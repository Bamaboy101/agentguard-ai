import express from 'express'
import cors from 'cors'

const app = express()
app.use(cors())
app.use(express.json())

app.use((req, res, next) => {
  const start = Date.now()
  res.on('finish', () => {
    console.log(`${req.method} ${req.path} ${res.statusCode} ${Date.now() - start}ms`)
  })
  next()
})

type Service = { id: string; name: string; expected_interval_s: number; last_seen_utc: string | null; last_success_utc: string | null; state: string; demo: boolean }
type Event = { id: string; service_id: string; runId: string | null; event_utc: string; type: string; duration_ms: number | null }
type Incident = { id: string; service_id: string; rule: string; severity: string; first_seen_utc: string; status: string }
type Action = { id: string; incident_id: string; actor: string; action: string; approved_utc: string; audit_note: string | null }

const services: Service[] = [
  { id: 'svc-demo-web', name: 'demo-web', expected_interval_s: 30, last_seen_utc: null, last_success_utc: null, state: 'healthy', demo: true },
  { id: 'svc-demo-worker', name: 'demo-worker', expected_interval_s: 60, last_seen_utc: null, last_success_utc: null, state: 'healthy', demo: true },
]

const events: Event[] = []
const incidents: Incident[] = []
const actions: Action[] = []

function evaluateRules() {
  const now = Date.now()
  for (const svc of services) {
    if (!svc.last_seen_utc) continue
    const lastSeen = new Date(svc.last_seen_utc).getTime()
    const ageMs = now - lastSeen
    const graceMs = svc.expected_interval_s * 1000 * 2
    if (ageMs > graceMs) {
      svc.state = 'critical'
      openIncident(svc.id, 'missed-heartbeat', 'critical')
    } else if (ageMs > svc.expected_interval_s * 1000) {
      svc.state = 'warning'
    } else {
      svc.state = 'healthy'
    }
  }
  const windowMs = 10 * 60 * 1000
  const burstThreshold = 3
  for (const svc of services) {
    const cutoff = new Date(now - windowMs).getTime()
    const failCount = events.filter(e => e.service_id === svc.id && e.type === 'failure' && new Date(e.event_utc).getTime() > cutoff).length
    if (failCount >= burstThreshold) {
      openIncident(svc.id, 'burst-failure', 'high')
    }
  }
}

function openIncident(serviceId: string, rule: string, severity: string): Incident | null {
  const existing = incidents.find(i => i.service_id === serviceId && i.rule === rule && i.status === 'open')
  if (existing) return null
  const id = `inc:${crypto.randomUUID()}`
  const inc: Incident = { id, service_id: serviceId, rule, severity, first_seen_utc: new Date().toISOString(), status: 'open' }
  incidents.push(inc)
  return inc
}

function recordAction(incidentId: string, actor: string, action: string, note: string | null): Action {
  const id = `act:${crypto.randomUUID()}`
  const act: Action = { id, incident_id: incidentId, actor, action, approved_utc: new Date().toISOString(), audit_note: note }
  actions.push(act)
  return act
}

function closeIncident(id: string) {
  const inc = incidents.find(i => i.id === id)
  if (inc) inc.status = 'resolved'
}

function getService(id: string) {
  return services.find(s => s.id === id)
}

function upsertHeartbeat(serviceId: string, runId: string | null) {
  const svc = getService(serviceId)
  if (!svc) return
  svc.last_seen_utc = new Date().toISOString()
  svc.last_success_utc = new Date().toISOString()
  svc.state = 'healthy'
  events.push({ id: `evt:${crypto.randomUUID()}`, service_id: serviceId, runId, event_utc: new Date().toISOString(), type: 'heartbeat', duration_ms: null })
  evaluateRules()
}

function recordFailure(serviceId: string, runId: string | null, durationMs: number | null) {
  const svc = getService(serviceId)
  if (!svc) return
  events.push({ id: `evt:${crypto.randomUUID()}`, service_id: serviceId, runId, event_utc: new Date().toISOString(), type: 'failure', duration_ms: durationMs })
  evaluateRules()
}

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', utc: new Date().toISOString() })
})

app.get('/api/services', (_req, res) => {
  res.json(services)
})

app.get('/api/services/:id', (req, res) => {
  const svc = getService(req.params.id)
  if (!svc) return res.status(404).json({ error: 'service not found' })
  res.json(svc)
})

app.post('/api/events', (req, res) => {
  const { service_id, runId } = req.body
  const svc = getService(service_id)
  if (!svc) return res.status(404).json({ error: 'service not found' })
  upsertHeartbeat(service_id, runId ?? null)
  evaluateRules()
  res.json({ ok: true, service: getService(service_id) })
})

app.post('/api/events/failure', (req, res) => {
  const { service_id, runId, duration_ms } = req.body
  const svc = getService(service_id)
  if (!svc) return res.status(404).json({ error: 'service not found' })
  recordFailure(service_id, runId ?? null, duration_ms ?? null)
  evaluateRules()
  res.json({ ok: true, service: getService(service_id) })
})

app.get('/api/incidents', (_req, res) => {
  res.json(incidents)
})

app.post('/api/incidents/:id/ack', (req, res) => {
  const { actor } = req.body
  if (!actor) return res.status(400).json({ error: 'actor required' })
  const inc = incidents.find(i => i.id === req.params.id)
  if (!inc) return res.status(404).json({ error: 'incident not found' })
  recordAction(inc.id, actor, 'acknowledge', 'Manual acknowledgment via UI')
  inc.status = 'acknowledged'
  res.json({ ok: true, incident: inc })
})

app.post('/api/incidents/:id/resolve', (req, res) => {
  const { actor, note } = req.body
  if (!actor) return res.status(400).json({ error: 'actor required' })
  const inc = incidents.find(i => i.id === req.params.id)
  if (!inc) return res.status(404).json({ error: 'incident not found' })
  closeIncident(inc.id)
  recordAction(inc.id, actor, 'resolve', note ?? '')
  inc.status = 'resolved'
  res.json({ ok: true, incident: inc })
})

app.get('/api/actions', (_req, res) => {
  res.json([...actions].reverse())
})

app.post('/api/demo/heartbeat', (req, res) => {
  const { service_id } = req.body
  if (!service_id) return res.status(400).json({ error: 'service_id required' })
  upsertHeartbeat(service_id, `run-${Date.now()}`)
  res.json({ ok: true, service: getService(service_id) })
})

app.post('/api/demo/stop', (req, res) => {
  const { service_id } = req.body
  if (!service_id) return res.status(400).json({ error: 'service_id required' })
  const svc = getService(service_id)
  if (!svc) return res.status(404).json({ error: 'service not found' })
  svc.state = 'warning'
  res.json({ ok: true, service: svc })
})

app.post('/api/demo/failure', (req, res) => {
  const { service_id } = req.body
  if (!service_id) return res.status(400).json({ error: 'service_id required' })
  recordFailure(service_id, `run-${Date.now()}`, null)
  res.json({ ok: true, service: getService(service_id) })
})

app.listen(4002, () => {
  console.log('AgentGuard API listening on http://localhost:4002')
})

export default app
