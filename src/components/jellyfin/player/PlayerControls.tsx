import React, { useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import { ArrowLeft, Settings, WifiOff, ListVideo, List, Lock } from 'lucide-react'
import type { BaseItemDto } from '../JellyfinContext'
import type { Chapter, MediaStream, TrickplayInfo } from './types'
import { IS_PHONE, IS_IOS } from '../../../utils/api'

import { Rewind, FastForward, ChevronsLeft, ChevronsRight } from 'lucide-react'
import PlayPauseButton from './buttons/PlayPauseButton'
import { PrevEpisodeButton, NextEpisodeButton } from './buttons/SkipEpisodeButtons'
import FullscreenButton from './buttons/FullscreenButton'
import CaptionsButton from './buttons/CaptionsButton'
import PictureInPictureButton from './buttons/PictureInPictureButton'
import VolumeControl from './VolumeControl'
import EndsAtDisplay from './EndsAtDisplay'
import ProgressSlider from './ProgressSlider'
import ChapterList from './ChapterList'
import SettingsMenu from './SettingsMenu'
import QueuePanel from './QueuePanel'
import { SleepTimerChip } from './SleepTimerPanel'

// Inline seek buttons to avoid extra indirection
const SeekBackButton = React.memo(({ seconds, onSeek }: { seconds: number; onSeek: () => void }) => (
  <button
    onClick={onSeek}
    className="p-2.5 hover:bg-white/10 rounded-full transition-all duration-200 hover:scale-110"
    title={`Skip back ${seconds} seconds`}
  >
    <Rewind size={22} className="text-white" />
  </button>
))

const SeekForwardButton = React.memo(({ seconds, onSeek }: { seconds: number; onSeek: () => void }) => (
  <button
    onClick={onSeek}
    className="p-2.5 hover:bg-white/10 rounded-full transition-all duration-200 hover:scale-110"
    title={`Skip forward ${seconds} seconds`}
  >
    <FastForward size={22} className="text-white" />
  </button>
))

const ChapterNavButton = React.memo(({ direction, disabled, onClick }: { direction: 'prev' | 'next'; disabled: boolean; onClick: () => void }) => (
  <button
    onClick={onClick}
    className="p-2.5 hover:bg-white/10 rounded-full transition-all duration-200 hover:scale-110"
    title={direction === 'prev' ? 'Previous Chapter' : 'Next Chapter'}
    disabled={disabled}
  >
    {direction === 'prev'
      ? <ChevronsLeft size={22} className={disabled ? 'text-white/30' : 'text-white'} />
      : <ChevronsRight size={22} className={disabled ? 'text-white/30' : 'text-white'} />
    }
  </button>
))

interface PlayerControlsProps {
  // Visibility
  showControls: boolean
  isPlaying: boolean

  // Item info
  item: BaseItemDto
  currentChapter: Chapter | null
  currentChapterIndex: number

  // Playback state
  currentTime: number
  duration: number
  bufferedPercent: number
  volume: number
  isMuted: boolean
  isFullscreen: boolean
  isPictureInPicture: boolean
  isPlayingLocally: boolean
  isOffline: boolean

  // Track state
  audioTracks: MediaStream[]
  subtitleTracks: MediaStream[]
  selectedAudioIndex: number | null
  selectedSubtitleIndex: number
  showStats: boolean

  // Seek settings
  seekBackSeconds: number
  seekForwardSeconds: number

  // Chapters
  chapters: Chapter[]

  // Episode queue
  previousEpisode: BaseItemDto | null
  nextEpisode: BaseItemDto | null
  hasOnPlayNext: boolean
  episodeQueue: BaseItemDto[]
  currentEpisodeIndex: number

  // Trickplay
  trickplayInfo: TrickplayInfo | null
  serverUrl: string | null
  accessToken: string | null

  // Video ref
  videoRef: React.RefObject<HTMLVideoElement | null>

  // Callbacks
  onClose: () => void
  onTogglePlay: () => void
  onSeekBack: () => void
  onSeekForward: () => void
  onPrevChapter: () => void
  onNextChapter: () => void
  onPlayPrevious: () => void
  onPlayNext: () => void
  onToggleFullscreen: () => void
  onTogglePiP: () => void
  onVolumeChange: (v: number) => void
  onToggleMute: () => void
  onAudioTrackChange: (index: number) => void
  onSubtitleTrackChange: (index: number) => void
  onToggleCaptions: () => void
  onToggleStats: () => void
  onPlayEpisode: (episode: BaseItemDto) => void
  onChapterSelect: (chapter: Chapter) => void
  onVideoAreaClick: (e: React.MouseEvent) => void
  /** Phone only: lock the player (all touch input frozen until unlocked) */
  onLock?: () => void
}

const PlayerControls: React.FC<PlayerControlsProps> = ({
  showControls,
  isPlaying,
  item,
  currentChapter,
  currentChapterIndex,
  currentTime,
  duration,
  bufferedPercent,
  volume,
  isMuted,
  isFullscreen,
  isPictureInPicture,
  isPlayingLocally,
  isOffline,
  audioTracks,
  subtitleTracks,
  selectedAudioIndex,
  selectedSubtitleIndex,
  showStats,
  seekBackSeconds,
  seekForwardSeconds,
  chapters,
  previousEpisode,
  nextEpisode,
  hasOnPlayNext,
  episodeQueue,
  currentEpisodeIndex,
  trickplayInfo,
  serverUrl,
  accessToken,
  videoRef,
  onClose,
  onTogglePlay,
  onSeekBack,
  onSeekForward,
  onPrevChapter,
  onNextChapter,
  onPlayPrevious,
  onPlayNext,
  onToggleFullscreen,
  onTogglePiP,
  onVolumeChange,
  onToggleMute,
  onAudioTrackChange,
  onSubtitleTrackChange,
  onToggleCaptions,
  onToggleStats,
  onPlayEpisode,
  onChapterSelect,
  onVideoAreaClick,
  onLock,
}) => {
  const [showSettingsMenu, setShowSettingsMenu] = useState(false)
  const [showQueuePanel, setShowQueuePanel] = useState(false)
  const [showChapterList, setShowChapterList] = useState(false)

  const visible = showControls || !isPlaying

  const handleCloseSettings = useCallback(() => setShowSettingsMenu(false), [])
  const handleCloseQueue = useCallback(() => setShowQueuePanel(false), [])
  const handleCloseChapters = useCallback(() => setShowChapterList(false), [])

  // The settings menu always has content now (sleep timer); audio/subtitle
  // track selects are gated inside the menu itself.
  const hasSettingsContent = true

  return (
    <>
      {/* Main controls overlay */}
      <motion.div
        className={`absolute inset-0 flex flex-col justify-between ${visible ? '' : 'pointer-events-none'}`}
        style={{
          zIndex: 2,
          background: visible
            ? 'linear-gradient(to bottom, rgba(0,0,0,0.8) 0%, rgba(0,0,0,0) 25%, rgba(0,0,0,0) 75%, rgba(0,0,0,0.9) 100%)'
            : 'transparent',
          // Phone: tighter padding + keep controls clear of the notch / home indicator
          padding: IS_PHONE
            ? 'calc(0.75em + env(safe-area-inset-top, 0px)) calc(1em + env(safe-area-inset-right, 0px)) calc(0.75em + env(safe-area-inset-bottom, 0px)) calc(1em + env(safe-area-inset-left, 0px))'
            : '2em 3em',
        }}
        initial={{ opacity: 0 }}
        animate={{ opacity: visible ? 1 : 0 }}
        transition={{ duration: 0.3 }}
        onClick={onVideoAreaClick}
      >
        {/* Header Row */}
        <div className="flex items-center justify-between" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={onClose}
            className="p-2.5 hover:bg-white/10 rounded-full transition-all duration-200"
          >
            <ArrowLeft size={24} className="text-white" />
          </button>
          <div className="flex items-center gap-2">
            {isPlayingLocally && (
              <span className="px-2.5 py-1 bg-green-500/80 rounded-full text-xs font-semibold text-white uppercase tracking-wide">
                Offline
              </span>
            )}
            {isOffline && !isPlayingLocally && (
              <span className="px-2.5 py-1 bg-red-500/80 rounded-full text-xs font-semibold text-white flex items-center gap-1.5 uppercase tracking-wide">
                <WifiOff size={12} />
                No Connection
              </span>
            )}
            <SleepTimerChip target="video" onClick={() => setShowSettingsMenu(true)} />
            {hasSettingsContent && (
              <button
                onClick={() => setShowSettingsMenu(!showSettingsMenu)}
                className={`p-2.5 hover:bg-white/10 rounded-full transition-all duration-200 ${showSettingsMenu ? 'bg-white/20' : ''}`}
              >
                <Settings size={24} className="text-white" />
              </button>
            )}
          </div>
        </div>

        {/* Bottom Section - Title + Controls (Blink layout: big series/movie
            title, "S2:E10 Episode Name" subtitle, bar, times, button row) */}
        <div className="flex flex-col gap-3" onClick={(e) => e.stopPropagation()}>
          {/* Title & Episode Info */}
          <div>
            <h1 className="text-white text-[2.5rem] phone:text-xl leading-tight font-semibold tracking-tight">
              {item.SeriesName || item.Name}
            </h1>
            {item.SeriesName && (
              <p className="text-white/90 text-lg font-normal mt-2">
                S{item.ParentIndexNumber}:E{item.IndexNumber} {item.Name}
              </p>
            )}
            {currentChapter && (
              <p className="text-theme-400/80 text-sm font-medium mt-1">
                {currentChapter.Name || `Chapter ${currentChapterIndex + 1}`}
              </p>
            )}
          </div>

          {/* Controls Section */}
          <div className="flex flex-col gap-2">
            {/* Progress Bar */}
            <ProgressSlider
              currentTime={currentTime}
              duration={duration}
              bufferedPercent={bufferedPercent}
              chapters={chapters}
              trickplayInfo={trickplayInfo}
              serverUrl={serverUrl}
              accessToken={accessToken}
              itemId={item.Id}
              videoRef={videoRef}
            />

            {/* Control Buttons Row */}
            <div className="flex items-center justify-between">
              {/* Left Controls - Blink order: PrevEp, SeekBack, PrevChapter, Play, NextChapter, SeekForward, NextEp, EndsAt */}
              <div className="flex items-center gap-2">
                <PrevEpisodeButton
                  previousEpisode={previousEpisode}
                  onPlayPrevious={onPlayPrevious}
                  hasPlayNext={hasOnPlayNext}
                />
                <SeekBackButton
                  seconds={seekBackSeconds}
                  onSeek={onSeekBack}
                />
                {chapters.length > 0 && (
                  <ChapterNavButton
                    direction="prev"
                    disabled={currentChapterIndex <= 0}
                    onClick={onPrevChapter}
                  />
                )}
                <PlayPauseButton isPlaying={isPlaying} onToggle={onTogglePlay} />
                {chapters.length > 0 && (
                  <ChapterNavButton
                    direction="next"
                    disabled={currentChapterIndex >= chapters.length - 1}
                    onClick={onNextChapter}
                  />
                )}
                <SeekForwardButton
                  seconds={seekForwardSeconds}
                  onSeek={onSeekForward}
                />
                <NextEpisodeButton
                  nextEpisode={nextEpisode}
                  onPlayNext={onPlayNext}
                  hasPlayNext={hasOnPlayNext}
                />
                <EndsAtDisplay duration={duration} currentTime={currentTime} />
              </div>

              {/* Right Controls */}
              <div className="flex items-center gap-2" onMouseLeave={() => {}}>
                <VolumeControl
                  volume={volume}
                  isMuted={isMuted}
                  onVolumeChange={onVolumeChange}
                  onToggleMute={onToggleMute}
                />
                {episodeQueue.length > 1 && (
                  <button
                    onClick={() => setShowQueuePanel(prev => !prev)}
                    className={`p-2.5 hover:bg-white/10 rounded-full transition-all duration-200 ${showQueuePanel ? 'bg-white/20' : ''}`}
                    title="Episode Queue"
                  >
                    <ListVideo size={22} className="text-white" />
                  </button>
                )}
                {chapters.length > 0 && (
                  <div className="relative">
                    <button
                      onClick={() => setShowChapterList(prev => !prev)}
                      className={`p-2.5 hover:bg-white/10 rounded-full transition-all duration-200 ${showChapterList ? 'bg-white/20' : ''}`}
                      title="Chapters"
                    >
                      <List size={22} className="text-white" />
                    </button>
                    <ChapterList
                      visible={showChapterList}
                      chapters={chapters}
                      currentChapterIndex={currentChapterIndex}
                      onSelect={(ch) => { onChapterSelect(ch); handleCloseChapters() }}
                      onClose={handleCloseChapters}
                    />
                  </div>
                )}
                <CaptionsButton
                  hasSubtitles={subtitleTracks.length > 0}
                  isEnabled={selectedSubtitleIndex !== -1}
                  onToggle={onToggleCaptions}
                  isPlayingLocally={isPlayingLocally}
                />
                <PictureInPictureButton
                  isActive={isPictureInPicture}
                  onToggle={onTogglePiP}
                />
                {IS_PHONE && onLock && (
                  <button
                    onClick={onLock}
                    className="p-2.5 hover:bg-white/10 rounded-full transition-all duration-200"
                    title="Lock player"
                  >
                    <Lock size={22} className="text-white" />
                  </button>
                )}
                {/* iOS: the custom player already fills the screen, and the
                    Fullscreen API on a <div> only re-opens the native iOS
                    player — so hide the button there. */}
                {!IS_IOS && (
                  <FullscreenButton
                    isFullscreen={isFullscreen}
                    onToggle={onToggleFullscreen}
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Settings Menu */}
      <SettingsMenu
        visible={showSettingsMenu}
        onClose={handleCloseSettings}
        isPlayingLocally={isPlayingLocally}
        endOfItemLabel={item.SeriesName ? 'episode' : 'movie'}
        audioTracks={audioTracks}
        subtitleTracks={subtitleTracks}
        selectedAudioIndex={selectedAudioIndex}
        selectedSubtitleIndex={selectedSubtitleIndex}
        onAudioTrackChange={onAudioTrackChange}
        onSubtitleTrackChange={onSubtitleTrackChange}
        showStats={showStats}
        onToggleStats={onToggleStats}
      />

      {/* Queue Panel */}
      {showQueuePanel && (
        <div onClick={(e) => e.stopPropagation()}>
          <QueuePanel
            visible={showQueuePanel}
            episodeQueue={episodeQueue}
            currentItemId={item.Id}
            currentEpisodeIndex={currentEpisodeIndex}
            serverUrl={serverUrl}
            onPlayEpisode={onPlayEpisode}
            onClose={handleCloseQueue}
          />
        </div>
      )}
    </>
  )
}

export default React.memo(PlayerControls)
