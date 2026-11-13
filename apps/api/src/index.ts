import { Hono, type Context } from 'hono'
import { guard, sessionOf } from './guard'

type AppEnv = { Bindings: { DB?: D1Database }; Variables: { session: string } }

const app = new Hono<AppEnv>()

app.use('*', guard({ tables: ['incidents', 'actions', 'events', 'services'] }))
app.use('*', async (c, next) => {
  const start = Date.now()
  await next()
  console.log(`${c.req.method} ${c.req.path} ${c.res.status} ${Date.now() - start}ms`)
})

async function parseBody(c: Context): Promise<any> {
  try {
    const body = await c.req.raw.json()
    if (typeof body === 'object' && body !== null && !Array.isArray(body)) return body
    return {}
  } catch (e) { return {} }
}

app.get('/api/health', (c) => {
  return c.json({ status: 'ok', mode: 'cloudflare', utc: new Date().toISOString() })
})

app.get('/api/services', async (c) => {
  try {
    if (c.env.DB) {
      const result = await c.env.DB.prepare(`SELECT * FROM services`).all()
      return c.json(result.results || [])
    }
  } catch (e) { console.error('D1 error:', e) }
  return c.json([])
})

app.get('/api/services/:id', async (c) => {
  try {
    if (c.env.DB) {
      const svc = await c.env.DB.prepare(`SELECT * FROM services WHERE id=?`).bind(c.req.param('id')).first() as any
      if (svc) return c.json(svc)
    }
  } catch (e) { console.error('D1 error:', e) }
  return c.json({ error: 'service not found' }, 404)
})

app.post('/api/events', async (c) => {
  const body = await parseBody(c) as { service_id?: string; run_id?: string }
  const { service_id, run_id } = body
  if (!service_id) return c.json({ error: 'service_id required' }, 400)
  const now = new Date().toISOString()
  try {
    if (c.env.DB) {
      await c.env.DB.prepare(
        `INSERT OR REPLACE INTO services (id, name, expected_interval_s, last_seen_utc, last_success_utc, state, demo) VALUES (?,?,?,?,?,?,?)`
      ).bind(service_id, service_id.replace('svc-', ''), 30, now, now, 'healthy', 1).run()
      await c.env.DB.prepare(
        `INSERT INTO events (id, service_id, run_id, event_utc, type, duration_ms, session_id) VALUES (?,?,?,?,?,?,?)`
      ).bind(`evt:${crypto.randomUUID()}`, service_id, run_id, now, 'heartbeat', null, sessionOf(c)).run()
    }
  } catch (e) { console.error('D1 error:', e) }
  return c.json({ ok: true, service: { id: service_id, state: 'healthy' } })
})

app.post('/api/events/failure', async (c) => {
  const body = await parseBody(c) as { service_id?: string; run_id?: string; duration_ms?: number }
  const { service_id, run_id, duration_ms } = body
  if (!service_id) return c.json({ error: 'service_id required' }, 400)
  const now = new Date().toISOString()
  try {
    if (c.env.DB) {
      await c.env.DB.prepare(
        `INSERT INTO events (id, service_id, run_id, event_utc, type, duration_ms, session_id) VALUES (?,?,?,?,?,?,?)`
      ).bind(`evt:${crypto.randomUUID()}`, service_id, run_id, now, 'failure', duration_ms, sessionOf(c)).run()
      const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString()
      const row = await c.env.DB.prepare(
        `SELECT COUNT(*) AS c FROM events WHERE service_id=? AND type='failure' AND event_utc > ? AND session_id=?`
      ).bind(service_id, cutoff, sessionOf(c)).first() as { c: number }
      if (row && row.c >= 3) {
        const existing = await c.env.DB.prepare(
          `SELECT 1 FROM incidents WHERE service_id=? AND rule=? AND status='open' AND session_id=? LIMIT 1`
        ).bind(service_id, 'burst-failure', sessionOf(c)).first()
        if (!existing) {
          await c.env.DB.prepare(
            `INSERT INTO incidents (id, service_id, rule, severity, first_seen_utc, status, session_id) VALUES (?,?,?,?,?,'open',?)`
          ).bind(`inc:${crypto.randomUUID()}`, service_id, 'burst-failure', 'high', now, sessionOf(c)).run()
        }
      }
    }
  } catch (e) { console.error('D1 error:', e) }
  return c.json({ ok: true, service: { id: service_id, state: 'healthy' } })
})

app.get('/api/incidents', async (c) => {
  try {
    if (c.env.DB) {
      const result = await c.env.DB.prepare(`SELECT * FROM incidents WHERE session_id=? ORDER BY first_seen_utc DESC LIMIT 50`).bind(sessionOf(c)).all()
      return c.json(result.results || [])
    }
  } catch (e) { console.error('D1 error:', e) }
  return c.json([])
})

app.post('/api/incidents/:id/ack', async (c) => {
  const body = await parseBody(c) as { actor?: string }
  const { actor } = body
  if (!actor) return c.json({ error: 'actor required' }, 400)
  const id = c.req.param('id')
  try {
    if (c.env.DB) {
      await c.env.DB.prepare(`UPDATE incidents SET status='acknowledged' WHERE id=? AND session_id=?`).bind(id, sessionOf(c)).run()
      await c.env.DB.prepare(
        `INSERT INTO actions (id, incident_id, actor, action, approved_utc, audit_note, session_id) VALUES (?,?,?,?,?,?,?)`
      ).bind(`act:${crypto.randomUUID()}`, id, actor, 'acknowledge', new Date().toISOString(), 'Manual acknowledgment via UI', sessionOf(c)).run()
      return c.json({ ok: true, incident: { id, status: 'acknowledged' } })
    }
  } catch (e) { console.error('D1 error:', e) }
  return c.json({ ok: true, incident: { id, status: 'acknowledged' } })
})

