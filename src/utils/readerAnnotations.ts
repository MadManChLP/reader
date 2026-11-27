// Local reader annotations: EPUB text highlights (with notes) and page
// bookmarks for PDF/manga. Per book, in IndexedDB (via ./storage).
//
// EPUB named bookmarks keep their own store (syncServerApi.getLocalBookmarks);
// page bookmarks use the same EpubBookmark shape with cfi = "page:N" so one
// list can show both.
//
// Server sync is not implemented (the Sync API has no annotation endpoints
// yet) — see the roadmap.

import { getItem, setItem } from './storage'
import type { EpubBookmark } from './syncServerApi'

export type HighlightColor = 'yellow' | 'green' | 'blue' | 'pink'

export const HIGHLIGHT_COLORS: Record<HighlightColor, string> = {
  yellow: '#facc15',
  green: '#4ade80',
  blue: '#60a5fa',
  pink: '#f472b6',
}

export interface Highlight {
  id: string
  /** epubcfi range of the highlighted text */
  cfiRange: string
  text: string
  color: HighlightColor
  note?: string
  /** Chapter label at the time of highlighting (for the list / export) */
  chapter?: string
  createdAt: number
  updatedAt: number
}

const HL_KEY = (bookId: string) => `epub_highlights_${bookId}`

export async function getHighlights(bookId: string): Promise<Highlight[]> {
  try {
    const raw = await getItem(HL_KEY(bookId))
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

async function saveHighlights(bookId: string, list: Highlight[]): Promise<void> {
  await setItem(HL_KEY(bookId), JSON.stringify(list))
}

export async function addHighlight(
  bookId: string,
  h: Omit<Highlight, 'id' | 'createdAt' | 'updatedAt'>,
): Promise<Highlight> {
  const list = await getHighlights(bookId)
  const now = Date.now()
  const created: Highlight = { ...h, id: crypto.randomUUID(), createdAt: now, updatedAt: now }
  list.push(created)
  await saveHighlights(bookId, list)
  return created
}

export async function updateHighlight(bookId: string, id: string, patch: Partial<Pick<Highlight, 'color' | 'note'>>): Promise<Highlight[]> {
  const list = await getHighlights(bookId)
  const next = list.map(h => (h.id === id ? { ...h, ...patch, updatedAt: Date.now() } : h))
  await saveHighlights(bookId, next)
  return next
}

export async function deleteHighlight(bookId: string, id: string): Promise<Highlight[]> {
  const next = (await getHighlights(bookId)).filter(h => h.id !== id)
  await saveHighlights(bookId, next)
  return next
}

// ── Page bookmarks (PDF / manga) ────────────────────────────────────────────

export function pageBookmarkCfi(page: number): string {
  return `page:${page}`
}

/** Page number of a page bookmark, or null for EPUB (CFI) bookmarks. */
export function bookmarkPage(bm: EpubBookmark): number | null {
  const m = /^page:(\d+)$/.exec(bm.cfi)
  return m ? parseInt(m[1], 10) : null
}

// ── Export ──────────────────────────────────────────────────────────────────

export function annotationsToMarkdown(
  title: string,
  author: string | undefined,
  bookmarks: EpubBookmark[],
  highlights: Highlight[],
): string {
  const lines: string[] = [`# ${title}`]
  if (author) lines.push(`*${author}*`)
  lines.push('', `Exported ${new Date().toLocaleString()}`, '')

  if (highlights.length > 0) {
    lines.push('## Highlights', '')
    let lastChapter: string | undefined
    for (const h of [...highlights].sort((a, b) => a.createdAt - b.createdAt)) {
      if (h.chapter && h.chapter !== lastChapter) {
        lines.push(`### ${h.chapter}`, '')
        lastChapter = h.chapter
      }
      lines.push(`> ${h.text.replace(/\s+/g, ' ').trim()}`)
      if (h.note) lines.push('', h.note)
      lines.push('')
    }
  }

  if (bookmarks.length > 0) {
    lines.push('## Bookmarks', '')
    for (const b of bookmarks) {
      const page = bookmarkPage(b)
      lines.push(`- ${b.name}${page ? ` (page ${page})` : ''}`)
    }
    lines.push('')
  }
  return lines.join('\n')
}
