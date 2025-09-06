import OpenAI from 'openai';
import { OpenAIConfig, SafetyResult } from '../types';

export class OpenAIService {
  private client: OpenAI;
  private config: OpenAIConfig;

  constructor(apiKey: string, config: OpenAIConfig = {
    writerModel: 'gpt-4.1',
    previewModel: 'gpt-4.1-mini',
    embeddingModel: 'text-embedding-3-large'
  }) {
    this.client = new OpenAI({ apiKey });
    this.config = config;
  }

  async generateMainLine(systemPrompt: string, userPrompt: string, temperature: number = 0.8): Promise<string> {
    try {
      const response = await this.client.chat.completions.create({
        model: this.config.writerModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature,
        max_tokens: 150,
        presence_penalty: 0.1,
        frequency_penalty: 0.2
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('No content received from OpenAI');
      }

      return content.trim();
    } catch (error) {
      console.error('Error generating main line:', error);
      throw error;
    }
  }

  async generateNudgePreview(systemPrompt: string, userPrompt: string): Promise<string> {
    try {
      const response = await this.client.chat.completions.create({
        model: this.config.previewModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.7,
        max_tokens: 100
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('No preview content received from OpenAI');
      }

      return content.trim();
    } catch (error) {
      console.error('Error generating nudge preview:', error);
      throw error;
    }
  }

  async generateEmbedding(text: string): Promise<number[]> {
    try {
      const response = await this.client.embeddings.create({
        model: this.config.embeddingModel,
        input: text,
        encoding_format: 'float'
      });

      return response.data[0].embedding;
    } catch (error) {
      console.error('Error generating embedding:', error);
      throw error;
    }
  }

  async batchGenerateEmbeddings(texts: string[]): Promise<number[][]> {
    try {
      const response = await this.client.embeddings.create({
        model: this.config.embeddingModel,
        input: texts,
        encoding_format: 'float'
      });

      return response.data.map(item => item.embedding);
    } catch (error) {
      console.error('Error generating batch embeddings:', error);
      throw error;
    }
  }

  async checkSafety(content: string): Promise<SafetyResult> {
    try {
      const moderationResponse = await this.client.moderations.create({
        input: content
      });

      const result = moderationResponse.results[0];
      
      if (result.flagged) {
        const flaggedCategories = Object.entries(result.categories)
          .filter(([_, flagged]) => flagged)
          .map(([category]) => category);
        
        return {
          isSafe: false,
          reason: `Content flagged for: ${flaggedCategories.join(', ')}`
        };
      }

      // Additional PG-13 and consent checks
      const lowerContent = content.toLowerCase();
      const unsafePatterns = [
        /explicit sexual content/i,
        /graphic violence/i,
        /non-consensual/i,
        /under 18/i,
        /minor/i
      ];

      for (const pattern of unsafePatterns) {
        if (pattern.test(content)) {
          return {
            isSafe: false,
            reason: 'Content violates PG-13 or consent guidelines'
          };
        }
      }

      return { isSafe: true };
    } catch (error) {
      console.error('Error checking safety:', error);
      return { isSafe: false, reason: 'Safety check failed' };
    }
  }

  getBaseSystemPrompt(): string {
    return `You are a romance story generator creating PG-13 content in a five-act structure. Follow these guidelines:

CONTENT RULES:
- All characters are 18+ adults
- Keep content PG-13 and consent-aware
- No explicit sexual content or graphic descriptions
- No slurs or offensive language
- Subtext over exposition

STORY STRUCTURE:
- Five-act progression: Setup → Rising Action → Climax → Falling Action → Resolution
- Scenes end on checkpoints or clean plateaus, never mid-conversation
- No timers or rushing - let moments breathe
- Lines should be ≤9 seconds when spoken aloud

NARRATIVE STYLE:
- Focus on dialogue between characters
- Narrator appears ≤1 short line per 3-4 exchanges
- Maintain continuity with established tokens and "Previously..." context
- Advance Disclosure/Physicality/Commitment/Conflict coherently for current act
- Never acknowledge the player directly in the story world

EMOTIONAL PROGRESSION:
- Track Attraction, Trust, Tension, and Comfort levels
- Use callback tokens for meaningful story continuity
- Build romantic tension through subtext and chemistry`;
  }

  getRolloutPrompt(
    act: number,
    vibeSummary: string,
    spotlight: [string, string],
    watchers: string[],
    setting: string,
    tokens: string[],
    recentLines: string[],
    nudgeDescriptor: string
  ): string {
    return `Generate exactly one line following this nudge: "${nudgeDescriptor}"

CONTEXT:
- Act: ${act}/5
- Vibe: ${vibeSummary}
- Spotlight: ${spotlight[0]} and ${spotlight[1]}
- Watchers: ${watchers.join(', ')}
- Setting: ${setting}
- Active Tokens: ${tokens.join(', ')}

RECENT LINES (latest first):
${recentLines.join('\n')}

Respond with exactly one line in format: "SPEAKER: TEXT"`;
  }
}