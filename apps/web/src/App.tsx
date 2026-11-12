import { useState, useEffect } from 'react'

type Service = { id: string; name: string; expected_interval_s: number; last_seen_utc: string | null; state: string; demo: boolean }
type Incident = { id: string; service_id: string; rule: string; severity: string; first_seen_utc: string; status: string }
type Action = { id: string; incident_id: string; actor: string; action: string; approved_utc: string; audit_note: string | null }

const SERVICES: Service[] = [
  { id: 'svc-demo-web', name: 'demo-web', expected_interval_s: 30, last_seen_utc: null, state: 'healthy', demo: true },
  { id: 'svc-demo-worker', name: 'demo-worker', expected_interval_s: 60, last_seen_utc: null, state: 'healthy', demo: true }
]

function sha256(input: string): Promise<string> {
  const buf = crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return buf.then(b => Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, '0')).join(''))
}

export default function App() {
  const [services, setServices] = useState<Service[]>(SERVICES)
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [actions, setActions] = useState<Action[]>([])
  const [simLoading, setSimLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const stateColor = (s: string) => s === 'healthy' ? '#16a34a' : s === 'warning' ? '#ca8a04' : '#dc2626'

  async function heartbeat(serviceId: string) {
    setSimLoading(serviceId)
    try {
      setServices(services.map(s => {
        if (s.id !== serviceId) return s
        return { ...s, last_seen_utc: new Date().toISOString(), state: 'healthy' }
      }))
    } finally { setSimLoading(null) }
  }

  async function stopService(serviceId: string) {
    setSimLoading(serviceId)
    try {
      setServices(services.map(s => s.id === serviceId ? { ...s, state: 'warning' } : s))
      setServices(services.map(s => s.id === serviceId ? { ...s, last_seen_utc: new Date(Date.now() - 120_000).toISOString() } : s))
    } finally { setSimLoading(null) }
  }

  async function failure(serviceId: string) {
    setSimLoading(serviceId)
    try {
      setServices(services.map(s => s.id === serviceId ? { ...s, state: 'critical' } : s))
      // Check burst rule: if 3+ failures, create incident
      const failCount = (services.filter(s => s.id === serviceId && s.state === 'critical').length || 0) + 1
      if (failCount >= 3) {
        const existing = incidents.find(i => i.service_id === serviceId && i.rule === 'burst-failure' && i.status === 'open')
        if (!existing) {
          const newIncident: Incident = {
            id: `inc:${Date.now()}`, service_id: serviceId, rule: 'burst-failure',
            severity: 'high', first_seen_utc: new Date().toISOString(), status: 'open'
          }
          setIncidents([newIncident, ...incidents])
        }
      }
    } finally { setSimLoading(null) }
  }

  async function acknowledge(incidentId: string) {
    setServices(services)
    setIncidents(incidents.map(i => i.id === incidentId ? { ...i, status: 'acknowledged' } : i))
    const inc = incidents.find(i => i.id === incidentId)
    if (inc) {
      const action: Action = { id: `act:${Date.now()}`, incident_id: incidentId, actor: 'operator-1', action: 'acknowledge', approved_utc: new Date().toISOString(), audit_note: 'Manual acknowledgment via UI' }
      setActions([action, ...actions])
    }
  }

  async function resolve(incidentId: string) {
    setIncidents(incidents.map(i => i.id === incidentId ? { ...i, status: 'resolved' } : i))
    const inc = incidents.find(i => i.id === incidentId)
    if (inc) {
      const action: Action = { id: `act:${Date.now()}`, incident_id: incidentId, actor: 'operator-1', action: 'resolve', approved_utc: new Date().toISOString(), audit_note: 'Resolved via demo' }
      setActions([action, ...actions])
    }
  }

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 980, margin: '0 auto', padding: 20 }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, paddingBottom: 20, borderBottom: '1px solid #e5e7eb' }}>
        <div style={{ width: 40, height: 40, background: 'linear-gradient(135deg, #ef4444, #f97316)', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 800, fontSize: 18 }}>AG</div>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>AgentGuard AI</h1>
          <p style={{ margin: 0, color: '#666', fontSize: 13 }}>Monitoring, incident detection & safe recovery</p>
          <span style={{ display: 'inline-block', marginTop: 6, padding: '2px 8px', border: '1px solid #ef4444', borderRadius: 10, fontSize: 11, color: '#ef4444' }}>Demo data</span>
        </div>
      </header>

      {error && <span style={{ color: '#dc2626', marginBottom: 12 }}>{error}</span>}

      <section style={{ marginTop: 16 }}>
        <h2>Services</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
          {services.length === 0 ? <p>No services.</p> : services.map(s => (
            <div key={s.id} style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontWeight: 600 }}>{s.name}</div>
                <div style={{ fontSize: 0.85, color: '#666' }}>{s.id}</div>
                <div style={{ fontSize: 0.85, color: '#666' }}>{s.last_seen_utc ? new Date(s.last_seen_utc).toLocaleString() : 'never'}</div>
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span style={{ padding: '2px 8px', borderRadius: 12, fontSize: 0.8, background: stateColor(s.state) + '22', color: stateColor(s.state), fontWeight: 600 }}>{s.state}</span>
                <button onClick={() => heartbeat(s.id)} disabled={simLoading === s.id} style={{ padding: '4px 8px', fontSize: 0.85 }}>{simLoading === s.id ? '…' : 'heartbeat'}</button>
                <button onClick={() => stopService(s.id)} disabled={simLoading === s.id} style={{ padding: '4px 8px', fontSize: 0.85 }}>{simLoading === s.id ? '…' : 'stop'}</button>
                <button onClick={() => failure(s.id)} disabled={simLoading === s.id} style={{ padding: '4px 8px', fontSize: 0.85 }}>{simLoading === s.id ? '…' : 'fail'}</button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section style={{ marginTop: 24 }}>
        <h2>Incidents</h2>
        {incidents.length === 0 ? <p>No incidents.</p> : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', borderBottom: '1px solid #ccc', padding: 6 }}>ID</th>
                <th style={{ textAlign: 'left', borderBottom: '1px solid #ccc', padding: 6 }}>Service</th>
                <th style={{ textAlign: 'left', borderBottom: '1px solid #ccc', padding: 6 }}>Rule</th>
                <th style={{ textAlign: 'right', borderBottom: '1px solid #ccc', padding: 6 }}>Severity</th>
                <th style={{ textAlign: 'right', borderBottom: '1px solid #ccc', padding: 6 }}>Status</th>
                <th style={{ textAlign: 'right', borderBottom: '1px solid #ccc', padding: 6 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {incidents.map(inc => (
                <tr key={inc.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                  <td style={{ padding: 4, fontSize: 0.85 }}>{inc.id}</td>
                  <td style={{ padding: 4, fontSize: 0.85 }}>{inc.service_id}</td>
                  <td style={{ padding: 4, fontSize: 0.85 }}>{inc.rule}</td>
                  <td style={{ padding: 4, fontSize: 0.85, textAlign: 'right' }}>{inc.severity}</td>
                  <td style={{ padding: 4, fontSize: 0.85, textAlign: 'right' }}>{inc.status}</td>
                  <td style={{ padding: 4, fontSize: 0.85, textAlign: 'right' }}>
                    {inc.status === 'open' && (
                      <>
                        <button onClick={() => acknowledge(inc.id)} style={{ marginRight: 4, padding: '2px 6px', fontSize: 0.8 }}>ack</button>
                        <button onClick={() => resolve(inc.id)} style={{ padding: '2px 6px', fontSize: 0.8 }}>resolve</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section style={{ marginTop: 24 }}>
        <h2>Audit Trail</h2>
        {actions.length === 0 ? <p>No actions yet.</p> : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', borderBottom: '1px solid #ccc', padding: 6 }}>Time (UTC)</th>
                <th style={{ textAlign: 'left', borderBottom: '1px solid #ccc', padding: 6 }}>Incident</th>
                <th style={{ textAlign: 'left', borderBottom: '1px solid #ccc', padding: 6 }}>Actor</th>
                <th style={{ textAlign: 'right', borderBottom: '1px solid #ccc', padding: 6 }}>Action</th>
                <th style={{ textAlign: 'left', borderBottom: '1px solid #ccc', padding: 6 }}>Note</th>
              </tr>
            </thead>
            <tbody>
              {actions.map(a => (
                <tr key={a.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                  <td style={{ padding: 4, fontSize: 0.85 }}>{new Date(a.approved_utc).toLocaleString()}</td>
                  <td style={{ padding: 4, fontSize: 0.85 }}>{a.incident_id}</td>
                  <td style={{ padding: 4, fontSize: 0.85 }}>{a.actor}</td>
                  <td style={{ padding: 4, fontSize: 0.85, textAlign: 'right' }}>{a.action}</td>
                  <td style={{ padding: 4, fontSize: 0.85 }}>{a.audit_note || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <p style={{ marginTop: 32, color: '#888', fontSize: 0.85 }}>
        Demo only. Recovery actions require explicit approval; no remote shell, reboot, or production restart.
      </p>
    </div>
  )
}