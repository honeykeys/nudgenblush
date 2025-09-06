import { NudgeCandidate, NudgeType, GameState, Vibe, CallbackToken, GameLine } from '../types';
import { OpenAIService } from '../integrations/openai';
import { WeaviateService } from '../integrations/weaviate';

interface FreshnessFeatures {
  surprise: number; // 0-1, embedding distance vs recent lines
  diversityGain: number; // 0-1, avoid repetitive moves
  beatBalance: number; // 0-1, serve underused emotional beats
  callbackRevival: number; // 0-1, bonus for surfacing dormant tokens
  stagnationBuster: number; // 0-1, bonus if story is plateauing
}

interface CoherenceFeatures {
  personaDrift: number; // 0-1, risk of character inconsistency
  actGrammarClash: number; // 0-1, violates current act expectations
  contradictionRisk: number; // 0-1, conflicts with established facts
  safetyRisk: number; // 0-1, PG-13 or consent violations
}

export class NudgeEngine {
  private openai: OpenAIService;
  private weaviate: WeaviateService;
  private embeddingCache: Map<string, number[]> = new Map();

  constructor(openai: OpenAIService, weaviate: WeaviateService) {
    this.openai = openai;
    this.weaviate = weaviate;
  }

  async generateNudgeCandidates(
    gameState: GameState,
    vibe: Vibe,
    setting: string,
    demoMode: boolean = false
  ): Promise<NudgeCandidate[]> {
    const candidates: NudgeCandidate[] = [];
    const nudgeTypes = this.selectNudgeTypes(gameState, vibe);
    
    // Limit to top 3 in demo mode
    const typesToProcess = demoMode ? nudgeTypes.slice(0, 3) : nudgeTypes;

    for (const nudgeType of typesToProcess) {
      try {
        const candidate = await this.createNudgeCandidate(
          nudgeType,
          gameState,
          vibe,
          setting
        );
        candidates.push(candidate);
      } catch (error) {
        console.error(`Error creating nudge candidate for ${nudgeType}:`, error);
      }
    }

    // Sort by net score (Freshness - λ·Coherence)
    candidates.sort((a, b) => b.netScore - a.netScore);
    
    return candidates;
  }

  private selectNudgeTypes(gameState: GameState, vibe: Vibe): NudgeType[] {
    const available: NudgeType[] = [];

    // Always consider basic nudges
    available.push('comfort', 'clarify');

    // Post-major nudge recovery bias
    if (gameState.shouldUseCalmingNudge && gameState.shouldUseCalmingNudge()) {
      return ['comfort', 'clarify'];
    }

    // Major nudges (if allowed)
    if (gameState.canUseMajorNudge && gameState.canUseMajorNudge()) {
      available.push('vulnerability', 'raise_stakes_light', 'aside_pair');
    }

    // Recall if we have tokens
    if (gameState.tokens.length > 0) {
      available.push('recall');
    }

    // Tempo control
    if (gameState.plateauCounter > 2) {
      available.push('tempo_up');
    } else if (gameState.loveGraph.tension > 0.7) {
      available.push('tempo_down');
    }

    // Prioritize by vibe preferences
    const prioritized = available.sort((a, b) => {
      const aIndex = vibe.nudgePriorities.indexOf(a);
      const bIndex = vibe.nudgePriorities.indexOf(b);
      if (aIndex === -1 && bIndex === -1) return 0;
      if (aIndex === -1) return 1;
      if (bIndex === -1) return -1;
      return aIndex - bIndex;
    });

    return prioritized.slice(0, 6); // Max 6 candidates
  }

  private async createNudgeCandidate(
    nudgeType: NudgeType,
    gameState: GameState,
    vibe: Vibe,
    setting: string
  ): Promise<NudgeCandidate> {
    const descriptor = this.getNudgeDescriptor(nudgeType, gameState);
    
    // Generate one-step preview
    const preview = await this.generateOneStepPreview(
      nudgeType,
      gameState,
      vibe,
      setting,
      descriptor
    );

    // Calculate freshness and coherence scores
    const freshnessScore = await this.calculateFreshnessScore(preview, gameState, nudgeType);
    const coherenceCost = this.calculateCoherenceCost(preview, gameState, vibe, nudgeType);
    const netScore = freshnessScore - (vibe.coherenceWeight * coherenceCost);

    const rationale = this.generateRationale(nudgeType, gameState, freshnessScore, coherenceCost);

    return {
      type: nudgeType,
      description: descriptor,
      oneStepPreview: preview,
      freshnessScore,
      coherenceCost,
      netScore,
      rationale
    };
  }

