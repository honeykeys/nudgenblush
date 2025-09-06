# Character Engine - Autonomous Romance Characters

The Character Engine powers autonomous romance characters with full decision-making capabilities, memory integration, and PG-13 safety guardrails. Built for OpenAI integration with Weaviate Cloud vector storage.

## 🎭 Overview

The Character Engine implements two types of autonomous agents:

- **LeadAgents**: Full autonomous characters (2-3 per story) with complete decision-making loops
- **SideAgents**: Simplified trigger-driven characters that provide context and support

All character behavior follows a seven-step autonomy loop: **Perceive → Recall → Intent → Draft → Self-Check → Emit → Reflect**.

## 🏗️ Architecture

### Core Components

- **LeadAgent** (`src/engines/character.ts`): Full autonomy loop for main characters
- **SideAgent** (`src/engines/character.ts`): Trigger-driven behavior for supporting characters  
- **CharacterOrchestrator** (`src/core/character-orchestrator.ts`): Integration hub and telemetry
- **Character Types** (`src/types/character.ts`): Comprehensive data contracts

### Integration Points

- **→ Narrative Agent**: Provides IntentBundles and LineDrafts for story auction
- **← Nudge Engine**: Consumes BiasFlags to influence character behavior
- **↔ Evaluator**: Self-check system with repair directives and quality scores

## 🤖 LeadAgent Autonomy Loop

### 1. Perceive
Analyzes current story state and computes scene fragility:
```typescript
const enhanced_state = await leadAgent.perceive(state, character_card);
// Computes: scene_fragility = 0.4*tension + 0.4*(1-trust) + 0.2*contradictions
```

### 2. Recall  
Queries Weaviate for relevant memories using semantic similarity:
```typescript
const recall_candidate = await leadAgent.recall(state, character_card);
// Returns token with highest: salience × dormancy × semantic_fit (≥0.6)
```

### 3. Intent Selection
Calculates utility scores for 12 available intents using weighted formula:
```typescript
U = 0.30*GoalAlignment + 0.20*RelationalGain + 0.15*ActVibeFit 
  + 0.15*NudgeAlignment + 0.10*FreshnessPotential - 0.10*CoherenceRisk
```

**Available Intents**: `reassure`, `reveal`, `invite`, `tease`, `challenge`, `clarify`, `apologize`, `deflect`, `ask`, `accept`, `decline`, `mischief`

### 4. Draft
Generates character dialogue using OpenAI with persona overlays:
- Base System Prompt + Vibe + Character persona + BiasFlags
- Enforces ≤9 second line length constraint  
- Weaves recall tokens naturally
- Maintains character voice style and tics

### 5. Self-Check
Five-dimensional quality assessment:
- **Safety/Consent**: PG-13 compliance and hard limits (≥0.7)
- **Continuity**: No contradictions with memory (≥0.7)
- **Persona/Voice**: Character consistency and tics (≥0.7)
- **Act/Vibe Grammar**: Appropriate for story phase (≥0.7)
- **Pacing/Novelty**: Length and uniqueness (≥0.7)

### 6. Emit
Creates FinalLine with metadata:
```typescript
{
  speaker: string,
  text: string,
  meta: {
    used_tokens: string[],
    deltas: ChemDeltas, // attraction, trust, tension, comfort
    rationales: string[]
  }
}
```

### 7. Reflect
Persists chosen line to Weaviate and updates token timestamps.

## 🎪 SideAgent Behavior

### Trigger System
SideAgents activate only when triggered:
- **Name Mention**: Character mentioned in recent dialogue
- **Policy/Time Pressure**: Role-based intervention (e.g., gatekeeper after 8+ lines)
- **Jealousy/Compersion Ripple**: Emotional context detection
- **Explicit Aside**: Nudge engine directs interaction

### Intent Mapping
Five simplified intents based on character role:
- **Gatekeeper** → `block`, `inform`
- **Wing** → `tease`, `soothe` 
- **Pressure** → `escalate`
- **Comic Relief** → `tease`
- **Catalyst** → `inform`, `escalate`

### Yield Discipline
SideAgents emit **one purposeful line only**, then step back to avoid stealing focus from the romantic leads.

## 🎯 Character Data Contracts

### CharacterCard (LeadAgent)
```typescript
interface CharacterCard {
  id: string;
  name: string;
  pronouns: string;
  voice_style: 'warm' | 'wry' | 'direct' | 'poetic';
  traits: {
    openness: number;      // 0-1, Big Five personality
    agreeableness: number;
    extraversion: number;
    conscientiousness: number;
    stability: number;
  };
  goals: string[]; // 3-5 ranked priorities
  values: string[]; // 2-4 core values
  hard_limits: string[]; // 2-4 non-negotiable boundaries
  love_lang: {
    words: number; // Love language preferences 0-1
    time: number;
    acts: number;
    gifts: number;
    touch: number;
  };
  tics: string[]; // 2-4 speech habits
  initial_stance: Record<string, number>; // other character IDs → sentiment (-1 to +1)
}
```

### SideCharacterCard (SideAgent)
```typescript
interface SideCharacterCard {
  id: string;
  name: string;  
  role: string;
  job_to_do: 'gatekeeper' | 'wing' | 'pressure' | 'comic_relief' | 'obstacle' | 'catalyst';
  tics: string[]; // 1-2 speech habits
  facts: string[]; // 1-2 background facts
}
```

## 🔌 Integration Usage

### For Narrative Agent

Generate intent bundles for story auction:
```typescript
const orchestrator = new CharacterOrchestrator(openai, weaviate, safety);
const bundles = await orchestrator.generateIntentBundles(state, ['emma', 'jake']);
// Returns IntentBundle[] with confidence scores for auction
```

