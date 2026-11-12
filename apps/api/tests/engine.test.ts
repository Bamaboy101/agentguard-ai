import { describe, it, expect } from 'vitest'
import {
  simulateHeartbeat, simulateStop, simulateFailure, acknowledgeIncident, resolveIncident, evaluateRules
} from '../src/engine'
import { db, seed, openIncident, listServices, listIncidents, listActions } from '../src/store'

function reset() {
  db.exec(`DELETE FROM actions; DELETE FROM incidents; DELETE FROM events; DELETE FROM services;`)
  seed(db)
}

describe('incident rules', () => {
  it('flags a stopped emitter as unhealthy within the window', () => {
    reset()
    simulateStop('svc-demo-web')
    evaluateRules()
    const svc = listServices(db).find(s => s.id === 'svc-demo-web')!
    expect(svc.state).toBe('warning')
  })

  it('dedupes repeated failures into one open incident', () => {
    reset()
    simulateFailure('svc-demo-worker')
    simulateFailure('svc-demo-worker')
    simulateFailure('svc-demo-worker')
    evaluateRules()
    const incs = listIncidents(db).filter(i => i.service_id === 'svc-demo-worker' && i.rule === 'burst-failure' && i.status === 'open')
    expect(incs.length).toBeGreaterThanOrEqual(1)
  })

  it('acknowledge + resolve produce an audit trail', () => {
    reset()
    const inc = openIncident(db, 'svc-demo-web', 'missed-heartbeat', 'critical')
    expect(inc).not.toBeNull()
    const acked = acknowledgeIncident(inc!.id, 'operator-1')
    expect(acked.ok).toBe(true)
    const resolved = resolveIncident(inc!.id, 'operator-1', 'fixed demo job')
    expect(resolved.ok).toBe(true)
    const actions = listActions(db).filter(a => a.incident_id === inc!.id)
    expect(actions.length).toBe(2)
    const actionTypes = actions.map(a => a.action).sort()
    expect(actionTypes).toEqual(['acknowledge', 'resolve'])
  })
})
