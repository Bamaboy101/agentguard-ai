import { defineConfig, devices } from '@playwright/test'

/**
 * Browser acceptance tests run against the LIVE public deployment.
 * No local server is started: the page under test is the published GitHub Pages
 * URL and the API under test is the deployed Cloudflare Worker.
 */
const APP = process.env.APP_NAME || 'marketmesh-ai'

export default defineConfig({
  testDir: '.',
  timeout: 90_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['json', { outputFile: 'results.json' }],
  ],
  outputDir: 'test-results',
  use: {
    baseURL: `https://bamaboy101.github.io/${APP}/`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
})
