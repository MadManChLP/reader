import type { PdfDisplayMode } from '../components/reader/types'
import type { EpubTheme, EpubFontFamily, EpubMargin } from '../components/reader/epubStyles'

// Per-reader-type display preferences, persisted locally.
// One set per engine (EPUB / PDF / Manga) — opening any book of that type
// restores the last used settings. Zoom levels are intentionally NOT saved
// (they're usually a temporary adjustment for a single page).

export interface EpubPreferences {
  fontSize: number
  theme: EpubTheme
  spreadMode: 'auto' | 'none' | 'always'
  fontFamily: EpubFontFamily
  lineHeight: number // 0 = book default, else 1.2–2.2
  margin: EpubMargin
}

export interface MangaPreferences {
  readingDirection: 'ltr' | 'rtl'
  viewMode: 'single' | 'double' | 'auto'
  /** Double mode: cover page alone */
  coverOffset: boolean
}

export interface PdfPreferences {
  displayMode: PdfDisplayMode
  // 'custom' means the user zoomed manually — that's transient, so only
  // 'page' and 'width' are ever stored here.
  fitMode: 'page' | 'width'
}

export interface ReaderPreferences {
  epub: EpubPreferences
  manga: MangaPreferences
  pdf: PdfPreferences
}

export const DEFAULT_READER_PREFERENCES: ReaderPreferences = {
  epub: { fontSize: 100, theme: 'dark', spreadMode: 'auto', fontFamily: 'default', lineHeight: 0, margin: 'normal' },
  manga: { readingDirection: 'ltr', viewMode: 'auto', coverOffset: true },
  pdf: { displayMode: 'single', fitMode: 'page' },
}

const STORAGE_KEY = 'reader-preferences'

export function loadReaderPreferences(): ReaderPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_READER_PREFERENCES
    const parsed = JSON.parse(raw)
    // Merge per section so settings saved by older builds stay valid
    return {
      epub: { ...DEFAULT_READER_PREFERENCES.epub, ...parsed.epub },
      manga: { ...DEFAULT_READER_PREFERENCES.manga, ...parsed.manga },
      pdf: { ...DEFAULT_READER_PREFERENCES.pdf, ...parsed.pdf },
    }
  } catch {
    return DEFAULT_READER_PREFERENCES
  }
}

export function saveReaderPreferences<K extends keyof ReaderPreferences>(
  section: K,
  values: Partial<ReaderPreferences[K]>,
) {
  try {
    const current = loadReaderPreferences()
    const next = { ...current, [section]: { ...current[section], ...values } }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch (e) {
    console.error('Failed to save reader preferences:', e)
  }
}

// ── Manga reading direction per book / series ─────────────────────────────
// A library mixes western comics (LTR) and manga (RTL), so one global toggle
// meant flipping it on every switch. The direction is remembered per series
// (all volumes follow) and per book; the global value is only the default
// for series never opened before.

const DIRECTION_KEY = 'reader-manga-direction'
type DirectionMap = Record<string, 'ltr' | 'rtl'>

function loadDirections(): DirectionMap {
  try { return JSON.parse(localStorage.getItem(DIRECTION_KEY) || '{}') || {} } catch { return {} }
}

export function getMangaDirection(book: { id: string; series?: string }): 'ltr' | 'rtl' {
  const map = loadDirections()
  return map[`book:${book.id}`]
    ?? (book.series ? map[`series:${book.series}`] : undefined)
    ?? loadReaderPreferences().manga.readingDirection
}

export function saveMangaDirection(book: { id: string; series?: string }, dir: 'ltr' | 'rtl') {
  try {
    const map = loadDirections()
    map[`book:${book.id}`] = dir
    if (book.series) map[`series:${book.series}`] = dir
    localStorage.setItem(DIRECTION_KEY, JSON.stringify(map))
  } catch (e) {
    console.error('Failed to save manga direction:', e)
  }
  // Also the default for the next never-seen series
  saveReaderPreferences('manga', { readingDirection: dir })
}
