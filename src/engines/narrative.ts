import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { CharacterOrchestrator } from '../core/character-orchestrator';
import { OpenAIService } from '../integrations/openai';
import { WeaviateService } from '../integrations/weaviate';
import { SafetyGuardian } from '../utils/safety';
import {
  Act,
  Ending,
  CheckpointType,
  NudgeType,
  NudgeIntensity,
  NudgeSource,
  EndReason,
  LoveGraph,
  LoveGraphPair,
  ChemistryDeltas,
  SpokenLine,
  Nudge,
  Scene,
  Episode,
  StoryState,
  Checkpoint,
  ActGate,
  NudgeDescriptor,
  TelemetryEventUnion,
  TurnStartEvent,
  TurnEndEvent,
  NudgeAppliedEvent,
  SceneTransitionEvent,
  MetricTickEvent,
  EpisodeSeed,
  EpisodeSummary,
  TickResult,
  ThresholdBadge,
  ConsoleState
} from '../types/narrative';
import { CharacterCard, AgentState, FinalLine } from '../types/character';

export class NarrativeEngine extends EventEmitter {
  private characterOrchestrator: CharacterOrchestrator;
  private openai: OpenAIService;
  private weaviate: WeaviateService;
  private safety: SafetyGuardian;
  
  private currentState: StoryState | null = null;
  private exchangeCounter = 0;
  private telemetryBuffer: TelemetryEventUnion[] = [];
  
  // Act progression checkpoints
  private readonly checkpoints: Checkpoint[] = [
    {
      type: 'mutual_spark',
      fromAct: 1,
      toAct: 2,
      description: 'Mutual spark acknowledged - reciprocal attraction bump + shared callback or micro-vulnerability',
      requirements: ['reciprocal_attraction >= 0.4', 'shared_moment || micro_vulnerability']
    },
    {
      type: 'explicit_conflict',
      fromAct: 2,
      toAct: 3,
      description: 'Explicit conflict or value clash spoken',
      requirements: ['spoken_disagreement', 'values_clash || tension >= 0.6']
    },
    {
      type: 'need_boundary',
      fromAct: 3,
      toAct: 4,
      description: 'Concrete need or boundary is stated - response required',
      requirements: ['explicit_need_statement', 'boundary_declared || trust >= 0.6']
    },
    {
      type: 'relational_choice',
      fromAct: 4,
      toAct: 5,
      description: 'Explicit relational choice made',
      requirements: ['commitment_statement', 'future_together_choice']
    }
  ];

  // Act gates and coherence weights
  private readonly actGates: Record<Act, ActGate> = {
    1: {
      act: 1,
      allowedNudges: ['comfort', 'vulnerability', 'recall', 'tempo_down'],
      blockedNudges: ['raise_stakes'],
      coherenceWeight: 0.7,
      description: 'Setup - Light introduction, avoid heavy stakes'
    },
    2: {
      act: 2,
      allowedNudges: ['comfort', 'vulnerability', 'recall', 'aside', 'tempo_up', 'raise_stakes'],
      blockedNudges: [],
      coherenceWeight: 0.9,
      description: 'Rising Action - Building connection, light stakes allowed'
    },
    3: {
      act: 3,
      allowedNudges: ['raise_stakes', 'vulnerability', 'aside', 'tempo_up'],
      blockedNudges: ['comfort'],
      coherenceWeight: 1.2,
      description: 'Climax - High stakes, conflict, vulnerability required'
    },
    4: {
      act: 4,
      allowedNudges: ['comfort', 'vulnerability', 'recall', 'tempo_down'],
      blockedNudges: ['raise_stakes'],
      coherenceWeight: 1.6,
      description: 'Falling Action - Resolution beginning, comfort returns'
    },
    5: {
      act: 5,
      allowedNudges: ['comfort', 'recall', 'tempo_down'],
      blockedNudges: ['raise_stakes', 'aside'],
      coherenceWeight: 1.8,
      description: 'Resolution - Commitment, no new complications'
    }
  };

