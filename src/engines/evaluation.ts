import { EventEmitter } from 'events';
import { OpenAIService } from '../integrations/openai';
import {
  Act,
  NudgeType,
  NudgeIntensity,
  SpokenLine,
  Nudge,
  TelemetryEventUnion,
  TurnEndEvent,
  MetricTickEvent,
  EvaluationState,
  EvaluationScores,
  EvaluationRecommendation,
  EvaluationSnapshot,
  FragilityComponents,
  FreshnessComponents,
  CoherenceComponents
} from '../types/narrative';

export class EvaluationEngine extends EventEmitter {
  private openai: OpenAIService;
  private rollingWindow: SpokenLine[] = [];
  private recentDeltas: any[] = [];
  private evaluationSnapshots: EvaluationSnapshot[] = [];
  private lastRecommendationTime = 0;
  private majorNudgeCount = 0;
  private lastMajorNudgeTime = 0;
  private exchangeCounter = 0;
  
  // Operational defaults
  private readonly actCoherenceWeights: Record<Act, number> = {
    1: 0.7,
    2: 0.9, 
    3: 1.2,
    4: 1.6,
    5: 1.8
  };

  private readonly windowSize = 12; // Keep last K lines
  private readonly majorNudgeCooldown = 6; // exchanges
  private readonly minScoreThreshold = 0.3; // Abstain if below this

  constructor(openai: OpenAIService) {
    super();
    this.openai = openai;
  }

  // Hook: OnTelemetry - Process incoming telemetry events
  onTelemetry(event: TelemetryEventUnion): void {
    this.emit('telemetry_received', event);

    switch (event.kind) {
      case 'turn.end':
        this.processTurnEnd(event);
        break;
      case 'nudge.applied':
        this.processNudgeApplied(event);
        break;
      case 'metric.tick':
        this.processMetricTick(event);
        break;
    }
  }

