// Rolling in-memory capture of console output + uncaught errors.
//
// Installed once at startup (main.tsx) BEFORE React mounts, so it captures logs
// in production builds too — this powers the "Generate Debug Report" button in
// Troubleshooting. Nothing here touches the network or persists to disk; it is a
// bounded ring buffer that lives for the app session only.

export interface LogEntry {
  t: number
  level: 'log' | 'info' | 'warn' | 'error' | 'debug'
  msg: string
}

// Keep the buffer bounded so a long-running session can't grow memory without
// limit. 800 lines is plenty of recent context for a bug report.
const MAX_ENTRIES = 800
const buffer: LogEntry[] = []
let installed = false

// Best-effort stringify of a single console argument.
function stringifyArg(a: unknown): string {
  if (typeof a === 'string') return a
  if (a instanceof Error) return a.stack || `${a.name}: ${a.message}`
  if (a === undefined) return 'undefined'
  if (a === null) return 'null'
  try {
    return JSON.stringify(a)
  } catch {
    return String(a)
  }
}

function push(level: LogEntry['level'], args: unknown[]) {
  try {
    buffer.push({ t: Date.now(), level, msg: args.map(stringifyArg).join(' ') })
    // Trim from the front once we exceed the cap (keeps the newest entries).
    if (buffer.length > MAX_ENTRIES) buffer.splice(0, buffer.length - MAX_ENTRIES)
  } catch {
    // Never let logging capture throw into the app.
  }
}

/**
 * Patch the console methods to tee into the ring buffer and hook global error
 * events. Idempotent — safe to call more than once. Call as early as possible.
 */
export function installDebugCapture(): void {
  if (installed) return
  installed = true

  const levels: LogEntry['level'][] = ['log', 'info', 'warn', 'error', 'debug']
  for (const level of levels) {
    const original = console[level] ? console[level].bind(console) : console.log.bind(console)
    console[level] = (...args: unknown[]) => {
      push(level, args)
      original(...args)
    }
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('error', (e) => {
      const where = e.filename ? ` @ ${e.filename}:${e.lineno}:${e.colno}` : ''
      push('error', [`[uncaught] ${e.message}${where}`])
    })
    window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
      push('error', ['[unhandledrejection]', e?.reason])
    })
  }
}

/** Snapshot of the captured log lines (oldest → newest). */
export function getCapturedLogs(): LogEntry[] {
  return buffer.slice()
}

/** Clear the buffer (used after a report is generated, if desired). */
export function clearCapturedLogs(): void {
  buffer.length = 0
}

/** Render entries as plain text lines with HH:MM:SS timestamps. */
export function formatLogs(entries: LogEntry[]): string {
  return entries
    .map((e) => `[${new Date(e.t).toISOString().slice(11, 19)}] ${e.level.toUpperCase().padEnd(5)} ${e.msg}`)
    .join('\n')
}