  // Nudge catalog with act restrictions and cooldowns
  private readonly nudgeCatalog: Record<NudgeType, NudgeDescriptor> = {
    raise_stakes: {
      type: 'raise_stakes',
      intensity: 'major',
      description: 'Short-term Tension bias; unlock heavier versions in Act III–IV',
      biasEffects: { tension: 0.15, attraction: 0.05 },
      actRestrictions: [2, 3, 4],
      cooldownExchanges: 6
    },
    comfort: {
      type: 'comfort',
      intensity: 'minor',
      description: 'Lower Tension, raise Comfort, permit reassurance',
      biasEffects: { comfort: 0.1, tension: -0.05 },
      cooldownExchanges: 2
    },
    vulnerability: {
      type: 'vulnerability',
      intensity: 'minor',
      description: 'Bias toward self-disclosure; raises Trust potential',
      biasEffects: { trust: 0.12, attraction: 0.03 },
      cooldownExchanges: 3
    },
    recall: {
      type: 'recall',
      intensity: 'minor', 
      description: 'Resurface dormant token; attraction/continuity bonus',
      biasEffects: { attraction: 0.08, comfort: 0.04 },
      cooldownExchanges: 4
    },
    aside: {
      type: 'aside',
      intensity: 'minor',
      description: 'Temporary spotlight shift with jealousy/compersion ripples',
      biasEffects: { tension: 0.06, attraction: 0.02 },
      actRestrictions: [2, 3, 4],
      cooldownExchanges: 5
    },
    tempo_up: {
      type: 'tempo_up',
      intensity: 'minor',
      description: 'Adjust micro-pauses & max line length for faster pacing',
      biasEffects: { tension: 0.04, attraction: 0.02 },
      cooldownExchanges: 2
    },
    tempo_down: {
      type: 'tempo_down',
      intensity: 'minor',
      description: 'Slower pacing, longer pauses, more reflection',
      biasEffects: { comfort: 0.06, trust: 0.02 },
      cooldownExchanges: 2
    }
  };

  constructor(
    characterOrchestrator: CharacterOrchestrator,
    openai: OpenAIService,
    weaviate: WeaviateService,
    safety: SafetyGuardian
  ) {
    super();
    this.characterOrchestrator = characterOrchestrator;
    this.openai = openai;
    this.weaviate = weaviate;
    this.safety = safety;
  }

  // Integration Contract: StartEpisode
  async startEpisode(seed: EpisodeSeed): Promise<EpisodeSummary> {
    const episodeId = uuidv4();
    const timestamp = Date.now();
    
    // Initialize Love Graph for all character pairs
    const loveGraph: LoveGraph = {};
    for (let i = 0; i < seed.characters.length; i++) {
      for (let j = i + 1; j < seed.characters.length; j++) {
        const pairKey = `${seed.characters[i]}-${seed.characters[j]}`;
        loveGraph[pairKey] = {
          attraction: 0.1,
          trust: 0.1,
          tension: 0.2,
          comfort: 0.1
        };
      }
    }

    // Create initial episode
    const episode: Episode = {
      id: episodeId,
      startedAt: timestamp,
      actPath: [1],
      scenes: [],
      loveGraph,
      activeVibe: seed.vibe,
      setting: seed.setting,
      constraints: {
        pg13: true,
        maxLineLength: 9 // seconds
      }
    };

    // Create initial scene
    const scene: Scene = {
      id: uuidv4(),
      episodeId,
      act: 1,
      index: 0,
      startedAt: timestamp,
      spotlightPair: [seed.characters[0], seed.characters[1]],
      majorNudges: 0,
      minorNudges: 0
    };

    episode.scenes.push(scene);

    // Initialize story state
    this.currentState = {
      episode,
      currentScene: scene,
      spotlight: scene.spotlightPair,
      recentLines: [],
      openLoops: seed.openLoops || [],
      callbacks: seed.callbacks || [],
      pendingNudges: [],
      plateauCounter: 0,
      lastMajorNudgeExchange: 0
    };

    this.exchangeCounter = 0;

    // Import seed context if provided
    if (seed.importSeed || seed.previousEnding) {
      await this.importSeedContext(seed);
    }

    const summary = this.buildEpisodeSummary();
    
    console.log(`📚 Episode started: ${episodeId}`);
    console.log(`🎬 Vibe: ${seed.vibe}, Setting: ${seed.setting}`);
    console.log(`👥 Spotlight: ${scene.spotlightPair.join(' & ')}`);

    return summary;
  }