  // Hook: Consider - Analyze state and return recommendation
  async consider(state: EvaluationState, lastLine?: SpokenLine): Promise<EvaluationRecommendation> {
    this.exchangeCounter++;

    try {
      // Update internal state
      if (lastLine) {
        this.addToRollingWindow(lastLine);
      }

      // Calculate fragility index
      const fragility = this.calculateFragilityIndex(state);
      
      // Generate candidate nudges
      const candidates = this.generateNudgeCandidates(state);
      
      // Score each candidate
      const scoredCandidates: Array<{nudge: Nudge, scores: EvaluationScores, rationales: string[]}> = [];
      
      for (const candidate of candidates) {
        const scores = await this.scoreNudgeCandidate(candidate, state, fragility);
        const rationales = this.generateRationales(candidate, scores, state);
        
        scoredCandidates.push({
          nudge: candidate,
          scores,
          rationales
        });
        
        // Store evaluation snapshot
        const snapshot: EvaluationSnapshot = {
          id: `eval_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          sceneId: state.structuralState.act.toString(), // Simplified
          candidate,
          scores,
          rationales,
          chosen: false,
          timestamp: Date.now()
        };
        this.evaluationSnapshots.push(snapshot);
      }

      // Sort by final score
      scoredCandidates.sort((a, b) => b.scores.finalScore - a.scores.finalScore);
      
      const bestCandidate = scoredCandidates[0];
      
      // Check if we should recommend or abstain
      if (!bestCandidate || bestCandidate.scores.finalScore < this.minScoreThreshold) {
        return {
          abstain: true,
          rationales: ['All candidates below minimum threshold', 'Maintaining current trajectory'],
          scores: {
            freshnessGain: 0,
            coherenceCost: 0,
            fragilityIndex: fragility.total,
            finalScore: 0
          }
        };
      }

      // Check cadence constraints
      const cadenceCheck = this.checkCadenceConstraints(bestCandidate.nudge);
      if (!cadenceCheck.allowed) {
        return {
          abstain: true,
          rationales: [cadenceCheck.reason, 'Respecting nudge cadence limits'],
          scores: bestCandidate.scores
        };
      }

      // Mark as chosen
      this.evaluationSnapshots.find(s => s.candidate === bestCandidate.nudge)!.chosen = true;

      return {
        autoNudge: bestCandidate.nudge,
        rationales: bestCandidate.rationales,
        scores: bestCandidate.scores,
        abstain: false
      };

    } catch (error) {
      console.error('Error in evaluation consider:', error);
      return {
        abstain: true,
        rationales: ['Evaluation error occurred', 'Defaulting to safe abstention'],
        scores: {
          freshnessGain: 0,
          coherenceCost: 1,
          fragilityIndex: 1,
          finalScore: -1
        }
      };
    }
  }

  // Process telemetry events
  private processTurnEnd(event: TurnEndEvent): void {
    this.addToRollingWindow(event.line);
    this.recentDeltas.push(event.deltas);
    
    // Keep only recent deltas
    if (this.recentDeltas.length > 10) {
      this.recentDeltas = this.recentDeltas.slice(-10);
    }
  }

  private processNudgeApplied(event: any): void {
    if (event.nudge.intensity === 'major') {
      this.majorNudgeCount++;
      this.lastMajorNudgeTime = this.exchangeCounter;
    }
  }

  private processMetricTick(event: MetricTickEvent): void {
    // Update internal metrics based on telemetry
    if (event.name === 'exchange_counter') {
      this.exchangeCounter = event.value;
    }
  }

  // Core scoring logic
  private async scoreNudgeCandidate(
    candidate: Nudge, 
    state: EvaluationState,
    fragility: FragilityComponents
  ): Promise<EvaluationScores> {
    
    // Calculate Freshness Gain
    const freshnessComponents = await this.calculateFreshnessGain(candidate, state);
    
    // Calculate Coherence Cost
    const coherenceComponents = this.calculateCoherenceCost(candidate, state);
    
    // Get act-weighted lambda
    const lambda = this.calculateLambda(fragility.total, state.structuralState.act);
    
    // Final score: FreshnessGain - λ * CoherenceCost
    const finalScore = freshnessComponents.total - (lambda * coherenceComponents.total);

    return {
      freshnessGain: freshnessComponents.total,
      coherenceCost: coherenceComponents.total,
      fragilityIndex: fragility.total,
      finalScore: Math.max(-1, Math.min(1, finalScore))
    };
  }

  private calculateFragilityIndex(state: EvaluationState): FragilityComponents {
    // High Tension component
    const avgTension = this.recentDeltas.length > 0 
      ? this.recentDeltas.reduce((sum, delta) => sum + delta.tension, 0) / this.recentDeltas.length
      : 0.2;
    const highTension = Math.max(0, avgTension - 0.5) * 2; // Scale tension above 0.5

    // Low Trust component  
    const avgTrust = this.recentDeltas.length > 0
      ? this.recentDeltas.reduce((sum, delta) => sum + delta.trust, 0) / this.recentDeltas.length
      : 0.3;
    const lowTrust = Math.max(0, 0.5 - avgTrust) * 2; // Scale trust below 0.5

    // Recent contradictions (simplified heuristic)
    const recentContradictions = this.detectContradictions();

    const total = Math.min(1, 0.4 * highTension + 0.4 * lowTrust + 0.2 * recentContradictions);

    return {
      highTension,
      lowTrust,
      recentContradictions,
      total
    };
  }

  private async calculateFreshnessGain(candidate: Nudge, state: EvaluationState): FreshnessComponents {
    // Semantic novelty vs last N lines
    const semanticNovelty = await this.calculateSemanticNovelty(candidate);
    
    // Diversity bonus for underused nudges
    const diversityBonus = this.calculateDiversityBonus(candidate.type);
    
    // Stagnation buster if chemistry deltas are flattening
    const stagnationBuster = this.calculateStagnationBuster();
    
    // Dormant callback revival bonus
    const callbackRevival = candidate.token ? 0.3 : 0;

    const total = Math.min(1, 
      0.4 * semanticNovelty +
      0.3 * diversityBonus + 
      0.2 * stagnationBuster +
      0.1 * callbackRevival
    );

    return {
      semanticNovelty,
      diversityBonus,
      stagnationBuster,
      callbackRevival,
      total
    };
  }

  private calculateCoherenceCost(candidate: Nudge, state: EvaluationState): CoherenceComponents {
    // Persona drift risk (simplified)
    const personaDrift = this.assessPersonaDriftRisk(candidate, state);
    
    // Beat/act grammar violations
    const actGrammarViolation = this.assessActGrammarViolation(candidate, state.structuralState.act);
    
    // Continuity/open-loop contradictions
    const continuityContradiction = this.assessContinuityRisk(candidate, state);
    
    // Safety guard (hard block)
    const safetyGuard = this.assessSafetyRisk(candidate);

    // Weight by act (higher coherence requirements in later acts)
    const actWeight = (state.structuralState.act - 1) * 0.1 + 1;
    
    const total = Math.min(1, actWeight * (
      0.3 * personaDrift +
      0.25 * actGrammarViolation +
      0.25 * continuityContradiction +
      0.2 * safetyGuard
    ));

    return {
      personaDrift,
      actGrammarViolation,
      continuityContradiction,
      safetyGuard,
      total
    };
  }

  private calculateLambda(fragility: number, act: Act): number {
    const baseWeight = this.actCoherenceWeights[act];
    // Lerp between 0.6 and 1.8 based on fragility, then multiply by act weight
    const fragilityMultiplier = 0.6 + (fragility * 1.2);
    return baseWeight * fragilityMultiplier;
  }

  // Candidate generation
  private generateNudgeCandidates(state: EvaluationState): Nudge[] {
    const candidates: Nudge[] = [];
    const act = state.structuralState.act;

    // Define available nudges per act
    const availableNudges: Record<Act, NudgeType[]> = {
      1: ['comfort', 'vulnerability', 'recall', 'tempo_down'],
      2: ['comfort', 'vulnerability', 'recall', 'aside', 'tempo_up', 'raise_stakes'],
      3: ['raise_stakes', 'vulnerability', 'aside', 'tempo_up'],
      4: ['comfort', 'vulnerability', 'recall', 'tempo_down'],
      5: ['comfort', 'recall', 'tempo_down']
    };

    const actNudges = availableNudges[act] || [];

    for (const nudgeType of actNudges) {
      const intensity = this.determineNudgeIntensity(nudgeType);
      
      const candidate: Nudge = {
        type: nudgeType,
        intensity,
        source: 'auto',
        metadata: {
          generatedAt: Date.now(),
          actContext: act
        }
      };

      // Add token for recall nudges
      if (nudgeType === 'recall' && state.callbackActivity.length > 0) {
        candidate.token = state.callbackActivity[0]; // Use first available callback
      }

      candidates.push(candidate);
    }

    return candidates.slice(0, 5); // Limit to top 5 candidates
  }

  private determineNudgeIntensity(nudgeType: NudgeType): NudgeIntensity {
    const majorNudges: NudgeType[] = ['raise_stakes'];
    return majorNudges.includes(nudgeType) ? 'major' : 'minor';
  }

  // Cadence checking
  private checkCadenceConstraints(nudge: Nudge): { allowed: boolean; reason: string } {
    if (nudge.intensity === 'major') {
      const exchangesSinceLastMajor = this.exchangeCounter - this.lastMajorNudgeTime;
      
      if (exchangesSinceLastMajor < this.majorNudgeCooldown) {
        return {
          allowed: false,
          reason: `Major nudge cooldown: ${this.majorNudgeCooldown - exchangesSinceLastMajor} exchanges remaining`
        };
      }
    }

    // Check for recovery period after major nudge
    if (this.exchangeCounter - this.lastMajorNudgeTime <= 2) {
      if (!['comfort', 'clarify'].includes(nudge.type as any)) {
        return {
          allowed: false,
          reason: 'Recovery period active - comfort/clarify nudges preferred'
        };
      }
    }

    return { allowed: true, reason: 'Cadence constraints satisfied' };
  }

  // Component calculations
  private async calculateSemanticNovelty(candidate: Nudge): Promise<number> {
    if (this.rollingWindow.length < 2) return 0.8;

    try {
      // Create a mock line based on the nudge type
      const mockLine = this.generateMockLine(candidate);
      const mockEmbedding = await this.openai.generateEmbedding(mockLine);
      
      // Compare with recent lines
      let totalSimilarity = 0;
      let comparisons = 0;
      
      for (const line of this.rollingWindow.slice(-3)) {
        const lineEmbedding = await this.openai.generateEmbedding(line.text);
        const similarity = this.cosineSimilarity(mockEmbedding, lineEmbedding);
        totalSimilarity += similarity;
        comparisons++;
      }

      const avgSimilarity = comparisons > 0 ? totalSimilarity / comparisons : 0.5;
      return Math.max(0, 1 - avgSimilarity);

    } catch (error) {
      console.error('Error calculating semantic novelty:', error);
      return 0.5; // Default moderate novelty
    }
  }

  private calculateDiversityBonus(nudgeType: NudgeType): number {
    // Track recent nudge usage (would be more sophisticated in full implementation)
    const recentNudges = this.evaluationSnapshots
      .slice(-10)
      .filter(s => s.chosen)
      .map(s => s.candidate.type);
    
    const recentUsage = recentNudges.filter(type => type === nudgeType).length;
    
    // Higher bonus for less used nudges
    return Math.max(0, 1 - (recentUsage * 0.3));
  }

  private calculateStagnationBuster(): number {
    if (this.recentDeltas.length < 3) return 0;

    // Check if recent chemistry deltas are flattening
    const recentMagnitudes = this.recentDeltas.slice(-3).map(delta =>
      Math.abs(delta.attraction) + Math.abs(delta.trust) + 
      Math.abs(delta.tension) + Math.abs(delta.comfort)
    );

    const avgMagnitude = recentMagnitudes.reduce((a, b) => a + b, 0) / recentMagnitudes.length;
    
    // Higher bonus if deltas are very small (stagnating)
    return avgMagnitude < 0.05 ? 0.8 : 0.2;
  }

  private assessPersonaDriftRisk(candidate: Nudge, state: EvaluationState): number {
    // Simplified: certain nudges have higher persona drift risk
    const riskMap: Record<NudgeType, number> = {
      raise_stakes: 0.3,
      vulnerability: 0.1,
      comfort: 0.05,
      recall: 0.1,
      aside: 0.2,
      tempo_up: 0.15,
      tempo_down: 0.1
    };

    return riskMap[candidate.type] || 0.1;
  }

  private assessActGrammarViolation(candidate: Nudge, act: Act): number {
    // Check if nudge violates act expectations
    const violations: Record<Act, Record<NudgeType, number>> = {
      1: { raise_stakes: 0.8 }, // High violation - no stakes in setup
      2: {},
      3: { comfort: 0.6 }, // Medium violation - climax shouldn't be too comfortable
      4: { raise_stakes: 0.7 }, // High violation - no new stakes in resolution
      5: { raise_stakes: 0.9, aside: 0.8 } // Very high violation - no complications in ending
    };

    const actViolations = violations[act] || {};
    return actViolations[candidate.type] || 0.1; // Small baseline violation
  }

  private assessContinuityRisk(candidate: Nudge, state: EvaluationState): number {
    // Simplified continuity risk assessment
    if (candidate.type === 'recall' && state.callbackActivity.length === 0) {
      return 0.8; // High risk - trying to recall when no callbacks available
    }

    return 0.1; // Low baseline risk
  }

  private assessSafetyRisk(candidate: Nudge): number {
    // Safety is handled upstream, but flag any potentially risky nudges
    if (candidate.type === 'raise_stakes' && candidate.intensity === 'major') {
      return 0.2; // Slight risk with major stakes
    }
    
    return 0.05; // Minimal baseline safety risk
  }

  // Utility methods
  private addToRollingWindow(line: SpokenLine): void {
    this.rollingWindow.push(line);
    if (this.rollingWindow.length > this.windowSize) {
      this.rollingWindow = this.rollingWindow.slice(-this.windowSize);
    }
  }

  private detectContradictions(): number {
    // Simplified contradiction detection
    if (this.rollingWindow.length < 2) return 0;

    const recent = this.rollingWindow.slice(-2);
    
    // Look for obvious contradictory patterns
    const contradictoryPairs = [
      ['yes', 'no'],
      ['love', 'hate'], 
      ['trust', 'distrust'],
      ['want', 'don\'t want']
    ];

    for (const [word1, word2] of contradictoryPairs) {
      if (recent[0].text.toLowerCase().includes(word1) && 
          recent[1].text.toLowerCase().includes(word2)) {
        return 0.5; // Medium contradiction detected
      }
    }

    return 0.1; // Low baseline contradiction risk
  }

  private generateMockLine(candidate: Nudge): string {
    const mockLines: Record<NudgeType, string> = {
      raise_stakes: 'Things just got more complicated between us.',
      comfort: 'Everything is going to be okay.',
      vulnerability: 'I need to tell you something important.',
      recall: 'I keep thinking about what happened.',
      aside: 'Can we talk privately for a moment?',
      tempo_up: 'We need to move faster on this.',
      tempo_down: 'Let\'s take this slowly and carefully.'
    };

    return mockLines[candidate.type] || 'Something is happening here.';
  }

  private generateRationales(
    candidate: Nudge, 
    scores: EvaluationScores,
    state: EvaluationState
  ): string[] {
    const rationales: string[] = [];

    // Freshness rationales
    if (scores.freshnessGain > 0.7) {
      rationales.push('High novelty potential');
    }

    if (candidate.token) {
      rationales.push('Dormant callback revival');
    }

    if (this.calculateStagnationBuster() > 0.6) {
      rationales.push('Story momentum stagnating');
    }

    // Coherence rationales
    if (scores.coherenceCost > 0.5) {
      rationales.push('Moderate coherence risk');
    }

    // Act-specific rationales
    if (state.structuralState.act >= 4 && candidate.type === 'raise_stakes') {
      rationales.push('Late-act stakes escalation');
    }

    if (state.structuralState.act <= 2 && candidate.type === 'vulnerability') {
      rationales.push('Early vulnerability building');
    }

    // Fragility rationales
    if (scores.fragilityIndex > 0.6 && candidate.type === 'comfort') {
      rationales.push('Fragile scene needs stabilization');
    }

    return rationales.length > 0 ? rationales : ['Standard progression nudge'];
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

  // Public accessors
  getEvaluationSnapshots(): EvaluationSnapshot[] {
    return this.evaluationSnapshots.slice();
  }

  getRecentScores(): EvaluationScores[] {
    return this.evaluationSnapshots
      .slice(-5)
      .map(snapshot => snapshot.scores);
  }

  clearSnapshots(): void {
    this.evaluationSnapshots = [];
  }

  // Export metrics for debugging
  exportMetrics(): any {
    return {
      exchangeCounter: this.exchangeCounter,
      windowSize: this.rollingWindow.length,
      majorNudgeCount: this.majorNudgeCount,
      lastMajorNudgeTime: this.lastMajorNudgeTime,
      recentDeltas: this.recentDeltas.slice(-3),
      snapshotCount: this.evaluationSnapshots.length
    };
  }
}