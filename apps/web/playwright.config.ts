import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    // Auth tests run first without any saved session
    {
      name: 'auth',
      testMatch: /auth\.spec\.ts/,
    },
    // Login once, save session for all subsequent tests
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
      dependencies: ['auth'],
    },
    // All smoke tests use the saved session
    {
      name: 'chromium',
      testMatch: /smoke\.spec\.ts/,
      use: {
        browserName: 'chromium',
        storageState: './e2e/.auth/user.json',
      },
      dependencies: ['setup'],
    },
  ],
  webServer: {
    command: 'pnpm dev',
    port: 3000,
    reuseExistingServer: true,
    timeout: 120000,
  },
});
