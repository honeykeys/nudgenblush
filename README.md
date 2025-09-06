# Nudge & Blush - OpenAI-First Romance Engine

An event-driven romance engine with smart nudge system, five-act structure, and comprehensive safety guardrails. Built specifically for OpenAI integration with Weaviate Cloud vector storage.

## 🎯 Mission

Build an event-driven romance engine with:
- **Core Gameplay**: Five-act, checkpoint-driven structure
- **Smart Nudge Engine**: Affordances → one-step rollout → Freshness–λ·Coherence scoring
- **Story Creation Engine**: Vibes, Settings, Characters, Tone management
- **OpenAI Integration**: GPT-4.1 for generation, text-embedding-3-large for vectors

## 🚀 Quick Start

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment:**
   ```bash
   cp .env.example .env
   # Edit .env with your OpenAI and Weaviate credentials
   ```

3. **Run demo mode:**
   ```bash
   npm run dev
   ```

4. **Run tests:**
   ```bash
   npm run dev test
   ```

## 🏗️ Architecture

### Core Components

- **GameplayEngine** (`src/core/gameplay.ts`): Five-act structure, Love Graph, checkpoints
- **NudgeEngine** (`src/engines/nudge.ts`): Candidate generation, Freshness-λ·Coherence scoring
- **StoryCreationEngine** (`src/engines/story.ts`): Vibe system, token extraction
- **DemoMode** (`src/core/demo.ts`): 5-minute demo with constraints
- **SafetyGuardian** (`src/utils/safety.ts`): PG-13, consent-aware filtering

### Integrations

- **OpenAIService** (`src/integrations/openai.ts`): GPT-4.1 + embeddings
- **WeaviateService** (`src/integrations/weaviate.ts`): Vector storage and retrieval

## 🎭 Vibes System

Six default romance vibes included:

| Vibe | Tone | Coherence λ | Priority Nudges |
|------|------|-------------|-----------------|
| **Ember** | Slow-burn, smoldering tension | 0.7 | vulnerability, comfort, recall |
| **Banter** | Witty intellectual sparring | 0.5 | clarify, raise_stakes_light, tempo_up |
| **Spark** | Electric, immediate attraction | 0.4 | raise_stakes_light, tempo_up, aside_pair |
| **Rivals** | Enemies-to-lovers dynamic | 0.6 | raise_stakes_light, clarify, vulnerability |
| **Crush** | Sweet, nervous developing feelings | 0.8 | comfort, clarify, recall |
| **Thaw** | Cold character slowly warming | 0.9 | comfort, vulnerability, tempo_down |

## 🧠 Nudge Engine

### Nudge Types
- `recall`: Surface dormant callback tokens
- `vulnerability`: Character reveals something personal
- `comfort`: Supportive, safe interactions
- `raise_stakes_light`: Mild tension without breaking mood
- `clarify`: Clear confusion, provide context
- `aside_pair`: Private moment between spotlight pair
- `tempo_up/down`: Control story pacing

### Scoring System
**Freshness Score** (0-1):
- Surprise: Semantic distance from recent lines
- Diversity: Avoid repetitive moves
- Beat Balance: Serve underused emotional beats
- Callback Revival: Bonus for surfacing tokens
- Stagnation Buster: Bonus if plateauing

**Coherence Cost** (0-1):
- Persona Drift: Character inconsistency risk
- Act Grammar: Violates current act expectations
- Contradiction Risk: Conflicts with established facts
- Safety Risk: PG-13 or consent violations

**Net Score**: `Freshness - (λ × Coherence)`

## 🛡️ Safety & Consent

- All characters 18+ adults
- PG-13 content only
- Consent-aware interactions
- No explicit sexual content
- No slurs or offensive language
- OpenAI moderation + custom pattern filtering

## 📊 Demo Mode Constraints

5-minute demo with:
- Max 3 suggestions per exchange
- Max 3 preview calls per exchange
- Max 1 vector write per exchange
- Early recall within ≤3 exchanges
- Mutual Spark checkpoint within ≤10 exchanges

## 🎯 Acceptance Criteria

✅ **Ember Vibe Test**: Two characters, "Previously..." line → Recall within ≤3 exchanges

✅ **Mutual Spark**: Non-slow-burn vibes reach checkpoint within ≤10 exchanges

✅ **Nudge Quality**: Freshness, coherence cost, 1-3 rationales per suggestion

✅ **Post-Major Recovery**: Comfort/Clarify bias for 2 exchanges after major nudges

✅ **Vector Integration**: Weaviate stores lines/tokens, influences continuity

✅ **Contradiction Rate**: <2% across sample scenes via safety guardian

## 🔧 Development

### Build & Run
```bash
npm run build     # Compile TypeScript
npm run dev       # Development mode
npm run start     # Production mode
npm run test      # Run tests
npm run lint      # Code linting
npm run typecheck # Type checking
```

### Model Configuration

```typescript
const config: OpenAIConfig = {
  writerModel: 'gpt-4.1',           // Main story generation
  previewModel: 'gpt-4.1-mini',     // Nudge previews (cost optimization)
  embeddingModel: 'text-embedding-3-large' // Vector generation
};
```

## 📝 Usage Example

```typescript
import { OpenAIService, WeaviateService, DemoMode } from './src';

// Initialize services
const openai = new OpenAIService(process.env.OPENAI_API_KEY);
const weaviate = new WeaviateService(process.env.WEAVIATE_URL, process.env.WEAVIATE_API_KEY);

// Create demo
const demo = new DemoMode(openai, weaviate, ['Emma', 'Jake']);

// Initialize with context
const context = await demo.initializeDemo(
  "Emma and Jake met during a thunderstorm, sharing meaningful glances."
);

// Process exchanges
const result = await demo.processExchange("Emma nervously adjusts her coffee cup");
console.log(result.suggestions); // Get nudge candidates with rationales
```

## 🌟 Key Features

- **Event-driven**: Checkpoint-based progression, no timers
- **Smart Memory**: Vector-based continuity and callback system
- **Adaptive Scoring**: Freshness vs. coherence balance by vibe
- **Safety-First**: Comprehensive content filtering
- **Demo-Ready**: 5-minute constrained demo mode
- **Extensible**: Easy to add custom vibes and nudge types

Built with TypeScript, OpenAI GPT-4.1, and Weaviate Cloud for production-ready romance storytelling.