Execute beat plan:
```typescript
const beatPlan = {
  speaker_order: ['emma', 'jake'],
  callbacks_to_surface: ['shared umbrella'],
  constraints: ['build tension', 'stay light']
};
const finalLines = await orchestrator.executeBeatPlan(state, beatPlan);
```

### For Evaluator Integration

Request repair for failed lines:
```typescript
const repaired = await orchestrator.attemptRepair(state, character, draft, {
  type: 'soften', // 'soften' | 'clarify' | 'swap' | 'defer' | 'aside_redirect'
  reason: 'Too intense for current act',
  max_attempts: 2
});
```

## 🛡️ Safety & Consent

### Multi-Layer Safety
1. **OpenAI Moderation API**: Automatic content filtering
2. **Custom Pattern Matching**: PG-13 and consent-specific rules
3. **Character Hard Limits**: Per-character boundary enforcement
4. **Self-Check Validation**: Quality gates before emission

### Safety Features
- All characters explicitly 18+ adults
- PG-13 content guidelines enforced
- Consent-aware language patterns
- No explicit sexual content or violence
- Automatic escalation blocking in fragile scenes

## 📊 Telemetry & Evaluation

### Real-Time Metrics
- **Intent Variety**: No same intent >2 consecutive times (target: variety)
- **Plateau-Break Rate**: Breakthrough when plateauCounter≥2 (target: ≥60%)
- **Contradiction Rate**: Continuity violations (target: <2%)
- **Recall Efficacy**: Token surfacing success (target: ≥80%)
- **Line Compliance**: ≤9sec + PG-13 adherence (target: ≥95%)

### Telemetry Export
```typescript
const metrics = orchestrator.exportTelemetry();
console.log('Intent Variety:', orchestrator.getIntentVarietyScore());
console.log('Contradiction Rate:', orchestrator.getContradictionRate());
```

## 🎪 Example Usage

### Creating Characters
```typescript
const emma: CharacterCard = {
  id: 'emma',
  name: 'Emma',
  voice_style: 'warm',
  traits: { openness: 0.7, agreeableness: 0.8, extraversion: 0.6, conscientiousness: 0.7, stability: 0.6 },
  goals: ['find genuine connection', 'overcome past heartbreak', 'be vulnerable'],
  values: ['authenticity', 'kindness'],
  hard_limits: ['no violence', 'respect boundaries'],
  love_lang: { words: 0.8, time: 0.7, acts: 0.6, gifts: 0.3, touch: 0.4 },
  tics: ['Well...', 'I suppose'],
  initial_stance: { 'jake': 0.3 }
  // ... other fields
};

orchestrator.addLeadCharacter(emma);
```

### Running Autonomy Loop
```typescript
const state: AgentState = {
  act: 1,
  vibe: 'ember',
  setting: 'cozy coffee shop',
  spotlight: ['emma', 'jake'],
  recent_lines: [/* previous dialogue */],
  bias_flags: { bias_self_disclosure: 0.4, recall_token: 'shared umbrella' },
  open_tokens: ['shared umbrella', 'meaningful glances'],
  love_graph_edge: { attraction: 0.2, trust: 0.1, tension: 0.3, comfort: 0.2 }
};

// Generate character responses
const bundles = await orchestrator.generateIntentBundles(state, ['emma', 'jake']);
const drafts = await orchestrator.generateLineDrafts(state, bundles);
```

## 🧪 Testing

Run acceptance criteria tests:
```bash
npm test -- character-acceptance.test.ts
```

### Acceptance Criteria Coverage
✅ **Lead Autonomy**: Different intents, persona consistency, bias responsiveness  
✅ **Recall Proof**: Umbrella token surfaces within ≤3 exchanges  
✅ **Side Discipline**: Triggers only, one line, then yields  
✅ **Continuity & Safety**: <2% contradiction rate, PG-13 compliance  
✅ **Integration**: Clean interfaces with Narrative Agent and Evaluator  
✅ **Latency Hygiene**: ≤3 OpenAI calls per exchange, efficient vector writes  

## 🎯 Advanced Features

### Voice Style Examples
- **Warm**: "Oh honey, that sounds wonderful..."
- **Wry**: "Well, well, isn't that interesting..."  
- **Direct**: "No. That's not happening."
- **Poetic**: "Like morning light through autumn leaves..."

### Utility Scoring Deep Dive
The intent selection system weighs multiple factors:
- **Goal Alignment** (30%): How well intent serves character's ranked goals
- **Relational Gain** (20%): Potential impact on attraction/trust/tension/comfort
- **Act/Vibe Fit** (15%): Appropriateness for current story phase and mood
- **Nudge Alignment** (15%): Responsiveness to Nudge Engine bias flags
- **Freshness Potential** (10%): Novelty and variety bonus
- **Coherence Risk** (10% penalty): Character inconsistency or safety concerns

### Memory Integration
Characters maintain semantic memory through Weaviate:
- **LineMemory**: Previous dialogue with embeddings for contextual recall
- **TokenMemory**: Important story elements with salience weighting
- **Dormancy Scoring**: Older unused tokens get priority for natural callback

## 🚀 Performance Notes

### Demo Constraints
- Max 3 OpenAI preview calls per exchange
- Embedding caching per session
- Only chosen lines written to Weaviate
- Batched operations where possible

### Production Optimizations
- Vector similarity search with 0.6+ threshold
- Intent variety enforcement prevents repetition
- Self-check repair system (max 2 attempts)
- Telemetry-driven quality monitoring

Built with taste: subtext over exposition, consent over chaos, and enough novelty to make the heart do little cartwheels. 💫