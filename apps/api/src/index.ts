import { Hono } from 'hono'
import { cors } from 'hono/cors'

const app = new Hono<{ Bindings: { DB: D1Database } }>()

app.use('*', cors())
app.use('*', async (c, next) => {
  const start = Date.now()
  await next()
  console.log(`${c.req.method} ${c.req.path} ${c.res.status} ${Date.now() - start}ms`)
})

async function parseBody(c: any): Promise<any> {
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
  return c.status(404).json({ error: 'service not found' })
})

app.post('/api/events', async (c) => {
  const body = await parseBody(c) as { service_id?: string; run_id?: string }
  const { service_id, run_id } = body
  const now = new Date().toISOString()
  try {
    if (c.env.DB) {
      await c.env.DB.prepare(
        `INSERT OR REPLACE INTO services (id, name, expected_interval_s, last_seen_utc, last_success_utc, state, demo) VALUES (?,?,?,?,?,?,?)`
      ).bind(service_id, service_id.replace('svc-', ''), 30, now, now, 'healthy', 1).run()
      await c.env.DB.prepare(
        `INSERT INTO events (id, service_id, run_id, event_utc, type, duration_ms) VALUES (?,?,?,?,?,?)`
      ).bind(`evt:${crypto.randomUUID()}`, service_id, run_id, now, 'heartbeat', null).run()
    }
  } catch (e) { console.error('D1 error:', e) }
  return c.json({ ok: true, service: { id: service_id, state: 'healthy' } })
})

app.post('/api/events/failure', async (c) => {
  const body = await parseBody(c) as { service_id?: string; run_id?: string; duration_ms?: number }
  const { service_id, run_id, duration_ms } = body
  const now = new Date().toISOString()
  try {
    if (c.env.DB) {
      await c.env.DB.prepare(
        `INSERT INTO events (id, service_id, run_id, event_utc, type, duration_ms) VALUES (?,?,?,?,?,?)`
      ).bind(`evt:${crypto.randomUUID()}`, service_id, run_id, now, 'failure', duration_ms).run()
      const cutoff = new Date(now.getTime() - 10 * 60 * 1000).toISOString()
      const row = await c.env.DB.prepare(
        `SELECT COUNT(*) AS c FROM events WHERE service_id=? AND type='failure' AND event_utc > ?`
      ).bind(service_id, cutoff).first() as { c: number }
      if (row && row.c >= 3) {
        const existing = await c.env.DB.prepare(
          `SELECT 1 FROM incidents WHERE service_id=? AND rule=? AND status='open' LIMIT 1`
        ).bind(service_id, 'burst-failure').first()
        if (!existing) {
          await c.env.DB.prepare(
            `INSERT INTO incidents (id, service_id, rule, severity, first_seen_utc, status) VALUES (?,?,?,?,?,'open')`
          ).bind(`inc:${crypto.randomUUID()}`, service_id, 'burst-failure', 'high', now).run()
        }
      }
    }
  } catch (e) { console.error('D1 error:', e) }
  return c.json({ ok: true, service: { id: service_id, state: 'healthy' } })
})

app.get('/api/incidents', async (c) => {
  try {
    if (c.env.DB) {
      const result = await c.env.DB.prepare(`SELECT * FROM incidents ORDER BY first_seen_utc DESC LIMIT 50`).all()
      return c.json(result.results || [])
    }
  } catch (e) { console.error('D1 error:', e) }
  return c.json([])
})

app.post('/api/incidents/:id/ack', async (c) => {
  const body = await parseBody(c) as { actor?: string }
  const { actor } = body
  if (!actor) return c.status(400).json({ error: 'actor required' })
  const id = c.req.param('id')
  try {
    if (c.env.DB) {
      await c.env.DB.prepare(`UPDATE incidents SET status='acknowledged' WHERE id=?`).bind(id).run()
      await c.env.DB.prepare(
        `INSERT INTO actions (id, incident_id, actor, action, approved_utc, audit_note) VALUES (?,?,?,?,?,?)`
      ).bind(`act:${crypto.randomUUID()}`, id, actor, 'acknowledge', new Date().toISOString(), 'Manual acknowledgment via UI').run()
      return c.json({ ok: true, incident: { id, status: 'acknowledged' } })
    }
  } catch (e) { console.error('D1 error:', e) }
  return c.json({ ok: true, incident: { id, status: 'acknowledged' } })
})

