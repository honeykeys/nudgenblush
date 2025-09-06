import { OpenAIService } from '../integrations/openai';
import { WeaviateService } from '../integrations/weaviate';
import { SafetyGuardian } from '../utils/safety';
import {
  CharacterCard,
  SideCharacterCard,
  Intent,
  SideIntent,
  AgentState,
  IntentBundle,
  LineDraft,
  FinalLine,
  SideTriggers,
  SelfCheckResult,
  RecallCandidate,
  UtilityScores,
  TelemetryData,
  RepairDirective,
  ChemDeltas,
  RiskFlags
} from '../types/character';

export class LeadAgent {
  private openai: OpenAIService;
  private weaviate: WeaviateService;
  private safety: SafetyGuardian;
  private telemetry: TelemetryData[] = [];
  private intentHistory: Map<string, Intent[]> = new Map();

  constructor(openai: OpenAIService, weaviate: WeaviateService, safety: SafetyGuardian) {
    this.openai = openai;
    this.weaviate = weaviate;
    this.safety = safety;
  }

  async perceive(state: AgentState, card: CharacterCard): Promise<AgentState> {
    const enhanced_state = { ...state };
    
    // Compute scene fragility
    const love_graph = state.love_graph_edge || { attraction: 0, trust: 0, tension: 0, comfort: 0 };
    const tension_factor = love_graph.tension;
    const trust_factor = 1 - love_graph.trust;
    
    // Check for recent contradictions (simplified heuristic)
    const recent_contradictions = 0; // Would analyze recent lines for logical inconsistencies
    
    enhanced_state.scene_fragility = Math.min(1, 
      0.4 * tension_factor + 0.4 * trust_factor + 0.2 * recent_contradictions
    );
    
    return enhanced_state;
  }

  async recall(state: AgentState, card: CharacterCard): Promise<RecallCandidate | null> {
    try {
      // Get embedding for recent context
      const recent_context = state.recent_lines
        .slice(-4)
        .map(line => `${line.speaker}: ${line.text}`)
        .join(' ');
      
      if (!recent_context.trim()) return null;
      
      const context_embedding = await this.openai.generateEmbedding(recent_context);
      
      // Query top-K similar lines from Weaviate
      const similar_lines = await this.weaviate.retrieveSimilarLines(
        'current_story', // Would use actual story ID
        context_embedding,
        10
      );
      
      // Get relevant tokens
      const relevant_tokens = await this.weaviate.retrieveRelevantTokens(
        'current_story',
        context_embedding,
        5
      );
      
      if (relevant_tokens.length === 0) return null;
      
      // Rank tokens by salience × dormancy × semantic fit
      const current_turn = state.recent_lines.length;
      const candidates: RecallCandidate[] = relevant_tokens.map(token => {
        const salience = token.salience;
        const dormancy = Math.min(1, (current_turn - token.lastSeenTurn) / 10); // More dormant = higher score
        const semantic_fit = 0.8; // Simplified - would use actual cosine similarity
        
        return {
          token: token.token,
          salience,
          dormancy,
          semantic_fit,
          relevance_score: salience * dormancy * semantic_fit
        };
      });
      
      // Return best candidate if semantic fit ≥ 0.6
      const best_candidate = candidates
        .filter(c => c.semantic_fit >= 0.6)
        .sort((a, b) => b.relevance_score - a.relevance_score)[0];
      
      return best_candidate || null;
      
    } catch (error) {
      console.error('Error in recall:', error);
      return null;
    }
  }

  async selectIntent(state: AgentState, card: CharacterCard, recall?: RecallCandidate): Promise<IntentBundle> {
    const available_intents: Intent[] = [
      'reassure', 'reveal', 'invite', 'tease', 'challenge', 
      'clarify', 'apologize', 'deflect', 'ask', 'accept', 'decline', 'mischief'
    ];
    
    // Filter out recently used intents to encourage variety
    const character_history = this.intentHistory.get(card.id) || [];
    const recent_intents = character_history.slice(-2);
    
    const viable_intents = available_intents.filter(intent => 
      !recent_intents.includes(intent) || intent === 'clarify' // Clarify is always allowed
    );
    
    let best_intent: Intent = 'reassure';
    let best_utility = -1;
    let best_scores: UtilityScores = {
      goal_alignment: 0,
      relational_gain: 0,
      act_vibe_fit: 0,
      nudge_alignment: 0,
      freshness_potential: 0,
      coherence_risk: 0,
      total_utility: 0
    };
    
    // Evaluate each viable intent
    for (const intent of viable_intents) {
      const utility_scores = this.calculateUtility(intent, state, card, recall);
      if (utility_scores.total_utility > best_utility) {
        best_utility = utility_scores.total_utility;
        best_intent = intent;
        best_scores = utility_scores;
      }
    }
    
    // Predict deltas based on intent and character traits
    const predicted_deltas = this.predictDeltas(best_intent, card, state);
    
    // Assess risk flags
    const risk_flags = this.assessRisks(best_intent, state, card);
    
    // Calculate confidence based on utility and risk
    const confidence = Math.max(0.1, best_utility * (1 - this.getRiskPenalty(risk_flags)));
    
    return {
      speaker: card.id,
      intent: best_intent,
      targets: this.getIntentTargets(best_intent, state),
      recall_token: recall?.token,
      predicted_deltas,
      risk_flags,
      confidence
    };
  }

