// Narrative Engine & Evaluation Engine Data Contracts

export type Act = 1 | 2 | 3 | 4 | 5;

export type Ending = 'warm_union' | 'hopeful_pause' | 'bittersweet_apart';

export type CheckpointType = 'mutual_spark' | 'explicit_conflict' | 'need_boundary' | 'relational_choice';

export type NudgeType = 'raise_stakes' | 'comfort' | 'vulnerability' | 'recall' | 'aside' | 'tempo_up' | 'tempo_down';

export type NudgeIntensity = 'minor' | 'major';

export type NudgeSource = 'observer' | 'auto' | 'evaluator';

export type EndReason = 'checkpoint' | 'plateau' | 'wrap';

export interface LoveGraphPair {
  attraction: number; // 0-1
  trust: number; // 0-1  
  tension: number; // 0-1
  comfort: number; // 0-1
}

export interface LoveGraph {
  [pairKey: string]: LoveGraphPair; // e.g., "emma-jake": {...}
}

export interface ChemistryDeltas {
  attraction: number;
  trust: number;
  tension: number;
  comfort: number;
}

export interface SpokenLine {
  timestamp: number;
  speaker: string;
  text: string;
  secs: number; // spoken duration
  deltas: ChemistryDeltas;
  latencyMs: number;
}

export interface Nudge {
  type: NudgeType;
  intensity: NudgeIntensity;
  source: NudgeSource;
  target?: string; // character ID
  token?: string; // for recall nudges
  metadata?: Record<string, any>;
}

export interface Scene {
  id: string;
  episodeId: string;
  act: Act;
  index: number;
  startedAt: number;
  endedAt?: number;
  spotlightPair: [string, string];
  endedReason?: EndReason;
  majorNudges: number;
  minorNudges: number;
}

export interface Episode {
  id: string;
  startedAt: number;
  endedAt?: number;
  actPath: Act[];
  ending?: Ending;
  importSeed?: string;
  scenes: Scene[];
  loveGraph: LoveGraph;
  activeVibe: string;
  setting: string;
  constraints: {
    pg13: boolean;
    maxLineLength: number;
  };
}

export interface StoryState {
  episode: Episode;
  currentScene: Scene;
  spotlight: [string, string];
  recentLines: SpokenLine[];
  openLoops: string[];
  callbacks: string[];
  pendingNudges: Nudge[];
  recoveryBias?: {
    type: 'comfort_clarify';
    exchangesLeft: number;
  };
  plateauCounter: number;
  lastMajorNudgeExchange: number;
}

export interface Checkpoint {
  type: CheckpointType;
  fromAct: Act;
  toAct: Act;
  description: string;
  requirements: string[];
}

export interface ActGate {
  act: Act;
  allowedNudges: NudgeType[];
  blockedNudges: NudgeType[];
  coherenceWeight: number; // λ value
  description: string;
}

export interface NudgeDescriptor {
  type: NudgeType;
  intensity: NudgeIntensity;
  description: string;
  biasEffects: {
    attraction?: number;
    trust?: number;
    tension?: number;
    comfort?: number;
  };
  actRestrictions?: Act[];
  cooldownExchanges?: number;
}

// Telemetry Events
export interface TelemetryEvent {
  kind: string;
  episodeId: string;
  timestamp: number;
  sceneId?: string;
}

export interface TurnStartEvent extends TelemetryEvent {
  kind: 'turn.start';
  act: Act;
  scene: number;
}

export interface TurnEndEvent extends TelemetryEvent {
  kind: 'turn.end';
  line: SpokenLine;
  deltas: ChemistryDeltas;
  latencyMs: number;
}

export interface NudgeAppliedEvent extends TelemetryEvent {
  kind: 'nudge.applied';
  nudge: Nudge;
  source: NudgeSource;
}

export interface SceneTransitionEvent extends TelemetryEvent {
  kind: 'scene.transition';
  from: { act: Act; scene: number };
  to: { act: Act; scene: number };
  reason: EndReason;
}

