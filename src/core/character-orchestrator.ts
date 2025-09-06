import { LeadAgent, SideAgent } from '../engines/character';
import { OpenAIService } from '../integrations/openai';
import { WeaviateService } from '../integrations/weaviate';
import { SafetyGuardian } from '../utils/safety';
import {
  CharacterCard,
  SideCharacterCard,
  AgentState,
  IntentBundle,
  LineDraft,
  FinalLine,
  BeatPlan,
  SideTriggers,
  RepairDirective,
  SelfCheckResult,
  TelemetryData
} from '../types/character';

export class CharacterOrchestrator {
  private leadAgent: LeadAgent;
  private sideAgent: SideAgent;
  private leadCharacters: Map<string, CharacterCard> = new Map();
  private sideCharacters: Map<string, SideCharacterCard> = new Map();
  private telemetryLog: TelemetryData[] = [];

  constructor(openai: OpenAIService, weaviate: WeaviateService, safety: SafetyGuardian) {
    this.leadAgent = new LeadAgent(openai, weaviate, safety);
    this.sideAgent = new SideAgent(openai, safety);
  }

  // Character management
  addLeadCharacter(card: CharacterCard): void {
    this.leadCharacters.set(card.id, card);
  }

  addSideCharacter(card: SideCharacterCard): void {
    this.sideCharacters.set(card.id, card);
  }

  getLeadCharacter(id: string): CharacterCard | undefined {
    return this.leadCharacters.get(id);
  }

  getSideCharacter(id: string): SideCharacterCard | undefined {
    return this.sideCharacters.get(id);
  }

  // Integration interface: Character Engine → Narrative Agent
  async generateIntentBundles(state: AgentState, leadIds: string[]): Promise<IntentBundle[]> {
    const bundles: IntentBundle[] = [];

    for (const leadId of leadIds) {
      const card = this.leadCharacters.get(leadId);
      if (!card) {
        console.warn(`Lead character ${leadId} not found`);
        continue;
      }

      try {
        const bundle = await this.leadAgent.intent(state, card, state.bias_flags);
        bundles.push(bundle);

        // Log telemetry
        this.logTelemetry({
          exchange_id: `exchange_${state.recent_lines.length}`,
          character_id: leadId,
          intent: bundle.intent,
          confidence: bundle.confidence,
          utility_scores: { // Would get actual scores from LeadAgent
            goal_alignment: 0.7,
            relational_gain: 0.6,
            act_vibe_fit: 0.8,
            nudge_alignment: 0.5,
            freshness_potential: 0.4,
            coherence_risk: 0.2,
            total_utility: 0.65
          },
          self_check_scores: {
            safety_consent: 1.0,
            continuity: 0.9,
            persona_voice: 0.8,
            act_vibe_grammar: 0.85,
            pacing_novelty: 0.7
          },
          line_length_sec: 0, // Will be filled after drafting
          novelty_score: 0, // Will be filled after drafting
          contradiction_flagged: false,
          repair_attempts: 0
        });

      } catch (error) {
        console.error(`Error generating intent bundle for ${leadId}:`, error);
      }
    }

    return bundles;
  }

  async generateLineDrafts(state: AgentState, selectedBundles: IntentBundle[]): Promise<LineDraft[]> {
    const drafts: LineDraft[] = [];

    for (const bundle of selectedBundles) {
      const card = this.leadCharacters.get(bundle.speaker);
      if (!card) continue;

      try {
        const draft = await this.leadAgent.draft_line(state, card, state.bias_flags, bundle);
        drafts.push(draft);

        // Update telemetry with draft info
        this.updateTelemetryForDraft(bundle.speaker, draft);

      } catch (error) {
        console.error(`Error generating line draft for ${bundle.speaker}:`, error);
      }
    }

    return drafts;
  }

