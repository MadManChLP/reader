// PDF text layer (OCR) support — detection, search index, match highlighting.
//
// An "OCR layer" in a scanned PDF is ordinary PDF text drawn invisibly
// (text render mode 3) on top of the page image. pdf.js extracts it through
// page.getTextContent() exactly like born-digital text, and react-pdf's text
// layer positions it over the canvas — so OCR support means: render the text
// layer, make it selectable on demand, and search it.
//
// Matching is deliberately forgiving because OCR text is noisy:
//   - case-insensitive, diacritic-insensitive (same default as pdf.js find)
//   - compatibility-normalized (NFKD: "ﬁ" ligature → "fi")
//   - whitespace-insensitive: OCR engines and pdf.js disagree about where the
//     spaces between word items go, so all whitespace is ignored on both sides
//     ("hello world" finds "helloworld" and "hello\nworld").

import { create } from 'zustand'

// ── Store (shared by Reader toolbar ↔ PdfReader) ─────────────────────────────

/** 'checking' until the first pages were sampled after the document loaded. */
export type TextLayerStatus = 'checking' | 'present' | 'absent'

interface PdfTextState {
  status: TextLayerStatus
  /** Text-select mode: page-turn click zones + drag-pan pause, text is selectable. */
  selectMode: boolean
  searchOpen: boolean
  setStatus: (status: TextLayerStatus) => void
  setSelectMode: (on: boolean) => void
  setSearchOpen: (open: boolean) => void
  reset: () => void
}

export const usePdfTextStore = create<PdfTextState>((set) => ({
  status: 'checking',
  selectMode: false,
  searchOpen: false,
  setStatus: (status) => set({ status }),
  setSelectMode: (selectMode) => set({ selectMode }),
  setSearchOpen: (searchOpen) => set({ searchOpen }),
  reset: () => set({ status: 'checking', selectMode: false, searchOpen: false }),
}))

export const NO_TEXT_LAYER_MESSAGE =
  'This PDF has no text layer (image-only scan without OCR) — text can\'t be selected or searched.'
export const CHECKING_TEXT_LAYER_MESSAGE = 'Still checking this PDF for a text layer…'

// ── Page text index ──────────────────────────────────────────────────────────

export interface PageTextIndex {
  /** Raw page text: items concatenated, '\n' after items with hasEOL. */
  text: string
  /** Raw offset of each textContent item (by item index); -1 for non-text items. */
  itemStarts: number[]
  /** Normalized text used for matching (see header comment). */
  norm: string
  /** norm[i] came from raw text[normToRaw[i]]. */
  normToRaw: number[]
}

/** A match on one page, as a raw-text range [start, end). */
export interface PdfTextMatch {
  page: number
  start: number
  end: number
}

const MARKS = /\p{M}/gu
const WHITESPACE = /\s/

/** Normalize one char; may return '' (whitespace, lone mark) or several chars (ligatures). */
function normChar(c: string): string {
  if (WHITESPACE.test(c)) return ''
  return c.normalize('NFKD').replace(MARKS, '').toLowerCase()
}

export function normalizeQuery(query: string): string {
  let out = ''
  for (const c of query) out += normChar(c)
  return out
}

/** Build the index from page.getTextContent() items (same call react-pdf makes,
 *  so item indices line up with customTextRenderer's itemIndex). */
export function buildPageIndex(items: any[]): PageTextIndex {
  let text = ''
  const itemStarts: number[] = new Array(items.length)
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (!item || typeof item.str !== 'string') { itemStarts[i] = -1; continue }
    itemStarts[i] = text.length
    text += item.str
    if (item.hasEOL) text += '\n'
  }

  let norm = ''
  const normToRaw: number[] = []
  // Iterate UTF-16 code units' code points while tracking raw offsets
  let i = 0
  while (i < text.length) {
    const cp = text.codePointAt(i)!
    const c = String.fromCodePoint(cp)
    const n = normChar(c)
    for (let k = 0; k < n.length; k++) {
      norm += n[k]
      normToRaw.push(i)
    }
    i += c.length
  }
  return { text, itemStarts, norm, normToRaw }
}

/** Non-whitespace character count — used to decide whether a page has text. */
export function meaningfulLength(index: PageTextIndex): number {
  return index.norm.length
}

/** All non-overlapping occurrences of an already-normalized query on a page. */
export function findInPage(index: PageTextIndex, normQuery: string, page: number): PdfTextMatch[] {
  if (!normQuery) return []
  const out: PdfTextMatch[] = []
  let from = 0
  for (;;) {
    const at = index.norm.indexOf(normQuery, from)
    if (at === -1) break
    const lastNorm = at + normQuery.length - 1
    const start = index.normToRaw[at]
    const lastRaw = index.normToRaw[lastNorm]
    // End after the full code point of the last matched raw char
    const lastCp = index.text.codePointAt(lastRaw)!
    const end = lastRaw + (lastCp > 0xffff ? 2 : 1)
    out.push({ page, start, end })
    from = at + normQuery.length
  }
  return out
}

// ── Highlight rendering (react-pdf customTextRenderer) ───────────────────────

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;')
}

/**
 * Build a customTextRenderer for one page that wraps match ranges in <mark>.
 * Matches may span several text items; each item highlights its own slice.
 * `activeLocal` is the index (within `pageMatches`) of the current match, or -1.
 */
export function makeHighlightRenderer(
  index: PageTextIndex,
  pageMatches: PdfTextMatch[],
  activeLocal: number,
): (args: { itemIndex: number; str: string }) => string {
  return ({ itemIndex, str }) => {
    const itemStart = index.itemStarts[itemIndex]
    if (itemStart === undefined || itemStart < 0 || !str) return escapeHtml(str)
    const itemEnd = itemStart + str.length
    let html = ''
    let cursor = 0
    for (let m = 0; m < pageMatches.length; m++) {
      const match = pageMatches[m]
      if (match.end <= itemStart) continue
      if (match.start >= itemEnd) break  // matches are sorted by start
      const s = Math.max(match.start, itemStart) - itemStart
      const e = Math.min(match.end, itemEnd) - itemStart
      if (s > cursor) html += escapeHtml(str.slice(cursor, s))
      const cls = m === activeLocal ? 'pdf-hit pdf-hit-active' : 'pdf-hit'
      html += `<mark class="${cls}">${escapeHtml(str.slice(s, e))}</mark>`
      cursor = e
    }
    if (cursor < str.length) html += escapeHtml(str.slice(cursor))
    return html
  }
}