  private calculateUtility(intent: Intent, state: AgentState, card: CharacterCard, recall?: RecallCandidate): UtilityScores {
    const goal_alignment = this.scoreGoalAlignment(intent, card);
    const relational_gain = this.scoreRelationalGain(intent, state, card);
    const act_vibe_fit = this.scoreActVibeFit(intent, state);
    const nudge_alignment = this.scoreNudgeAlignment(intent, state.bias_flags);
    const freshness_potential = this.scoreFreshnessPotential(intent, state, card);
    const coherence_risk = this.scoreCoherenceRisk(intent, state, card);
    
    const total_utility = 
      0.30 * goal_alignment +
      0.20 * relational_gain +
      0.15 * act_vibe_fit +
      0.15 * nudge_alignment +
      0.10 * freshness_potential -
      0.10 * coherence_risk;
    
    return {
      goal_alignment,
      relational_gain,
      act_vibe_fit,
      nudge_alignment,
      freshness_potential,
      coherence_risk,
      total_utility
    };
  }

  private scoreGoalAlignment(intent: Intent, card: CharacterCard): number {
    // Match intent to character goals
    const goal_keywords = card.goals.join(' ').toLowerCase();
    
    switch (intent) {
      case 'reveal': return goal_keywords.includes('honest') || goal_keywords.includes('vulnerable') ? 0.9 : 0.4;
      case 'reassure': return goal_keywords.includes('supportive') || goal_keywords.includes('caring') ? 0.9 : 0.5;
      case 'challenge': return goal_keywords.includes('growth') || goal_keywords.includes('push') ? 0.8 : 0.3;
      case 'invite': return card.traits.extraversion > 0.6 ? 0.8 : 0.4;
      case 'deflect': return card.traits.stability < 0.4 ? 0.7 : 0.2;
      default: return 0.5;
    }
  }

  private scoreRelationalGain(intent: Intent, state: AgentState, card: CharacterCard): number {
    const love_graph = state.love_graph_edge || { attraction: 0, trust: 0, tension: 0, comfort: 0 };
    
    switch (intent) {
      case 'reassure': return 1 - love_graph.comfort; // More valuable when comfort is low
      case 'reveal': return 1 - love_graph.trust; // More valuable when trust is low
      case 'invite': return 1 - love_graph.attraction; // More valuable when attraction is low
      case 'challenge': return love_graph.comfort > 0.7 ? 0.8 : 0.2; // Good when very comfortable
      case 'tease': return love_graph.attraction > 0.4 ? 0.7 : 0.3; // Need some attraction first
      default: return 0.5;
    }
  }

  private scoreActVibeFit(intent: Intent, state: AgentState): number {
    // Act-specific scoring
    switch (state.act) {
      case 1: // Setup - avoid heavy reveals/challenges
        if (['reveal', 'challenge', 'apologize'].includes(intent)) return 0.2;
        if (['invite', 'ask', 'tease'].includes(intent)) return 0.8;
        return 0.5;
        
      case 2: // Rising Action - building connection
        if (['reveal', 'invite', 'reassure'].includes(intent)) return 0.8;
        if (['deflect', 'decline'].includes(intent)) return 0.3;
        return 0.6;
        
      case 3: // Climax - high stakes emotions
        if (['challenge', 'reveal', 'apologize'].includes(intent)) return 0.9;
        if (['mischief', 'deflect'].includes(intent)) return 0.2;
        return 0.5;
        
      case 4: // Falling Action - resolution
        if (['reassure', 'accept', 'clarify'].includes(intent)) return 0.8;
        if (['challenge', 'tease'].includes(intent)) return 0.3;
        return 0.6;
        
      case 5: // Resolution - commitment
        if (['accept', 'reassure', 'invite'].includes(intent)) return 0.9;
        if (['decline', 'deflect'].includes(intent)) return 0.1;
        return 0.5;
        
      default:
        return 0.5;
    }
  }

