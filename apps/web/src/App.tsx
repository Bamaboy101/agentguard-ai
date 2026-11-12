import { useState, useEffect } from 'react'

const API = import.meta.env.VITE_API_BASE || ''
const POLL_MS = 3000

type Service = { id: string; name: string; expected_interval_s: number; last_seen_utc: string | null; last_success_utc: string | null; state: string; demo: boolean }
type Incident = { id: string; service_id: string; rule: string; severity: string; first_seen_utc: string; status: string }
type Action = { id: string; incident_id: string; actor: string; action: string; approved_utc: string; audit_note: string | null }

export default function App() {
  const [services, setServices] = useState<Service[]>([])
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [actions, setActions] = useState<Action[]>([])
  const [error, setError] = useState<string | null>(null)
  const [simLoading, setSimLoading] = useState<string | null>(null)

  useEffect(() => {
    loadAll()
    const t = setInterval(loadAll, POLL_MS)
    return () => clearInterval(t)
  }, [])

  async function loadAll() {
    try {
      const [s, i, a] = await Promise.all([
        fetch(`${API}/api/services`).then(r => r.json()),
        fetch(`${API}/api/incidents`).then(r => r.json()),
        fetch(`${API}/api/actions`).then(r => r.json())
      ])
      setServices(s)
      setIncidents(i)
      setActions(a)
    } catch (e) {
      setError(String(e))
    }
  }

  async function sim(kind: 'heartbeat' | 'stop' | 'failure', serviceId: string) {
    setSimLoading(serviceId)
    try {
      await fetch(`${API}/api/demo/${kind}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ service_id: serviceId }) })
      await loadAll()
    } finally {
      setSimLoading(null)
    }
  }

  async function decide(incidentId: string, action: 'ack' | 'resolve', actor = 'operator-1') {
    try {
      if (action === 'ack') {
        await fetch(`${API}/api/incidents/${incidentId}/ack`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actor }) })
      } else {
        await fetch(`${API}/api/incidents/${incidentId}/resolve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actor, note: 'resolved via demo' }) })
      }
      await loadAll()
    } catch (e) {
      setError(String(e))
    }
  }

  const stateColor = (s: string) => s === 'healthy' ? '#16a34a' : s === 'warning' ? '#ca8a04' : '#dc2626'

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 980, margin: '0 auto', padding: 20 }}>
      <h1>AgentGuard AI <span style={{ color: '#666', fontSize: 0.6 }}>&bull; demo</span></h1>
      <p style={{ color: '#555' }}>Monitoring, incident detection and safe recovery. Heartbeat &rarr; incident &rarr; alert &rarr; human decision.</p>
      {error && <span style={{ color: '#dc2626' }}>{error}</span>}

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
                <button onClick={() => sim('heartbeat', s.id)} disabled={simLoading === s.id} style={{ padding: '4px 8px', fontSize: 0.85 }}>{simLoading === s.id ? '…' : 'heartbeat'}</button>
                <button onClick={() => sim('stop', s.id)} disabled={simLoading === s.id} style={{ padding: '4px 8px', fontSize: 0.85 }}>{simLoading === s.id ? '…' : 'stop'}</button>
                <button onClick={() => sim('failure', s.id)} disabled={simLoading === s.id} style={{ padding: '4px 8px', fontSize: 0.85 }}>{simLoading === s.id ? '…' : 'fail'}</button>
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
                        <button onClick={() => decide(inc.id, 'ack')} style={{ marginRight: 4, padding: '2px 6px', fontSize: 0.8 }}>ack</button>
                        <button onClick={() => decide(inc.id, 'resolve')} style={{ padding: '2px 6px', fontSize: 0.8 }}>resolve</button>
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
        <h2>Audit trail</h2>
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
