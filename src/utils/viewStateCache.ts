// Session-scoped caches that let list/grid views survive unmount/remount when
// the user drills into a details page and comes back: the items are restored
// instantly (no refetch) and the scroll position is put back where it was.
//
// Entries live in memory for the app session only. Each grid entry stores a
// `sig` (query signature: sort, search, filters…) so a view can tell whether
// the cached items still match its current query — on mismatch it refetches.

interface GridStateEntry {
  sig: string
  data: unknown
}

const gridStates = new Map<string, GridStateEntry>()
const scrollPositions = new Map<string, number>()

export function loadGridState<T>(key: string): { sig: string; data: T } | undefined {
  const entry = gridStates.get(key)
  return entry ? { sig: entry.sig, data: entry.data as T } : undefined
}

export function saveGridState<T>(key: string, sig: string, data: T): void {
  gridStates.set(key, { sig, data })
}

// Drop cached grid items so remounted views refetch. With a prefix only the
// matching entries are cleared (per-tab refresh); without it everything goes.
export function clearGridStates(prefix?: string): void {
  if (!prefix) {
    gridStates.clear()
    return
  }
  for (const key of Array.from(gridStates.keys())) {
    if (key.startsWith(prefix)) gridStates.delete(key)
  }
}

export function getScrollPos(key: string): number {
  return scrollPositions.get(key) ?? 0
}

export function setScrollPos(key: string, pos: number): void {
  scrollPositions.set(key, pos)
}
