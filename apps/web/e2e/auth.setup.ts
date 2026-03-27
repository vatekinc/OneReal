import { test as setup } from '@playwright/test';

setup('authenticate', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('abhishek15@gmail.com');
  await page.getByLabel('Password').fill('manage@15');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(
    (url) => url.pathname === '/' || url.pathname === '/onboarding',
    { timeout: 15000 },
  );
  await page.context().storageState({ path: './e2e/.auth/user.json' });
});
