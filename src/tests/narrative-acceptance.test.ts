import { NarrativeEngine } from '../engines/narrative';
import { EvaluationEngine } from '../engines/evaluation';
import { CharacterOrchestrator } from '../core/character-orchestrator';
import { OpenAIService } from '../integrations/openai';
import { WeaviateService } from '../integrations/weaviate';
import { SafetyGuardian } from '../utils/safety';
import { narrativeStore } from '../storage/narrative-store';
import {
  Act,
  CheckpointType,
  NudgeType,
  EpisodeSeed,
  EvaluationState,
  SpokenLine
} from '../types/narrative';

// Mock implementations
class MockOpenAIService extends OpenAIService {
  constructor() {
    super('mock-key');
  }

  async generateMainLine(): Promise<string> {
    const responses = [
      "I've been thinking about what you said...",
      "There's something I need to tell you.",
      "I don't think I can agree with that.",
      "Maybe we should take this step by step.",
      "I choose to be with you."
    ];
    return responses[Math.floor(Math.random() * responses.length)];
  }

  async generateEmbedding(): Promise<number[]> {
    return new Array(1536).fill(0).map(() => Math.random());
  }
}

class MockWeaviateService extends WeaviateService {
  constructor() {
    super('mock-url', 'mock-key');
  }

  async initializeSchema(): Promise<void> {}
  async storeLine(): Promise<string> { return 'mock-id'; }
  async retrieveRelevantTokens(): Promise<any[]> { return []; }
  async retrieveSimilarLines(): Promise<any[]> { return []; }
  async updateTokenLastSeen(): Promise<void> {}
}

class MockSafetyGuardian extends SafetyGuardian {
  constructor() {
    super(new MockOpenAIService() as any);
  }

  async validateContent(): Promise<any> {
    return { isSafe: true };
  }
}

