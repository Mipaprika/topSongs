import type { PlaylistProvider } from "../../publish/playlist-publisher";

export interface NeteasePlaylistApi {
  getPlaylistTrackIds(playlistId: string): Promise<string[]>;
  updatePlaylistTracks(playlistId: string, op: "add" | "del", tracks: string[]): Promise<void>;
}

export class NeteasePlaylistProvider implements PlaylistProvider {
  constructor(private readonly api: NeteasePlaylistApi) {}

  async removeAllTracks(playlistId: string): Promise<void> {
    const existingTrackIds = await this.api.getPlaylistTrackIds(playlistId);
    if (existingTrackIds.length === 0) {
      return;
    }
    await this.api.updatePlaylistTracks(playlistId, "del", existingTrackIds);
  }

  async addTracks(playlistId: string, songs: string[]): Promise<void> {
    if (songs.length === 0) {
      return;
    }
    await this.api.updatePlaylistTracks(playlistId, "add", songs);
  }
}