  // Integration interface: Character Engine accepts BeatPlan from Narrative Agent
  async executeBeatPlan(state: AgentState, beatPlan: BeatPlan): Promise<FinalLine[]> {
    const finalLines: FinalLine[] = [];

    for (const speakerId of beatPlan.speaker_order) {
      // Check if it's a lead or side character
      const leadCard = this.leadCharacters.get(speakerId);
      const sideCard = this.sideCharacters.get(speakerId);

      if (leadCard) {
        // Execute lead character line
        const finalLine = await this.executeLeadLine(state, leadCard, beatPlan);
        if (finalLine) {
          finalLines.push(finalLine);
          
          // Update state for next character
          state.recent_lines.push({
            speaker: finalLine.speaker,
            text: finalLine.text,
            timestamp: new Date()
          });
        }

      } else if (sideCard) {
        // Execute side character line (if triggered)
        const triggers = SideAgent.shouldTrigger(sideCard, state, beatPlan.speaker_order);
        const finalLine = await this.sideAgent.maybeSpeak(state, sideCard, triggers);
        
        if (finalLine) {
          finalLines.push(finalLine);
          
          // Update state
          state.recent_lines.push({
            speaker: finalLine.speaker,
            text: finalLine.text,
            timestamp: new Date()
          });
        }

      } else {
        console.warn(`Character ${speakerId} not found in beat plan`);
      }
    }

    return finalLines;
  }

  private async executeLeadLine(
    state: AgentState, 
    card: CharacterCard, 
    beatPlan: BeatPlan
  ): Promise<FinalLine | null> {
    // Generate intent bundle
    const bundle = await this.leadAgent.intent(state, card, state.bias_flags);
    
    // Check if we should surface specific callbacks
    if (beatPlan.callbacks_to_surface.length > 0) {
      const targetToken = beatPlan.callbacks_to_surface.find(token => 
        // Simple matching - would be more sophisticated
        bundle.recall_token === token || beatPlan.callbacks_to_surface.includes(token)
      );
      if (targetToken) {
        bundle.recall_token = targetToken;
      }
    }

    // Generate draft
    const draft = await this.leadAgent.draft_line(state, card, state.bias_flags, bundle);
    
    // Self-check
    const checkResult = await this.leadAgent.selfCheck(draft, state, card);
    
    if (!checkResult.passed && checkResult.suggestion) {
      // Attempt repair
      const repairedDraft = await this.attemptRepair(state, card, draft, {
        type: checkResult.suggestion,
        reason: checkResult.issues.join('; '),
        max_attempts: 2
      });
      
      if (repairedDraft) {
        const finalLine = await this.leadAgent.emit_line(state, repairedDraft);
        await this.leadAgent.reflect(finalLine, state);
        return finalLine;
      }
    }

    if (checkResult.passed) {
      const finalLine = await this.leadAgent.emit_line(state, draft);
      await this.leadAgent.reflect(finalLine, state);
      return finalLine;
    }

    // Failed all checks - defer or skip
    console.warn(`Line from ${card.name} failed self-check and repair attempts`);
    return null;
  }

  // Integration interface: Character Engine ↔ Evaluator
  async attemptRepair(
    state: AgentState,
    card: CharacterCard,
    originalDraft: LineDraft,
    directive: RepairDirective
  ): Promise<LineDraft | null> {
    let attempts = 0;
    
    while (attempts < directive.max_attempts) {
      attempts++;
      
      try {
        const repairedDraft = await this.applyRepairDirective(state, card, originalDraft, directive);
        const checkResult = await this.leadAgent.selfCheck(repairedDraft, state, card);
        
        if (checkResult.passed) {
          // Update telemetry
          this.updateTelemetryForRepair(card.id, attempts);
          return repairedDraft;
        }

        // If still failing, try next repair attempt
        originalDraft = repairedDraft; // Use repaired version as base for next attempt

      } catch (error) {
        console.error(`Repair attempt ${attempts} failed for ${card.name}:`, error);
      }
    }

    console.warn(`All repair attempts failed for ${card.name}`);
    return null;
  }

  private async applyRepairDirective(
    state: AgentState,
    card: CharacterCard,
    draft: LineDraft,
    directive: RepairDirective
  ): Promise<LineDraft> {
    const repairPrompt = this.buildRepairPrompt(directive, draft.text);
    
    // Use OpenAI to repair the line
    const system_prompt = `You are helping repair a character's dialogue line. 
    Apply the requested change while maintaining the character's voice and intent.
    
    CHARACTER: ${card.name}
    VOICE STYLE: ${card.voice_style}
    PERSONALITY TRAITS: ${this.describeTraits(card.traits)}
    SPEECH HABITS: ${card.tics.join(', ')}`;

    try {
      const repairedText = await this.leadAgent['openai'].generateMainLine(system_prompt, repairPrompt, 0.7);
      
      return {
        ...draft,
        text: repairedText,
        coherence_cost: draft.coherence_cost * 0.8 // Assume repair improves coherence
      };

    } catch (error) {
      console.error('Error in repair generation:', error);
      return draft; // Return original if repair fails
    }
  }

