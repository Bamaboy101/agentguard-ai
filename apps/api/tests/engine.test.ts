import { describe, it, expect } from 'vitest'
import {
  simulateHeartbeat, simulateStop, simulateFailure, acknowledgeIncident, resolveIncident, evaluateRules,
  listServices, listIncidents, listActions, openIncident
} from '../src/engine'

describe('incident rules', () => {
  it('flags a stopped emitter as unhealthy', () => {
    simulateStop('svc-demo-web')
    evaluateRules()
    const svc = listServices().find(s => s.id === 'svc-demo-web')!
    expect(svc.state).toBe('warning')
  })

  it('detects burst failures into one open incident', () => {
    simulateFailure('svc-demo-worker')
    simulateFailure('svc-demo-worker')
    simulateFailure('svc-demo-worker')
    evaluateRules()
    const incs = listIncidents().filter(i => i.service_id === 'svc-demo-worker' && i.rule === 'burst-failure' && i.status === 'open')
    expect(incs.length).toBeGreaterThanOrEqual(1)
  })

  it('acknowledge + resolve produce an audit trail', () => {
    const inc = openIncident('svc-demo-web', 'missed-heartbeat', 'critical')
    expect(inc).not.toBeNull()
    const acked = acknowledgeIncident(inc!.id, 'operator-1')
    expect(acked.ok).toBe(true)
    const resolved = resolveIncident(inc!.id, 'operator-1', 'fixed demo job')
    expect(resolved.ok).toBe(true)
    const actions = listActions().filter(a => a.incident_id === inc!.id)
    expect(actions.length).toBe(2)
    const actionTypes = actions.map(a => a.action).sort()
    expect(actionTypes).toEqual(['acknowledge', 'resolve'])
  })
})
