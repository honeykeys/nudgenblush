# Narrative Engine & Evaluation Engine

Real-time story runtime that conducts multi-character scenes in a five-act framework with autonomous nudge evaluation, Love Graph tracking, and rich telemetry. Built for hackathon platform with event-driven progression and safety-first design.

## 🎬 Overview

The Narrative Engine orchestrates real-time romance stories through:
- **5-Act Structure**: Setup → Rising Action → Climax → Falling Action → Resolution
- **Event-Driven Scenes**: No timers, progression through checkpoints only
- **Love Graph Tracking**: Multi-dimensional relationship tracking with ripple effects
- **Smart Nudge System**: AI-driven story direction with cadence control
- **Rich Telemetry**: Complete event stream for evaluation and debugging

The Evaluation Engine provides real-time story criticism with:
- **Freshness vs Coherence**: Dynamic scoring based on scene fragility and act
- **Auto-Nudge Recommendations**: Context-aware story interventions
- **Transparent Reasoning**: Human-readable rationales for all decisions

## 🏗️ Architecture

### Core Components

- **NarrativeEngine** (`src/engines/narrative.ts`): 5-act orchestration with Love Graph
- **EvaluationEngine** (`src/engines/evaluation.ts`): Real-time story criticism and nudge recommendations
- **NarrativeStore** (`src/storage/narrative-store.ts`): Telemetry and episode persistence
- **Narrative Types** (`src/types/narrative.ts`): Comprehensive data contracts

### Integration Points

- **← Character Engine**: Orchestrates character interactions via beat plans
- **→ Console/UI**: Provides real-time state, badges, and telemetry
- **↔ Observer**: Accepts manual nudges and emits story events

## 🎭 Core Concepts

### Acts & Scenes
**5 Acts with Logical Progression:**
- **Act I**: Setup - Light introduction, establish chemistry
- **Act II**: Rising Action - Building connection, light stakes  
- **Act III**: Climax - High emotional stakes, conflict
- **Act IV**: Falling Action - Resolution beginning
- **Act V**: Resolution - Commitment, no new complications

**Scene Lifecycle:**
1. Start scene with spotlight pair and current vibe
2. Alternate lines with soft biases from pending nudges
3. Update Love Graph after each exchange
4. Check for checkpoints → advance act or suggest soft wrap
5. Monitor plateau (low novelty) → suggest freshness nudge

### Spotlight & Love Graph
**Spotlight System:**
- One primary pair in focus per scene
- All character pairs tracked in Love Graph matrix
- Watchers receive emotional ripple effects (jealousy/compersion)

**Love Graph Dimensions:**
```typescript
interface LoveGraphPair {
  attraction: number; // 0-1, romantic/physical appeal
  trust: number;      // 0-1, emotional safety and reliability  
  tension: number;    // 0-1, conflict and unresolved issues
  comfort: number;    // 0-1, ease and familiarity
}
```

**Chemistry Deltas:**
Each line produces small changes (+/-0.15 max) with clamping to [0,1] and ripple effects to watching characters.

### Checkpoint System
**Four Act Advancement Checkpoints:**

| Checkpoint | Transition | Requirements |
|------------|------------|--------------|
| **Mutual Spark** | I → II | Reciprocal attraction ≥0.4 + shared callback OR micro-vulnerability |
| **Explicit Conflict** | II → III | Spoken disagreement + tension ≥0.6 OR values clash |
| **Need/Boundary** | III → IV | Explicit need statement + boundary declared OR trust ≥0.6 |
| **Relational Choice** | IV → V | Commitment statement + future together choice |

### Nudge System
**7 Core Nudge Types:**

| Nudge | Intensity | Description | Bias Effects | Act Restrictions |
|-------|-----------|-------------|--------------|------------------|
| **raise_stakes** | major | Short-term tension bias | +0.15 tension, +0.05 attraction | Acts II-IV only |
| **comfort** | minor | Lower tension, permit reassurance | +0.1 comfort, -0.05 tension | All acts |
| **vulnerability** | minor | Bias toward self-disclosure | +0.12 trust, +0.03 attraction | All acts |
| **recall** | minor | Resurface dormant callback token | +0.08 attraction, +0.04 comfort | All acts |
| **aside** | minor | Spotlight shift with ripple effects | +0.06 tension, +0.02 attraction | Acts II-IV |
| **tempo_up** | minor | Faster pacing, shorter pauses | +0.04 tension, +0.02 attraction | All acts |
| **tempo_down** | minor | Slower pacing, more reflection | +0.06 comfort, +0.02 trust | All acts |

**Cadence Rules:**
- ≤1 major nudge per 6 exchanges
- 2-exchange recovery bias (Comfort/Clarify) after any major
- Minor nudges unlimited but diversity-throttled

## 🔌 Integration Contracts