  private buildRepairPrompt(directive: RepairDirective, originalText: string): string {
    const instructions = {
      soften: 'Make the tone gentler and less intense while keeping the same meaning.',
      clarify: 'Make the meaning clearer and remove any ambiguity or confusion.',
      swap: 'Replace this line with something that better fits the character personality.',
      defer: 'Rewrite to delay or redirect rather than directly addressing the topic.',
      aside_redirect: 'Turn this into a private aside or internal thought instead.'
    };

    return `Original line: "${originalText}"

Issue: ${directive.reason}

Please ${instructions[directive.type]} Keep it ≤9 seconds when spoken aloud.

Repaired line:`;
  }

  // Telemetry and evaluation
  private logTelemetry(data: TelemetryData): void {
    this.telemetryLog.push(data);
    
    // Keep only last 100 entries to prevent memory bloat
    if (this.telemetryLog.length > 100) {
      this.telemetryLog = this.telemetryLog.slice(-100);
    }
  }

  private updateTelemetryForDraft(characterId: string, draft: LineDraft): void {
    const latest = this.telemetryLog
      .filter(t => t.character_id === characterId)
      .sort((a, b) => a.exchange_id.localeCompare(b.exchange_id))
      .pop();

    if (latest) {
      latest.line_length_sec = this.estimateLineDuration(draft.text);
      latest.novelty_score = draft.novelty;
      latest.contradiction_flagged = draft.coherence_cost > 0.7;
    }
  }

  private updateTelemetryForRepair(characterId: string, attempts: number): void {
    const latest = this.telemetryLog
      .filter(t => t.character_id === characterId)
      .sort((a, b) => a.exchange_id.localeCompare(b.exchange_id))
      .pop();

    if (latest) {
      latest.repair_attempts = attempts;
    }
  }

  private estimateLineDuration(text: string): number {
    // Rough estimate: ~150 words per minute = 2.5 words per second
    const wordCount = text.split(' ').length;
    return wordCount / 2.5;
  }

  private describeTraits(traits: any): string {
    return Object.entries(traits)
      .map(([trait, value]) => `${trait}: ${((value as number) * 100).toFixed(0)}%`)
      .join(', ');
  }

  // Evaluation metrics
  getIntentVarietyScore(): number {
    if (this.telemetryLog.length < 6) return 1.0;

    const recentIntents = this.telemetryLog.slice(-6);
    const intentCounts = recentIntents.reduce((acc, entry) => {
      acc[entry.intent] = (acc[entry.intent] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const maxRepeats = Math.max(...Object.values(intentCounts));
    return maxRepeats <= 2 ? 1.0 : Math.max(0, 1 - (maxRepeats - 2) * 0.3);
  }

  getPlateauBreakRate(): number {
    // Would need more sophisticated tracking of plateau states
    // Simplified calculation
    const plateauBreaks = this.telemetryLog.filter(entry => 
      entry.novelty_score > 0.6 && ['reveal', 'challenge', 'invite'].includes(entry.intent as any)
    ).length;
    
    const totalOpportunities = Math.max(1, this.telemetryLog.length);
    return plateauBreaks / totalOpportunities;
  }

  getContradictionRate(): number {
    const contradictions = this.telemetryLog.filter(entry => entry.contradiction_flagged).length;
    return this.telemetryLog.length > 0 ? contradictions / this.telemetryLog.length : 0;
  }

  getRecallEfficacyRate(): number {
    // Count successful recalls vs. attempted recalls
    const recalls = this.telemetryLog.filter(entry => entry.intent === 'reveal' || entry.recall_success);
    const successfulRecalls = recalls.filter(entry => entry.recall_success === true);
    
    return recalls.length > 0 ? successfulRecalls.length / recalls.length : 1.0;
  }

  getLineComplianceRate(): number {
    const compliantLines = this.telemetryLog.filter(entry => 
      entry.line_length_sec <= 9 && 
      entry.self_check_scores.safety_consent >= 0.8
    ).length;
    
    return this.telemetryLog.length > 0 ? compliantLines / this.telemetryLog.length : 1.0;
  }

  // Export telemetry for analysis
  exportTelemetry(): TelemetryData[] {
    return [...this.telemetryLog];
  }

  // Reset telemetry (for testing)
  clearTelemetry(): void {
    this.telemetryLog = [];
  }
}