  private getNudgeDescriptor(nudgeType: NudgeType, gameState: GameState): string {
    switch (nudgeType) {
      case 'recall':
        const token = gameState.tokens.find(t => !t.scheduled);
        return `Surface the "${token?.content || 'dormant'}" callback naturally`;
        
      case 'vulnerability':
        return `${gameState.spotlightPair[0]} reveals something personal or emotionally significant`;
        
      case 'comfort':
        return `Gentle, supportive interaction that builds safety and connection`;
        
      case 'raise_stakes_light':
        return `Introduce mild tension or conflict without breaking the romantic mood`;
        
      case 'clarify':
        return `Clear up confusion or provide context to smooth narrative flow`;
        
      case 'aside_pair':
        return `Private moment between the spotlight pair, away from watchers`;
        
      case 'tempo_up':
        return `Quicken the pace with dynamic action or emotional intensity`;
        
      case 'tempo_down':
        return `Slow things down with reflection, tender moments, or quiet intimacy`;
        
      default:
        return `Apply ${nudgeType} to advance the romantic connection`;
    }
  }

  private async generateOneStepPreview(
    nudgeType: NudgeType,
    gameState: GameState,
    vibe: Vibe,
    setting: string,
    descriptor: string
  ): Promise<string> {
    const systemPrompt = this.openai.getBaseSystemPrompt() + `\n\n${vibe.tone}`;
    
    const rolloutPrompt = this.openai.getRolloutPrompt(
      gameState.currentAct,
      `${vibe.name}: ${vibe.tone}`,
      gameState.spotlightPair,
      gameState.watchers,
      setting,
      gameState.tokens.map(t => t.content),
      gameState.recentLines.map(l => `${l.speaker}: ${l.text}`),
      descriptor
    );

    return await this.openai.generateNudgePreview(systemPrompt, rolloutPrompt);
  }

  private async calculateFreshnessScore(
    preview: string,
    gameState: GameState,
    nudgeType: NudgeType
  ): Promise<number> {
    const features = await this.calculateFreshnessFeatures(preview, gameState, nudgeType);
    
    // Weighted combination of freshness features
    const weights = {
      surprise: 0.3,
      diversityGain: 0.25,
      beatBalance: 0.2,
      callbackRevival: 0.15,
      stagnationBuster: 0.1
    };

    return (
      features.surprise * weights.surprise +
      features.diversityGain * weights.diversityGain +
      features.beatBalance * weights.beatBalance +
      features.callbackRevival * weights.callbackRevival +
      features.stagnationBuster * weights.stagnationBuster
    );
  }

  private async calculateFreshnessFeatures(
    preview: string,
    gameState: GameState,
    nudgeType: NudgeType
  ): Promise<FreshnessFeatures> {
    // Get or generate embedding for preview
    let previewEmbedding = this.embeddingCache.get(preview);
    if (!previewEmbedding) {
      previewEmbedding = await this.openai.generateEmbedding(preview);
      this.embeddingCache.set(preview, previewEmbedding);
    }

    // Surprise: semantic distance from recent lines
    const surprise = await this.calculateSurprise(previewEmbedding, gameState);
    
    // Diversity: avoid repetitive nudge types
    const diversityGain = this.calculateDiversityGain(nudgeType, gameState);
    
    // Beat balance: serve underused emotional beats
    const beatBalance = this.calculateBeatBalance(nudgeType, gameState);
    
    // Callback revival: bonus for surfacing tokens
    const callbackRevival = nudgeType === 'recall' ? 0.8 : 0;
    
    // Stagnation buster: bonus if plateauing
    const stagnationBuster = gameState.plateauCounter >= 3 ? 0.6 : 0;

    return {
      surprise,
      diversityGain,
      beatBalance,
      callbackRevival,
      stagnationBuster
    };
  }