### StartEpisode
```typescript
async startEpisode(seed: EpisodeSeed): Promise<EpisodeSummary>
```
Initializes new story with characters, vibe, setting, and optional imported context.

### ApplyNudge  
```typescript
async applyNudge(nudge: Nudge): Promise<boolean>
```
Schedules bias for next exchange, subject to act gates and cadence limits.

### Tick
```typescript
async tick(): Promise<TickResult>
```
Advances one exchange, processes character interactions, updates Love Graph, checks checkpoints, emits telemetry.

### GetState
```typescript
getState(): ConsoleState | null
```
Read-only snapshot for console display with badges, metrics, and recent activity.

## 📊 Evaluation Engine

### Scoring Model
**Final Score Formula:**
```
Score = FreshnessGain - λ × CoherenceCost
```

**Lambda Calculation:**
```
λ = ActWeight × (0.6 + Fragility × 1.2)
```

**Act Coherence Weights:**
- Act I: 0.7 (light coherence)
- Act II: 0.9 (building structure)  
- Act III: 1.2 (high stakes precision)
- Act IV: 1.6 (careful resolution)
- Act V: 1.8 (maximum coherence)

### Freshness Components
**Semantic Novelty** (40%): Embedding distance vs recent lines
**Diversity Bonus** (30%): Underused nudge type preference  
**Stagnation Buster** (20%): Bonus when chemistry deltas flatten
**Callback Revival** (10%): Dormant token surfacing reward

### Coherence Components  
**Persona Drift** (30%): Character inconsistency risk
**Act Grammar Violation** (25%): Wrong nudge for current act
**Continuity Contradiction** (25%): Conflicts with established facts
**Safety Guard** (20%): PG-13 and consent violations (hard block)

### Fragility Index
**High Tension** (40%): Recent tension deltas above 0.5
**Low Trust** (40%): Recent trust deltas below 0.5  
**Contradictions** (20%): Detected logical inconsistencies

Fragile scenes (fragility > 0.6) heavily favor coherence; stable scenes allow bolder moves.

## 📡 Telemetry Wire

### Event Stream
All events are append-only, JSON-serializable, and order-preserving:

```typescript
// Turn lifecycle
{
  "kind": "turn.start",
  "episodeId": "ep_42", 
  "act": 1,
  "scene": 0
}

{
  "kind": "turn.end",
  "episodeId": "ep_42",
  "line": {
    "t": 1694012345678,
    "speaker": "Emma", 
    "text": "I kept the umbrella.",
    "secs": 5.1
  },
  "deltas": {"attraction": 0.11, "trust": 0.06, "tension": -0.03, "comfort": 0.07},
  "latencyMs": 420
}

// Nudge application
{
  "kind": "nudge.applied",
  "episodeId": "ep_42",
  "nudge": {"type": "recall", "token": "umbrella"},
  "source": "auto"
}

// Scene transitions  
{
  "kind": "scene.transition",
  "from": {"act": 1, "scene": 0},
  "to": {"act": 2, "scene": 1}, 
  "reason": "checkpoint"
}

// Metrics
{
  "kind": "metric.tick",
  "name": "plateau_counter",
  "value": 3
}
```

### Storage Schema
```sql
episodes(id, started_at, ended_at, act_path[], ending, import_seed)
scenes(id, episode_id, act, idx, ended_reason, major_nudges, minor_nudges)  
turns(id, scene_id, speaker, text, secs, deltas jsonb, latency_ms)
eval_snapshots(id, scene_id, candidate jsonb, freshness, coherence, fragility, score, chosen)
```

## 🛡️ Safety System

### Multi-Layer Protection
1. **Character Hard Limits**: Per-character boundaries (no violence, respect consent)
2. **OpenAI Moderation**: Automatic content filtering 
3. **Custom Pattern Matching**: PG-13 specific rules
4. **Act Gate Enforcement**: Wrong-act nudges blocked
5. **Emergency Stops**: Hard blocks for unsafe content

### Content Guidelines
- All characters 18+ adults explicitly
- PG-13 content only (no explicit sexual content)
- Consent-aware language patterns  
- No violence, slurs, or offensive content
- Narrator never overrides character choices

## 🎯 Usage Examples

### Initialize Episode
```typescript
import { NarrativeEngine, EvaluationEngine } from './engines';

const narrativeEngine = new NarrativeEngine(characterOrchestrator, openai, weaviate, safety);
const evaluationEngine = new EvaluationEngine(openai);

const seed: EpisodeSeed = {
  characters: ['emma', 'jake'],
  vibe: 'ember',
  setting: 'cozy coffee shop',
  callbacks: ['shared umbrella', 'meaningful glances']
};

const summary = await narrativeEngine.startEpisode(seed);
console.log(`Started episode ${summary.episodeId} in Act ${summary.act}`);
```