  // Integration Contract: ApplyNudge  
  async applyNudge(nudgeDescriptor: Nudge): Promise<boolean> {
    if (!this.currentState) {
      console.warn('No active episode to apply nudge to');
      return false;
    }

    // Check act gates
    const currentAct = this.currentState.episode.actPath[this.currentState.episode.actPath.length - 1];
    const actGate = this.actGates[currentAct];
    
    if (actGate.blockedNudges.includes(nudgeDescriptor.type)) {
      console.warn(`Nudge ${nudgeDescriptor.type} blocked in Act ${currentAct}`);
      return false;
    }

    if (!actGate.allowedNudges.includes(nudgeDescriptor.type)) {
      console.warn(`Nudge ${nudgeDescriptor.type} not allowed in Act ${currentAct}`);
      return false;
    }

    // Check cadence for major nudges
    if (nudgeDescriptor.intensity === 'major') {
      const exchangesSinceLastMajor = this.exchangeCounter - this.currentState.lastMajorNudgeExchange;
      if (exchangesSinceLastMajor < 6) {
        console.warn(`Major nudge on cooldown: ${6 - exchangesSinceLastMajor} exchanges remaining`);
        return false;
      }
    }

    // Safety check
    const safetyResult = await this.safety.validateContent(JSON.stringify(nudgeDescriptor));
    if (!safetyResult.isSafe) {
      console.warn(`Nudge blocked by safety: ${safetyResult.reason}`);
      return false;
    }

    // Schedule nudge
    this.currentState.pendingNudges.push(nudgeDescriptor);

    // Update counters
    if (nudgeDescriptor.intensity === 'major') {
      this.currentState.lastMajorNudgeExchange = this.exchangeCounter;
      this.currentState.currentScene.majorNudges++;
      
      // Schedule recovery bias
      this.currentState.recoveryBias = {
        type: 'comfort_clarify',
        exchangesLeft: 2
      };
    } else {
      this.currentState.currentScene.minorNudges++;
    }

    // Emit telemetry
    this.emitTelemetry({
      kind: 'nudge.applied',
      episodeId: this.currentState.episode.id,
      timestamp: Date.now(),
      sceneId: this.currentState.currentScene.id,
      nudge: nudgeDescriptor,
      source: nudgeDescriptor.source
    });

    console.log(`🎚️  Applied ${nudgeDescriptor.intensity} nudge: ${nudgeDescriptor.type}`);
    
    return true;
  }

  // Integration Contract: Tick (advance one exchange)
  async tick(): Promise<TickResult> {
    if (!this.currentState) {
      throw new Error('No active episode to tick');
    }

    const startTime = Date.now();
    this.exchangeCounter++;

    // Emit turn start
    this.emitTelemetry({
      kind: 'turn.start',
      episodeId: this.currentState.episode.id,
      timestamp: startTime,
      sceneId: this.currentState.currentScene.id,
      act: this.getCurrentAct(),
      scene: this.currentState.currentScene.index
    });

    const producedLines: SpokenLine[] = [];
    const transitions: SceneTransitionEvent[] = [];
    const telemetryEvents: TelemetryEventUnion[] = [];

    try {
      // Build agent state for character orchestrator
      const agentState = this.buildAgentState();
      
      // Execute character interactions
      const beatPlan = {
        speaker_order: [this.currentState.spotlight[0], this.currentState.spotlight[1]],
        callbacks_to_surface: this.currentState.callbacks.slice(0, 2),
        constraints: this.buildConstraints()
      };

      const finalLines = await this.characterOrchestrator.executeBeatPlan(agentState, beatPlan);

      // Process each produced line
      for (const finalLine of finalLines) {
        const spokenLine = await this.processLine(finalLine, startTime);
        producedLines.push(spokenLine);

        // Update Love Graph
        await this.updateLoveGraph(spokenLine);

        // Check for checkpoints
        const checkpoint = await this.checkActAdvancement();
        if (checkpoint) {
          const transition = await this.advanceAct(checkpoint);
          if (transition) transitions.push(transition);
        }

        // Check for plateau
        await this.checkPlateau();
      }

      // Process pending nudges for next exchange
      this.processPendingNudges();

      // Update recovery bias
      this.updateRecoveryBias();

      // Emit metrics
      await this.emitMetrics();

    } catch (error) {
      console.error('Error during tick:', error);
      throw error;
    }

    const endTime = Date.now();
    const latencyMs = endTime - startTime;

    // Emit turn end for each line
    for (const line of producedLines) {
      this.emitTelemetry({
        kind: 'turn.end',
        episodeId: this.currentState.episode.id,
        timestamp: endTime,
        sceneId: this.currentState.currentScene.id,
        line,
        deltas: line.deltas,
        latencyMs
      });
    }

    return {
      producedLines,
      updatedSummary: this.buildEpisodeSummary(),
      transitions,
      telemetryEvents: this.flushTelemetryBuffer()
    };
  }

