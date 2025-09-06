import { v4 as uuidv4 } from 'uuid';
import { StoryContext, Vibe, CallbackToken } from '../types';
import { OpenAIService } from '../integrations/openai';

export class StoryCreationEngine {
  private openai: OpenAIService;
  private vibes: Map<string, Vibe> = new Map();

  constructor(openai: OpenAIService) {
    this.openai = openai;
    this.initializeDefaultVibes();
  }

  private initializeDefaultVibes(): void {
    const defaultVibes: Vibe[] = [
      {
        id: 'ember',
        name: 'Ember',
        tone: 'Smoldering tension with slow-burn romance. Characters drawn together by inexplicable chemistry, building heat through stolen glances and charged moments.',
        archetypes: ['mysterious stranger', 'guarded romantic', 'patient pursuer'],
        conflicts: ['past heartbreak', 'fear of vulnerability', 'timing challenges'],
        settingSeeds: ['dimly lit cafe', 'rain-soaked street', 'intimate concert venue'],
        callbackTokens: ['first meeting', 'meaningful look', 'almost kiss', 'shared secret'],
        nudgePriorities: ['vulnerability', 'comfort', 'recall', 'tempo_down'],
        coherenceWeight: 0.7,
        actGates: {
          1: 'Initial attraction established through subtle chemistry',
          2: 'Emotional barriers begin to surface and slowly crack',
          3: 'Moment of truth where vulnerability must be embraced',
          4: 'Past wounds acknowledged and healing begins',
          5: 'Deep connection solidified through patient understanding'
        }
      },
      {
        id: 'banter',
        name: 'Banter',
        tone: 'Witty, playful romance built on clever wordplay and intellectual sparring. Characters connect through humor and verbal jousting.',
        archetypes: ['witty intellectual', 'sharp-tongued charmer', 'competitive academic'],
        conflicts: ['pride vs. affection', 'intellectual rivalry', 'fear of sincerity'],
        settingSeeds: ['university library', 'bookstore cafe', 'debate club', 'literary salon'],
        callbackTokens: ['clever comeback', 'verbal defeat', 'unexpected compliment', 'moment of sincerity'],
        nudgePriorities: ['clarify', 'raise_stakes_light', 'tempo_up', 'vulnerability'],
        coherenceWeight: 0.5,
        actGates: {
          1: 'Establish competitive dynamic and mutual respect',
          2: 'Banter reveals deeper compatibility and attraction',
          3: 'Verbal sparring becomes emotionally charged',
          4: 'Walls come down, sincerity emerges',
          5: 'Love declared with characteristic wit and warmth'
        }
      },
      {
        id: 'spark',
        name: 'Spark',
        tone: 'Electric, immediate attraction with high energy and passionate connection. Fast-moving romance with intense chemistry.',
        archetypes: ['passionate artist', 'spontaneous adventurer', 'magnetic performer'],
        conflicts: ['intensity vs. sustainability', 'other commitments', 'fear of burning out'],
        settingSeeds: ['art gallery opening', 'music festival', 'dance floor', 'rooftop party'],
        callbackTokens: ['electric touch', 'breathless moment', 'passionate kiss', 'wild adventure'],
        nudgePriorities: ['raise_stakes_light', 'tempo_up', 'aside_pair', 'vulnerability'],
        coherenceWeight: 0.4,
        actGates: {
          1: 'Instant, undeniable chemistry and attraction',
          2: 'Passionate exploration of connection',
          3: 'Reality challenges the fantasy',
          4: 'Choose commitment over easy passion',
          5: 'Transform spark into lasting flame'
        }
      },
      {
        id: 'rivals',
        name: 'Rivals',
        tone: 'Enemies-to-lovers dynamic with competitive tension that transforms into romantic attraction.',
        archetypes: ['professional rival', 'former enemy', 'competitive equal'],
        conflicts: ['professional competition', 'past betrayal', 'conflicting loyalties'],
        settingSeeds: ['corporate boardroom', 'sports field', 'courtroom', 'competition venue'],
        callbackTokens: ['heated argument', 'grudging respect', 'protective instinct', 'moment of understanding'],
        nudgePriorities: ['raise_stakes_light', 'clarify', 'vulnerability', 'comfort'],
        coherenceWeight: 0.6,
        actGates: {
          1: 'Establish rivalry and mutual competence',
          2: 'Respect grows despite opposition',
          3: 'Competition becomes personal and intense',
          4: 'Understanding replaces animosity',
          5: 'Partnership and love emerge from rivalry'
        }
      },
      {
        id: 'crush',
        name: 'Crush',
        tone: 'Sweet, nervous energy of developing feelings. Innocent romance with butterflies and heartfelt moments.',
        archetypes: ['shy admirer', 'oblivious crush', 'supportive friend'],
        conflicts: ['fear of rejection', 'friendship boundaries', 'self-doubt'],
        settingSeeds: ['school hallway', 'coffee shop', 'park bench', 'study group'],
        callbackTokens: ['nervous laughter', 'kind gesture', 'shared interest', 'encouraging word'],
        nudgePriorities: ['comfort', 'clarify', 'recall', 'tempo_down'],
        coherenceWeight: 0.8,
        actGates: {
          1: 'Innocent attraction and nervous energy',
          2: 'Friendship deepens with romantic undertones',
          3: 'Feelings become too strong to ignore',
          4: 'Risk friendship for something more',
          5: 'Sweet confession and mutual feelings revealed'
        }
      },
      {
        id: 'thaw',
        name: 'Thaw',
        tone: 'Cold character slowly warming to love. Healing romance that melts emotional barriers through patience and care.',
        archetypes: ['emotionally guarded', 'wounded healer', 'patient caregiver'],
        conflicts: ['emotional walls', 'past trauma', 'fear of intimacy'],
        settingSeeds: ['quiet cabin', 'hospital room', 'empty restaurant', 'snow-covered garden'],
        callbackTokens: ['small kindness', 'moment of trust', 'crack in armor', 'gentle touch'],
        nudgePriorities: ['comfort', 'vulnerability', 'tempo_down', 'recall'],
        coherenceWeight: 0.9,
        actGates: {
          1: 'Cold exterior but hints of warmth beneath',
          2: 'Small gestures begin to chip away at walls',
          3: 'Moment of crisis forces emotional breakthrough',
          4: 'Past pain acknowledged and shared',
          5: 'Complete emotional thaw and vulnerability'
        }
      }
    ];

    defaultVibes.forEach(vibe => {
      this.vibes.set(vibe.id, vibe);
    });
  }

