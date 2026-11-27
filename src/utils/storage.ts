/**
 * Storage Module - IndexedDB with localStorage migration
 *
 * Provides async storage operations using IndexedDB for better performance.
 * Automatically migrates data from localStorage on first use.
 */

import { get, set, del, keys, createStore } from 'idb-keyval'

// Create a custom store for our app
const appStore = createStore('reader-db', 'reader-store')

// Track migration status
let migrationComplete = false
let migrationPromise: Promise<void> | null = null

// Keys that should be migrated from localStorage
const MIGRATION_KEYS = [
  'started_book_ids',
  'sync_readBooks',
  'sync_bookmarks',
  'sync_pendingChanges',
  'sync_lastSynced',
]

// Prefix for progress keys
const PROGRESS_PREFIX = 'progress_'
const BOOKMARKS_PREFIX = 'epub_bookmarks_'

/**
 * Migrate data from localStorage to IndexedDB (one-time operation)
 */
async function migrateFromLocalStorage(): Promise<void> {
  if (migrationComplete) return

  // Check if migration was already done
  const migrated = await get<boolean>('_migration_complete', appStore)
  if (migrated) {
    migrationComplete = true
    return
  }

  console.log('[Storage] Starting migration from localStorage to IndexedDB...')

  try {
    // Migrate known keys
    for (const key of MIGRATION_KEYS) {
      const value = localStorage.getItem(key)
      if (value !== null) {
        await set(key, value, appStore)
      }
    }

    // Migrate all progress_ keys
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith(PROGRESS_PREFIX) || key?.startsWith(BOOKMARKS_PREFIX) || key?.startsWith('pdf_annotations_')) {
        const value = localStorage.getItem(key)
        if (value !== null) {
          await set(key, value, appStore)
        }
      }
    }

    // Mark migration as complete
    await set('_migration_complete', true, appStore)
    migrationComplete = true

    // Clean up localStorage (optional - keep for now as backup)
    // for (const key of MIGRATION_KEYS) {
    //   localStorage.removeItem(key)
    // }

    console.log('[Storage] Migration complete')
  } catch (error) {
    console.error('[Storage] Migration failed:', error)
    // Fall back to localStorage if migration fails
  }
}

/**
 * Ensure migration is complete before any operation
 */
async function ensureMigrated(): Promise<void> {
  if (migrationComplete) return

  if (!migrationPromise) {
    migrationPromise = migrateFromLocalStorage()
  }

  await migrationPromise
}

/**
 * Get a value from storage
 */
export async function getItem(key: string): Promise<string | null> {
  await ensureMigrated()

  try {
    const value = await get<string>(key, appStore)
    return value ?? null
  } catch (error) {
    console.error('[Storage] getItem error:', error)
    // Fallback to localStorage
    return localStorage.getItem(key)
  }
}

/**
 * Set a value in storage
 */
export async function setItem(key: string, value: string): Promise<void> {
  await ensureMigrated()

  try {
    await set(key, value, appStore)
  } catch (error) {
    console.error('[Storage] setItem error:', error)
    // Fallback to localStorage
    localStorage.setItem(key, value)
  }
}

/**
 * Remove a value from storage
 */
export async function removeItem(key: string): Promise<void> {
  await ensureMigrated()

  try {
    await del(key, appStore)
  } catch (error) {
    console.error('[Storage] removeItem error:', error)
    // Fallback to localStorage
    localStorage.removeItem(key)
  }
}

/**
 * Get all keys matching a prefix
 */
export async function getKeysWithPrefix(prefix: string): Promise<string[]> {
  await ensureMigrated()

  try {
    const allKeys = await keys<string>(appStore)
    return allKeys.filter(key => key.startsWith(prefix))
  } catch (error) {
    console.error('[Storage] getKeysWithPrefix error:', error)
    // Fallback to localStorage
    const result: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith(prefix)) {
        result.push(key)
      }
    }
    return result
  }
}

/**
 * Initialize storage - call this on app startup
 */
export async function initializeStorage(): Promise<void> {
  await ensureMigrated()
}
