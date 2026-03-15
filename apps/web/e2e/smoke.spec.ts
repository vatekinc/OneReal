import { test, expect } from '@playwright/test';

const EMAIL = 'abhishek15@gmail.com';
const PASSWORD = 'manage@15';

test.describe('OneReal Smoke Tests', () => {
  test('login and view dashboard', async ({ page }) => {
    // Go to login page
    await page.goto('/login');
    await expect(page.getByText('Welcome back')).toBeVisible();

    // Fill credentials
    await page.getByLabel('Email').fill(EMAIL);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click();

    // Should redirect to dashboard (or onboarding if not completed)
    await page.waitForURL((url) => {
      const path = url.pathname;
      return path === '/' || path === '/onboarding';
    }, { timeout: 15000 });

    const currentPath = new URL(page.url()).pathname;

    if (currentPath === '/onboarding') {
      console.log('User needs onboarding - skipping dashboard check');
      await expect(page.locator('body')).not.toContainText('42P17');
      return;
    }

    // On dashboard - verify no errors
    await expect(page.locator('body')).not.toContainText('42P17');
    await expect(page.locator('body')).not.toContainText('infinite recursion');
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 10000 });
    console.log('Dashboard loaded successfully!');
  });

  test('dashboard shows portfolio stats', async ({ page }) => {
    // Login first
    await page.goto('/login');
    await page.getByLabel('Email').fill(EMAIL);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click();

    await page.waitForURL('/', { timeout: 15000 });

    // Verify stat cards
    await expect(page.getByText('Total Properties')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Total Units')).toBeVisible();
    await expect(page.getByText('Occupancy Rate')).toBeVisible();
    await expect(page.getByText('Rent Potential')).toBeVisible();
  });

  test('navigate to properties page', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(EMAIL);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click();

    await page.waitForURL('/', { timeout: 15000 });

    // Navigate to properties
    await page.getByRole('link', { name: /properties/i }).first().click();
    await page.waitForURL('/properties', { timeout: 10000 });

    await expect(page.locator('body')).not.toContainText('42P17');
    await expect(page.getByText(/properties/i).first()).toBeVisible();
  });

  test('navigate to settings page', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(EMAIL);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click();

    await page.waitForURL('/', { timeout: 15000 });

    // Navigate to settings
    await page.getByRole('link', { name: /settings/i }).first().click();
    await page.waitForURL('/settings', { timeout: 10000 });

    await expect(page.locator('body')).not.toContainText('42P17');
  });
});
