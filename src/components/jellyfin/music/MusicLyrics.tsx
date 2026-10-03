import React, { useEffect, useRef, useMemo, memo } from 'react'
import { X, Mic2, Music2 } from 'lucide-react'
import { useMusicPlayer, lyricsTicksToSeconds } from '../../../stores/musicPlayerStore'
import { useJellyfin } from '../JellyfinContext'

// Gate: subscribe only to isLyricsOpen while closed, so the 4x/sec currentTime
// updates don't re-render anything when the lyrics panel isn't visible.
export const MusicLyrics = memo(function MusicLyrics() {
  const isLyricsOpen = useMusicPlayer(s => s.isLyricsOpen)
  if (!isLyricsOpen) return null
  return <MusicLyricsPanel />
})

const MusicLyricsPanel = memo(function MusicLyricsPanel() {
  const { serverUrl, getImageUrl } = useJellyfin()
  const currentTrack = useMusicPlayer(s => s.currentTrack)
  const currentTime = useMusicPlayer(s => s.currentTime)
  const lyrics = useMusicPlayer(s => s.lyrics)
  const lyricsLoading = useMusicPlayer(s => s.lyricsLoading)
  const lyricsError = useMusicPlayer(s => s.lyricsError)
  const setLyricsOpen = useMusicPlayer(s => s.setLyricsOpen)

  const lyricsContainerRef = useRef<HTMLDivElement>(null)
  const currentLineRef = useRef<HTMLDivElement>(null)

  // Determine if lyrics are synced (have timestamps)
  const isSynced = useMemo(() => {
    return lyrics?.some(line => line.start !== undefined) ?? false
  }, [lyrics])

  // Find the current lyric line based on playback time
  const currentLineIndex = useMemo(() => {
    if (!lyrics || !isSynced) return -1

    let index = -1
    for (let i = 0; i < lyrics.length; i++) {
      const lineTime = lyricsTicksToSeconds(lyrics[i].start)
      if (lineTime !== undefined && lineTime <= currentTime) {
        index = i
      } else if (lineTime !== undefined && lineTime > currentTime) {
        break
      }
    }
    return index
  }, [lyrics, currentTime, isSynced])

  // Auto-scroll to current line
  useEffect(() => {
    if (currentLineRef.current && lyricsContainerRef.current && isSynced) {
      const container = lyricsContainerRef.current
      const line = currentLineRef.current

      const containerRect = container.getBoundingClientRect()
      const lineRect = line.getBoundingClientRect()

      // Center the current line in the container
      const scrollTop = line.offsetTop - container.offsetTop - (containerRect.height / 2) + (lineRect.height / 2)

      container.scrollTo({
        top: scrollTop,
        behavior: 'smooth'
      })
    }
  }, [currentLineIndex, isSynced])

  const imageUrl = currentTrack?.albumId
    ? getImageUrl(currentTrack.albumId, 'Primary', 400)
    : null

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
        onClick={() => setLyricsOpen(false)}
      />

      {/* Lyrics Panel */}
      <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] max-w-[90vw] phone:max-w-full h-[70vh] max-h-[600px] phone:w-full phone:h-full phone:max-h-none phone:rounded-none phone:z-[60] phone:pt-safe phone:pb-safe bg-gray-900/95 backdrop-blur-md border border-white/10 rounded-2xl z-50 flex flex-col shadow-2xl overflow-hidden">
        {/* Background blur from album art */}
        {imageUrl && (
          <div
            className="absolute inset-0 opacity-20 blur-3xl"
            style={{
              backgroundImage: `url(${imageUrl})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center'
            }}
          />
        )}

        {/* Header */}
        <div className="relative flex items-center justify-between px-6 py-4 border-b border-white/10">
          <div className="flex items-center gap-3">
            <Mic2 size={20} className="text-theme-400" />
            <div>
              <h2 className="font-semibold text-white">Lyrics</h2>
              {currentTrack && (
                <p className="text-sm text-white/60">
                  {currentTrack.name} - {currentTrack.artists.join(', ')}
                </p>
              )}
            </div>
          </div>

          <button
            onClick={() => setLyricsOpen(false)}
            className="p-2 text-white/50 hover:text-white hover:bg-white/10 rounded-full transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Lyrics content */}
        <div
          ref={lyricsContainerRef}
          className="relative flex-1 overflow-y-auto custom-scrollbar px-6 py-8"
        >
          {/* Loading state */}
          {lyricsLoading && (
            <div className="flex flex-col items-center justify-center h-full">
              <div className="w-8 h-8 border-2 border-theme-500 border-t-transparent rounded-full animate-spin mb-4" />
              <p className="text-white/60">Loading lyrics...</p>
            </div>
          )}

          {/* Error state */}
          {lyricsError && !lyricsLoading && (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <Music2 size={48} className="text-white/20 mb-4" />
              <p className="text-white/60 mb-2">Could not load lyrics</p>
              <p className="text-sm text-white/40">{lyricsError}</p>
            </div>
          )}

          {/* No lyrics available */}
          {!lyrics && !lyricsLoading && !lyricsError && (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <Music2 size={48} className="text-white/20 mb-4" />
              <p className="text-white/60">No lyrics available</p>
              <p className="text-sm text-white/40 mt-1">
                Lyrics are not available for this track
              </p>
            </div>
          )}

          {/* Lyrics display */}
          {lyrics && lyrics.length > 0 && !lyricsLoading && (
            <div className="space-y-4 pb-20">
              {lyrics.map((line, index) => {
                const isCurrentLine = index === currentLineIndex
                const isPastLine = isSynced && index < currentLineIndex

                return (
                  <div
                    key={index}
                    ref={isCurrentLine ? currentLineRef : null}
                    className={`
                      text-center transition-all duration-300 ease-out
                      ${isCurrentLine
                        ? 'text-2xl font-bold text-white scale-105'
                        : isPastLine
                        ? 'text-lg text-white/40'
                        : 'text-lg text-white/60 hover:text-white/80'
                      }
                      ${!isSynced ? 'text-lg text-white/80' : ''}
                    `}
                  >
                    {line.text || '\u00A0'}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Synced indicator */}
        {lyrics && lyrics.length > 0 && (
          <div className="relative px-6 py-3 border-t border-white/10 flex justify-center">
            <span className={`text-xs px-3 py-1 rounded-full ${
              isSynced
                ? 'bg-theme-500/20 text-theme-400'
                : 'bg-white/10 text-white/40'
            }`}>
              {isSynced ? 'Synced lyrics' : 'Unsynced lyrics'}
            </span>
          </div>
        )}
      </div>
    </>
  )
})