app.post('/api/incidents/:id/resolve', async (c) => {
  const body = await parseBody(c) as { actor?: string; note?: string }
  const { actor, note } = body
  if (!actor) return c.status(400).json({ error: 'actor required' })
  const id = c.req.param('id')
  try {
    if (c.env.DB) {
      await c.env.DB.prepare(`UPDATE incidents SET status='resolved' WHERE id=?`).bind(id).run()
      await c.env.DB.prepare(
        `INSERT INTO actions (id, incident_id, actor, action, approved_utc, audit_note) VALUES (?,?,?,?,?,?)`
      ).bind(`act:${crypto.randomUUID()}`, id, actor, 'resolve', new Date().toISOString(), note ?? '').run()
      return c.json({ ok: true, incident: { id, status: 'resolved' } })
    }
  } catch (e) { console.error('D1 error:', e) }
  return c.json({ ok: true, incident: { id, status: 'resolved' } })
})

app.get('/api/actions', async (c) => {
  try {
    if (c.env.DB) {
      const result = await c.env.DB.prepare(`SELECT * FROM actions ORDER BY approved_utc DESC LIMIT 50`).all()
      return c.json(result.results || [])
    }
  } catch (e) { console.error('D1 error:', e) }
  return c.json([])
})

app.post('/api/demo/heartbeat', async (c) => {
  const body = await parseBody(c) as { service_id?: string }
  if (!body.service_id) return c.status(400).json({ error: 'service_id required' })
  try {
    if (c.env.DB) {
      const now = new Date().toISOString()
      await c.env.DB.prepare(
        `INSERT OR REPLACE INTO services (id, name, expected_interval_s, last_seen_utc, last_success_utc, state, demo) VALUES (?,?,?,?,?,?,?)`
      ).bind(body.service_id, body.service_id.replace('svc-', ''), 30, now, now, 'healthy', 1).run()
      await c.env.DB.prepare(
        `INSERT INTO events (id, service_id, run_id, event_utc, type, duration_ms) VALUES (?,?,?,?,?,?)`
      ).bind(`evt:${crypto.randomUUID()}`, body.service_id, `run-${Date.now()}`, now, 'heartbeat', null).run()
    }
  } catch (e) { console.error('D1 error:', e) }
  return c.json({ ok: true, service: { id: body.service_id, state: 'healthy' } })
})

app.post('/api/demo/stop', async (c) => {
  const body = await parseBody(c) as { service_id?: string }
  if (!body.service_id) return c.status(400).json({ error: 'service_id required' })
  try {
    if (c.env.DB) {
      await c.env.DB.prepare(`UPDATE services SET state='warning' WHERE id=?`).bind(body.service_id).run()
    }
  } catch (e) { console.error('D1 error:', e) }
  return c.json({ ok: true, service: { id: body.service_id, state: 'warning' } })
})

app.post('/api/demo/failure', async (c) => {
  const body = await parseBody(c) as { service_id?: string }
  if (!body.service_id) return c.status(400).json({ error: 'service_id required' })
  try {
    if (c.env.DB) {
      await c.env.DB.prepare(
        `INSERT INTO events (id, service_id, run_id, event_utc, type, duration_ms) VALUES (?,?,?,?,?,?)`
      ).bind(`evt:${crypto.randomUUID()}`, body.service_id, `run-${Date.now()}`, new Date().toISOString(), 'failure', null).run()
    }
  } catch (e) { console.error('D1 error:', e) }
  return c.json({ ok: true, service: { id: body.service_id, state: 'healthy' } })
})

app.onError((err, c) => {
  console.error(err)
  return c.status(500).json({ error: 'internal server error' })
})

app.notFound((c) => {
  return c.status(404).json({ error: 'not found' })
})

export default app
