export type VoiceStyle = 'warm' | 'wry' | 'direct' | 'poetic';

export type Intent = 
  | 'reassure' 
  | 'reveal' 
  | 'invite' 
  | 'tease' 
  | 'challenge' 
  | 'clarify' 
  | 'apologize' 
  | 'deflect' 
  | 'ask' 
  | 'accept' 
  | 'decline' 
  | 'mischief';

export type SideIntent = 'inform' | 'tease' | 'block' | 'soothe' | 'escalate';

export interface CharacterTraits {
  openness: number; // 0-1
  agreeableness: number; // 0-1
  extraversion: number; // 0-1
  conscientiousness: number; // 0-1
  stability: number; // 0-1
}

export interface LoveLanguage {
  words: number; // 0-1
  time: number; // 0-1
  acts: number; // 0-1
  gifts: number; // 0-1
  touch: number; // 0-1
}

export interface CharacterCard {
  id: string;
  name: string;
  pronouns: string;
  voice_style: VoiceStyle;
  traits: CharacterTraits;
  goals: string[]; // 3-5 ranked goals
  values: string[]; // 2-4 values
  hard_limits: string[]; // 2-4 hard limits (PG-13/consent baked in)
  love_lang: LoveLanguage;
  tics: string[]; // 2-4 diction/phrase habits
  initial_stance: Record<string, number>; // other lead IDs → (-1..+1)
}

export interface SideCharacterCard {
  id: string;
  name: string;
  role: string;
  job_to_do: 'gatekeeper' | 'wing' | 'pressure' | 'comic_relief' | 'obstacle' | 'catalyst';
  tics: string[]; // 1-2 tics
  facts: string[]; // 1-2 facts
}

export interface ChemDeltas {
  attraction: number;
  trust: number;
  tension: number;
  comfort: number;
}

export interface RiskFlags {
  safety?: boolean;
  continuity?: boolean;
  act_gate?: boolean;
}

export interface IntentBundle {
  speaker: string;
  intent: Intent;
  targets: string[];
  recall_token?: string;
  predicted_deltas: ChemDeltas;
  risk_flags: RiskFlags;
  confidence: number; // 0-1
}

export interface LineDraft {
  speaker: string;
  text: string; // ≤9s spoken
  used_token?: string;
  novelty: number; // 0-1
  coherence_cost: number; // 0-1
}

export interface FinalLine {
  speaker: string;
  text: string;
  meta: {
    used_tokens: string[];
    deltas: ChemDeltas;
    rationales: string[];
  };
}

export interface BiasFlags {
  bias_self_disclosure?: number; // 0-1
  bias_reassure?: number; // 0-1
  bias_stakes?: number; // 0-1
  bias_clarify?: boolean;
  cap_line_sec?: number;
  recall_token?: string;
  aside_pair?: [string, string];
}

export interface AgentState {
  act: number;
  vibe: string;
  setting: string;
  spotlight: [string, string];
  recent_lines: Array<{
    speaker: string;
    text: string;
    timestamp: Date;
  }>;
  bias_flags: BiasFlags;
  open_tokens: string[];
  love_graph_edge?: ChemDeltas; // For partner relationship
  scene_fragility?: number; // Computed from tension↑ + trust↓ + contradictions
}

export interface SideTriggers {
  name_mention?: boolean;
  policy_pressure?: boolean;
  time_pressure?: boolean;
  jealousy_ripple?: boolean;
  compersion_ripple?: boolean;
  explicit_aside?: boolean;
}

export interface BeatPlan {
  speaker_order: string[];
  callbacks_to_surface: string[];
  constraints: string[];
}

export interface SelfCheckResult {
  passed: boolean;
  scores: {
    safety_consent: number; // 0-1
    continuity: number; // 0-1
    persona_voice: number; // 0-1
    act_vibe_grammar: number; // 0-1
    pacing_novelty: number; // 0-1
  };
  issues: string[];
  suggestion?: 'soften' | 'clarify' | 'swap' | 'defer' | 'aside_redirect';
}

export interface RecallCandidate {
  token: string;
  salience: number;
  dormancy: number;
  semantic_fit: number;
  relevance_score: number;
}

export interface UtilityScores {
  goal_alignment: number; // 0-1
  relational_gain: number; // 0-1
  act_vibe_fit: number; // 0-1
  nudge_alignment: number; // 0-1
  freshness_potential: number; // 0-1
  coherence_risk: number; // 0-1
  total_utility: number;
}

export interface TelemetryData {
  exchange_id: string;
  character_id: string;
  intent: Intent | SideIntent;
  confidence: number;
  utility_scores: UtilityScores;
  self_check_scores: SelfCheckResult['scores'];
  recall_success?: boolean;
  line_length_sec: number;
  novelty_score: number;
  contradiction_flagged: boolean;
  repair_attempts: number;
}

export interface RepairDirective {
  type: 'soften' | 'clarify' | 'swap' | 'defer' | 'aside_redirect';
  reason: string;
  max_attempts: number;
}