  getVibe(id: string): Vibe | null {
    return this.vibes.get(id) || null;
  }

  getAllVibes(): Vibe[] {
    return Array.from(this.vibes.values());
  }

  addCustomVibe(vibe: Vibe): void {
    this.vibes.set(vibe.id, vibe);
  }

  async createStoryContext(
    vibeId: string,
    spotlightPair: [string, string],
    previouslyLine?: string
  ): Promise<StoryContext | null> {
    const vibe = this.getVibe(vibeId);
    if (!vibe) {
      throw new Error(`Vibe '${vibeId}' not found`);
    }

    let extractedTokens: CallbackToken[] = [];

    // Extract 1-3 tokens from "Previously..." line if provided
    if (previouslyLine) {
      extractedTokens = await this.extractTokensFromPreviously(previouslyLine, vibe);
    }

    return {
      vibe,
      previouslyLine,
      extractedTokens
    };
  }

  private async extractTokensFromPreviously(
    previouslyLine: string,
    vibe: Vibe
  ): Promise<CallbackToken[]> {
    const extractPrompt = `Extract 1-3 meaningful callback tokens from this "Previously..." line that could be referenced later in a ${vibe.name} romance story:

"${previouslyLine}"

Focus on:
- Key emotional moments or revelations
- Important objects, places, or promises
- Significant actions or decisions
- Relationship dynamics or conflicts

Return as a simple list, one per line, using specific phrases from the text.`;

    try {
      const response = await this.openai.generateMainLine(
        'You are a romance story analyst extracting callback tokens.',
        extractPrompt
      );

      const tokenStrings = response
        .split('\n')
        .map(line => line.trim().replace(/^[-*]\s*/, ''))
        .filter(line => line.length > 0)
        .slice(0, 3); // Max 3 tokens

      return tokenStrings.map((content, index) => ({
        id: uuidv4(),
        content,
        salience: 0.8 - (index * 0.1), // First token most salient
        lastSeenTurn: 0,
        scheduled: true // Mark for early recall
      }));

    } catch (error) {
      console.error('Error extracting tokens:', error);
      // Fallback to simple keyword extraction
      return this.simpleTokenExtraction(previouslyLine);
    }
  }

