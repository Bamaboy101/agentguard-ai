import express, { type Request, type Response, type NextFunction } from 'express'
import cors from 'cors'
import { z } from 'zod'
import {
  listServices, upsertHeartbeat, recordFailure, getService,
  listIncidents, openIncident, recordAction, listActions, closeIncident,
  simulateHeartbeat, simulateStop, simulateFailure,
  acknowledgeIncident, resolveIncident, evaluateRules, db
} from './engine'

const app = express()
const PORT = Number(process.env.PORT) || 4001

app.use(cors())
app.use(express.json())

app.use((_req: Request, _res: Response, next: NextFunction) => {
  const start = Date.now()
  _res.on('finish', () => {
    console.log(`${_req.method} ${_req.originalUrl} ${_res.statusCode} ${Date.now() - start}ms`)
  })
  next()
})

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', utc: new Date().toISOString() })
})

app.get('/api/services', (_req: Request, res: Response) => {
  res.json(listServices(db))
})

app.get('/api/services/:id', (req: Request, res: Response) => {
  const svc = getService(db, req.params.id)
  if (!svc) return res.status(404).json({ error: 'service not found' })
  res.json(svc)
})

const heartbeatBody = z.object({ service_id: z.string().min(1), run_id: z.string().optional() })
app.post('/api/events', (req: Request, res: Response) => {
  const parsed = heartbeatBody.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid body', issues: parsed.error.flatten() })
  const { service_id, run_id } = parsed.data
  const svc = getService(db, service_id)
  if (!svc) return res.status(404).json({ error: 'service not found' })
  upsertHeartbeat(db, service_id, run_id ?? null)
  evaluateRules()
  res.json({ ok: true, service: getService(db, service_id) })
})

const failureBody = z.object({ service_id: z.string().min(1), run_id: z.string().optional(), duration_ms: z.number().optional() })
app.post('/api/events/failure', (req: Request, res: Response) => {
  const parsed = failureBody.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid body', issues: parsed.error.flatten() })
  const { service_id, run_id, duration_ms } = parsed.data
  const svc = getService(db, service_id)
  if (!svc) return res.status(404).json({ error: 'service not found' })
  recordFailure(db, service_id, run_id ?? null, duration_ms ?? null)
  evaluateRules()
  res.json({ ok: true, service: getService(db, service_id) })
})

app.get('/api/incidents', (_req: Request, res: Response) => {
  res.json(listIncidents(db))
})

app.post('/api/incidents/:id/ack', (req: Request, res: Response) => {
  const { actor } = req.body as { actor?: string }
  if (!actor) return res.status(400).json({ error: 'actor required' })
  const result = acknowledgeIncident(req.params.id, actor)
  if (!result.ok) return res.status(404).json({ error: result.error })
  res.json(result)
})

app.post('/api/incidents/:id/resolve', (req: Request, res: Response) => {
  const { actor, note } = req.body as { actor?: string; note?: string }
  if (!actor) return res.status(400).json({ error: 'actor required' })
  const result = resolveIncident(req.params.id, actor, note ?? '')
  if (!result.ok) return res.status(404).json({ error: result.error })
  res.json(result)
})

app.get('/api/actions', (_req: Request, res: Response) => {
  res.json(listActions(db))
})

// Demo control endpoints (simulator only; not for production)
app.post('/api/demo/heartbeat', (req: Request, res: Response) => {
  const { service_id } = req.body as { service_id?: string }
  if (!service_id) return res.status(400).json({ error: 'service_id required' })
  res.json(simulateHeartbeat(service_id))
})
app.post('/api/demo/stop', (req: Request, res: Response) => {
  const { service_id } = req.body as { service_id?: string }
  if (!service_id) return res.status(400).json({ error: 'service_id required' })
  res.json(simulateStop(service_id))
})
app.post('/api/demo/failure', (req: Request, res: Response) => {
  const { service_id } = req.body as { service_id?: string }
  if (!service_id) return res.status(400).json({ error: 'service_id required' })
  res.json(simulateFailure(service_id))
})

app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'not found' })
})
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err)
  res.status(500).json({ error: 'internal server error' })
})

app.listen(PORT, () => {
  console.log(`AgentGuard API listening on :${PORT}`)
})

export default app
