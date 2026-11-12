import Database from 'better-sqlite3'
import { resolve } from 'path'
import { randomUUID } from 'crypto'

const DB_PATH = process.env.AGENTGUARD_DB_PATH || resolve(process.cwd(), 'agentguard.db')
export const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')

export function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS services (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      expected_interval_s INTEGER NOT NULL DEFAULT 60,
      last_seen_utc TEXT,
      last_success_utc TEXT,
      state TEXT NOT NULL DEFAULT 'healthy',
      demo INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      service_id TEXT NOT NULL,
      run_id TEXT,
      event_utc TEXT NOT NULL,
      type TEXT NOT NULL,
      duration_ms INTEGER,
      FOREIGN KEY (service_id) REFERENCES services(id)
    );
    CREATE TABLE IF NOT EXISTS incidents (
      id TEXT PRIMARY KEY,
      service_id TEXT NOT NULL,
      rule TEXT NOT NULL,
      severity TEXT NOT NULL,
      first_seen_utc TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      FOREIGN KEY (service_id) REFERENCES services(id)
    );
    CREATE TABLE IF NOT EXISTS actions (
      id TEXT PRIMARY KEY,
      incident_id TEXT NOT NULL,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      approved_utc TEXT NOT NULL,
      audit_note TEXT,
      FOREIGN KEY (incident_id) REFERENCES incidents(id)
    );
  `)
}

export interface Service {
  id: string
  name: string
  expected_interval_s: number
  last_seen_utc: string | null
  last_success_utc: string | null
  state: string
  demo: boolean
}
export interface Event {
  id: string
  service_id: string
  run_id: string | null
  event_utc: string
  type: string
  duration_ms: number | null
}
export interface Incident {
  id: string
  service_id: string
  rule: string
  severity: string
  first_seen_utc: string
  status: string
}
export interface Action {
  id: string
  incident_id: string
  actor: string
  action: string
  approved_utc: string
  audit_note: string | null
}

export function seed(db: Database.Database) {
  const services: Service[] = [
    { id: 'svc-demo-web', name: 'demo-web', expected_interval_s: 30, last_seen_utc: null, last_success_utc: null, state: 'healthy', demo: 1 },
    { id: 'svc-demo-worker', name: 'demo-worker', expected_interval_s: 60, last_seen_utc: null, last_success_utc: null, state: 'healthy', demo: 1 }
  ]
  const insSvc = db.prepare('INSERT OR IGNORE INTO services (id,name,expected_interval_s,last_seen_utc,last_success_utc,state,demo) VALUES (?,?,?,?,?,?,?)')
  for (const s of services) insSvc.run(s.id, s.name, s.expected_interval_s, s.last_seen_utc, s.last_success_utc, s.state, s.demo ? 1 : 0)
}

export function listServices(db: Database.Database): Service[] {
  return db.prepare('SELECT * FROM services ORDER BY name').all() as Service[]
}

export function upsertHeartbeat(db: Database.Database, serviceId: string, runId: string | null) {
  const now = new Date().toISOString()
  db.prepare(`UPDATE services SET last_seen_utc = ?, last_success_utc = ?, state = 'healthy' WHERE id = ?`).run(now, now, serviceId)
  db.prepare(`INSERT INTO events (id, service_id, run_id, event_utc, type, duration_ms) VALUES (?,?,?,?,?,?)`).run(
    `evt:${randomUUID()}`, serviceId, runId, now, 'heartbeat', null
  )
}

export function recordFailure(db: Database.Database, serviceId: string, runId: string | null, durationMs: number | null) {
  const now = new Date().toISOString()
  db.prepare(`INSERT INTO events (id, service_id, run_id, event_utc, type, duration_ms) VALUES (?,?,?,?,?,?)`).run(
    `evt:${randomUUID()}`, serviceId, runId, now, 'failure', durationMs
  )
}

export function getService(db: Database.Database, id: string): Service | undefined {
  return db.prepare('SELECT * FROM services WHERE id = ?').get(id) as Service | undefined
}

export function listIncidents(db: Database.Database): Incident[] {
  return db.prepare('SELECT * FROM incidents ORDER BY first_seen_utc DESC').all() as Incident[]
}

export function openIncident(db: Database.Database, serviceId: string, rule: string, severity: string): Incident | null {
  const existing = db.prepare(`SELECT * FROM incidents WHERE service_id = ? AND rule = ? AND status = 'open'`).get(serviceId, rule)
  if (existing) return null
  const id = `inc:${randomUUID()}`
  const now = new Date().toISOString()
  db.prepare(`INSERT INTO incidents (id, service_id, rule, severity, first_seen_utc, status) VALUES (?,?,?,?,?,'open')`).run(id, serviceId, rule, severity, now)
  return { id, service_id: serviceId, rule, severity, first_seen_utc: now, status: 'open' }
}

export function recordAction(db: Database.Database, incidentId: string, actor: string, action: string, note: string | null): Action {
  const id = `act:${randomUUID()}`
  const now = new Date().toISOString()
  db.prepare(`INSERT INTO actions (id, incident_id, actor, action, approved_utc, audit_note) VALUES (?,?,?,?,?,?)`).run(id, incidentId, actor, action, now, note)
  return { id, incident_id: incidentId, actor, action, approved_utc: now, audit_note: note }
}

export function listActions(db: Database.Database): Action[] {
  return db.prepare('SELECT * FROM actions ORDER BY approved_utc DESC').all() as Action[]
}

export function closeIncident(db: Database.Database, id: string) {
  db.prepare(`UPDATE incidents SET status = 'resolved' WHERE id = ?`).run(id)
}
