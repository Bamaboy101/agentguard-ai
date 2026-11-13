import { test, expect } from '@playwright/test';

const API_BASE = 'https://agentguard-api.marketmesh-api.workers.dev';

test('AgentGuard health', async ({ page }) => {
  const res = await page.request.get(`${API_BASE}/api/health`);
  expect(res.ok()).toBeTruthy();
  const data = await res.json();
  expect(data.status).toBe('ok');
});

test('AgentGuard services', async ({ page }) => {
  const res = await page.request.get(`${API_BASE}/api/services`);
  expect(res.ok()).toBeTruthy();
  const services = await res.json();
  expect(Array.isArray(services)).toBeTruthy();
  expect(services.length).toBeGreaterThan(0);
});

test('AgentGuard heartbeat', async ({ page }) => {
  const res = await page.request.post(`${API_BASE}/api/events`, {
    data: { service_id: 'svc-demo-web', run_id: 'run-test-123' }
  });
  expect(res.ok()).toBeTruthy();
  const data = await res.json();
  expect(data.ok).toBe(true);
});

test('AgentGuard failure detection', async ({ page }) => {
  // Trigger failures
  await page.request.post(`${API_BASE}/api/events/failure`, {
    data: { service_id: 'svc-demo-web', run_id: 'run-fail-1' }
  });
  await page.request.post(`${API_BASE}/api/events/failure`, {
    data: { service_id: 'svc-demo-web', run_id: 'run-fail-2' }
  });
  await page.request.post(`${API_BASE}/api/events/failure`, {
    data: { service_id: 'svc-demo-web', run_id: 'run-fail-3' }
  });

  const incidents = await page.request.get(`${API_BASE}/api/incidents`);
  expect(incidents.ok()).toBeTruthy();
  const incidentsData = await incidents.json();
  expect(incidentsData.length).toBeGreaterThan(0);
});
