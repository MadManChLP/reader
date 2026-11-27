// App-wide context menu: floating menu at the pointer on desktop (right-click
// or ⋯ button), bottom sheet on phones (long-press). Implemented in the music
// folder where it started; re-exported here for the other card types.
export {
  MusicContextMenu as ContextMenu,
  useContextMenu,
  type ContextMenuItem,
} from './jellyfin/music/MusicContextMenu'
