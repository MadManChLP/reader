// Screen-orientation control for the video player (phone).
//
// Uses the web Screen Orientation API. This works on Android (Chromium WebView)
// and Chromium desktop. iOS WKWebView does NOT implement `orientation.lock`
// (the call throws) — forcing landscape there requires a native hook in the
// generated iOS project, which is tracked separately. Every call is wrapped so
// an unsupported platform never breaks playback.

/** Try to lock the screen to landscape (best-effort; no-op where unsupported). */
export async function lockLandscape(): Promise<void> {
  try {
    const orientation = screen.orientation as ScreenOrientation & {
      lock?: (o: string) => Promise<void>
    }
    await orientation?.lock?.('landscape')
  } catch {
    /* unsupported (iOS WKWebView / desktop / no fullscreen) — ignore */
  }
}

/** Release an orientation lock taken by lockLandscape(). */
export function unlockOrientation(): void {
  try {
    screen.orientation?.unlock?.()
  } catch {
    /* ignore */
  }
}
