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
  viewMode: 'single' | 'double'
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
  manga: { readingDirection: 'ltr', viewMode: 'single' },
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
