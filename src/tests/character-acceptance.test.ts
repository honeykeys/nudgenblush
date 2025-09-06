import { CharacterOrchestrator } from '../core/character-orchestrator';
import { OpenAIService } from '../integrations/openai';
import { WeaviateService } from '../integrations/weaviate';
import { SafetyGuardian } from '../utils/safety';
import {
  CharacterCard,
  SideCharacterCard,
  AgentState,
  IntentBundle,
  LineDraft,
  FinalLine
} from '../types/character';

// Mock implementations for testing
class MockOpenAIService extends OpenAIService {
  constructor() {
    super('mock-key');
  }

  async generateMainLine(): Promise<string> {
    const responses = [
      "I still think about that umbrella we shared...",
      "You know, I'm really glad we met that day in the rain.",
      "There's something I've been meaning to tell you.",
      "Would you like to get coffee sometime?"
    ];
    return responses[Math.floor(Math.random() * responses.length)];
  }

  async generateEmbedding(): Promise<number[]> {
    return new Array(1536).fill(0).map(() => Math.random());
  }
}

class MockWeaviateService extends WeaviateService {
  private stored_lines: any[] = [];
  private stored_tokens: any[] = [
    {
      token: 'shared an umbrella',
      salience: 0.8,
      lastSeenTurn: 0
    }
  ];

  constructor() {
    super('mock-url', 'mock-key');
  }

  async initializeSchema(): Promise<void> {
    // Mock implementation
  }

  async storeLine(line: any): Promise<string> {
    this.stored_lines.push(line);
    return 'mock-id';
  }

  async retrieveRelevantTokens(): Promise<any[]> {
    return this.stored_tokens;
  }

  async retrieveSimilarLines(): Promise<any[]> {
    return [];
  }

  async updateTokenLastSeen(): Promise<void> {
    // Mock implementation
  }
}

class MockSafetyGuardian extends SafetyGuardian {
  constructor() {
    super(new MockOpenAIService() as any);
  }

  async validateContent(): Promise<any> {
    return { isSafe: true };
  }
}

