export interface LoveGraph {
  attraction: number; // 0-1
  trust: number; // 0-1
  tension: number; // 0-1
  comfort: number; // 0-1
}

export interface GameState {
  storyId: string;
  currentAct: number; // 1-5
  spotlightPair: [string, string];
  watchers: string[];
  recentLines: GameLine[];
  loveGraph: LoveGraph;
  tokens: CallbackToken[];
  plateauCounter: number;
  lastMajorNudgeExchange: number;
  currentExchange: number;
}

export interface GameLine {
  turnIdx: number;
  speaker: string;
  text: string;
  timestamp: Date;
  isNarrator?: boolean;
}

export interface CallbackToken {
  id: string;
  content: string;
  salience: number;
  lastSeenTurn: number;
  scheduled?: boolean;
}

export interface NudgeCandidate {
  type: NudgeType;
  description: string;
  oneStepPreview?: string;
  freshnessScore: number;
  coherenceCost: number;
  netScore: number;
  rationale: string[];
}

export type NudgeType = 
  | 'recall'
  | 'vulnerability'
  | 'comfort'
  | 'raise_stakes_light'
  | 'clarify'
  | 'aside_pair'
  | 'tempo_up'
  | 'tempo_down';

export interface Vibe {
  id: string;
  name: string;
  tone: string;
  archetypes: string[];
  conflicts: string[];
  settingSeeds: string[];
  callbackTokens: string[];
  nudgePriorities: NudgeType[];
  coherenceWeight: number; // λ value
  actGates: Record<number, string>; // Requirements for each act
}

export interface StoryContext {
  vibe: Vibe;
  previouslyLine?: string;
  extractedTokens: CallbackToken[];
}

export interface LineMemory {
  storyId: string;
  turnIdx: number;
  speaker: string;
  text: string;
  timestamp: Date;
  vector: number[];
}

export interface TokenMemory {
  storyId: string;
  token: string;
  salience: number;
  lastSeenTurn: number;
  vector: number[];
}

export interface OpenAIConfig {
  writerModel: 'gpt-4.1' | 'gpt-4o';
  previewModel: 'gpt-4.1-mini' | 'gpt-4o-mini';
  embeddingModel: 'text-embedding-3-large' | 'text-embedding-3-small';
}

export interface SafetyResult {
  isSafe: boolean;
  reason?: string;
}