  // Integration Contract: GetState (read-only snapshot)
  getState(): ConsoleState | null {
    if (!this.currentState) return null;

    return {
      episode: this.buildEpisodeSummary(),
      badges: this.generateThresholdBadges(),
      recentNudges: this.currentState.pendingNudges.slice(),
      evaluationScores: {
        freshnessGain: this.calculateFreshnessGain(),
        coherenceCost: this.calculateCoherenceCost(),
        fragilityIndex: this.calculateFragilityIndex(),
        finalScore: 0 // Calculated by Evaluation Engine
      },
      cadenceStatus: {
        majorBudgetUsed: this.currentState.currentScene.majorNudges,
        majorBudgetMax: 1, // Per 6 exchanges
        lastMajorExchange: this.currentState.lastMajorNudgeExchange,
        recoveryMode: !!this.currentState.recoveryBias
      }
    };
  }

  // Scene lifecycle management
  private async processLine(finalLine: FinalLine, startTime: number): Promise<SpokenLine> {
    const duration = this.estimateLineDuration(finalLine.text);
    
    const spokenLine: SpokenLine = {
      timestamp: startTime,
      speaker: finalLine.speaker,
      text: finalLine.text,
      secs: duration,
      deltas: finalLine.meta.deltas,
      latencyMs: Date.now() - startTime
    };

    // Add to recent lines (keep last 12-16)
    this.currentState!.recentLines.push(spokenLine);
    if (this.currentState!.recentLines.length > 16) {
      this.currentState!.recentLines = this.currentState!.recentLines.slice(-16);
    }

    // Update callbacks if token was used
    if (finalLine.meta.used_tokens.length > 0) {
      this.currentState!.callbacks = this.currentState!.callbacks.filter(
        token => !finalLine.meta.used_tokens.includes(token)
      );
    }

    return spokenLine;
  }

  private async updateLoveGraph(line: SpokenLine): Promise<void> {
    if (!this.currentState) return;

    const pairKey = this.currentState.spotlight.sort().join('-');
    const currentPair = this.currentState.episode.loveGraph[pairKey];
    
    if (currentPair) {
      // Apply deltas
      currentPair.attraction += line.deltas.attraction;
      currentPair.trust += line.deltas.trust;
      currentPair.tension += line.deltas.tension;
      currentPair.comfort += line.deltas.comfort;

      // Clamp to [0,1]
      Object.keys(currentPair).forEach(key => {
        const k = key as keyof LoveGraphPair;
        currentPair[k] = Math.max(0, Math.min(1, currentPair[k]));
      });

      // Apply ripple effects to watchers (jealousy/compersion)
      await this.applyRippleEffects(line, pairKey);
    }
  }

  private async applyRippleEffects(line: SpokenLine, primaryPairKey: string): Promise<void> {
    if (!this.currentState) return;

    // Simple ripple logic - positive deltas create compersion, negative create jealousy
    const primaryDeltas = line.deltas;
    const rippleStrength = 0.1; // Watchers get 10% of the effect
    
    Object.keys(this.currentState.episode.loveGraph).forEach(pairKey => {
      if (pairKey === primaryPairKey) return;

      const pair = this.currentState!.episode.loveGraph[pairKey];
      
      // Compersion ripple for positive attraction/comfort
      if (primaryDeltas.attraction > 0 || primaryDeltas.comfort > 0) {
        pair.attraction += primaryDeltas.attraction * rippleStrength;
        pair.comfort += primaryDeltas.comfort * rippleStrength;
      }

      // Jealousy ripple for high tension
      if (primaryDeltas.tension > 0.1) {
        pair.tension += primaryDeltas.tension * rippleStrength * 0.5;
        pair.trust -= primaryDeltas.tension * rippleStrength * 0.3;
      }

      // Clamp values
      Object.keys(pair).forEach(key => {
        const k = key as keyof LoveGraphPair;
        pair[k] = Math.max(0, Math.min(1, pair[k]));
      });
    });
  }