  private scoreNudgeAlignment(intent: Intent, bias_flags: any): number {
    let score = 0.5;
    
    if (bias_flags.bias_self_disclosure && ['reveal', 'apologize'].includes(intent)) {
      score += 0.4 * (bias_flags.bias_self_disclosure || 0);
    }
    
    if (bias_flags.bias_reassure && intent === 'reassure') {
      score += 0.4 * (bias_flags.bias_reassure || 0);
    }
    
    if (bias_flags.bias_stakes && ['challenge', 'tease'].includes(intent)) {
      score += 0.3 * (bias_flags.bias_stakes || 0);
    }
    
    if (bias_flags.bias_clarify && intent === 'clarify') {
      score += 0.5;
    }
    
    return Math.min(1, score);
  }

  private scoreFreshnessPotential(intent: Intent, state: AgentState, card: CharacterCard): number {
    const character_history = this.intentHistory.get(card.id) || [];
    const recent_count = character_history.filter(h => h === intent).length;
    
    // Penalize repetition
    return Math.max(0, 1 - (recent_count * 0.3));
  }

  private scoreCoherenceRisk(intent: Intent, state: AgentState, card: CharacterCard): number {
    let risk = 0;
    
    // Persona risk - inconsistent with character traits
    if (intent === 'challenge' && card.traits.agreeableness > 0.8) risk += 0.3;
    if (intent === 'reveal' && card.traits.openness < 0.3) risk += 0.4;
    if (intent === 'deflect' && card.traits.stability > 0.8) risk += 0.2;
    
    // Scene fragility risk
    if (state.scene_fragility && state.scene_fragility > 0.7) {
      if (['challenge', 'tease', 'decline'].includes(intent)) risk += 0.3;
    }
    
    return Math.min(1, risk);
  }

  private predictDeltas(intent: Intent, card: CharacterCard, state: AgentState): ChemDeltas {
    const base_deltas: ChemDeltas = { attraction: 0, trust: 0, tension: 0, comfort: 0 };
    
    switch (intent) {
      case 'reassure':
        base_deltas.comfort += 0.1;
        base_deltas.trust += 0.05;
        break;
      case 'reveal':
        base_deltas.trust += 0.1;
        base_deltas.attraction += 0.05;
        base_deltas.tension += 0.02;
        break;
      case 'invite':
        base_deltas.attraction += 0.08;
        base_deltas.tension += 0.03;
        break;
      case 'challenge':
        base_deltas.tension += 0.1;
        base_deltas.attraction += 0.03;
        break;
      case 'tease':
        base_deltas.attraction += 0.06;
        base_deltas.tension += 0.04;
        break;
      default:
        base_deltas.attraction += 0.02;
        base_deltas.comfort += 0.01;
    }
    
    // Modify based on character traits
    const trait_modifier = (card.traits.extraversion + card.traits.agreeableness) / 2;
    Object.keys(base_deltas).forEach(key => {
      base_deltas[key as keyof ChemDeltas] *= (0.8 + 0.4 * trait_modifier);
    });
    
    return base_deltas;
  }

  private assessRisks(intent: Intent, state: AgentState, card: CharacterCard): RiskFlags {
    const risks: RiskFlags = {};
    
    // Safety risk for certain intents in certain contexts
    if (['challenge', 'tease'].includes(intent) && state.scene_fragility && state.scene_fragility > 0.8) {
      risks.safety = true;
    }
    
    // Continuity risk if going against established character behavior
    const character_history = this.intentHistory.get(card.id) || [];
    if (character_history.length > 0) {
      const typical_behavior = this.getTypicalBehavior(character_history);
      if (this.isIntentInconsistent(intent, typical_behavior, card)) {
        risks.continuity = true;
      }
    }
    
    // Act gate risk if intent doesn't fit current act
    if (state.act === 1 && ['reveal', 'apologize', 'challenge'].includes(intent)) {
      risks.act_gate = true;
    }
    
    return risks;
  }

  private getIntentTargets(intent: Intent, state: AgentState): string[] {
    // For romance, usually targeting the other person in spotlight pair
    return state.spotlight.filter(id => id !== state.spotlight[0]); // Simplified
  }

  private getRiskPenalty(risks: RiskFlags): number {
    let penalty = 0;
    if (risks.safety) penalty += 0.3;
    if (risks.continuity) penalty += 0.2;
    if (risks.act_gate) penalty += 0.1;
    return Math.min(0.8, penalty);
  }

  private getTypicalBehavior(history: Intent[]): Intent[] {
    // Return most common intents from history
    const counts = history.reduce((acc, intent) => {
      acc[intent] = (acc[intent] || 0) + 1;
      return acc;
    }, {} as Record<Intent, number>);
    
    return Object.entries(counts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)
      .map(([intent]) => intent as Intent);
  }

