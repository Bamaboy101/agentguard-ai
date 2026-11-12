import { initDb, db, seed, listServices, upsertHeartbeat, recordFailure, getService, listIncidents, openIncident, recordAction, listActions, closeIncident, type Service, type Incident, type Action } from './store'

export {
  db,
  listServices,
  upsertHeartbeat,
  recordFailure,
  getService,
  listIncidents,
  openIncident,
  recordAction,
  listActions,
  closeIncident
}

const MISSING_HEARTBEAT_RULE = 'missed-heartbeat'
const BURST_FAILURE_RULE = 'burst-failure'

/** Evaluate incident rules over current state. Call after each heartbeat/failure. */
export function evaluateRules() {
  const services = listServices(db)
  const now = Date.now()

  for (const svc of services) {
    if (!svc.last_seen_utc) continue
    const lastSeen = new Date(svc.last_seen_utc).getTime()
    const ageMs = now - lastSeen
    const graceMs = svc.expected_interval_s * 1000 * 2 // interval + grace period

    if (ageMs > graceMs) {
      openIncident(db, svc.id, MISSING_HEARTBEAT_RULE, 'critical')
      db.prepare(`UPDATE services SET state = 'critical' WHERE id = ?`).run(svc.id)
    } else if (ageMs > svc.expected_interval_s * 1000) {
      db.prepare(`UPDATE services SET state = 'warning' WHERE id = ?`).run(svc.id)
    } else {
      db.prepare(`UPDATE services SET state = 'healthy' WHERE id = ?`).run(svc.id)
    }
  }

  // Burst failure rule: N failures in explicit window -> one grouped incident
  const windowMs = 10 * 60 * 1000 // 10 minutes
  const burstThreshold = 3
  for (const svc of services) {
    const cutoff = new Date(now - windowMs).toISOString()
    const row = db.prepare(
      `SELECT COUNT(*) AS c FROM events WHERE service_id = ? AND type = 'failure' AND event_utc > ?`
    ).get(svc.id, cutoff) as { c: number }
    const failCount = row.c

    if (failCount >= burstThreshold) {
      openIncident(db, svc.id, BURST_FAILURE_RULE, 'high')
    }
  }
}

export function simulateHeartbeat(serviceId: string) {
  const svc = getService(db, serviceId)
  if (!svc) return { ok: false, error: 'service not found' }
  upsertHeartbeat(db, serviceId, `run-${Date.now()}`)
  evaluateRules()
  return { ok: true, service: getService(db, serviceId) }
}

export function simulateStop(serviceId: string) {
  const svc = getService(db, serviceId)
  if (!svc) return { ok: false, error: 'service not found' }
  db.prepare(`UPDATE services SET state = 'warning' WHERE id = ?`).run(serviceId)
  return { ok: true, service: getService(db, serviceId) }
}

export function simulateFailure(serviceId: string) {
  const svc = getService(db, serviceId)
  if (!svc) return { ok: false, error: 'service not found' }
  recordFailure(db, serviceId, `run-${Date.now()}`, null)
  evaluateRules()
  return { ok: true, service: getService(db, serviceId) }
}

export function acknowledgeIncident(incidentId: string, actor: string) {
  const inc = db.prepare(`SELECT * FROM incidents WHERE id = ?`).get(incidentId) as Incident | undefined
  if (!inc) return { ok: false, error: 'incident not found' }
  recordAction(db, incidentId, actor, 'acknowledge', 'Manual acknowledgment via UI')
  return { ok: true, incident: { ...inc, status: 'acknowledged' } }
}

export function resolveIncident(incidentId: string, actor: string, note: string) {
  const inc = db.prepare(`SELECT * FROM incidents WHERE id = ?`).get(incidentId) as Incident | undefined
  if (!inc) return { ok: false, error: 'incident not found' }
  closeIncident(db, incidentId)
  recordAction(db, incidentId, actor, 'resolve', note)
  return { ok: true, incident: { ...inc, status: 'resolved' } }
}

initDb()
seed(db)

console.log(`AgentGuard collector ready (db=${process.env.AGENTGUARD_DB_PATH || 'agentguard.db'})`)