export interface MetricTickEvent extends TelemetryEvent {
  kind: 'metric.tick';
  name: string;
  value: number;
}

export type TelemetryEventUnion = 
  | TurnStartEvent 
  | TurnEndEvent 
  | NudgeAppliedEvent 
  | SceneTransitionEvent 
  | MetricTickEvent;

// Evaluation Engine Types
export interface EvaluationState {
  recentLines: SpokenLine[];
  structuralState: {
    act: Act;
    sceneIndex: number;
    milestones: CheckpointType[];
    spotlight: [string, string];
  };
  loveGraphDeltas: ChemistryDeltas[];
  callbackActivity: string[];
  pacingMetrics: {
    latencyMs: number;
    interruptions: number;
  };
}

export interface EvaluationScores {
  freshnessGain: number; // 0-1
  coherenceCost: number; // 0-1
  fragilityIndex: number; // 0-1
  finalScore: number;
}

export interface EvaluationRecommendation {
  autoNudge?: Nudge;
  rationales: string[];
  scores: EvaluationScores;
  abstain?: boolean;
}

export interface EvaluationSnapshot {
  id: string;
  sceneId: string;
  candidate: Nudge;
  scores: EvaluationScores;
  rationales: string[];
  chosen: boolean;
  timestamp: number;
}

export interface FragilityComponents {
  highTension: number;
  lowTrust: number;
  recentContradictions: number;
  total: number;
}

export interface FreshnessComponents {
  semanticNovelty: number;
  diversityBonus: number;
  stagnationBuster: number;
  callbackRevival: number;
  total: number;
}

export interface CoherenceComponents {
  personaDrift: number;
  actGrammarViolation: number;
  continuityContradiction: number;
  safetyGuard: number;
  total: number;
}

// Integration Contracts
export interface EpisodeSeed {
  characters: string[];
  vibe: string;
  setting: string;
  importSeed?: string;
  previousEnding?: string;
  callbacks?: string[];
  openLoops?: string[];
}

export interface EpisodeSummary {
  episodeId: string;
  act: Act;
  scene: number;
  spotlight: [string, string];
  openLoops: string[];
  lastLines: SpokenLine[];
  loveGraphSnapshot: LoveGraph;
}

export interface TickResult {
  producedLines: SpokenLine[];
  updatedSummary: EpisodeSummary;
  transitions: SceneTransitionEvent[];
  telemetryEvents: TelemetryEventUnion[];
}

// Storage Models
export interface EpisodeRecord {
  id: string;
  started_at: Date;
  ended_at?: Date;
  act_path: Act[];
  ending?: Ending;
  import_seed?: string;
  transcript_jsonb: any;
  avg_latency_ms: number;
  persona_used: string;
  satisfaction_score?: number;
}

export interface SceneRecord {
  id: string;
  episode_id: string;
  act: Act;
  idx: number;
  ended_reason?: EndReason;
  major_nudges: number;
  minor_nudges: number;
}

export interface TurnRecord {
  id: string;
  scene_id: string;
  speaker: string;
  text: string;
  secs: number;
  deltas: ChemistryDeltas;
  latency_ms: number;
}

export interface EvaluationSnapshotRecord {
  id: string;
  scene_id: string;
  candidate: Nudge;
  freshness: number;
  coherence: number;
  fragility: number;
  score: number;
  chosen: boolean;
}

// Threshold Badges for Console Display
export interface ThresholdBadge {
  type: 'spark' | 'fragile_trust' | 'safe_space' | 'high_tension' | 'plateau';
  level: 'low' | 'medium' | 'high';
  description: string;
}

export interface ConsoleState {
  episode: EpisodeSummary;
  badges: ThresholdBadge[];
  recentNudges: Nudge[];
  evaluationScores: EvaluationScores;
  cadenceStatus: {
    majorBudgetUsed: number;
    majorBudgetMax: number;
    lastMajorExchange: number;
    recoveryMode: boolean;
  };
}