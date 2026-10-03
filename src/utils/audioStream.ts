// Builds the Jellyfin "universal" audio stream URL.
//
// `container` lists what the WebView can direct-play (Chromium/WebView2:
// mp3, aac/m4a/m4b, flac, opus, ogg/vorbis, webm, wav). Entries like
// `webm|opus` mean "webm container with opus codec". Anything NOT in this
// list (wma, ape, alac, dsf, mpc, wv, ...) is transcoded server-side using
// the transcoding* parameters — without them the endpoint has no fallback
// and playback of exotic formats simply fails.
const DIRECT_PLAY_CONTAINERS =
  'opus,webm|opus,mp3,aac,m4a|aac,m4b|aac,flac,webma,webm|webma,wav,ogg'

export function getUniversalAudioUrl(
  serverUrl: string,
  itemId: string,
  accessToken: string,
): string {
  const params = new URLSearchParams({
    ApiKey: accessToken,
    container: DIRECT_PLAY_CONTAINERS,
    transcodingContainer: 'mp3',
    transcodingProtocol: 'http',
    audioCodec: 'mp3',
    audioBitRate: '320000',
    maxStreamingBitrate: '140000000',
  })
  return `${serverUrl}/Audio/${itemId}/universal?${params.toString()}`
}
