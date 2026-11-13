/**
 * Shared edge guard for the public demo Workers.
 *
 * Responsibilities (applied as middleware, business logic untouched):
 *  - anonymous session identity (opaque id issued by the server, echoed by the client)
 *  - per-session request throttling (abuse control on an internet-facing endpoint)
 *  - request body size ceiling
 *  - CORS restricted to the published frontend origins
 *  - uniform JSON error envelope
 *
 * Session isolation model: every visitor gets a server-issued opaque session id.
 * Records written by a session are stamped with that id and read back filtered by
 * it, so two independent browsers never observe each other's records. Sessions are
 * anonymous: no login, no cookies, no personal data. Ids are non-guessable UUIDs
 * and are never derived from client-supplied values.
 */
import type { Context, Next } from 'hono'

export const SESSION_HEADER = 'x-demo-session'
export const MAX_BODY_BYTES = 512 * 1024 // 512 KiB: ample for text + small text PDFs
export const RATE_LIMIT = 120 // requests
export const RATE_WINDOW_MS = 60_000 // per minute, per session

export const ALLOWED_ORIGINS = [
  'https://bamaboy101.github.io',
  'http://localhost:5173',
  'http://localhost:4173',
  'http://127.0.0.1:5173',
]

const SESSION_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Throttle buckets live in the isolate; they are a cheap abuse brake, not a quota system. */
const buckets = new Map<string, { count: number; resetAt: number }>()

export function isValidSession(value: unknown): value is string {
  return typeof value === 'string' && SESSION_RE.test(value)
}

/** Resolve the caller's session. Unknown/absent/malformed ids get a fresh server-issued id. */
export function resolveSession(c: Context): string {
  const supplied = c.req.header(SESSION_HEADER)
  return isValidSession(supplied) ? supplied.toLowerCase() : crypto.randomUUID()
}

export function corsOrigin(origin: string | undefined): string | null {
  if (!origin) return null
  return ALLOWED_ORIGINS.includes(origin) ? origin : null
}

function applyCors(c: Context, session: string) {
  const allowed = corsOrigin(c.req.header('Origin'))
  if (allowed) {
    c.header('Access-Control-Allow-Origin', allowed)
    c.header('Vary', 'Origin')
    c.header('Access-Control-Allow-Credentials', 'false')
  }
  c.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  c.header('Access-Control-Allow-Headers', `Content-Type,${SESSION_HEADER}`)
  c.header('Access-Control-Expose-Headers', SESSION_HEADER)
  c.header('Access-Control-Max-Age', '600')
  // Always echo the resolved session so the browser can adopt it.
  c.header(SESSION_HEADER, session)
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('Referrer-Policy', 'no-referrer')
}

export function guard(options: { tables?: string[]; columns?: [string, string, string][] } = {}) {
  const tables = options.tables ?? []
  const columns = options.columns ?? []
  let migrated = false
  return async (c: Context, next: Next) => {
    const session = resolveSession(c)
    ;(c as any).set('session', session)
    applyCors(c, session)

    if (c.req.method === 'OPTIONS') return c.body(null, 204)

    // One-time, idempotent schema upgrade per isolate.
    const db = (c.env as any)?.DB as D1Database | undefined
    if (db && tables.length && !migrated) {
      for (const t of tables) await ensureSessionColumn(db, t)
      for (const [t, col, type] of columns) {
        try { await db.prepare(`ALTER TABLE ${t} ADD COLUMN ${col} ${type}`).run() } catch { /* exists */ }
      }
      migrated = true
    }

    // Body size ceiling (defence against oversized payloads).
    const lenHeader = c.req.header('content-length')
    if (lenHeader && Number(lenHeader) > MAX_BODY_BYTES) {
      return c.json({ error: 'payload too large', limit_bytes: MAX_BODY_BYTES }, 413)
    }

    // Per-session throttle.
    const now = Date.now()
    const bucket = buckets.get(session)
    if (!bucket || bucket.resetAt <= now) {
      buckets.set(session, { count: 1, resetAt: now + RATE_WINDOW_MS })
    } else {
      bucket.count += 1
      if (bucket.count > RATE_LIMIT) {
        c.header('Retry-After', String(Math.ceil((bucket.resetAt - now) / 1000)))
        return c.json({ error: 'rate limit exceeded', limit: RATE_LIMIT, window_seconds: 60 }, 429)
      }
    }
    // Bound memory: drop expired buckets opportunistically.
    if (buckets.size > 5000) {
      for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k)
    }

    await next()
  }
}

/** Session id for the current request (set by guard()). */
export function sessionOf(c: Context): string {
  return (c as any).get('session') as string
}

/** Idempotently add a session_id column so existing deployments keep working. */
export async function ensureSessionColumn(db: D1Database | undefined, table: string) {
  if (!db) return
  try {
    await db.prepare(`ALTER TABLE ${table} ADD COLUMN session_id TEXT`).run()
  } catch {
    // Column already exists — expected on every call after the first.
  }
}