app.post('/api/incidents/:id/resolve', async (c) => {
  const body = await parseBody(c) as { actor?: string; note?: string }
  const { actor, note } = body
  if (!actor) return c.json({ error: 'actor required' }, 400)
  const id = c.req.param('id')
  try {
    if (c.env.DB) {
      await c.env.DB.prepare(`UPDATE incidents SET status='resolved' WHERE id=? AND session_id=?`).bind(id, sessionOf(c)).run()
      await c.env.DB.prepare(
        `INSERT INTO actions (id, incident_id, actor, action, approved_utc, audit_note, session_id) VALUES (?,?,?,?,?,?,?)`
      ).bind(`act:${crypto.randomUUID()}`, id, actor, 'resolve', new Date().toISOString(), note ?? '', sessionOf(c)).run()
      return c.json({ ok: true, incident: { id, status: 'resolved' } })
    }
  } catch (e) { console.error('D1 error:', e) }
  return c.json({ ok: true, incident: { id, status: 'resolved' } })
})

app.get('/api/actions', async (c) => {
  try {
    if (c.env.DB) {
      const result = await c.env.DB.prepare(`SELECT * FROM actions WHERE session_id=? ORDER BY approved_utc DESC LIMIT 50`).bind(sessionOf(c)).all()
      return c.json(result.results || [])
    }
  } catch (e) { console.error('D1 error:', e) }
  return c.json([])
})

app.post('/api/demo/heartbeat', async (c) => {
  const body = await parseBody(c) as { service_id?: string }
  if (!body.service_id) return c.json({ error: 'service_id required' }, 400)
  try {
    if (c.env.DB) {
      const now = new Date().toISOString()
      await c.env.DB.prepare(
        `INSERT OR REPLACE INTO services (id, name, expected_interval_s, last_seen_utc, last_success_utc, state, demo) VALUES (?,?,?,?,?,?,?)`
      ).bind(body.service_id, body.service_id.replace('svc-', ''), 30, now, now, 'healthy', 1).run()
      await c.env.DB.prepare(
        `INSERT INTO events (id, service_id, run_id, event_utc, type, duration_ms, session_id) VALUES (?,?,?,?,?,?,?)`
      ).bind(`evt:${crypto.randomUUID()}`, body.service_id, `run-${Date.now()}`, now, 'heartbeat', null, sessionOf(c)).run()
    }
  } catch (e) { console.error('D1 error:', e) }
  return c.json({ ok: true, service: { id: body.service_id, state: 'healthy' } })
})

app.post('/api/demo/stop', async (c) => {
  const body = await parseBody(c) as { service_id?: string }
  if (!body.service_id) return c.json({ error: 'service_id required' }, 400)
  try {
    if (c.env.DB) {
      await c.env.DB.prepare(`UPDATE services SET state='warning' WHERE id=?`).bind(body.service_id).run()
    }
  } catch (e) { console.error('D1 error:', e) }
  return c.json({ ok: true, service: { id: body.service_id, state: 'warning' } })
})

app.post('/api/demo/failure', async (c) => {
  const body = await parseBody(c) as { service_id?: string }
  if (!body.service_id) return c.json({ error: 'service_id required' }, 400)
  try {
    if (c.env.DB) {
      const now = new Date().toISOString()
      await c.env.DB.prepare(
        `INSERT INTO events (id, service_id, run_id, event_utc, type, duration_ms, session_id) VALUES (?,?,?,?,?,?,?)`
      ).bind(`evt:${crypto.randomUUID()}`, body.service_id, `run-${Date.now()}`, now, 'failure', null, sessionOf(c)).run()
      // Burst detection: >=3 failures inside 10 minutes opens exactly one incident.
      const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString()
      const row = await c.env.DB.prepare(
        `SELECT COUNT(*) AS c FROM events WHERE service_id=? AND type='failure' AND event_utc > ? AND session_id=?`
      ).bind(body.service_id, cutoff, sessionOf(c)).first() as { c: number } | null
      if (row && row.c >= 3) {
        const existing = await c.env.DB.prepare(
          `SELECT 1 FROM incidents WHERE service_id=? AND rule=? AND status='open' AND session_id=? LIMIT 1`
        ).bind(body.service_id, 'burst-failure', sessionOf(c)).first()
        if (!existing) {
          await c.env.DB.prepare(
            `INSERT INTO incidents (id, service_id, rule, severity, first_seen_utc, status, session_id) VALUES (?,?,?,?,?,'open',?)`
          ).bind(`inc:${crypto.randomUUID()}`, body.service_id, 'burst-failure', 'high', now, sessionOf(c)).run()
        }
      }
    }
  } catch (e) { console.error('D1 error:', e) }
  return c.json({ ok: true, service: { id: body.service_id, state: 'healthy' } })
})

app.onError((err, c) => {
  console.error(err)
  return c.json({ error: 'internal server error' }, 500)
})

app.notFound((c) => {
  return c.json({ error: 'not found' }, 404)
})

export default app