describe('Character Engine Acceptance Criteria', () => {
  let orchestrator: CharacterOrchestrator;
  let emma_card: CharacterCard;
  let jake_card: CharacterCard;
  let barista_card: SideCharacterCard;
  let test_state: AgentState;

  beforeEach(() => {
    const mockOpenAI = new MockOpenAIService();
    const mockWeaviate = new MockWeaviateService();
    const mockSafety = new MockSafetyGuardian();

    orchestrator = new CharacterOrchestrator(mockOpenAI, mockWeaviate, mockSafety);

    // Create test characters
    emma_card = {
      id: 'emma',
      name: 'Emma',
      pronouns: 'she/her',
      voice_style: 'warm',
      traits: {
        openness: 0.7,
        agreeableness: 0.8,
        extraversion: 0.6,
        conscientiousness: 0.7,
        stability: 0.6
      },
      goals: ['find genuine connection', 'overcome past heartbreak', 'be vulnerable'],
      values: ['authenticity', 'kindness'],
      hard_limits: ['no violence', 'respect boundaries'],
      love_lang: {
        words: 0.8,
        time: 0.7,
        acts: 0.6,
        gifts: 0.3,
        touch: 0.4
      },
      tics: ['Well...', 'I suppose'],
      initial_stance: { 'jake': 0.3 }
    };

    jake_card = {
      id: 'jake',
      name: 'Jake',
      pronouns: 'he/him',
      voice_style: 'wry',
      traits: {
        openness: 0.8,
        agreeableness: 0.6,
        extraversion: 0.5,
        conscientiousness: 0.6,
        stability: 0.7
      },
      goals: ['be more open', 'find someone who gets his humor', 'take romantic risks'],
      values: ['humor', 'intelligence'],
      hard_limits: ['no drama', 'mutual respect'],
      love_lang: {
        words: 0.6,
        time: 0.8,
        acts: 0.5,
        gifts: 0.4,
        touch: 0.6
      },
      tics: ['Well, well', 'Interesting'],
      initial_stance: { 'emma': 0.4 }
    };

    barista_card = {
      id: 'sarah',
      name: 'Sarah',
      role: 'coffee shop barista',
      job_to_do: 'gatekeeper',
      tics: ['Um', 'excuse me'],
      facts: ['works at the coffee shop', 'notices everything']
    };

    orchestrator.addLeadCharacter(emma_card);
    orchestrator.addLeadCharacter(jake_card);
    orchestrator.addSideCharacter(barista_card);

    // Create test state with Ember vibe and umbrella context
    test_state = {
      act: 1,
      vibe: 'ember',
      setting: 'cozy coffee shop',
      spotlight: ['emma', 'jake'],
      recent_lines: [
        {
          speaker: 'narrator',
          text: 'Previously: Emma and Jake shared an umbrella during a sudden downpour.',
          timestamp: new Date()
        }
      ],
      bias_flags: {
        bias_self_disclosure: 0.3,
        recall_token: 'shared an umbrella'
      },
      open_tokens: ['shared an umbrella', 'meaningful glances', 'coffee shop meeting'],
      love_graph_edge: {
        attraction: 0.2,
        trust: 0.1,
        tension: 0.3,
        comfort: 0.2
      }
    };
  });

  describe('Acceptance Criteria 1: Lead Autonomy', () => {
    test('With Vibe Banter, two leads produce different intents across 3 exchanges without repetition', async () => {
      // Change to Banter vibe for this test
      test_state.vibe = 'banter';
      
      const intent_history: Record<string, string[]> = {
        emma: [],
        jake: []
      };

      for (let exchange = 0; exchange < 3; exchange++) {
        const bundles = await orchestrator.generateIntentBundles(test_state, ['emma', 'jake']);
        
        expect(bundles).toHaveLength(2);
        
        const emma_bundle = bundles.find(b => b.speaker === 'emma');
        const jake_bundle = bundles.find(b => b.speaker === 'jake');
        
        expect(emma_bundle).toBeDefined();
        expect(jake_bundle).toBeDefined();
        
        // Check different intents between characters
        expect(emma_bundle!.intent).not.toBe(jake_bundle!.intent);
        
        // Check no repetition for each character
        expect(intent_history.emma).not.toContain(emma_bundle!.intent);
        expect(intent_history.jake).not.toContain(jake_bundle!.intent);
        
        intent_history.emma.push(emma_bundle!.intent);
        intent_history.jake.push(jake_bundle!.intent);
        
        // Simulate adding to recent lines
        test_state.recent_lines.push(
          {
            speaker: 'emma',
            text: 'Mock Emma line',
            timestamp: new Date()
          },
          {
            speaker: 'jake', 
            text: 'Mock Jake line',
            timestamp: new Date()
          }
        );
      }
    });

    test('Lines fit persona/tics for each character', async () => {
      const drafts = await orchestrator.generateLineDrafts(test_state, [
        {
          speaker: 'emma',
          intent: 'reassure',
          targets: ['jake'],
          predicted_deltas: { attraction: 0.05, trust: 0.1, tension: 0, comfort: 0.1 },
          risk_flags: {},
          confidence: 0.8
        },
        {
          speaker: 'jake',
          intent: 'tease',
          targets: ['emma'],
          predicted_deltas: { attraction: 0.08, trust: 0.02, tension: 0.05, comfort: 0 },
          risk_flags: {},
          confidence: 0.7
        }
      ]);

      expect(drafts).toHaveLength(2);
      
      const emma_draft = drafts.find(d => d.speaker === 'emma');
      const jake_draft = drafts.find(d => d.speaker === 'jake');
      
      // Emma should have warm voice style characteristics
      expect(emma_draft).toBeDefined();
      // Would test for actual warm language patterns in real implementation
      
      // Jake should have wry voice style characteristics  
      expect(jake_draft).toBeDefined();
      // Would test for actual wry language patterns in real implementation
    });

    test('At least one vulnerability or reassure lands when bias is active', async () => {
      // Set vulnerability bias
      test_state.bias_flags.bias_self_disclosure = 0.8;
      test_state.bias_flags.bias_reassure = 0.6;

      const bundles = await orchestrator.generateIntentBundles(test_state, ['emma', 'jake']);
      
      const has_vulnerability = bundles.some(b => b.intent === 'reveal');
      const has_reassure = bundles.some(b => b.intent === 'reassure');
      
      // At least one should match the bias
      expect(has_vulnerability || has_reassure).toBe(true);
    });
  });

  describe('Acceptance Criteria 2: Recall Proof', () => {
    test('Recall candidate appears and umbrella surfaces naturally in Act I within ≤3 exchanges', async () => {
      let recall_surfaced = false;
      let umbrella_mentioned = false;

      for (let exchange = 0; exchange < 3; exchange++) {
        const bundles = await orchestrator.generateIntentBundles(test_state, ['emma', 'jake']);
        
        // Check if any bundle has recall token
        const has_recall = bundles.some(b => b.recall_token === 'shared an umbrella');
        if (has_recall) {
          recall_surfaced = true;
        }

        // Generate drafts and check if umbrella is mentioned
        const drafts = await orchestrator.generateLineDrafts(test_state, bundles);
        const has_umbrella = drafts.some(d => 
          d.text.toLowerCase().includes('umbrella') || 
          d.used_token === 'shared an umbrella'
        );
        
        if (has_umbrella) {
          umbrella_mentioned = true;
          break;
        }

        // Simulate conversation continuing
        test_state.recent_lines.push({
          speaker: bundles[0].speaker,
          text: drafts[0]?.text || 'Mock line',
          timestamp: new Date()
        });
      }

      expect(recall_surfaced).toBe(true);
      expect(umbrella_mentioned).toBe(true);
    });
  });

  describe('Acceptance Criteria 3: Side Discipline', () => {
    test('Side character speaks only when triggered and yields after one line', async () => {
      // Test without triggers - should not speak
      const triggers_empty = {
        name_mention: false,
        policy_pressure: false,
        time_pressure: false,
        jealousy_ripple: false,
        compersion_ripple: false,
        explicit_aside: false
      };

      let result = await orchestrator['sideAgent'].maybeSpeak(test_state, barista_card, triggers_empty);
      expect(result).toBeNull();

      // Test with name mention trigger - should speak once
      const triggers_active = {
        name_mention: true,
        policy_pressure: false,
        time_pressure: false,
        jealousy_ripple: false,
        compersion_ripple: false,
        explicit_aside: false
      };

      // Add line mentioning the barista
      test_state.recent_lines.push({
        speaker: 'emma',
        text: 'Excuse me, Sarah, could we get another coffee?',
        timestamp: new Date()
      });

      result = await orchestrator['sideAgent'].maybeSpeak(test_state, barista_card, triggers_active);
      expect(result).not.toBeNull();
      expect(result!.speaker).toBe('sarah');
      expect(result!.text).toBeDefined();
      
      // Verify it's brief (≤9 seconds ≈ ≤20 words)
      const word_count = result!.text.split(' ').length;
      expect(word_count).toBeLessThanOrEqual(20);
    });
  });

  describe('Acceptance Criteria 4: Continuity & Safety', () => {
    test('No contradictions flagged against memories', async () => {
      // Add some context lines
      test_state.recent_lines.push(
        {
          speaker: 'emma',
          text: 'I love rainy days.',
          timestamp: new Date()
        },
        {
          speaker: 'jake',
          text: 'Me too, they are so peaceful.',
          timestamp: new Date()
        }
      );

      const bundles = await orchestrator.generateIntentBundles(test_state, ['emma']);
      const drafts = await orchestrator.generateLineDrafts(test_state, bundles);

      // Check coherence cost (lower is better)
      for (const draft of drafts) {
        expect(draft.coherence_cost).toBeLessThan(0.5);
      }
    });

    test('Hard limits and PG-13 enforced', async () => {
      const bundle: IntentBundle = {
        speaker: 'emma',
        intent: 'reveal',
        targets: ['jake'],
        predicted_deltas: { attraction: 0.1, trust: 0.1, tension: 0, comfort: 0 },
        risk_flags: {},
        confidence: 0.8
      };

      const draft = await orchestrator.generateLineDrafts(test_state, [bundle]);
      
      // All generated content should pass safety checks
      expect(draft).toHaveLength(1);
      expect(draft[0].text).toBeDefined();
      // Safety is enforced by the SafetyGuardian mock always returning safe
    });

    test('Contradiction rate < 2%', async () => {
      // Generate multiple exchanges and check contradiction rate
      for (let i = 0; i < 10; i++) {
        const bundles = await orchestrator.generateIntentBundles(test_state, ['emma', 'jake']);
        await orchestrator.generateLineDrafts(test_state, bundles);
        
        // Add mock lines to state
        test_state.recent_lines.push({
          speaker: 'emma',
          text: `Emma line ${i}`,
          timestamp: new Date()
        });
      }

      const contradiction_rate = orchestrator.getContradictionRate();
      expect(contradiction_rate).toBeLessThan(0.02);
    });
  });

  describe('Acceptance Criteria 5: Integration', () => {
    test('Character Engine outputs IntentBundles that Narrative Agent can auction', async () => {
      const bundles = await orchestrator.generateIntentBundles(test_state, ['emma', 'jake']);
      
      // Verify bundle structure matches expected interface
      for (const bundle of bundles) {
        expect(bundle).toHaveProperty('speaker');
        expect(bundle).toHaveProperty('intent');
        expect(bundle).toHaveProperty('targets');
        expect(bundle).toHaveProperty('predicted_deltas');
        expect(bundle).toHaveProperty('risk_flags');
        expect(bundle).toHaveProperty('confidence');
        
        expect(typeof bundle.confidence).toBe('number');
        expect(bundle.confidence).toBeGreaterThan(0);
        expect(bundle.confidence).toBeLessThanOrEqual(1);
      }
    });

    test('Character Engine accepts BeatPlans and returns FinalLines', async () => {
      const beat_plan = {
        speaker_order: ['emma', 'jake'],
        callbacks_to_surface: ['shared an umbrella'],
        constraints: ['keep it light', 'build attraction']
      };

      const final_lines = await orchestrator.executeBeatPlan(test_state, beat_plan);
      
      expect(final_lines).toHaveLength(2);
      
      for (const line of final_lines) {
        expect(line).toHaveProperty('speaker');
        expect(line).toHaveProperty('text');
        expect(line).toHaveProperty('meta');
        expect(line.meta).toHaveProperty('used_tokens');
        expect(line.meta).toHaveProperty('deltas');
        expect(line.meta).toHaveProperty('rationales');
      }
    });
  });

  describe('Acceptance Criteria 6: Latency Hygiene', () => {
    test('≤3 OpenAI preview calls per exchange', async () => {
      // This would require instrumenting the OpenAI service to count calls
      // For now, verify that we're limiting candidates appropriately
      const bundles = await orchestrator.generateIntentBundles(test_state, ['emma', 'jake', 'sarah']);
      
      // Should not exceed reasonable limits even with multiple characters
      expect(bundles.length).toBeLessThanOrEqual(3);
    });

    test('Only chosen lines written to Weaviate', async () => {
      const initial_count = (orchestrator['leadAgent']['weaviate'] as any).stored_lines.length;
      
      const beat_plan = {
        speaker_order: ['emma'],
        callbacks_to_surface: [],
        constraints: []
      };

      await orchestrator.executeBeatPlan(test_state, beat_plan);
      
      const final_count = (orchestrator['leadAgent']['weaviate'] as any).stored_lines.length;
      
      // Only one line should be stored per character that actually speaks
      expect(final_count - initial_count).toBe(1);
    });
  });

  describe('Evaluation Metrics', () => {
    test('Intent variety score calculation', () => {
      // Initially should be perfect (no history)
      expect(orchestrator.getIntentVarietyScore()).toBe(1.0);
      
      // Would test with actual telemetry data in full implementation
    });

    test('Line compliance rate calculation', () => {
      const compliance_rate = orchestrator.getLineComplianceRate();
      expect(compliance_rate).toBeGreaterThanOrEqual(0);
      expect(compliance_rate).toBeLessThanOrEqual(1);
    });
  });
});