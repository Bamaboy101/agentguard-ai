import { type Page, type BrowserContext, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

export const APP = process.env.APP_NAME || 'marketmesh-ai'
export const WORKER = process.env.WORKER_BASE || 'https://marketmesh-api.marketmesh-api.workers.dev'
export const SHOTS = process.env.SHOT_DIR || 'screenshots'

/** Collect console errors + failed requests so a green test still proves a clean page. */
export function instrument(page: Page) {
  const consoleErrors: string[] = []
  const failedRequests: string[] = []
  const workerCalls: { url: string; status: number; method: string }[] = []

  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text())
  })
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`))
  page.on('requestfailed', (r) => {
    // Third-party font/CDN hiccups are environment noise, not app defects.
    if (r.url().includes('workers.dev') || r.url().includes('github.io')) {
      failedRequests.push(`${r.url()} :: ${r.failure()?.errorText}`)
    }
  })
  page.on('response', async (r) => {
    if (r.url().startsWith(WORKER)) {
      workerCalls.push({ url: r.url(), status: r.status(), method: r.request().method() })
    }
  })
  return { consoleErrors, failedRequests, workerCalls }
}

export async function openApp(page: Page) {
  await page.goto('./', { waitUntil: 'domcontentloaded' })
  // React mounts from CDN builds; wait for real app chrome, not just <div id=root>.
  await expect(page.locator('nav')).toBeVisible({ timeout: 60_000 })
}

export async function shoot(page: Page, name: string, project: string) {
  fs.mkdirSync(SHOTS, { recursive: true })
  const file = path.join(SHOTS, `${APP}-${project}-${name}.png`)
  await page.screenshot({ path: file, fullPage: true })
  return file
}

export function dumpDiagnostics(name: string, data: unknown) {
  fs.mkdirSync('diagnostics', { recursive: true })
  fs.writeFileSync(path.join('diagnostics', `${APP}-${name}.json`), JSON.stringify(data, null, 2))
}

/** A second, fully isolated visitor: separate storage, cookies and session id. */
export async function freshVisitor(context: BrowserContext) {
  const page = await context.newPage()
  await openApp(page)
  return page
}


/** Wait until the page has actually called a Worker endpoint successfully. */
export async function expectWorkerCall(
  calls: { url: string; status: number; method: string }[],
  match: string,
  method = 'GET',
) {
  await expect
    .poll(() => calls.some((c) => c.url.includes(match) && c.status === 200 && c.method === method), {
      timeout: 45_000,
      intervals: [500, 1000, 2000],
    })
    .toBeTruthy()
}

export { expect }
