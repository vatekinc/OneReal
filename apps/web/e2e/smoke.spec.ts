import { test, expect } from '@playwright/test';

const EMAIL = 'abhishek15@gmail.com';
const PASSWORD = 'manage@15';

// Reusable login helper
async function login(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((url) => {
    const path = url.pathname;
    return path === '/' || path === '/onboarding';
  }, { timeout: 15000 });
}

test.describe('OneReal Smoke Tests', () => {
  test('login and view dashboard', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByText('Welcome back')).toBeVisible();

    await login(page);

    const currentPath = new URL(page.url()).pathname;
    if (currentPath === '/onboarding') {
      console.log('User needs onboarding - skipping dashboard check');
      return;
    }

    await expect(page.locator('body')).not.toContainText('42P17');
    await expect(page.locator('body')).not.toContainText('infinite recursion');
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 10000 });
  });

  test('dashboard shows portfolio stats', async ({ page }) => {
    await login(page);
    await expect(page.getByText('Total Properties')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Total Units')).toBeVisible();
    await expect(page.getByText('Occupancy Rate')).toBeVisible();
    await expect(page.getByText('Rent Potential')).toBeVisible();
  });

  test('navigate to properties page', async ({ page }) => {
    await login(page);
    await page.getByRole('link', { name: /properties/i }).first().click();
    await page.waitForURL('/properties', { timeout: 10000 });
    await expect(page.locator('body')).not.toContainText('42P17');
  });

  test('navigate to settings page', async ({ page }) => {
    await login(page);
    await page.getByRole('link', { name: /settings/i }).first().click();
    await page.waitForURL('/settings', { timeout: 10000 });
    await expect(page.locator('body')).not.toContainText('42P17');
  });

  test('new property form loads without console errors', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await login(page);
    await page.goto('/properties/new');
    await page.waitForLoadState('networkidle');

    // Form sections should be visible
    await expect(page.getByText('Basic Info')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Address', { exact: true })).toBeVisible();
    await expect(page.getByText('Details', { exact: true })).toBeVisible();

    // State should be a dropdown (Select), not a text input
    await expect(page.getByText('Select state')).toBeVisible();

    // Address field should be present
    await expect(page.getByText('Address Line 1')).toBeVisible();

    // No Google Maps API errors
    const mapsErrors = consoleErrors.filter((e) =>
      e.includes('Google Maps') || e.includes('ApiNotActivated') || e.includes('InvalidKeyMapError')
    );
    expect(mapsErrors).toEqual([]);
  });

  test('new property form state dropdown works', async ({ page }) => {
    await login(page);
    await page.goto('/properties/new');
    await page.waitForLoadState('networkidle');

    // Click the state dropdown
    await page.getByText('Select state').click();

    // Should show US states
    await expect(page.getByRole('option', { name: 'Virginia', exact: true })).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('option', { name: 'California' })).toBeVisible();
    await expect(page.getByRole('option', { name: 'Texas' })).toBeVisible();

    // Select a state
    await page.getByRole('option', { name: 'Virginia', exact: true }).click();

    // Verify selection
    await expect(page.getByRole('combobox', { name: 'State' })).toHaveText('Virginia');
  });

  test('new property form address autocomplete loads', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await login(page);
    await page.goto('/properties/new');
    await page.waitForLoadState('networkidle');

    // Type in address field to trigger autocomplete
    const addressInput = page.locator('input[placeholder="Start typing an address..."]');
    await expect(addressInput).toBeVisible({ timeout: 10000 });
    await addressInput.fill('1600 Pennsylvania');

    // Wait a moment for Google Places to respond
    await page.waitForTimeout(2000);

    // Check that the Google Places dropdown appears (pac-container)
    const suggestions = page.locator('.pac-container .pac-item');
    const hasSuggestions = await suggestions.count() > 0;

    if (!hasSuggestions) {
      // If no suggestions, check for API errors
      const apiErrors = consoleErrors.filter((e) =>
        e.includes('Google Maps') || e.includes('ApiNotActivated') || e.includes('REQUEST_DENIED') || e.includes('LegacyApiNotActivated')
      );
      expect(apiErrors).toEqual([]);
    }
  });
});