### Process Exchange with Evaluation
```typescript
// Set up telemetry flow
narrativeEngine.on('telemetry', (event) => {
  evaluationEngine.onTelemetry(event);
});

// Process story exchange  
const tickResult = await narrativeEngine.tick();
console.log(`Produced ${tickResult.producedLines.length} lines`);

// Get evaluation recommendation
const evaluationState = buildEvaluationState(tickResult);
const recommendation = await evaluationEngine.consider(evaluationState);

if (recommendation.autoNudge && !recommendation.abstain) {
  console.log(`🤖 Auto-nudge: ${recommendation.autoNudge.type}`);
  console.log(`📝 Rationales: ${recommendation.rationales.join(', ')}`);
  
  await narrativeEngine.applyNudge(recommendation.autoNudge);
}
```

### Apply Manual Nudge
```typescript
const success = await narrativeEngine.applyNudge({
  type: 'vulnerability',
  intensity: 'minor', 
  source: 'observer'
});

if (success) {
  console.log('✅ Nudge applied successfully');
} else {
  console.log('❌ Nudge blocked by act gates or cadence limits');
}
```

### Monitor Console State  
```typescript
const state = narrativeEngine.getState();
if (state) {
  console.log(`💕 Love Graph: A:${state.episode.loveGraphSnapshot['emma-jake']?.attraction.toFixed(2)}`);
  console.log(`🏷️  Badges: ${state.badges.map(b => b.type).join(', ')}`);
  console.log(`📊 Fragility: ${state.evaluationScores.fragilityIndex.toFixed(2)}`);
  console.log(`⏱️  Recovery Mode: ${state.cadenceStatus.recoveryMode}`);
}
```

## 🎪 Threshold Badges

Visual indicators for console display:

| Badge | Trigger | Description |
|-------|---------|-------------|
| **spark** | attraction ≥ 0.7 | Strong mutual attraction |
| **fragile_trust** | trust < 0.3 + tension > 0.5 | Trust issues amid tension |
| **safe_space** | comfort ≥ 0.8 | Comfortable connection established |
| **high_tension** | tension ≥ 0.7 | Conflict or unresolved issues |
| **plateau** | counter ≥ 3 | Story momentum stagnating |

## 🧪 Testing & Validation

### Run Acceptance Tests
```bash
npm test -- narrative-acceptance.test.ts
```

**Coverage Includes:**
- ✅ Act grammar compliance (blocked/allowed nudges per act)
- ✅ Checkpoint progression (4 advancement triggers)  
- ✅ Cadence control (1 major per 6 exchanges + recovery)
- ✅ Evaluation scoring (Freshness-λ×Coherence with fragility scaling)
- ✅ Callback management (dormant token recall in Act I-II)
- ✅ Transparency (rationales and evaluation snapshots)
- ✅ Safety enforcement (hard limits and PG-13 compliance)
- ✅ Telemetry flow (complete event stream to evaluation)

### Performance Benchmarks
- **Latency Target**: <500ms per exchange including character generation
- **Throughput**: 60+ exchanges per 5-minute demo session
- **Memory**: <100MB for complete episode with telemetry
- **Storage**: ~1KB per turn in compressed JSON

## 🔧 Operational Defaults

| Parameter | Value | Description |
|-----------|-------|-------------|
| **Max Line Length** | 9 seconds | When spoken aloud |
| **Window Size** | 12-16 lines | Recent context maintained |
| **Major Nudge Cooldown** | 6 exchanges | Cadence enforcement |
| **Recovery Period** | 2 exchanges | Post-major comfort bias |
| **Plateau Threshold** | 3 exchanges | Low-delta detection |
| **Fragility Scale** | 0.6 → 1.8 | Lambda multiplier range |

## 🎯 Acceptance Criteria (All Met)

✅ **Act Grammar**: Only allowed nudges per act, no new triangles in IV/V  
✅ **Checkpointing**: 4 advancement triggers, plateau suggests (never forces) wrap  
✅ **Cadence**: ≤1 major per 6 exchanges, 2-exchange recovery bias  
✅ **Fresh-Coherent**: λ scaled by fragility + act, fragile scenes favor coherence  
✅ **Callbacks**: Dormant tokens recall in Act I-II with chemistry tracking  
✅ **Transparency**: Console displays rationales, turn events include deltas  
✅ **Safety**: Hard limits enforced, PG-13 compliance, 18+ characters only  

## 🚀 Production Roadmap

**Phase 1**: PostgreSQL migration with full schema
**Phase 2**: Real-time streaming via WebSockets  
**Phase 3**: Multi-spotlight concurrent scenes
**Phase 4**: Voice integration with prosody analysis
**Phase 5**: Long-term relationship memory system

Built for hackathon platform with production scalability in mind. Event-driven, not timed; checkpoints, not timers; subtext over exposition, consent over chaos. 💫