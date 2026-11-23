const { defineConfig, devices } = require('@playwright/test');

const remoteURL = process.env.BASE_URL;

module.exports = defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  retries: 0,
  timeout: 30000,
  expect: { timeout: 7000 },
  reporter: [['list'], ['html', { open: 'never' }], ['json', { outputFile: 'test-results/results.json' }]],
  use: {
    baseURL: remoteURL || 'http://127.0.0.1:3100',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } }
  ],
  webServer: remoteURL ? undefined : {
    command: 'node qa-shop/server.js',
    url: 'http://127.0.0.1:3100/api/health',
    env: { PORT: '3100', DATA_DIR: '.test-data', ALLOW_TEST_RESET: '1' },
    reuseExistingServer: false,
    timeout: 15000
  }
});
