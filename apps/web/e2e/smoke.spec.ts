import { test, expect } from '@playwright/test';

// ---------------------------------------------------------------------------
// All pages to test (used by health sweep)
// ---------------------------------------------------------------------------
const ALL_PAGES = [
  '/',
  '/properties',
  '/accounting',
  '/accounting/incoming',
  '/accounting/outgoing',
  '/contacts/tenants',
  '/contacts/providers',
  '/messages',
  '/settings',
  '/settings/profile',
];

// ---------------------------------------------------------------------------
// 1. DASHBOARD (uses saved auth session automatically)
// ---------------------------------------------------------------------------
test.describe('Dashboard', () => {
  test('renders with portfolio and financial stats', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Total Properties')).toBeVisible();
    await expect(page.getByText('Total Units')).toBeVisible();
    await expect(page.getByText('Monthly Income')).toBeVisible();
    await expect(page.getByText('Net Income')).toBeVisible();
    await expect(page.getByText('Recent Transactions')).toBeVisible();
    await expect(page.locator('body')).not.toContainText('42P17');
  });
});

// ---------------------------------------------------------------------------
// 3. PROPERTIES
// ---------------------------------------------------------------------------
test.describe('Properties', () => {
  test('list page renders with filters', async ({ page }) => {
    await page.goto('/properties');
    await expect(page.getByText('Properties').first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByPlaceholder('Search properties...')).toBeVisible();
    await expect(page.getByText('All Types')).toBeVisible();
    await expect(page.getByText('All Status')).toBeVisible();
    await expect(page.getByRole('link', { name: /add property/i })).toBeVisible();
    await expect(page.locator('body')).not.toContainText('42P17');
  });

  test('CRUD: create, verify, delete property', async ({ page }) => {
    await page.goto('/properties/new');
    await page.waitForLoadState('networkidle');

    // Create
    await page.getByPlaceholder('123 Main St').fill('E2E Test Property');
    const addressInput = page.locator('input[placeholder="Start typing an address..."]');
    await addressInput.fill('100 Test Ave');
    await page.getByText('Select state').click();
    await page.getByRole('option', { name: 'Virginia', exact: true }).click();
    await page.getByRole('button', { name: /create property/i }).click();

    // Verify detail page
    await page.waitForURL(/\/properties\/[a-f0-9-]+/, { timeout: 15000 });
    await expect(page.getByText('E2E Test Property')).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('tab', { name: /overview/i })).toBeVisible();

    // Delete (cleanup)
    page.on('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: /delete/i }).click();
    await page.waitForURL('/properties', { timeout: 10000 });
  });
});

// ---------------------------------------------------------------------------
// 4. ACCOUNTING
// ---------------------------------------------------------------------------
test.describe('Accounting', () => {
  test('overview renders with stat cards and charts', async ({ page }) => {
    await page.goto('/accounting');
    await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Cash Flow')).toBeVisible();
    await expect(page.getByText('Expense Breakdown')).toBeVisible();
    await expect(page.getByText('Invoice Aging')).toBeVisible();
    await expect(page.getByText('Collection Rate', { exact: true })).toBeVisible();
    await expect(page.getByText('Property Performance')).toBeVisible();
    await expect(page.locator('body')).not.toContainText('42P17');
  });

  test('incoming page renders with tabs and filters', async ({ page }) => {
    await page.goto('/accounting/incoming');
    await expect(page.getByRole('heading', { name: 'Incoming' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('tab', { name: 'Open' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Paid' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'All' })).toBeVisible();
    await expect(page.getByPlaceholder('Search invoices...')).toBeVisible();
    await expect(page.getByRole('button', { name: /new invoice/i })).toBeVisible();
    await expect(page.locator('body')).not.toContainText('42P17');
  });

  test('outgoing page renders with tabs and filters', async ({ page }) => {
    await page.goto('/accounting/outgoing');
    await expect(page.getByRole('heading', { name: 'Outgoing' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('tab', { name: 'Open' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Paid' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'All' })).toBeVisible();
    await expect(page.getByPlaceholder('Search bills...')).toBeVisible();
    await expect(page.getByRole('button', { name: /new bill/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /generate bills/i })).toBeVisible();
    await expect(page.locator('body')).not.toContainText('42P17');
  });
});

// ---------------------------------------------------------------------------
// 5. CONTACTS
// ---------------------------------------------------------------------------
test.describe('Contacts', () => {
  test('tenants page renders', async ({ page }) => {
    await page.goto('/contacts/tenants');
    await expect(page.getByRole('heading', { name: 'Tenants' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByPlaceholder('Search tenants...')).toBeVisible();
    await expect(page.getByRole('button', { name: /add tenant/i })).toBeVisible();
    await expect(page.locator('body')).not.toContainText('42P17');
  });

  test('providers page renders', async ({ page }) => {
    await page.goto('/contacts/providers');
    await expect(page.getByRole('heading', { name: 'Service Providers' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByPlaceholder('Search providers...')).toBeVisible();
    await expect(page.getByText('All Categories')).toBeVisible();
    await expect(page.getByRole('button', { name: /add provider/i })).toBeVisible();
    await expect(page.locator('body')).not.toContainText('42P17');
  });
});

// ---------------------------------------------------------------------------
// 6. MESSAGES
// ---------------------------------------------------------------------------
test.describe('Messages', () => {
  test('page renders', async ({ page }) => {
    await page.goto('/messages');
    await page.waitForLoadState('networkidle');
    // Either shows Messages panel or plan gate
    const hasMessages = await page.getByText('Messages').first().isVisible().catch(() => false);
    const hasGate = await page.getByText('Messaging Not Available').isVisible().catch(() => false);
    expect(hasMessages || hasGate).toBeTruthy();
    await expect(page.locator('body')).not.toContainText('42P17');
  });
});

// ---------------------------------------------------------------------------
// 7. SETTINGS
// ---------------------------------------------------------------------------
test.describe('Settings', () => {
  test('org and profile pages render', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByText('Organization Settings')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('body')).not.toContainText('42P17');

    await page.goto('/settings/profile');
    await expect(page.getByText('Profile Settings')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('body')).not.toContainText('42P17');
  });
});

// ---------------------------------------------------------------------------
// 8. HEALTH SWEEP — console errors + network errors across all pages
// ---------------------------------------------------------------------------
test.describe('Health Sweep', () => {
  test('no 5xx errors on any page', async ({ page }) => {
    test.setTimeout(120000);
    const serverErrors: string[] = [];
    page.on('response', (res) => {
      if (res.status() >= 500) {
        serverErrors.push(`${res.status()} ${res.url()}`);
      }
    });

    for (const p of ALL_PAGES) {
      await page.goto(p);
      await page.waitForLoadState('networkidle');
    }

    expect(serverErrors).toEqual([]);
  });

  test('no critical console errors on any page', async ({ page }) => {
    test.setTimeout(120000);
    const criticalErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        if (
          text.includes('42P17') ||
          text.includes('infinite recursion') ||
          text.includes('Internal Server Error')
        ) {
          criticalErrors.push(text);
        }
      }
    });

    for (const p of ALL_PAGES) {
      await page.goto(p);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1000);
    }

    expect(criticalErrors).toEqual([]);
  });
});
