export interface PlaylistProvider {
  removeAllTracks(playlistId: string): Promise<void>;
  addTracks(playlistId: string, songs: string[]): Promise<void>;
}

export async function publishDailyPlaylist(
  playlistId: string,
  songIds: string[],
  provider: PlaylistProvider
): Promise<void> {
  await provider.removeAllTracks(playlistId);
  await provider.addTracks(playlistId, songIds.slice(0, 20));
}