  private isIntentInconsistent(intent: Intent, typical: Intent[], card: CharacterCard): boolean {
    // Check if intent is dramatically inconsistent with past behavior and traits
    if (typical.length === 0) return false;
    
    // If character typically deflects but now wants to reveal
    if (typical.includes('deflect') && intent === 'reveal') return true;
    
    // If character typically challenges but now wants to reassure (without good reason)
    if (typical.includes('challenge') && intent === 'reassure' && card.traits.agreeableness < 0.3) return true;
    
    return false;
  }

  async draft(state: AgentState, card: CharacterCard, intent_bundle: IntentBundle): Promise<LineDraft> {
    const persona_overlay = this.buildPersonaOverlay(card);
    const bias_instructions = this.buildBiasInstructions(state.bias_flags);
    const context_lines = state.recent_lines.slice(-6).map(line => `${line.speaker}: ${line.text}`).join('\n');
    
    const system_prompt = `${this.openai.getBaseSystemPrompt()}
    
${persona_overlay}

${bias_instructions}

Remember: Lines must be ≤9 seconds when spoken aloud. Focus on subtext over exposition.`;

    const user_prompt = `Current context:
Act: ${state.act}/5
Vibe: ${state.vibe}
Setting: ${state.setting}
Your character: ${card.name}
Your intent: ${intent_bundle.intent}
${intent_bundle.recall_token ? `Weave this token naturally: "${intent_bundle.recall_token}"` : ''}

Recent lines:
${context_lines}

Generate one line for ${card.name} that expresses "${intent_bundle.intent}" while staying true to their personality and the scene's mood.`;

    try {
      const generated_text = await this.openai.generateMainLine(system_prompt, user_prompt, 0.8);
      
      // Calculate novelty and coherence cost
      const novelty = await this.calculateNovelty(generated_text, state);
      const coherence_cost = this.calculateCoherenceCost(generated_text, card, state);
      
      return {
        speaker: card.id,
        text: generated_text,
        used_token: intent_bundle.recall_token,
        novelty,
        coherence_cost
      };
      
    } catch (error) {
      console.error('Error in draft generation:', error);
      
      // Fallback line based on intent
      const fallback_text = this.getFallbackLine(intent_bundle.intent, card);
      
      return {
        speaker: card.id,
        text: fallback_text,
        used_token: intent_bundle.recall_token,
        novelty: 0.3,
        coherence_cost: 0.1
      };
    }
  }

  private buildPersonaOverlay(card: CharacterCard): string {
    const trait_descriptions = this.describeTraits(card.traits);
    
    return `CHARACTER: ${card.name} (${card.pronouns})
Voice: ${card.voice_style}

PERSONALITY:
${trait_descriptions}

GOALS (in priority order):
${card.goals.map((goal, i) => `${i + 1}. ${goal}`).join('\n')}

VALUES: ${card.values.join(', ')}

HARD LIMITS (never violate): ${card.hard_limits.join(', ')}

LOVE LANGUAGE: 
- Words of affirmation: ${(card.love_lang.words * 100).toFixed(0)}%
- Quality time: ${(card.love_lang.time * 100).toFixed(0)}%
- Acts of service: ${(card.love_lang.acts * 100).toFixed(0)}%
- Physical touch: ${(card.love_lang.touch * 100).toFixed(0)}%
- Gifts: ${(card.love_lang.gifts * 100).toFixed(0)}%

SPEECH HABITS: ${card.tics.join(', ')}`;
  }

  private describeTraits(traits: any): string {
    const descriptions = [];
    
    if (traits.openness > 0.7) descriptions.push('Very open to new experiences and ideas');
    else if (traits.openness < 0.3) descriptions.push('Prefers familiar, traditional approaches');
    
    if (traits.agreeableness > 0.7) descriptions.push('Highly cooperative and trusting');
    else if (traits.agreeableness < 0.3) descriptions.push('Direct, competitive, skeptical');
    
    if (traits.extraversion > 0.7) descriptions.push('Outgoing, energetic, seeks stimulation');
    else if (traits.extraversion < 0.3) descriptions.push('Reserved, quiet, independent');
    
    if (traits.conscientiousness > 0.7) descriptions.push('Organized, disciplined, goal-focused');
    else if (traits.conscientiousness < 0.3) descriptions.push('Flexible, spontaneous, adaptable');
    
    if (traits.stability > 0.7) descriptions.push('Emotionally stable, calm under pressure');
    else if (traits.stability < 0.3) descriptions.push('Emotionally reactive, sensitive to stress');
    
    return descriptions.join('. ') + '.';
  }