  private async checkActAdvancement(): Promise<Checkpoint | null> {
    if (!this.currentState) return null;

    const currentAct = this.getCurrentAct();
    const checkpoint = this.checkpoints.find(c => c.fromAct === currentAct);
    
    if (!checkpoint) return null;

    const pairKey = this.currentState.spotlight.sort().join('-');
    const loveData = this.currentState.episode.loveGraph[pairKey];
    
    if (!loveData) return null;

    // Check specific checkpoint conditions
    switch (checkpoint.type) {
      case 'mutual_spark':
        const hasReciprocal = loveData.attraction >= 0.4;
        const hasSharedMoment = this.currentState.callbacks.length > 0 || 
                               this.currentState.recentLines.some(l => l.deltas.trust > 0.05);
        return hasReciprocal && hasSharedMoment ? checkpoint : null;

      case 'explicit_conflict':
        const hasConflict = loveData.tension >= 0.6;
        const hasSpokenDisagreement = this.currentState.recentLines.some(l => 
          l.text.toLowerCase().includes('disagree') || 
          l.text.toLowerCase().includes('wrong') ||
          l.deltas.tension > 0.1
        );
        return hasConflict && hasSpokenDisagreement ? checkpoint : null;

      case 'need_boundary':
        const hasTrust = loveData.trust >= 0.6;
        const hasBoundaryStatement = this.currentState.recentLines.some(l =>
          l.text.toLowerCase().includes('need') ||
          l.text.toLowerCase().includes('want') ||
          l.text.toLowerCase().includes('boundary')
        );
        return hasTrust && hasBoundaryStatement ? checkpoint : null;

      case 'relational_choice':
        const hasCommitment = this.currentState.recentLines.some(l =>
          l.text.toLowerCase().includes('choose') ||
          l.text.toLowerCase().includes('want us') ||
          l.text.toLowerCase().includes('together')
        );
        return hasCommitment ? checkpoint : null;

      default:
        return null;
    }
  }

  private async advanceAct(checkpoint: Checkpoint): Promise<SceneTransitionEvent> {
    if (!this.currentState) throw new Error('No active state');

    const fromAct = checkpoint.fromAct;
    const toAct = checkpoint.toAct;
    
    // Update act path
    this.currentState.episode.actPath.push(toAct);
    
    // End current scene
    this.currentState.currentScene.endedAt = Date.now();
    this.currentState.currentScene.endedReason = 'checkpoint';
    
    // Create new scene
    const newScene: Scene = {
      id: uuidv4(),
      episodeId: this.currentState.episode.id,
      act: toAct,
      index: this.currentState.currentScene.index + 1,
      startedAt: Date.now(),
      spotlightPair: this.currentState.spotlight,
      majorNudges: 0,
      minorNudges: 0
    };
    
    this.currentState.episode.scenes.push(newScene);
    this.currentState.currentScene = newScene;
    
    // Reset counters
    this.currentState.plateauCounter = 0;
    
    const transition: SceneTransitionEvent = {
      kind: 'scene.transition',
      episodeId: this.currentState.episode.id,
      timestamp: Date.now(),
      sceneId: newScene.id,
      from: { act: fromAct, scene: this.currentState.currentScene.index - 1 },
      to: { act: toAct, scene: newScene.index },
      reason: 'checkpoint'
    };

    this.emitTelemetry(transition);
    
    console.log(`🎬 Act advancement: ${fromAct} → ${toAct} (${checkpoint.type})`);
    
    return transition;
  }

  private async checkPlateau(): Promise<void> {
    if (!this.currentState) return;

    const recentDeltas = this.currentState.recentLines.slice(-3);
    if (recentDeltas.length < 3) return;

    // Check for low novelty and tiny deltas
    const avgDeltaMagnitude = recentDeltas.reduce((sum, line) => {
      return sum + Math.abs(line.deltas.attraction) + Math.abs(line.deltas.trust) +
             Math.abs(line.deltas.tension) + Math.abs(line.deltas.comfort);
    }, 0) / (recentDeltas.length * 4);

    const hasRepetition = recentDeltas.some((line, i) =>
      recentDeltas.slice(i + 1).some(other => 
        this.calculateTextSimilarity(line.text, other.text) > 0.8
      )
    );

    if (avgDeltaMagnitude < 0.02 || hasRepetition) {
      this.currentState.plateauCounter++;
      
      this.emitTelemetry({
        kind: 'metric.tick',
        episodeId: this.currentState.episode.id,
        timestamp: Date.now(),
        sceneId: this.currentState.currentScene.id,
        name: 'plateau_detected',
        value: this.currentState.plateauCounter
      });

      if (this.currentState.plateauCounter >= 3) {
        console.log('📊 Plateau detected - suggesting freshness nudge');
      }
    } else {
      this.currentState.plateauCounter = 0;
    }
  }