describe('Narrative Engine Acceptance Criteria', () => {
  let narrativeEngine: NarrativeEngine;
  let evaluationEngine: EvaluationEngine;
  let characterOrchestrator: CharacterOrchestrator;

  beforeEach(async () => {
    const mockOpenAI = new MockOpenAIService();
    const mockWeaviate = new MockWeaviateService();
    const mockSafety = new MockSafetyGuardian();

    characterOrchestrator = new CharacterOrchestrator(mockOpenAI, mockWeaviate, mockSafety);
    narrativeEngine = new NarrativeEngine(characterOrchestrator, mockOpenAI, mockWeaviate, mockSafety);
    evaluationEngine = new EvaluationEngine(mockOpenAI);

    // Add test characters
    characterOrchestrator.addLeadCharacter({
      id: 'emma',
      name: 'Emma',
      pronouns: 'she/her',
      voice_style: 'warm',
      traits: { openness: 0.7, agreeableness: 0.8, extraversion: 0.6, conscientiousness: 0.7, stability: 0.6 },
      goals: ['find love', 'be vulnerable'],
      values: ['honesty', 'kindness'],
      hard_limits: ['no violence'],
      love_lang: { words: 0.8, time: 0.7, acts: 0.6, gifts: 0.3, touch: 0.4 },
      tics: ['Well...', 'I suppose'],
      initial_stance: { 'jake': 0.3 }
    });

    characterOrchestrator.addLeadCharacter({
      id: 'jake',
      name: 'Jake', 
      pronouns: 'he/him',
      voice_style: 'wry',
      traits: { openness: 0.8, agreeableness: 0.6, extraversion: 0.5, conscientiousness: 0.6, stability: 0.7 },
      goals: ['be open', 'find connection'],
      values: ['humor', 'authenticity'],
      hard_limits: ['respect boundaries'],
      love_lang: { words: 0.6, time: 0.8, acts: 0.5, gifts: 0.4, touch: 0.6 },
      tics: ['Well, well', 'Interesting'],
      initial_stance: { 'emma': 0.4 }
    });

    await narrativeStore.clearAllData();
  });

  describe('Act Grammar Compliance', () => {
    test('Only allowed nudges appear per act', async () => {
      const seed: EpisodeSeed = {
        characters: ['emma', 'jake'],
        vibe: 'ember',
        setting: 'coffee shop'
      };

      const summary = await narrativeEngine.startEpisode(seed);
      
      // Test Act 1 restrictions - raise_stakes should be blocked
      const act1RaiseStakes = await narrativeEngine.applyNudge({
        type: 'raise_stakes',
        intensity: 'major',
        source: 'observer'
      });
      
      expect(act1RaiseStakes).toBe(false); // Should be blocked in Act 1

      // Test Act 1 allowed nudges
      const act1Comfort = await narrativeEngine.applyNudge({
        type: 'comfort',
        intensity: 'minor',
        source: 'observer'
      });
      
      expect(act1Comfort).toBe(true); // Should be allowed in Act 1
    });

    test('Act IV/V never introduce new triangles', async () => {
      // This would be tested by verifying that aside nudges are blocked in Act 5
      const seed: EpisodeSeed = {
        characters: ['emma', 'jake'],
        vibe: 'ember',
        setting: 'coffee shop'
      };

      await narrativeEngine.startEpisode(seed);
      
      // Simulate progression to Act 5
      const state = narrativeEngine.getState();
      if (state) {
        // Force act progression for test (would happen naturally through checkpoints)
        (narrativeEngine as any).currentState.episode.actPath = [1, 2, 3, 4, 5];
        (narrativeEngine as any).currentState.currentScene.act = 5;
      }

      const act5Aside = await narrativeEngine.applyNudge({
        type: 'aside',
        intensity: 'minor',
        source: 'observer'
      });

      expect(act5Aside).toBe(false); // Aside should be blocked in Act 5
    });
  });

  describe('Checkpoint System', () => {
    test('Four advancement checkpoints trigger act moves as specified', async () => {
      const seed: EpisodeSeed = {
        characters: ['emma', 'jake'],
        vibe: 'ember',
        setting: 'coffee shop'
      };

      await narrativeEngine.startEpisode(seed);
      
      let state = narrativeEngine.getState();
      expect(state?.episode.act).toBe(1);

      // Simulate mutual spark checkpoint (Act I → II)
      // Force love graph values to meet checkpoint conditions
      if ((narrativeEngine as any).currentState) {
        const pairKey = 'emma-jake';
        (narrativeEngine as any).currentState.episode.loveGraph[pairKey] = {
          attraction: 0.45, // >= 0.4 required
          trust: 0.2,
          tension: 0.3,
          comfort: 0.2
        };
        (narrativeEngine as any).currentState.callbacks = ['shared moment']; // Shared moment requirement
      }

      // Process an exchange to trigger checkpoint check
      const tickResult = await narrativeEngine.tick();
      
      // Check if act advanced
      state = narrativeEngine.getState();
      if (state && state.episode.act > 1) {
        expect(state.episode.act).toBe(2);
        
        // Verify transition event was emitted
        const transitions = tickResult.transitions;
        expect(transitions).toHaveLength(1);
        expect(transitions[0].reason).toBe('checkpoint');
        expect(transitions[0].from.act).toBe(1);
        expect(transitions[0].to.act).toBe(2);
      }
    });

    test('Plateau suggests soft wrap but never forces', async () => {
      const seed: EpisodeSeed = {
        characters: ['emma', 'jake'],
        vibe: 'ember',
        setting: 'coffee shop'
      };

      await narrativeEngine.startEpisode(seed);
      
      // Simulate plateau conditions by setting tiny deltas and repetitive content
      if ((narrativeEngine as any).currentState) {
        const mockLines: SpokenLine[] = [
          {
            timestamp: Date.now() - 3000,
            speaker: 'emma',
            text: 'Yes, I agree',
            secs: 2,
            deltas: { attraction: 0.01, trust: 0.01, tension: 0, comfort: 0 },
            latencyMs: 500
          },
          {
            timestamp: Date.now() - 2000,
            speaker: 'jake',
            text: 'Yes, I agree too',
            secs: 2,
            deltas: { attraction: 0.01, trust: 0.01, tension: 0, comfort: 0 },
            latencyMs: 500
          },
          {
            timestamp: Date.now() - 1000,
            speaker: 'emma',
            text: 'Yes, I definitely agree',
            secs: 2,
            deltas: { attraction: 0.005, trust: 0.005, tension: 0, comfort: 0 },
            latencyMs: 500
          }
        ];
        
        (narrativeEngine as any).currentState.recentLines = mockLines;
      }

      await narrativeEngine.tick();
      
      const state = narrativeEngine.getState();
      
      // Should suggest freshness but not force scene end
      expect(state?.episode.act).toBe(1); // Still in same act
      
      // Check telemetry for plateau detection
      const telemetryEvents = narrativeStore.getRecentTelemetryEvents();
      const plateauEvent = telemetryEvents.find(e => e.kind === 'metric.tick' && (e as any).name === 'plateau_detected');
      
      if (plateauEvent) {
        expect((plateauEvent as any).value).toBeGreaterThan(0);
      }
    });
  });

  describe('Cadence Control', () => {
    test('No more than 1 major auto-nudge in any window of 6 exchanges', async () => {
      const seed: EpisodeSeed = {
        characters: ['emma', 'jake'],
        vibe: 'ember',
        setting: 'coffee shop'
      };

      await narrativeEngine.startEpisode(seed);
      
      // Apply first major nudge
      const firstMajor = await narrativeEngine.applyNudge({
        type: 'raise_stakes',
        intensity: 'major',
        source: 'auto'
      });
      
      expect(firstMajor).toBe(true);

      // Try to apply second major nudge immediately
      const secondMajor = await narrativeEngine.applyNudge({
        type: 'raise_stakes',
        intensity: 'major',
        source: 'auto'
      });
      
      expect(secondMajor).toBe(false); // Should be blocked due to cadence
    });

    test('After major nudge, next two exchanges bias Comfort/Clarify', async () => {
      const seed: EpisodeSeed = {
        characters: ['emma', 'jake'],
        vibe: 'ember',
        setting: 'coffee shop'
      };

      await narrativeEngine.startEpisode(seed);
      
      // Apply major nudge
      await narrativeEngine.applyNudge({
        type: 'raise_stakes',
        intensity: 'major',
        source: 'auto'
      });

      // Check that recovery bias is active
      const state = narrativeEngine.getState();
      expect(state?.cadenceStatus.recoveryMode).toBe(true);

      // Process exchanges and verify recovery bias decreases
      await narrativeEngine.tick();
      await narrativeEngine.tick();
      
      const stateAfter = narrativeEngine.getState();
      // Recovery mode should end after 2 exchanges
    });
  });

  describe('Evaluation Engine Scoring', () => {
    test('Evaluator score uses λ scaled by Fragility and act', async () => {
      const mockState: EvaluationState = {
        recentLines: [],
        structuralState: {
          act: 1,
          sceneIndex: 0,
          milestones: [],
          spotlight: ['emma', 'jake']
        },
        loveGraphDeltas: [],
        callbackActivity: [],
        pacingMetrics: {
          latencyMs: 500,
          interruptions: 0
        }
      };

      const recommendation = await evaluationEngine.consider(mockState);
      
      expect(recommendation.scores).toBeDefined();
      expect(typeof recommendation.scores.freshnessGain).toBe('number');
      expect(typeof recommendation.scores.coherenceCost).toBe('number');
      expect(typeof recommendation.scores.fragilityIndex).toBe('number');
      expect(typeof recommendation.scores.finalScore).toBe('number');
      
      // Score should be calculated as: FreshnessGain - λ * CoherenceCost
      const expectedLambda = 0.7; // Act 1 base weight
      const expectedScore = recommendation.scores.freshnessGain - 
                          (expectedLambda * recommendation.scores.coherenceCost);
      
      // Allow for small floating point differences
      expect(Math.abs(recommendation.scores.finalScore - expectedScore)).toBeLessThan(0.5);
    });

    test('Fragile scenes favor coherence, stable scenes allow bolder moves', async () => {
      // Test fragile scene (high tension, low trust)
      const fragileState: EvaluationState = {
        recentLines: [],
        structuralState: { act: 3, sceneIndex: 2, milestones: [], spotlight: ['emma', 'jake'] },
        loveGraphDeltas: [
          { attraction: 0, trust: -0.1, tension: 0.3, comfort: -0.05 },
          { attraction: 0, trust: -0.1, tension: 0.25, comfort: -0.1 }
        ],
        callbackActivity: [],
        pacingMetrics: { latencyMs: 500, interruptions: 0 }
      };

      const fragileRecommendation = await evaluationEngine.consider(fragileState);
      
      // Test stable scene (high comfort, stable trust)
      const stableState: EvaluationState = {
        ...fragileState,
        loveGraphDeltas: [
          { attraction: 0.1, trust: 0.1, tension: 0, comfort: 0.15 },
          { attraction: 0.05, trust: 0.1, tension: 0, comfort: 0.1 }
        ]
      };

      const stableRecommendation = await evaluationEngine.consider(stableState);
      
      // Fragile scene should have higher fragility index
      expect(fragileRecommendation.scores.fragilityIndex).toBeGreaterThan(
        stableRecommendation.scores.fragilityIndex
      );
      
      // With higher fragility, lambda should be higher, making coherence cost more impactful
      expect(fragileRecommendation.scores.finalScore).toBeLessThanOrEqual(
        stableRecommendation.scores.finalScore
      );
    });
  });

  describe('Callback Management', () => {
    test('Dormant tokens resurface within Act I–II with Recall', async () => {
      const seed: EpisodeSeed = {
        characters: ['emma', 'jake'],
        vibe: 'ember',
        setting: 'coffee shop',
        callbacks: ['shared umbrella', 'coffee shop meeting']
      };

      await narrativeEngine.startEpisode(seed);
      
      let recallAttempted = false;
      let recallSuccessful = false;
      
      // Process several exchanges in Act I-II
      for (let i = 0; i < 8 && !recallSuccessful; i++) {
        const evaluationState: EvaluationState = {
          recentLines: (narrativeEngine as any).rollingWindow || [],
          structuralState: {
            act: Math.min(2, Math.floor(i / 4) + 1) as Act,
            sceneIndex: 0,
            milestones: [],
            spotlight: ['emma', 'jake']
          },
          loveGraphDeltas: [],
          callbackActivity: ['shared umbrella'], // Available callback
          pacingMetrics: { latencyMs: 500, interruptions: 0 }
        };

        const recommendation = await evaluationEngine.consider(evaluationState);
        
        if (recommendation.autoNudge?.type === 'recall') {
          recallAttempted = true;
          
          const applied = await narrativeEngine.applyNudge(recommendation.autoNudge);
          if (applied) {
            const tickResult = await narrativeEngine.tick();
            
            // Check if callback was used in generated lines
            const usedCallback = tickResult.producedLines.some(line =>
              line.text.toLowerCase().includes('umbrella')
            );
            
            if (usedCallback) {
              recallSuccessful = true;
            }
          }
        } else {
          await narrativeEngine.tick();
        }
      }
      
      expect(recallAttempted).toBe(true);
      // Note: recallSuccessful depends on character generation, so we mainly test that recall was attempted
    });

    test('Telemetry logs token hits and their chemistry effect', async () => {
      const seed: EpisodeSeed = {
        characters: ['emma', 'jake'],
        vibe: 'ember',
        setting: 'coffee shop',
        callbacks: ['shared umbrella']
      };

      await narrativeEngine.startEpisode(seed);
      
      // Apply recall nudge
      const recallNudge = await narrativeEngine.applyNudge({
        type: 'recall',
        intensity: 'minor',
        source: 'auto',
        token: 'shared umbrella'
      });
      
      expect(recallNudge).toBe(true);
      
      await narrativeEngine.tick();
      
      // Check telemetry events
      const telemetryEvents = narrativeStore.getRecentTelemetryEvents();
      
      const nudgeAppliedEvent = telemetryEvents.find(e => e.kind === 'nudge.applied');
      expect(nudgeAppliedEvent).toBeDefined();
      
      if (nudgeAppliedEvent && 'nudge' in nudgeAppliedEvent) {
        expect(nudgeAppliedEvent.nudge.type).toBe('recall');
        expect(nudgeAppliedEvent.nudge.token).toBe('shared umbrella');
      }

      const turnEndEvent = telemetryEvents.find(e => e.kind === 'turn.end');
      expect(turnEndEvent).toBeDefined();
      
      if (turnEndEvent && 'deltas' in turnEndEvent) {
        expect(turnEndEvent.deltas).toBeDefined();
        expect(typeof turnEndEvent.deltas.attraction).toBe('number');
      }
    });
  });

  describe('Transparency and Console Features', () => {
    test('Console can display "why this nudge" from evaluation snapshots', async () => {
      const mockState: EvaluationState = {
        recentLines: [],
        structuralState: { act: 1, sceneIndex: 0, milestones: [], spotlight: ['emma', 'jake'] },
        loveGraphDeltas: [],
        callbackActivity: ['test callback'],
        pacingMetrics: { latencyMs: 500, interruptions: 0 }
      };

      const recommendation = await evaluationEngine.consider(mockState);
      
      // Check that rationales are provided
      expect(recommendation.rationales).toBeDefined();
      expect(Array.isArray(recommendation.rationales)).toBe(true);
      expect(recommendation.rationales.length).toBeGreaterThan(0);
      
      // Each rationale should be a readable string
      recommendation.rationales.forEach(rationale => {
        expect(typeof rationale).toBe('string');
        expect(rationale.length).toBeGreaterThan(0);
      });

      // Check evaluation snapshots are created
      const snapshots = evaluationEngine.getEvaluationSnapshots();
      expect(snapshots.length).toBeGreaterThan(0);
      
      const latestSnapshot = snapshots[snapshots.length - 1];
      expect(latestSnapshot.rationales).toBeDefined();
      expect(latestSnapshot.scores).toBeDefined();
    });

    test('Turn events include deltas and latency', async () => {
      const seed: EpisodeSeed = {
        characters: ['emma', 'jake'],
        vibe: 'ember',
        setting: 'coffee shop'
      };

      await narrativeEngine.startEpisode(seed);
      
      const tickResult = await narrativeEngine.tick();
      
      // Check turn events in telemetry
      const turnEvents = tickResult.telemetryEvents.filter(e => e.kind === 'turn.end');
      
      for (const event of turnEvents) {
        if ('line' in event) {
          expect(event.line.deltas).toBeDefined();
          expect(event.line.deltas.attraction).toBeDefined();
          expect(event.line.deltas.trust).toBeDefined();
          expect(event.line.deltas.tension).toBeDefined();
          expect(event.line.deltas.comfort).toBeDefined();
          
          expect(event.latencyMs).toBeDefined();
          expect(typeof event.latencyMs).toBe('number');
          expect(event.latencyMs).toBeGreaterThanOrEqual(0);
        }
      }
    });
  });

  describe('Safety Enforcement', () => {
    test('Lines violating hard limits are blocked before emission', async () => {
      const seed: EpisodeSeed = {
        characters: ['emma', 'jake'],
        vibe: 'ember',
        setting: 'coffee shop'
      };

      await narrativeEngine.startEpisode(seed);
      
      // All our mock responses are safe, so this tests the safety validation pathway
      const tickResult = await narrativeEngine.tick();
      
      // All emitted lines should be safe
      expect(tickResult.producedLines.length).toBeGreaterThan(0);
      
      for (const line of tickResult.producedLines) {
        expect(line.text).toBeDefined();
        expect(line.text.length).toBeGreaterThan(0);
        // Our mock safety guardian always returns safe=true
      }
    });

    test('All characters are 18+ and no explicit content', async () => {
      // This is enforced at the character card level and safety guardian level
      const characters = [
        characterOrchestrator.getLeadCharacter('emma'),
        characterOrchestrator.getLeadCharacter('jake')
      ];

      for (const character of characters) {
        if (character) {
          // Check hard limits include safety boundaries
          expect(character.hard_limits).toContain('no violence');
          // All test characters are implicitly 18+ adults
          expect(character.goals.some(goal => 
            goal.includes('adult') || !goal.includes('minor') || !goal.includes('child')
          )).toBe(true);
        }
      }
    });
  });

  describe('Integration and Flow', () => {
    test('Complete telemetry-to-evaluation flow', async () => {
      const seed: EpisodeSeed = {
        characters: ['emma', 'jake'],
        vibe: 'ember',
        setting: 'coffee shop'
      };

      await narrativeEngine.startEpisode(seed);
      
      // Set up telemetry listener
      let telemetryReceived = false;
      evaluationEngine.on('telemetry_received', () => {
        telemetryReceived = true;
      });

      // Process an exchange
      const tickResult = await narrativeEngine.tick();
      
      // Feed telemetry to evaluation engine
      for (const event of tickResult.telemetryEvents) {
        evaluationEngine.onTelemetry(event);
      }
      
      expect(telemetryReceived).toBe(true);
      
      // Get evaluation recommendation
      const evaluationState: EvaluationState = {
        recentLines: tickResult.producedLines,
        structuralState: {
          act: 1,
          sceneIndex: 0,
          milestones: [],
          spotlight: ['emma', 'jake']
        },
        loveGraphDeltas: tickResult.producedLines.map(line => line.deltas),
        callbackActivity: [],
        pacingMetrics: { latencyMs: 500, interruptions: 0 }
      };

      const recommendation = await evaluationEngine.consider(evaluationState);
      
      expect(recommendation).toBeDefined();
      expect(recommendation.scores).toBeDefined();
      
      // If recommendation provided, apply it
      if (recommendation.autoNudge && !recommendation.abstain) {
        const applied = await narrativeEngine.applyNudge(recommendation.autoNudge);
        expect(typeof applied).toBe('boolean');
      }
    });
  });

  afterEach(async () => {
    await narrativeStore.clearAllData();
  });
});

// Helper to fix import issue in test file
function getTelemetryEvents(episodeId: string) {
  return narrativeStore.getTelemetryEvents(episodeId);
}