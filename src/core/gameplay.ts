import { v4 as uuidv4 } from 'uuid';
import { GameState, GameLine, LoveGraph, CallbackToken, Vibe } from '../types';

export class GameplayEngine {
  private gameState: GameState;

  constructor(vibe: Vibe, spotlightPair: [string, string], watchers: string[] = []) {
    this.gameState = {
      storyId: uuidv4(),
      currentAct: 1,
      spotlightPair,
      watchers,
      recentLines: [],
      loveGraph: {
        attraction: 0.1,
        trust: 0.1,
        tension: 0.2,
        comfort: 0.1
      },
      tokens: [],
      plateauCounter: 0,
      lastMajorNudgeExchange: 0,
      currentExchange: 0
    };
  }

  getGameState(): GameState {
    return { ...this.gameState };
  }

  addLine(line: GameLine): void {
    this.gameState.recentLines.push(line);
    this.gameState.currentExchange = line.turnIdx;
    
    // Keep only last 12-16 lines
    if (this.gameState.recentLines.length > 16) {
      this.gameState.recentLines = this.gameState.recentLines.slice(-16);
    }
  }

  updateLoveGraph(changes: Partial<LoveGraph>): void {
    Object.assign(this.gameState.loveGraph, changes);
    
    // Clamp values between 0 and 1
    Object.keys(this.gameState.loveGraph).forEach(key => {
      const value = this.gameState.loveGraph[key as keyof LoveGraph];
      this.gameState.loveGraph[key as keyof LoveGraph] = Math.max(0, Math.min(1, value));
    });
  }

  addToken(token: CallbackToken): void {
    const existingTokenIndex = this.gameState.tokens.findIndex(t => t.id === token.id);
    if (existingTokenIndex >= 0) {
      this.gameState.tokens[existingTokenIndex] = token;
    } else {
      this.gameState.tokens.push(token);
    }
  }

  getActiveTokens(maxTokens: number = 5): CallbackToken[] {
    return this.gameState.tokens
      .sort((a, b) => b.salience - a.salience)
      .slice(0, maxTokens);
  }

  checkActProgression(vibe: Vibe): boolean {
    const currentActGate = vibe.actGates[this.gameState.currentAct];
    if (!currentActGate) return false;

    // Check if current act requirements are met
    switch (this.gameState.currentAct) {
      case 1: // Setup - Basic attraction established
        return this.gameState.loveGraph.attraction >= 0.3;
        
      case 2: // Rising Action - Trust or tension building
        return (this.gameState.loveGraph.trust >= 0.4 || this.gameState.loveGraph.tension >= 0.5);
        
      case 3: // Climax - High emotional stakes
        return (this.gameState.loveGraph.tension >= 0.7 || this.gameState.loveGraph.attraction >= 0.6);
        
      case 4: // Falling Action - Resolution beginning
        return (this.gameState.loveGraph.comfort >= 0.5 && this.gameState.loveGraph.trust >= 0.5);
        
      case 5: // Resolution - Story complete
        return true;
        
      default:
        return false;
    }
  }

  advanceAct(): boolean {
    if (this.gameState.currentAct < 5) {
      this.gameState.currentAct++;
      this.gameState.plateauCounter = 0; // Reset plateau counter
      return true;
    }
    return false;
  }

  incrementPlateauCounter(): void {
    this.gameState.plateauCounter++;
  }

  resetPlateauCounter(): void {
    this.gameState.plateauCounter = 0;
  }

  isPlateauing(): boolean {
    return this.gameState.plateauCounter >= 3;
  }

  recordMajorNudge(): void {
    this.gameState.lastMajorNudgeExchange = this.gameState.currentExchange;
  }

  getExchangesSinceMajorNudge(): number {
    return this.gameState.currentExchange - this.gameState.lastMajorNudgeExchange;
  }

  canUseMajorNudge(): boolean {
    // Allow major nudges only every 6+ exchanges
    return this.getExchangesSinceMajorNudge() >= 6;
  }

  shouldUseCalmingNudge(): boolean {
    // Use calming nudges for 2 exchanges after major nudge
    const exchangesSince = this.getExchangesSinceMajorNudge();
    return exchangesSince <= 2 && exchangesSince > 0;
  }

  getRecentLines(count: number = 6): GameLine[] {
    return this.gameState.recentLines.slice(-count);
  }

  checkCheckpoint(): 'mutual_spark' | 'deep_connection' | 'conflict_resolution' | 'commitment' | null {
    const { loveGraph, currentAct } = this.gameState;

    switch (currentAct) {
      case 1:
      case 2:
        // Mutual Spark checkpoint
        if (loveGraph.attraction >= 0.4 && loveGraph.comfort >= 0.3) {
          return 'mutual_spark';
        }
        break;
        
      case 3:
        // Deep Connection or Conflict Resolution
        if (loveGraph.trust >= 0.6 && loveGraph.attraction >= 0.5) {
          return 'deep_connection';
        }
        if (loveGraph.tension >= 0.7 && loveGraph.comfort >= 0.4) {
          return 'conflict_resolution';
        }
        break;
        
      case 4:
      case 5:
        // Commitment checkpoint
        if (loveGraph.trust >= 0.7 && loveGraph.attraction >= 0.6 && loveGraph.comfort >= 0.6) {
          return 'commitment';
        }
        break;
    }

    return null;
  }

  getLoveGraphSummary(): string {
    const { attraction, trust, tension, comfort } = this.gameState.loveGraph;
    const scores = [
      `Attraction: ${(attraction * 100).toFixed(0)}%`,
      `Trust: ${(trust * 100).toFixed(0)}%`,
      `Tension: ${(tension * 100).toFixed(0)}%`,
      `Comfort: ${(comfort * 100).toFixed(0)}%`
    ];
    return scores.join(', ');
  }

  exportState(): any {
    return {
      ...this.gameState,
      loveGraphSummary: this.getLoveGraphSummary(),
      checkpoint: this.checkCheckpoint(),
      canUseMajor: this.canUseMajorNudge(),
      shouldUseCalming: this.shouldUseCalmingNudge(),
      isPlateauing: this.isPlateauing()
    };
  }
}