  private processPendingNudges(): void {
    if (!this.currentState) return;

    // Apply biases to next exchange based on pending nudges
    for (const nudge of this.currentState.pendingNudges) {
      const descriptor = this.nudgeCatalog[nudge.type];
      if (descriptor) {
        console.log(`🎭 Processing nudge bias: ${nudge.type} (${nudge.intensity})`);
      }
    }

    // Clear processed nudges
    this.currentState.pendingNudges = [];
  }

  private updateRecoveryBias(): void {
    if (!this.currentState?.recoveryBias) return;

    this.currentState.recoveryBias.exchangesLeft--;
    
    if (this.currentState.recoveryBias.exchangesLeft <= 0) {
      this.currentState.recoveryBias = undefined;
      console.log('🔄 Recovery bias period ended');
    }
  }

  // Helper methods
  private getCurrentAct(): Act {
    if (!this.currentState) return 1;
    return this.currentState.episode.actPath[this.currentState.episode.actPath.length - 1];
  }

  private buildAgentState(): AgentState {
    if (!this.currentState) throw new Error('No active state');

    return {
      act: this.getCurrentAct(),
      vibe: this.currentState.episode.activeVibe,
      setting: this.currentState.episode.setting,
      spotlight: this.currentState.spotlight,
      recent_lines: this.currentState.recentLines.map(line => ({
        speaker: line.speaker,
        text: line.text,
        timestamp: new Date(line.timestamp)
      })),
      bias_flags: this.buildBiasFlags(),
      open_tokens: this.currentState.callbacks.slice(),
      love_graph_edge: this.getLoveGraphForSpotlight(),
      scene_fragility: this.calculateFragilityIndex()
    };
  }

  private buildBiasFlags(): any {
    if (!this.currentState) return {};

    const flags: any = {};
    
    // Apply recovery bias
    if (this.currentState.recoveryBias) {
      flags.bias_reassure = 0.6;
      flags.bias_clarify = true;
    }

    // Apply nudge biases
    for (const nudge of this.currentState.pendingNudges) {
      const descriptor = this.nudgeCatalog[nudge.type];
      if (descriptor?.biasEffects) {
        if (descriptor.biasEffects.comfort) flags.bias_reassure = 0.7;
        if (descriptor.biasEffects.trust) flags.bias_self_disclosure = 0.5;
        if (descriptor.biasEffects.tension) flags.bias_stakes = 0.4;
      }
      
      if (nudge.token) {
        flags.recall_token = nudge.token;
      }
    }

    return flags;
  }

  private buildConstraints(): string[] {
    if (!this.currentState) return [];
    
    const constraints = ['PG-13 content', 'consent-aware'];
    
    const currentAct = this.getCurrentAct();
    const actGate = this.actGates[currentAct];
    constraints.push(actGate.description);
    
    if (this.currentState.recoveryBias) {
      constraints.push('recovery mode - comfort/clarify bias');
    }

    return constraints;
  }

  private getLoveGraphForSpotlight(): any {
    if (!this.currentState) return null;
    
    const pairKey = this.currentState.spotlight.sort().join('-');
    return this.currentState.episode.loveGraph[pairKey] || null;
  }

  private buildEpisodeSummary(): EpisodeSummary {
    if (!this.currentState) throw new Error('No active state');

    return {
      episodeId: this.currentState.episode.id,
      act: this.getCurrentAct(),
      scene: this.currentState.currentScene.index,
      spotlight: this.currentState.spotlight,
      openLoops: this.currentState.openLoops.slice(),
      lastLines: this.currentState.recentLines.slice(-3),
      loveGraphSnapshot: { ...this.currentState.episode.loveGraph }
    };
  }

