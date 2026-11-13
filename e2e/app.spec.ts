import { test, expect } from '@playwright/test'
import { instrument, openApp, shoot, dumpDiagnostics, expectWorkerCall, WORKER } from './helpers'

test.describe('AgentGuard AI — live public acceptance', () => {
  test('heartbeat → controlled failure → incident → acknowledge → resolve → audit persists', async ({ page, browser }, testInfo) => {
    const probe = instrument(page)
    const project = testInfo.project.name

    await openApp(page)
    await expect(page).toHaveTitle(/AgentGuard/i)
    await expect(page.getByRole('heading', { name: 'Services' })).toBeVisible()
    await expect(page.getByText('demo-web').first()).toBeVisible({ timeout: 45_000 })
    await expectWorkerCall(probe.workerCalls, '/api/services')
    await shoot(page, '01-services', project)

    const row = page.locator('tr', { hasText: 'demo-web' }).first()

    // Heartbeat is a real API write.
    await row.getByRole('button', { name: 'Heartbeat' }).click()
    await expect.poll(() => probe.workerCalls.filter((c) => c.url.includes('/api/demo/heartbeat')).length).toBeGreaterThan(0)
    await shoot(page, '02-heartbeat', project)

    // Controlled failures must open exactly one burst incident (dedupe).
    for (let i = 0; i < 3; i++) {
      await row.getByRole('button', { name: 'Fail' }).click()
      await page.waitForTimeout(1200)
    }
    const incidentCard = page.locator('div', { hasText: 'burst-failure' }).last()
    await expect(page.getByText('burst-failure').first()).toBeVisible({ timeout: 45_000 })
    await shoot(page, '03-incident', project)

    const session = await page.evaluate(() => localStorage.getItem('demo-session-id'))
    const headers = { 'x-demo-session': session || '' }
    const incidents = await (await page.request.get(`${WORKER}/api/incidents`, { headers })).json()
    const burst = incidents.filter((i: any) => i.rule === 'burst-failure' && i.status === 'open')
    expect(burst.length, 'duplicate incidents must be deduped to one').toBe(1)

    // Acknowledge then resolve, both real writes.
    await page.getByRole('button', { name: 'Acknowledge' }).first().click()
    await expect(page.getByText('acknowledged').first()).toBeVisible({ timeout: 45_000 })
    await shoot(page, '04-acknowledged', project)

    await page.getByRole('button', { name: 'Resolve' }).first().click()
    await expect(page.getByText('resolved').first()).toBeVisible({ timeout: 45_000 })
    await shoot(page, '05-resolved', project)

    // Audit trail returned by the backend.
    const actions = await (await page.request.get(`${WORKER}/api/actions`, { headers })).json()
    expect(actions.length).toBeGreaterThanOrEqual(2)
    expect(actions.map((a: any) => a.action)).toEqual(expect.arrayContaining(['acknowledge', 'resolve']))

    // Persistence across reload.
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.locator('nav')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Audit Trail' })).toBeVisible()
    await expect(page.getByText('acknowledge').first()).toBeVisible({ timeout: 45_000 })
    await shoot(page, '06-after-reload', project)

    // Second isolated visitor sees no incidents from this session.
    const otherCtx = await browser.newContext()
    const other = await otherCtx.newPage()
    await openApp(other)
    const otherSession = await other.evaluate(() => localStorage.getItem('demo-session-id'))
    expect(otherSession).not.toEqual(session)
    const otherIncidents = await (await other.request.get(`${WORKER}/api/incidents`, {
      headers: { 'x-demo-session': otherSession || '' },
    })).json()
    expect(otherIncidents.length).toBe(0)
    await shoot(other, '07-isolated-visitor', project)
    await otherCtx.close()

    // Demo controls only ever address the seeded demo services.
    const services = await (await page.request.get(`${WORKER}/api/services`, { headers })).json()
    for (const s of services) expect(String(s.id).startsWith('svc-demo-')).toBeTruthy()

    dumpDiagnostics(`${project}-network`, probe)
    expect(probe.failedRequests, probe.failedRequests.join(' | ')).toEqual([])
    expect(probe.consoleErrors, probe.consoleErrors.join(' | ')).toEqual([])
  })
})
