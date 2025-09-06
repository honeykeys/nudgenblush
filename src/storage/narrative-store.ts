// Simple in-memory storage for the hackathon platform
// In production, this would use PostgreSQL with the schema defined in types/narrative.ts

import {
  Episode,
  Scene,
  SpokenLine,
  EvaluationSnapshot,
  EpisodeRecord,
  SceneRecord,
  TurnRecord,
  EvaluationSnapshotRecord,
  TelemetryEventUnion
} from '../types/narrative';

export class NarrativeStore {
  private episodes: Map<string, Episode> = new Map();
  private scenes: Map<string, Scene> = new Map();
  private turns: SpokenLine[] = [];
  private evaluationSnapshots: EvaluationSnapshot[] = [];
  private telemetryEvents: TelemetryEventUnion[] = [];

  // Episode management
  async createEpisode(episode: Episode): Promise<void> {
    this.episodes.set(episode.id, { ...episode });
    console.log(`📚 Stored episode: ${episode.id}`);
  }

  async getEpisode(id: string): Promise<Episode | null> {
    return this.episodes.get(id) || null;
  }

  async updateEpisode(episode: Episode): Promise<void> {
    this.episodes.set(episode.id, { ...episode });
  }

  async listEpisodes(): Promise<Episode[]> {
    return Array.from(this.episodes.values());
  }

  // Scene management
  async createScene(scene: Scene): Promise<void> {
    this.scenes.set(scene.id, { ...scene });
    
    // Also update parent episode
    const episode = this.episodes.get(scene.episodeId);
    if (episode) {
      const existingIndex = episode.scenes.findIndex(s => s.id === scene.id);
      if (existingIndex >= 0) {
        episode.scenes[existingIndex] = { ...scene };
      } else {
        episode.scenes.push({ ...scene });
      }
      this.episodes.set(episode.id, episode);
    }

    console.log(`🎬 Stored scene: ${scene.id} (Act ${scene.act})`);
  }

  async getScene(id: string): Promise<Scene | null> {
    return this.scenes.get(id) || null;
  }

  async getScenesForEpisode(episodeId: string): Promise<Scene[]> {
    return Array.from(this.scenes.values()).filter(s => s.episodeId === episodeId);
  }

  // Turn management
  async createTurn(turn: SpokenLine): Promise<void> {
    this.turns.push({ ...turn });
    console.log(`💬 Stored turn: ${turn.speaker} - "${turn.text.substring(0, 50)}..."`);
  }

  async getTurnsForScene(sceneId: string): Promise<SpokenLine[]> {
    // In a real implementation, turns would be linked to scenes via foreign key
    // For now, we'll return recent turns (simplified)
    return this.turns.slice(-10);
  }

  async getTurnsForEpisode(episodeId: string): Promise<SpokenLine[]> {
    // Simplified - would join with scenes table in production
    return this.turns.slice();
  }

  // Evaluation snapshot management
  async createEvaluationSnapshot(snapshot: EvaluationSnapshot): Promise<void> {
    this.evaluationSnapshots.push({ ...snapshot });
    console.log(`📊 Stored evaluation snapshot: ${snapshot.id}`);
  }

  async getEvaluationSnapshots(sceneId: string): Promise<EvaluationSnapshot[]> {
    return this.evaluationSnapshots.filter(s => s.sceneId === sceneId);
  }