  private generateThresholdBadges(): ThresholdBadge[] {
    if (!this.currentState) return [];

    const badges: ThresholdBadge[] = [];
    const loveData = this.getLoveGraphForSpotlight();
    
    if (loveData) {
      if (loveData.attraction >= 0.7) {
        badges.push({
          type: 'spark',
          level: 'high',
          description: 'Strong mutual attraction'
        });
      }
      
      if (loveData.trust < 0.3 && loveData.tension > 0.5) {
        badges.push({
          type: 'fragile_trust',
          level: 'high',
          description: 'Trust issues amid tension'
        });
      }
      
      if (loveData.comfort >= 0.8) {
        badges.push({
          type: 'safe_space',
          level: 'high',
          description: 'Comfortable connection established'
        });
      }
    }

    if (this.currentState.plateauCounter >= 3) {
      badges.push({
        type: 'plateau',
        level: 'high',
        description: 'Story momentum stagnating'
      });
    }

    return badges;
  }

  private calculateFreshnessGain(): number {
    // Simplified calculation - would be more sophisticated in full implementation
    if (!this.currentState || this.currentState.recentLines.length < 2) return 0.5;
    
    const recent = this.currentState.recentLines.slice(-2);
    const similarity = this.calculateTextSimilarity(recent[0].text, recent[1].text);
    return Math.max(0, 1 - similarity);
  }

  private calculateCoherenceCost(): number {
    // Simplified calculation
    if (!this.currentState) return 0;
    
    const currentAct = this.getCurrentAct();
    const actGate = this.actGates[currentAct];
    
    // Higher coherence cost in later acts
    return Math.min(1, 0.2 + (currentAct - 1) * 0.1);
  }

  private calculateFragilityIndex(): number {
    if (!this.currentState) return 0;
    
    const loveData = this.getLoveGraphForSpotlight();
    if (!loveData) return 0;
    
    const highTension = loveData.tension * 0.4;
    const lowTrust = (1 - loveData.trust) * 0.4;
    const contradictions = 0.2; // Would check for actual contradictions
    
    return Math.min(1, highTension + lowTrust + contradictions);
  }

  private async importSeedContext(seed: EpisodeSeed): Promise<void> {
    // Import previous ending, callbacks, and open loops
    if (seed.callbacks) {
      this.currentState!.callbacks.push(...seed.callbacks);
    }
    
    if (seed.openLoops) {
      this.currentState!.openLoops.push(...seed.openLoops);
    }

    console.log(`📥 Imported seed context: ${seed.callbacks?.length || 0} callbacks, ${seed.openLoops?.length || 0} open loops`);
  }

  private estimateLineDuration(text: string): number {
    // Rough estimate: ~150 words per minute = 2.5 words per second
    const wordCount = text.split(' ').length;
    return Math.min(9, wordCount / 2.5); // Cap at 9 seconds
  }

  private calculateTextSimilarity(text1: string, text2: string): number {
    // Simple Jaccard similarity
    const words1 = new Set(text1.toLowerCase().split(' '));
    const words2 = new Set(text2.toLowerCase().split(' '));
    
    const intersection = new Set([...words1].filter(x => words2.has(x)));
    const union = new Set([...words1, ...words2]);
    
    return intersection.size / union.size;
  }

  private async emitMetrics(): Promise<void> {
    if (!this.currentState) return;

    // Emit various metrics
    const metrics = [
      { name: 'exchange_counter', value: this.exchangeCounter },
      { name: 'plateau_counter', value: this.currentState.plateauCounter },
      { name: 'active_callbacks', value: this.currentState.callbacks.length },
      { name: 'love_graph_attraction', value: this.getLoveGraphForSpotlight()?.attraction || 0 }
    ];

    for (const metric of metrics) {
      this.emitTelemetry({
        kind: 'metric.tick',
        episodeId: this.currentState.episode.id,
        timestamp: Date.now(),
        sceneId: this.currentState.currentScene.id,
        name: metric.name,
        value: metric.value
      });
    }
  }

  private emitTelemetry(event: TelemetryEventUnion): void {
    this.telemetryBuffer.push(event);
    this.emit('telemetry', event);
  }

  private flushTelemetryBuffer(): TelemetryEventUnion[] {
    const events = this.telemetryBuffer.slice();
    this.telemetryBuffer = [];
    return events;
  }
}