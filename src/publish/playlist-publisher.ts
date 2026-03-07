export interface PlaylistProvider {
  removeAllTracks(playlistId: string): Promise<void>;
  addTracks(playlistId: string, songs: string[]): Promise<void>;
  replaceDescription(playlistId: string, description: string): Promise<void>;
}

export async function publishDailyPlaylist(
  playlistId: string,
  songIds: string[],
  provider: PlaylistProvider,
  description?: string
): Promise<void> {
  await provider.removeAllTracks(playlistId);
  await provider.addTracks(playlistId, songIds.slice(0, 20));
  if (description !== undefined) {
    await provider.replaceDescription(playlistId, description);
  }
}
