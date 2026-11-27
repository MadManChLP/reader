import { getItem, setItem } from '../../utils/storage'
import type { BookAnnotations } from './types'

const KEY_PREFIX = 'pdf_annotations_'

let saveTimer: ReturnType<typeof setTimeout> | null = null
let pendingData: BookAnnotations | null = null

export async function loadAnnotations(bookId: string): Promise<BookAnnotations> {
  const key = KEY_PREFIX + bookId
  const raw = await getItem(key)
  if (raw) {
    try {
      return JSON.parse(raw)
    } catch {
      // corrupted data
    }
  }
  return {
    version: 1,
    bookId,
    pages: {},
    lastModified: Date.now(),
  }
}

export function saveAnnotationsDebounced(data: BookAnnotations): void {
  pendingData = data
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    flushAnnotations()
  }, 1500)
}

export async function flushAnnotations(): Promise<void> {
  if (!pendingData) return
  const data = pendingData
  pendingData = null
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  const key = KEY_PREFIX + data.bookId
  await setItem(key, JSON.stringify(data))
}