  async getRecentEvaluationSnapshots(limit: number = 10): Promise<EvaluationSnapshot[]> {
    return this.evaluationSnapshots
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  // Telemetry management
  async storeTelemetryEvent(event: TelemetryEventUnion): Promise<void> {
    this.telemetryEvents.push({ ...event });
  }

  async getTelemetryEvents(episodeId: string): Promise<TelemetryEventUnion[]> {
    return this.telemetryEvents.filter(e => e.episodeId === episodeId);
  }

  async getRecentTelemetryEvents(limit: number = 50): Promise<TelemetryEventUnion[]> {
    return this.telemetryEvents
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  // Analytics and reporting
  async generateEpisodeReport(episodeId: string): Promise<{
    episode: Episode;
    scenes: Scene[];
    turnCount: number;
    avgLatencyMs: number;
    evaluationCount: number;
    telemetryEventCount: number;
  }> {
    const episode = await this.getEpisode(episodeId);
    if (!episode) throw new Error(`Episode ${episodeId} not found`);

    const scenes = await this.getScenesForEpisode(episodeId);
    const turns = await this.getTurnsForEpisode(episodeId);
    const telemetryEvents = await this.getTelemetryEvents(episodeId);
    
    const avgLatencyMs = turns.length > 0 
      ? turns.reduce((sum, turn) => sum + turn.latencyMs, 0) / turns.length
      : 0;

    const evaluationSnapshots = this.evaluationSnapshots.filter(s => 
      scenes.some(scene => scene.id === s.sceneId)
    );

    return {
      episode,
      scenes,
      turnCount: turns.length,
      avgLatencyMs,
      evaluationCount: evaluationSnapshots.length,
      telemetryEventCount: telemetryEvents.length
    };
  }

  // Convert to production schema (for future migration)
  async exportForProduction(): Promise<{
    episodes: EpisodeRecord[];
    scenes: SceneRecord[];
    turns: TurnRecord[];
    evaluationSnapshots: EvaluationSnapshotRecord[];
  }> {
    const episodes: EpisodeRecord[] = Array.from(this.episodes.values()).map(ep => ({
      id: ep.id,
      started_at: new Date(ep.startedAt),
      ended_at: ep.endedAt ? new Date(ep.endedAt) : undefined,
      act_path: ep.actPath,
      ending: ep.ending,
      import_seed: ep.importSeed,
      transcript_jsonb: {
        scenes: ep.scenes,
        loveGraph: ep.loveGraph,
        activeVibe: ep.activeVibe,
        setting: ep.setting
      },
      avg_latency_ms: this.calculateAvgLatency(ep.id),
      persona_used: ep.activeVibe,
      satisfaction_score: undefined
    }));

    const scenes: SceneRecord[] = Array.from(this.scenes.values()).map(scene => ({
      id: scene.id,
      episode_id: scene.episodeId,
      act: scene.act,
      idx: scene.index,
      ended_reason: scene.endedReason,
      major_nudges: scene.majorNudges,
      minor_nudges: scene.minorNudges
    }));

    const turns: TurnRecord[] = this.turns.map(turn => ({
      id: `turn_${turn.timestamp}_${turn.speaker}`,
      scene_id: 'scene_placeholder', // Would need proper scene linking
      speaker: turn.speaker,
      text: turn.text,
      secs: turn.secs,
      deltas: turn.deltas,
      latency_ms: turn.latencyMs
    }));

    const evaluationSnapshots: EvaluationSnapshotRecord[] = this.evaluationSnapshots.map(snap => ({
      id: snap.id,
      scene_id: snap.sceneId,
      candidate: snap.candidate,
      freshness: snap.scores.freshnessGain,
      coherence: snap.scores.coherenceCost,
      fragility: snap.scores.fragilityIndex,
      score: snap.scores.finalScore,
      chosen: snap.chosen
    }));

    return {
      episodes,
      scenes,
      turns,
      evaluationSnapshots
    };
  }

  // Utility methods
  private calculateAvgLatency(episodeId: string): number {
    const episodeTurns = this.turns.filter(turn => 
      // Simplified - would use proper episode linking
      true
    );
    
    return episodeTurns.length > 0
      ? episodeTurns.reduce((sum, turn) => sum + turn.latencyMs, 0) / episodeTurns.length
      : 0;
  }

  // Cleanup and maintenance
  async clearEpisode(episodeId: string): Promise<void> {
    this.episodes.delete(episodeId);
    
    const scenesToDelete = Array.from(this.scenes.values())
      .filter(s => s.episodeId === episodeId);
    
    for (const scene of scenesToDelete) {
      this.scenes.delete(scene.id);
    }

    this.telemetryEvents = this.telemetryEvents.filter(e => e.episodeId !== episodeId);
    
    console.log(`🗑️  Cleared episode: ${episodeId}`);
  }

  async clearAllData(): Promise<void> {
    this.episodes.clear();
    this.scenes.clear();
    this.turns = [];
    this.evaluationSnapshots = [];
    this.telemetryEvents = [];
    
    console.log('🗑️  Cleared all narrative data');
  }

  // Statistics
  getStats(): {
    episodeCount: number;
    sceneCount: number;
    turnCount: number;
    evaluationSnapshotCount: number;
    telemetryEventCount: number;
  } {
    return {
      episodeCount: this.episodes.size,
      sceneCount: this.scenes.size,
      turnCount: this.turns.length,
      evaluationSnapshotCount: this.evaluationSnapshots.length,
      telemetryEventCount: this.telemetryEvents.length
    };
  }
}

// Singleton instance for hackathon use
export const narrativeStore = new NarrativeStore();