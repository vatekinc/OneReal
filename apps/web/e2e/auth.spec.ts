import { test, expect } from '@playwright/test';

// ---------------------------------------------------------------------------
// AUTH TESTS (run WITHOUT saved session)
// ---------------------------------------------------------------------------
test('login page renders', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByText('Welcome back')).toBeVisible({ timeout: 10000 });
  await expect(page.getByLabel('Email')).toBeVisible();
  await expect(page.getByLabel('Password')).toBeVisible();
  await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
});

test('invalid credentials stay on login', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('wrong@example.com');
  await page.getByLabel('Password').fill('wrongpassword');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForTimeout(2000);
  expect(page.url()).toContain('/login');
});

test('unauthenticated user is redirected to login', async ({ page }) => {
  await page.goto('/');
  await page.waitForURL(/\/login/, { timeout: 10000 });
});
