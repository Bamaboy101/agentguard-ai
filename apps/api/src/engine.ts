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

export function initDb() {}
export function seed() {}

export function listServices(): Service[] { return services }
export function getService(id: string): Service | undefined { return services.find(s => s.id === id) }

export function upsertHeartbeat(serviceId: string, runId: string | null) {
  const svc = getService(serviceId)
  if (!svc) return
  svc.last_seen_utc = new Date().toISOString()
  svc.last_success_utc = new Date().toISOString()
  svc.state = 'healthy'
  events.push({ id: `evt:${crypto.randomUUID()}`, service_id: serviceId, runId, event_utc: new Date().toISOString(), type: 'heartbeat', duration_ms: null })
  evaluateRules()
}

export function recordFailure(serviceId: string, runId: string | null, durationMs: number | null) {
  const svc = getService(serviceId)
  if (!svc) return
  events.push({ id: `evt:${crypto.randomUUID()}`, service_id: serviceId, runId, event_utc: new Date().toISOString(), type: 'failure', duration_ms: durationMs })
  evaluateRules()
}

export { incidents }
export function listIncidents(): Incident[] { return incidents }
export function openIncident(serviceId: string, rule: string, severity: string): Incident | null {
  const existing = incidents.find(i => i.service_id === serviceId && i.rule === rule && i.status === 'open')
  if (existing) return null
  const id = `inc:${crypto.randomUUID()}`
  const now = new Date().toISOString()
  const inc: Incident = { id, service_id: serviceId, rule, severity, first_seen_utc: now, status: 'open' }
  incidents.push(inc)
  return inc
}

export function recordAction(incidentId: string, actor: string, action: string, note: string | null): Action {
  const id = `act:${crypto.randomUUID()}`
  const now = new Date().toISOString()
  const act: Action = { id, incident_id: incidentId, actor, action, approved_utc: now, audit_note: note }
  actions.push(act)
  return act
}

export function listActions(): Action[] { return [...actions].reverse() }

export function closeIncident(id: string) {
  const inc = incidents.find(i => i.id === id)
  if (inc) inc.status = 'resolved'
}

const MISSING_HEARTBEAT_RULE = 'missed-heartbeat'
const BURST_FAILURE_RULE = 'burst-failure'

export function evaluateRules() {
  const now = Date.now()
  for (const svc of services) {
    if (!svc.last_seen_utc) continue
    const lastSeen = new Date(svc.last_seen_utc).getTime()
    const ageMs = now - lastSeen
    const graceMs = svc.expected_interval_s * 1000 * 2
    if (ageMs > graceMs) {
      svc.state = 'critical'
      openIncident(svc.id, MISSING_HEARTBEAT_RULE, 'critical')
    } else if (ageMs > svc.expected_interval_s * 1000) {
      svc.state = 'warning'
    } else {
      svc.state = 'healthy'
    }
  }
  const windowMs = 10 * 60 * 1000
  const burstThreshold = 3
  for (const svc of services) {
    const cutoff = new Date(now - windowMs).toISOString()
    const failCount = events.filter(e => e.service_id === svc.id && e.type === 'failure' && new Date(e.event_utc).getTime() > new Date(cutoff).getTime()).length
    if (failCount >= burstThreshold) {
      openIncident(svc.id, BURST_FAILURE_RULE, 'high')
    }
  }
}

export function simulateHeartbeat(serviceId: string) {
  const svc = getService(serviceId)
  if (!svc) return { ok: false, error: 'service not found' }
  upsertHeartbeat(serviceId, `run-${Date.now()}`)
  evaluateRules()
  return { ok: true, service: getService(serviceId) }
}

export function simulateStop(serviceId: string) {
  const svc = getService(serviceId)
  if (!svc) return { ok: false, error: 'service not found' }
  svc.state = 'warning'
  return { ok: true, service: getService(serviceId) }
}

export function simulateFailure(serviceId: string) {
  const svc = getService(serviceId)
  if (!svc) return { ok: false, error: 'service not found' }
  recordFailure(serviceId, `run-${Date.now()}`, null)
  evaluateRules()
  return { ok: true, service: getService(serviceId) }
}

export function acknowledgeIncident(incidentId: string, actor: string) {
  const inc = incidents.find(i => i.id === incidentId)
  if (!inc) return { ok: false, error: 'incident not found' }
  recordAction(incidentId, actor, 'acknowledge', 'Manual acknowledgment via UI')
  return { ok: true, incident: { ...inc, status: 'acknowledged' } }
}

export function resolveIncident(incidentId: string, actor: string, note: string) {
  const inc = incidents.find(i => i.id === incidentId)
  if (!inc) return { ok: false, error: 'incident not found' }
  closeIncident(incidentId)
  recordAction(incidentId, actor, 'resolve', note)
  return { ok: true, incident: { ...inc, status: 'resolved' } }
}

initDb()
seed()

console.log('AgentGuard collector ready')