  private buildBiasInstructions(bias_flags: any): string {
    const instructions = [];
    
    if (bias_flags.bias_self_disclosure) {
      instructions.push(`BIAS: Show vulnerability/openness (strength: ${(bias_flags.bias_self_disclosure * 100).toFixed(0)}%)`);
    }
    
    if (bias_flags.bias_reassure) {
      instructions.push(`BIAS: Offer comfort/support (strength: ${(bias_flags.bias_reassure * 100).toFixed(0)}%)`);
    }
    
    if (bias_flags.bias_stakes) {
      instructions.push(`BIAS: Raise emotional stakes slightly (strength: ${(bias_flags.bias_stakes * 100).toFixed(0)}%)`);
    }
    
    if (bias_flags.bias_clarify) {
      instructions.push('BIAS: Clarify confusion or provide context');
    }
    
    if (bias_flags.cap_line_sec) {
      instructions.push(`LENGTH CAP: Maximum ${bias_flags.cap_line_sec} seconds when spoken`);
    }
    
    if (bias_flags.aside_pair) {
      instructions.push(`ASIDE: Private moment between ${bias_flags.aside_pair.join(' and ')}`);
    }
    
    return instructions.length > 0 ? instructions.join('\n') : '';
  }

  private async calculateNovelty(text: string, state: AgentState): number {
    // Compare against recent lines for semantic similarity
    if (state.recent_lines.length === 0) return 0.8;
    
    try {
      const text_embedding = await this.openai.generateEmbedding(text);
      let total_similarity = 0;
      let comparisons = 0;
      
      for (const line of state.recent_lines.slice(-3)) {
        const line_embedding = await this.openai.generateEmbedding(line.text);
        const similarity = this.cosineSimilarity(text_embedding, line_embedding);
        total_similarity += similarity;
        comparisons++;
      }
      
      const avg_similarity = comparisons > 0 ? total_similarity / comparisons : 0;
      return Math.max(0, 1 - avg_similarity); // Higher novelty = lower similarity
      
    } catch (error) {
      console.error('Error calculating novelty:', error);
      return 0.5;
    }
  }

  private calculateCoherenceCost(text: string, card: CharacterCard, state: AgentState): number {
    let cost = 0;
    
    // Voice style consistency
    const text_lower = text.toLowerCase();
    switch (card.voice_style) {
      case 'warm':
        if (!text_lower.match(/\b(dear|sweet|love|heart|gentle)\b/)) cost += 0.1;
        break;
      case 'wry':
        if (!text_lower.match(/\b(well|really|quite|suppose|rather)\b/)) cost += 0.1;
        break;
      case 'direct':
        if (text.length > 100) cost += 0.2; // Too wordy for direct style
        break;
      case 'poetic':
        if (!text_lower.match(/\b(like|as|seems|feels|whisper)\b/)) cost += 0.1;
        break;
    }
    
    // Tic consistency
    const has_tic = card.tics.some(tic => text_lower.includes(tic.toLowerCase()));
    if (!has_tic && Math.random() < 0.3) cost += 0.1; // Should occasionally use tics
    
    // Length check (≤9 seconds ≈ 15-20 words)
    const word_count = text.split(' ').length;
    if (word_count > 20) cost += 0.3;
    
    return Math.min(1, cost);
  }