  private async calculateSurprise(
    previewEmbedding: number[],
    gameState: GameState
  ): Promise<number> {
    if (gameState.recentLines.length === 0) return 0.5;

    let totalSimilarity = 0;
    let count = 0;

    for (const line of gameState.recentLines.slice(-5)) {
      try {
        let lineEmbedding = this.embeddingCache.get(line.text);
        if (!lineEmbedding) {
          lineEmbedding = await this.openai.generateEmbedding(line.text);
          this.embeddingCache.set(line.text, lineEmbedding);
        }

        const similarity = this.cosineSimilarity(previewEmbedding, lineEmbedding);
        totalSimilarity += similarity;
        count++;
      } catch (error) {
        console.error('Error calculating similarity:', error);
      }
    }

    const averageSimilarity = count > 0 ? totalSimilarity / count : 0.5;
    return Math.max(0, 1 - averageSimilarity); // Higher surprise for lower similarity
  }

  private calculateDiversityGain(nudgeType: NudgeType, gameState: GameState): number {
    // Look at recent nudge types (would need to track this in game state)
    // For now, simple heuristic based on nudge type frequency
    const recentNudgeTypes = []; // This would come from game state history
    const typeCount = recentNudgeTypes.filter(t => t === nudgeType).length;
    return Math.max(0, 1 - (typeCount * 0.3));
  }

  private calculateBeatBalance(nudgeType: NudgeType, gameState: GameState): number {
    const { loveGraph } = gameState;
    
    // Score based on which emotional beat needs attention
    switch (nudgeType) {
      case 'vulnerability':
        return 1 - loveGraph.trust; // More valuable when trust is low
      case 'comfort':
        return 1 - loveGraph.comfort;
      case 'raise_stakes_light':
        return 1 - loveGraph.tension;
      case 'recall':
        return 1 - loveGraph.attraction;
      default:
        return 0.5;
    }
  }

  private calculateCoherenceCost(
    preview: string,
    gameState: GameState,
    vibe: Vibe,
    nudgeType: NudgeType
  ): number {
    const features = this.calculateCoherenceFeatures(preview, gameState, vibe, nudgeType);
    
    // All coherence features are costs (0 = good, 1 = bad)
    const weights = {
      personaDrift: 0.3,
      actGrammarClash: 0.25,
      contradictionRisk: 0.25,
      safetyRisk: 0.2
    };

    return (
      features.personaDrift * weights.personaDrift +
      features.actGrammarClash * weights.actGrammarClash +
      features.contradictionRisk * weights.contradictionRisk +
      features.safetyRisk * weights.safetyRisk
    );
  }

  private calculateCoherenceFeatures(
    preview: string,
    gameState: GameState,
    vibe: Vibe,
    nudgeType: NudgeType
  ): CoherenceFeatures {
    // Simple heuristics for coherence costs
    let personaDrift = 0;
    let actGrammarClash = 0;
    let contradictionRisk = 0;
    let safetyRisk = 0;

    // Act grammar checks
    if (gameState.currentAct === 1 && nudgeType === 'vulnerability') {
      actGrammarClash = 0.3; // Vulnerability too early
    }
    if (gameState.currentAct === 5 && nudgeType === 'raise_stakes_light') {
      actGrammarClash = 0.4; // Conflict too late
    }

    // Safety checks (basic keyword filtering)
    const lowerPreview = preview.toLowerCase();
    const unsafePatterns = ['explicit', 'graphic', 'non-consensual'];
    if (unsafePatterns.some(pattern => lowerPreview.includes(pattern))) {
      safetyRisk = 1.0;
    }

    return {
      personaDrift,
      actGrammarClash,
      contradictionRisk,
      safetyRisk
    };
  }

  private generateRationale(
    nudgeType: NudgeType,
    gameState: GameState,
    freshnessScore: number,
    coherenceCost: number
  ): string[] {
    const rationale: string[] = [];

    // Freshness rationales
    if (nudgeType === 'recall' && gameState.tokens.length > 0) {
      rationale.push('Dormant token');
    }
    if (freshnessScore > 0.6) {
      rationale.push('High novelty');
    }
    if (gameState.plateauCounter >= 3) {
      rationale.push('Beat balance');
    }

    // Coherence rationales
    if (coherenceCost > 0.5) {
      rationale.push('Coherence risk');
    }

    // Context rationales
    if (gameState.shouldUseCalmingNudge && gameState.shouldUseCalmingNudge()) {
      rationale.push('Post-major recovery');
    }

    return rationale.length > 0 ? rationale : ['Standard progression'];
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  clearEmbeddingCache(): void {
    this.embeddingCache.clear();
  }
}