  private simpleTokenExtraction(text: string): CallbackToken[] {
    const keywords = text
      .toLowerCase()
      .split(/\W+/)
      .filter(word => word.length > 3)
      .filter(word => !['that', 'they', 'were', 'when', 'where', 'what', 'said'].includes(word))
      .slice(0, 3);

    return keywords.map((word, index) => ({
      id: uuidv4(),
      content: word,
      salience: 0.7 - (index * 0.1),
      lastSeenTurn: 0,
      scheduled: true
    }));
  }

  generateVibeSystemPrompt(vibe: Vibe, currentAct: number = 1): string {
    const basePrompt = `ROMANCE VIBE: ${vibe.name.toUpperCase()}

${vibe.tone}

CHARACTER ARCHETYPES:
${vibe.archetypes.map(arch => `- ${arch}`).join('\n')}

TYPICAL CONFLICTS:
${vibe.conflicts.map(conf => `- ${conf}`).join('\n')}

SETTING INSPIRATION:
${vibe.settingSeeds.map(setting => `- ${setting}`).join('\n')}

CALLBACK TOKENS TO DEVELOP:
${vibe.callbackTokens.map(token => `- ${token}`).join('\n')}

ACT ${currentAct} EXPECTATIONS:
${vibe.actGates[currentAct] || 'Continue building romantic tension appropriately for this stage'}

NUDGE PRIORITIES (preferred story moves):
${vibe.nudgePriorities.slice(0, 4).map(nudge => `- ${nudge}`).join('\n')}

Remember: This vibe has coherence weight ${vibe.coherenceWeight} (${vibe.coherenceWeight > 0.7 ? 'high - prioritize consistency' : 'moderate - allow some creative risks'}).`;

    return basePrompt;
  }

  validateStoryProgression(
    vibe: Vibe,
    currentAct: number,
    loveGraph: { attraction: number; trust: number; tension: number; comfort: number }
  ): { valid: boolean; suggestions: string[] } {
    const suggestions: string[] = [];
    let valid = true;

    // Check if love graph values align with vibe expectations
    switch (vibe.id) {
      case 'ember':
        if (currentAct >= 2 && loveGraph.attraction < 0.3) {
          valid = false;
          suggestions.push('Ember vibe needs more smoldering attraction by Act 2');
        }
        break;
        
      case 'spark':
        if (currentAct >= 2 && loveGraph.attraction < 0.5) {
          valid = false;
          suggestions.push('Spark vibe should have high attraction early');
        }
        break;
        
      case 'rivals':
        if (currentAct === 1 && loveGraph.tension < 0.3) {
          valid = false;
          suggestions.push('Rivals need more competitive tension in Act 1');
        }
        break;
        
      case 'crush':
        if (currentAct >= 2 && loveGraph.comfort < 0.4) {
          valid = false;
          suggestions.push('Crush vibe needs comfortable friendship foundation');
        }
        break;
        
      case 'thaw':
        if (currentAct <= 2 && loveGraph.comfort > 0.5) {
          valid = false;
          suggestions.push('Thaw character warming too quickly - maintain emotional barriers longer');
        }
        break;
    }

    // General act progression checks
    const actRequirement = vibe.actGates[currentAct];
    if (actRequirement) {
      suggestions.push(`Current act should focus on: ${actRequirement}`);
    }

    return { valid, suggestions };
  }
}