  private getFallbackLine(intent: Intent, card: CharacterCard): string {
    const fallbacks = {
      reassure: `${card.tics[0] || 'Hey'}, it's going to be okay.`,
      reveal: `I should probably tell you something...`,
      invite: `Would you like to... maybe...?`,
      tease: `Oh, really? ${card.tics[0] || 'Interesting'}.`,
      challenge: `Are you sure about that?`,
      clarify: `Wait, what do you mean?`,
      apologize: `I'm sorry, I didn't mean...`,
      deflect: `Let's not talk about that right now.`,
      ask: `Can I ask you something?`,
      accept: `Yes, I'd like that.`,
      decline: `I don't think so.`,
      mischief: `${card.tics[0] || 'Well'}, this should be interesting.`
    };
    
    return fallbacks[intent] || "I'm not sure what to say.";
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

  async selfCheck(draft: LineDraft, state: AgentState, card: CharacterCard): Promise<SelfCheckResult> {
    const scores = {
      safety_consent: await this.checkSafetyConsent(draft.text),
      continuity: await this.checkContinuity(draft.text, state),
      persona_voice: this.checkPersonaVoice(draft.text, card),
      act_vibe_grammar: this.checkActVibeGrammar(draft.text, state),
      pacing_novelty: this.checkPacingNovelty(draft.text, draft.novelty)
    };
    
    const min_threshold = 0.7;
    const issues = [];
    let suggestion: SelfCheckResult['suggestion'];
    
    if (scores.safety_consent < min_threshold) {
      issues.push('Safety/consent violation detected');
      suggestion = 'soften';
    }
    
    if (scores.continuity < min_threshold) {
      issues.push('Continuity contradiction detected');
      suggestion = 'clarify';
    }
    
    if (scores.persona_voice < min_threshold) {
      issues.push('Voice/persona inconsistency');
      suggestion = 'swap';
    }
    
    if (scores.act_vibe_grammar < min_threshold) {
      issues.push('Act/vibe grammar violation');
      suggestion = 'defer';
    }
    
    if (scores.pacing_novelty < min_threshold) {
      issues.push('Pacing/novelty issue');
      suggestion = 'aside_redirect';
    }
    
    const overall_score = Object.values(scores).reduce((a, b) => a + b, 0) / Object.values(scores).length;
    const passed = overall_score >= min_threshold && issues.length === 0;
    
    return {
      passed,
      scores,
      issues,
      suggestion
    };
  }

  private async checkSafetyConsent(text: string): Promise<number> {
    const safety_result = await this.safety.validateContent(text);
    return safety_result.isSafe ? 1.0 : 0.0;
  }

  private async checkContinuity(text: string, state: AgentState): Promise<number> {
    // Check for contradictions with recent context
    // Simplified heuristic - would use more sophisticated NLI
    const recent_context = state.recent_lines.slice(-3).map(l => l.text).join(' ');
    
    // Look for obvious contradictions
    const contradictory_patterns = [
      [/\byes\b/i, /\bno\b/i],
      [/\bwill\b/i, /\bwon't\b/i],
      [/\blove\b/i, /\bhate\b/i]
    ];
    
    for (const [pattern1, pattern2] of contradictory_patterns) {
      if (recent_context.match(pattern1) && text.match(pattern2)) {
        return 0.3; // Potential contradiction
      }
    }
    
    return 0.9; // No obvious contradictions
  }

  private checkPersonaVoice(text: string, card: CharacterCard): number {
    let score = 0.7; // Base score
    
    // Check voice style consistency
    const text_lower = text.toLowerCase();
    switch (card.voice_style) {
      case 'warm':
        if (text_lower.match(/\b(dear|sweet|love|heart|gentle|soft)\b/)) score += 0.2;
        break;
      case 'wry':
        if (text_lower.match(/\b(well|really|quite|suppose|rather|hmm)\b/)) score += 0.2;
        break;
      case 'direct':
        if (text.split(' ').length <= 15 && !text.includes('...')) score += 0.2;
        break;
      case 'poetic':
        if (text_lower.match(/\b(like|as|seems|feels|whisper|dance|shimmer)\b/)) score += 0.2;
        break;
    }
    
    // Check for tics usage (should appear occasionally)
    const has_tic = card.tics.some(tic => text_lower.includes(tic.toLowerCase()));
    if (has_tic) score += 0.1;
    
    return Math.min(1, score);
  }

  private checkActVibeGrammar(text: string, state: AgentState): number {
    // Check if line fits current act expectations
    let score = 0.8;
    
    switch (state.act) {
      case 1: // Setup - should be lighter
        if (text.toLowerCase().includes('love') || text.includes('forever')) score -= 0.3;
        break;
      case 2: // Rising action - building connection
        if (text.toLowerCase().includes('goodbye') || text.includes('never')) score -= 0.2;
        break;
      case 3: // Climax - high emotion allowed
        // Most things acceptable in climax
        break;
      case 4: // Falling action - resolving
        if (text.includes('?') && !text.includes('sure')) score -= 0.1; // Avoid new questions
        break;
      case 5: // Resolution - commitment
        if (text.toLowerCase().includes('maybe') || text.includes('...')) score -= 0.2;
        break;
    }
    
    return Math.max(0.3, score);
  }

  private checkPacingNovelty(text: string, novelty: number): number {
    const word_count = text.split(' ').length;
    let score = 0.8;
    
    // Length check (≤9 seconds ≈ 15-20 words)
    if (word_count > 25) score -= 0.4;
    else if (word_count > 20) score -= 0.2;
    
    // Novelty check
    if (novelty < 0.3) score -= 0.3; // Too similar to recent lines
    else if (novelty > 0.8) score += 0.1; // Bonus for high novelty
    
    return Math.max(0.1, score);
  }

  async emit(state: AgentState, draft: LineDraft, intent_bundle: IntentBundle): Promise<FinalLine> {
    // Record intent in history
    if (!this.intentHistory.has(draft.speaker)) {
      this.intentHistory.set(draft.speaker, []);
    }
    this.intentHistory.get(draft.speaker)!.push(intent_bundle.intent);
    
    // Keep only last 10 intents per character
    if (this.intentHistory.get(draft.speaker)!.length > 10) {
      this.intentHistory.set(draft.speaker, this.intentHistory.get(draft.speaker)!.slice(-10));
    }
    
    const rationales = [];
    
    if (intent_bundle.recall_token) {
      rationales.push('Dormant token surfaced');
    }
    
    if (intent_bundle.intent === 'reveal') {
      rationales.push('Vulnerability honored');
    }
    
    if (intent_bundle.confidence > 0.8) {
      rationales.push('High confidence intent');
    }
    
    return {
      speaker: draft.speaker,
      text: draft.text,
      meta: {
        used_tokens: draft.used_token ? [draft.used_token] : [],
        deltas: intent_bundle.predicted_deltas,
        rationales
      }
    };
  }

  async reflect(final_line: FinalLine, state: AgentState): Promise<void> {
    // Store line in Weaviate
    try {
      await this.weaviate.storeLine({
        storyId: 'current_story', // Would use actual story ID
        turnIdx: state.recent_lines.length,
        speaker: final_line.speaker,
        text: final_line.text,
        timestamp: new Date()
      });
      
      // Update token last seen if used
      if (final_line.meta.used_tokens.length > 0) {
        for (const token of final_line.meta.used_tokens) {
          await this.weaviate.updateTokenLastSeen('current_story', token, state.recent_lines.length);
        }
      }
      
    } catch (error) {
      console.error('Error in reflect phase:', error);
    }
  }

  // Public interface methods for integration
  async intent(state: AgentState, card: CharacterCard, biases: any): Promise<IntentBundle> {
    const enhanced_state = await this.perceive(state, card);
    const recall_candidate = await this.recall(enhanced_state, card);
    return await this.selectIntent(enhanced_state, card, recall_candidate);
  }

  async draft_line(state: AgentState, card: CharacterCard, biases: any, intent?: IntentBundle): Promise<LineDraft> {
    const intent_bundle = intent || await this.intent(state, card, biases);
    return await this.draft(state, card, intent_bundle);
  }

  async emit_line(state: AgentState, draft_or_intent: LineDraft | IntentBundle): Promise<FinalLine> {
    if ('text' in draft_or_intent) {
      // It's a LineDraft
      const mock_intent: IntentBundle = {
        speaker: draft_or_intent.speaker,
        intent: 'reassure', // Default
        targets: [],
        predicted_deltas: { attraction: 0.02, trust: 0.01, tension: 0, comfort: 0.02 },
        risk_flags: {},
        confidence: 0.7
      };
      return await this.emit(state, draft_or_intent, mock_intent);
    } else {
      // It's an IntentBundle - need to draft first
      const card_id = draft_or_intent.speaker;
      // Would need to get card from somewhere - simplified here
      const mock_card: CharacterCard = {
        id: card_id,
        name: card_id,
        pronouns: 'they/them',
        voice_style: 'warm',
        traits: { openness: 0.5, agreeableness: 0.7, extraversion: 0.6, conscientiousness: 0.5, stability: 0.6 },
        goals: ['connect with others'],
        values: ['honesty'],
        hard_limits: ['no violence'],
        love_lang: { words: 0.8, time: 0.6, acts: 0.4, gifts: 0.2, touch: 0.3 },
        tics: ['Well...'],
        initial_stance: {}
      };
      
      const draft = await this.draft(state, mock_card, draft_or_intent);
      return await this.emit(state, draft, draft_or_intent);
    }
  }
}

export class SideAgent {
  private openai: OpenAIService;
  private safety: SafetyGuardian;

  constructor(openai: OpenAIService, safety: SafetyGuardian) {
    this.openai = openai;
    this.safety = safety;
  }

  async maybeSpeak(state: AgentState, card: SideCharacterCard, triggers: SideTriggers): Promise<FinalLine | null> {
    // Check if any triggers are active
    const is_triggered = Object.values(triggers).some(trigger => trigger === true);
    if (!is_triggered) return null;

    // Determine intent based on character role and trigger type
    const intent = this.selectSideIntent(card, triggers);
    
    // Generate line based on role and intent
    const line_text = await this.generateSideLine(state, card, intent, triggers);
    
    // Safety check
    const safety_result = await this.safety.validateContent(line_text);
    if (!safety_result.isSafe) {
      console.log(`Side character ${card.name} line blocked for safety: ${safety_result.reason}`);
      return null;
    }

    // Minimal deltas for side characters
    const deltas: ChemDeltas = this.getSideDeltas(intent, card);

    return {
      speaker: card.id,
      text: line_text,
      meta: {
        used_tokens: [],
        deltas,
        rationales: [`Side character ${card.role}`, `Intent: ${intent}`]
      }
    };
  }

  private selectSideIntent(card: SideCharacterCard, triggers: SideTriggers): SideIntent {
    // Map triggers and role to appropriate side intent
    if (triggers.name_mention) {
      switch (card.job_to_do) {
        case 'gatekeeper': return 'block';
        case 'wing': return 'tease';
        case 'pressure': return 'escalate';
        case 'comic_relief': return 'tease';
        default: return 'inform';
      }
    }

    if (triggers.jealousy_ripple) {
      return card.job_to_do === 'wing' ? 'soothe' : 'escalate';
    }

    if (triggers.compersion_ripple) {
      return 'soothe';
    }

    if (triggers.policy_pressure || triggers.time_pressure) {
      return card.job_to_do === 'gatekeeper' ? 'block' : 'escalate';
    }

    if (triggers.explicit_aside) {
      return 'inform';
    }

    return 'inform'; // Default
  }

  private async generateSideLine(
    state: AgentState, 
    card: SideCharacterCard, 
    intent: SideIntent,
    triggers: SideTriggers
  ): Promise<string> {
    const system_prompt = `${this.openai.getBaseSystemPrompt()}

CHARACTER: ${card.name} - ${card.role}
JOB: ${card.job_to_do}
PERSONALITY TRAITS: ${card.tics.join(', ')}
BACKGROUND FACTS: ${card.facts.join(', ')}

RULES:
- You are a SIDE CHARACTER - speak briefly and yield focus
- Your job is "${card.job_to_do}" - stay in that role
- One purposeful line only, then step back
- Never steal focus from the main romantic pair
- Keep it ≤9 seconds when spoken aloud`;

    const trigger_context = Object.entries(triggers)
      .filter(([, active]) => active)
      .map(([trigger]) => trigger.replace('_', ' '))
      .join(', ');

    const user_prompt = `Context:
Setting: ${state.setting}
Current situation: ${trigger_context}
Your intent as ${card.name}: ${intent}

Recent conversation:
${state.recent_lines.slice(-3).map(line => `${line.speaker}: ${line.text}`).join('\n')}

Generate ONE brief line for ${card.name} that serves your role as "${card.job_to_do}" with intent "${intent}".`;

    try {
      const generated_text = await this.openai.generateMainLine(system_prompt, user_prompt, 0.7);
      return generated_text;
    } catch (error) {
      console.error('Error generating side line:', error);
      return this.getFallbackSideLine(card, intent);
    }
  }

  private getFallbackSideLine(card: SideCharacterCard, intent: SideIntent): string {
    const fallbacks = {
      inform: `${card.tics[0] || 'Hey'}, just so you know...`,
      tease: `${card.tics[0] || 'Oh'}, this is getting interesting.`,
      block: `Hold on, ${card.tics[0] || 'wait a minute'}.`,
      soothe: `It's okay, ${card.tics[0] || 'everyone'}.`,
      escalate: `${card.tics[0] || 'Well'}, things just got complicated.`
    };
    return fallbacks[intent] || `${card.tics[0] || 'Um'}, what's happening here?`;
  }

  private getSideDeltas(intent: SideIntent, card: SideCharacterCard): ChemDeltas {
    const base_deltas: ChemDeltas = { attraction: 0, trust: 0, tension: 0, comfort: 0 };
    
    // Side characters have minimal impact on main relationship
    switch (intent) {
      case 'block':
        base_deltas.tension += 0.02;
        break;
      case 'soothe':
        base_deltas.comfort += 0.01;
        break;
      case 'escalate':
        base_deltas.tension += 0.03;
        break;
      case 'tease':
        base_deltas.attraction += 0.01;
        break;
      case 'inform':
        // Neutral impact
        break;
    }

    return base_deltas;
  }

  // Check if side character should be triggered
  static shouldTrigger(
    card: SideCharacterCard, 
    state: AgentState, 
    recent_speakers: string[]
  ): SideTriggers {
    const triggers: SideTriggers = {};

    // Name mention check
    const recent_text = state.recent_lines.slice(-2).map(l => l.text).join(' ');
    if (recent_text.toLowerCase().includes(card.name.toLowerCase())) {
      triggers.name_mention = true;
    }

    // Policy/time pressure based on role
    if (card.job_to_do === 'gatekeeper' && state.recent_lines.length > 8) {
      triggers.policy_pressure = true;
    }

    // Explicit aside involving this character
    if (state.bias_flags.aside_pair && state.bias_flags.aside_pair.includes(card.id)) {
      triggers.explicit_aside = true;
    }

    // Simple heuristics for emotional ripples
    const recent_tension_words = recent_text.toLowerCase().match(/\b(jealous|worried|upset|angry)\b/);
    if (recent_tension_words) {
      triggers.jealousy_ripple = true;
    }

    const recent_joy_words = recent_text.toLowerCase().match(/\b(happy|excited|wonderful|amazing)\b/);
    if (recent_joy_words && card.job_to_do === 'wing') {
      triggers.compersion_ripple = true;
    }

    return triggers;
  }
}