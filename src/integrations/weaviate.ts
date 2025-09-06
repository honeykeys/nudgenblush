import weaviate, { WeaviateClient } from 'weaviate-ts-client';
import { LineMemory, TokenMemory } from '../types';

export class WeaviateService {
  private client: WeaviateClient;
  
  constructor(url: string, apiKey: string) {
    this.client = weaviate.client({
      scheme: 'https',
      host: url.replace('https://', ''),
      apiKey: { apiKey },
      headers: { 'X-OpenAI-Api-Key': process.env.OPENAI_API_KEY || '' }
    });
  }

  async initializeSchema(): Promise<void> {
    try {
      // Check if LineMemory class exists
      const lineMemoryExists = await this.client.schema.classGetter().withClassName('LineMemory').do();
      
      if (!lineMemoryExists) {
        const lineMemoryClass = {
          class: 'LineMemory',
          description: 'Storage for individual story lines with vector embeddings',
          vectorizer: 'text2vec-openai',
          moduleConfig: {
            'text2vec-openai': {
              model: 'text-embedding-3-large',
              dimensions: 3072,
              type: 'text'
            }
          },
          properties: [
            {
              name: 'storyId',
              dataType: ['text'],
              description: 'Unique identifier for the story'
            },
            {
              name: 'turnIdx',
              dataType: ['int'],
              description: 'Turn index in the conversation'
            },
            {
              name: 'speaker',
              dataType: ['text'],
              description: 'Character name who spoke the line'
            },
            {
              name: 'text',
              dataType: ['text'],
              description: 'The actual dialogue or narrative text'
            },
            {
              name: 'timestamp',
              dataType: ['date'],
              description: 'When the line was created'
            }
          ]
        };

        await this.client.schema.classCreator().withClass(lineMemoryClass).do();
        console.log('LineMemory class created successfully');
      }

      // Check if TokenMemory class exists
      const tokenMemoryExists = await this.client.schema.classGetter().withClassName('TokenMemory').do();
      
      if (!tokenMemoryExists) {
        const tokenMemoryClass = {
          class: 'TokenMemory',
          description: 'Storage for callback tokens with semantic vectors',
          vectorizer: 'text2vec-openai',
          moduleConfig: {
            'text2vec-openai': {
              model: 'text-embedding-3-large',
              dimensions: 3072,
              type: 'text'
            }
          },
          properties: [
            {
              name: 'storyId',
              dataType: ['text'],
              description: 'Unique identifier for the story'
            },
            {
              name: 'token',
              dataType: ['text'],
              description: 'The callback token content'
            },
            {
              name: 'salience',
              dataType: ['number'],
              description: 'Importance score of the token'
            },
            {
              name: 'lastSeenTurn',
              dataType: ['int'],
              description: 'Last turn when token was referenced'
            }
          ]
        };

        await this.client.schema.classCreator().withClass(tokenMemoryClass).do();
        console.log('TokenMemory class created successfully');
      }

    } catch (error) {
      console.error('Error initializing Weaviate schema:', error);
      throw error;
    }
  }

  async storeLine(lineMemory: Omit<LineMemory, 'vector'>): Promise<string> {
    try {
      const result = await this.client.data.creator()
        .withClassName('LineMemory')
        .withProperties({
          storyId: lineMemory.storyId,
          turnIdx: lineMemory.turnIdx,
          speaker: lineMemory.speaker,
          text: lineMemory.text,
          timestamp: lineMemory.timestamp.toISOString()
        })
        .do();

      return result.id as string;
    } catch (error) {
      console.error('Error storing line:', error);
      throw error;
    }
  }

  async storeToken(tokenMemory: Omit<TokenMemory, 'vector'>): Promise<string> {
    try {
      const result = await this.client.data.creator()
        .withClassName('TokenMemory')
        .withProperties({
          storyId: tokenMemory.storyId,
          token: tokenMemory.token,
          salience: tokenMemory.salience,
          lastSeenTurn: tokenMemory.lastSeenTurn
        })
        .do();

      return result.id as string;
    } catch (error) {
      console.error('Error storing token:', error);
      throw error;
    }
  }

  async retrieveSimilarLines(storyId: string, queryVector: number[], limit: number = 5): Promise<LineMemory[]> {
    try {
      const result = await this.client.graphql.get()
        .withClassName('LineMemory')
        .withFields('storyId turnIdx speaker text timestamp')
        .withWhere({
          path: ['storyId'],
          operator: 'Equal',
          valueText: storyId
        })
        .withNearVector({
          vector: queryVector,
          certainty: 0.7
        })
        .withLimit(limit)
        .do();

      return result.data.Get.LineMemory.map((item: any) => ({
        storyId: item.storyId,
        turnIdx: item.turnIdx,
        speaker: item.speaker,
        text: item.text,
        timestamp: new Date(item.timestamp),
        vector: [] // Vector not returned in queries
      }));
    } catch (error) {
      console.error('Error retrieving similar lines:', error);
      throw error;
    }
  }

  async retrieveRelevantTokens(storyId: string, queryVector: number[], limit: number = 3): Promise<TokenMemory[]> {
    try {
      const result = await this.client.graphql.get()
        .withClassName('TokenMemory')
        .withFields('storyId token salience lastSeenTurn')
        .withWhere({
          path: ['storyId'],
          operator: 'Equal',
          valueText: storyId
        })
        .withNearVector({
          vector: queryVector,
          certainty: 0.6
        })
        .withLimit(limit)
        .do();

      return result.data.Get.TokenMemory.map((item: any) => ({
        storyId: item.storyId,
        token: item.token,
        salience: item.salience,
        lastSeenTurn: item.lastSeenTurn,
        vector: [] // Vector not returned in queries
      }));
    } catch (error) {
      console.error('Error retrieving relevant tokens:', error);
      throw error;
    }
  }

  async updateTokenLastSeen(storyId: string, token: string, turnIdx: number): Promise<void> {
    try {
      // Find the token first
      const result = await this.client.graphql.get()
        .withClassName('TokenMemory')
        .withFields('storyId token')
        .withWhere({
          path: ['storyId'],
          operator: 'Equal',
          valueText: storyId
        })
        .withWhere({
          path: ['token'],
          operator: 'Equal',
          valueText: token
        })
        .withLimit(1)
        .do();

      if (result.data.Get.TokenMemory.length > 0) {
        const tokenId = result.data.Get.TokenMemory[0].id;
        
        await this.client.data.updater()
          .withClassName('TokenMemory')
          .withId(tokenId)
          .withProperties({
            lastSeenTurn: turnIdx
          })
          .do();
      }
    } catch (error) {
      console.error('Error updating token last seen:', error);
      throw error;
    }
  }

  async getRecentLines(storyId: string, limit: number = 16): Promise<LineMemory[]> {
    try {
      const result = await this.client.graphql.get()
        .withClassName('LineMemory')
        .withFields('storyId turnIdx speaker text timestamp')
        .withWhere({
          path: ['storyId'],
          operator: 'Equal',
          valueText: storyId
        })
        .withSort([{ path: ['turnIdx'], order: 'desc' }])
        .withLimit(limit)
        .do();

      return result.data.Get.LineMemory.map((item: any) => ({
        storyId: item.storyId,
        turnIdx: item.turnIdx,
        speaker: item.speaker,
        text: item.text,
        timestamp: new Date(item.timestamp),
        vector: []
      })).reverse(); // Return in chronological order
    } catch (error) {
      console.error('Error getting recent lines:', error);
      throw error;
    }
  }
}