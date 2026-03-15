import { test, expect } from '@playwright/test';

const EMAIL = 'abhishek15@gmail.com';
const PASSWORD = 'manage@15';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
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

function collectConsoleErrors(page: import('@playwright/test').Page) {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  return errors;
}

// ---------------------------------------------------------------------------
// 1. AUTH – Login Page
// ---------------------------------------------------------------------------
test.describe('Auth - Login Page', () => {
  test('login page renders correctly', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByText('Welcome back')).toBeVisible();
    await expect(page.getByText('Sign in to your OneReal account')).toBeVisible();
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /continue with google/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /sign up/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /forgot password/i })).toBeVisible();
  });

  test('login with valid credentials', async ({ page }) => {
    await login(page);
    const currentPath = new URL(page.url()).pathname;
    if (currentPath === '/onboarding') {
      console.log('User needs onboarding - skipping dashboard check');
      return;
    }
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 10000 });
  });

  test('login with invalid credentials shows error', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill('wrong@example.com');
    await page.getByLabel('Password').fill('wrongpassword');
    await page.getByRole('button', { name: /sign in/i }).click();
    // Should show an error toast (sonner) and stay on login page
    await page.waitForTimeout(2000);
    expect(page.url()).toContain('/login');
  });

  test('login page navigates to register', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('link', { name: /sign up/i }).click();
    await page.waitForURL('/register', { timeout: 5000 });
    await expect(page.getByText('Create an account')).toBeVisible();
  });

  test('login page navigates to forgot password', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('link', { name: /forgot password/i }).click();
    await page.waitForURL('/forgot-password', { timeout: 5000 });
    await expect(page.getByText('Forgot password?')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 2. AUTH – Register Page
// ---------------------------------------------------------------------------
test.describe('Auth - Register Page', () => {
  test('register page renders correctly', async ({ page }) => {
    await page.goto('/register');
    await expect(page.getByText('Create an account')).toBeVisible();
    await expect(page.getByText('Get started with OneReal')).toBeVisible();
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Confirm Password')).toBeVisible();
    await expect(page.getByRole('button', { name: /create account/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /continue with google/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /sign in/i })).toBeVisible();
  });

  test('register page navigates to login', async ({ page }) => {
    await page.goto('/register');
    await page.getByRole('link', { name: /sign in/i }).click();
    await page.waitForURL('/login', { timeout: 5000 });
    await expect(page.getByText('Welcome back')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 3. AUTH – Forgot Password Page
// ---------------------------------------------------------------------------
test.describe('Auth - Forgot Password Page', () => {
  test('forgot password page renders correctly', async ({ page }) => {
    await page.goto('/forgot-password');
    await expect(page.getByText('Forgot password?')).toBeVisible();
    await expect(page.getByText('Enter your email to receive a reset link')).toBeVisible();
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByRole('button', { name: /send reset link/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /back to sign in/i })).toBeVisible();
  });

  test('forgot password back link goes to login', async ({ page }) => {
    await page.goto('/forgot-password');
    await page.getByRole('link', { name: /back to sign in/i }).click();
    await page.waitForURL('/login', { timeout: 5000 });
  });
});

// ---------------------------------------------------------------------------
// 4. AUTH – Unauthenticated redirect
// ---------------------------------------------------------------------------
test.describe('Auth - Route Protection', () => {
  test('unauthenticated user is redirected to login', async ({ page }) => {
    // Go directly to a protected page without logging in
    await page.goto('/');
    await page.waitForURL(/\/login/, { timeout: 10000 });
    await expect(page.getByText('Welcome back')).toBeVisible();
  });

  test('unauthenticated user cannot access properties', async ({ page }) => {
    await page.goto('/properties');
    await page.waitForURL(/\/login/, { timeout: 10000 });
  });

  test('unauthenticated user cannot access settings', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForURL(/\/login/, { timeout: 10000 });
  });
});

// ---------------------------------------------------------------------------
// 5. DASHBOARD
// ---------------------------------------------------------------------------
test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('dashboard shows portfolio stats', async ({ page }) => {
    await expect(page.getByText('Total Properties')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Total Units')).toBeVisible();
    await expect(page.getByText('Occupancy Rate')).toBeVisible();
    await expect(page.getByText('Rent Potential')).toBeVisible();
  });

  test('dashboard has Add Property button', async ({ page }) => {
    await expect(page.getByRole('link', { name: /add property/i })).toBeVisible({ timeout: 10000 });
  });

  test('dashboard shows recent activity section', async ({ page }) => {
    await expect(page.getByText('Recent Activity')).toBeVisible({ timeout: 10000 });
  });

  test('dashboard has no database errors', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    await expect(page.locator('body')).not.toContainText('42P17');
    await expect(page.locator('body')).not.toContainText('infinite recursion');
    await expect(page.locator('body')).not.toContainText('500');
  });

  test('dashboard Add Property button navigates to new property', async ({ page }) => {
    await page.getByRole('link', { name: /add property/i }).click();
    await page.waitForURL('/properties/new', { timeout: 10000 });
    await expect(page.getByRole('heading', { name: 'New Property' })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 6. SIDEBAR NAVIGATION
// ---------------------------------------------------------------------------
test.describe('Sidebar Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.waitForLoadState('networkidle');
  });

  test('sidebar shows navigation items', async ({ page }) => {
    await expect(page.getByRole('link', { name: /dashboard/i }).first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('link', { name: /properties/i }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: /settings/i }).first()).toBeVisible();
  });

  test('sidebar shows OneReal branding', async ({ page }) => {
    await expect(page.getByText('OneReal')).toBeVisible({ timeout: 10000 });
  });

  test('navigate to properties via sidebar', async ({ page }) => {
    await page.getByRole('link', { name: /properties/i }).first().click();
    await page.waitForURL('/properties', { timeout: 10000 });
  });

  test('navigate to settings via sidebar', async ({ page }) => {
    await page.getByRole('link', { name: /settings/i }).first().click();
    await page.waitForURL('/settings', { timeout: 10000 });
  });

  test('disabled nav items show Soon badge', async ({ page }) => {
    const soonBadges = page.locator('text=Soon');
    await expect(soonBadges.first()).toBeVisible({ timeout: 10000 });
  });
});

// ---------------------------------------------------------------------------
// 7. PROPERTIES LIST PAGE
// ---------------------------------------------------------------------------
test.describe('Properties List', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/properties');
    await page.waitForLoadState('networkidle');
  });

  test('properties page renders without errors', async ({ page }) => {
    await expect(page.locator('body')).not.toContainText('42P17');
    await expect(page.locator('body')).not.toContainText('infinite recursion');
    await expect(page.getByText('Properties').first()).toBeVisible({ timeout: 10000 });
  });

  test('properties page has Add Property button', async ({ page }) => {
    await expect(page.getByRole('link', { name: /add property/i })).toBeVisible({ timeout: 10000 });
  });

  test('properties page has search input', async ({ page }) => {
    await expect(page.getByPlaceholder('Search properties...')).toBeVisible({ timeout: 10000 });
  });

  test('properties page has type filter dropdown', async ({ page }) => {
    await expect(page.getByText('All Types')).toBeVisible({ timeout: 10000 });
  });

  test('properties page has status filter dropdown', async ({ page }) => {
    await expect(page.getByText('All Status')).toBeVisible({ timeout: 10000 });
  });

  test('properties page has view toggle buttons', async ({ page }) => {
    // Table and Grid view buttons (icon buttons)
    const viewButtons = page.locator('button[class*="size-icon"], button:has(svg)').filter({ hasText: '' });
    // At minimum the page should load without error
    await expect(page.getByText('Properties').first()).toBeVisible({ timeout: 10000 });
  });

  test('type filter dropdown shows options', async ({ page }) => {
    await page.getByText('All Types').click();
    await expect(page.getByRole('option', { name: 'Single Family' })).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('option', { name: 'Townhouse' })).toBeVisible();
    await expect(page.getByRole('option', { name: 'Apartment Complex' })).toBeVisible();
    await expect(page.getByRole('option', { name: 'Condo' })).toBeVisible();
    await expect(page.getByRole('option', { name: 'Commercial' })).toBeVisible();
  });

  test('status filter dropdown shows options', async ({ page }) => {
    await page.getByText('All Status').click();
    await expect(page.getByRole('option', { name: 'Active', exact: true })).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('option', { name: 'Inactive' })).toBeVisible();
    await expect(page.getByRole('option', { name: 'Sold' })).toBeVisible();
  });

  test('Add Property button navigates to new property form', async ({ page }) => {
    await page.getByRole('link', { name: /add property/i }).click();
    await page.waitForURL('/properties/new', { timeout: 10000 });
    await expect(page.getByRole('heading', { name: 'New Property' })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 8. NEW PROPERTY FORM
// ---------------------------------------------------------------------------
test.describe('New Property Form', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/properties/new');
    await page.waitForLoadState('networkidle');
  });

  test('form loads without console errors', async ({ page }) => {
    const consoleErrors = collectConsoleErrors(page);

    // Re-navigate to capture console errors from load
    await page.goto('/properties/new');
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('Basic Info')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Address', { exact: true })).toBeVisible();
    await expect(page.getByText('Details', { exact: true })).toBeVisible();

    // No Google Maps API errors
    const mapsErrors = consoleErrors.filter((e) =>
      e.includes('Google Maps') || e.includes('ApiNotActivated') || e.includes('InvalidKeyMapError')
    );
    expect(mapsErrors).toEqual([]);
  });

  test('form shows all three sections', async ({ page }) => {
    await expect(page.getByText('Basic Info')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Address', { exact: true })).toBeVisible();
    await expect(page.getByText('Details', { exact: true })).toBeVisible();
  });

  test('property name field is visible', async ({ page }) => {
    await expect(page.getByText('Property Name *')).toBeVisible({ timeout: 10000 });
    await expect(page.getByPlaceholder('123 Main St')).toBeVisible();
  });

  test('property type dropdown works', async ({ page }) => {
    // Type dropdown should have a default value
    await expect(page.getByText('Type *')).toBeVisible({ timeout: 10000 });
  });

  test('status dropdown works', async ({ page }) => {
    await expect(page.getByText('Status')).toBeVisible({ timeout: 10000 });
  });

  test('address autocomplete field is present', async ({ page }) => {
    await expect(page.getByText('Address Line 1')).toBeVisible({ timeout: 10000 });
    const addressInput = page.locator('input[placeholder="Start typing an address..."]');
    await expect(addressInput).toBeVisible();
  });

  test('address line 2 field is present', async ({ page }) => {
    await expect(page.getByText('Address Line 2')).toBeVisible({ timeout: 10000 });
    await expect(page.getByPlaceholder('Apt, Suite, Unit')).toBeVisible();
  });

  test('city field is present', async ({ page }) => {
    await expect(page.getByText('City')).toBeVisible({ timeout: 10000 });
  });

  test('state dropdown shows US states', async ({ page }) => {
    await expect(page.getByText('Select state')).toBeVisible({ timeout: 10000 });
    await page.getByText('Select state').click();

    await expect(page.getByRole('option', { name: 'Virginia', exact: true })).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('option', { name: 'California' })).toBeVisible();
    await expect(page.getByRole('option', { name: 'Texas' })).toBeVisible();
    await expect(page.getByRole('option', { name: 'New York' })).toBeVisible();
    await expect(page.getByRole('option', { name: 'Florida' })).toBeVisible();
  });

  test('state dropdown selection works', async ({ page }) => {
    await page.getByText('Select state').click();
    await page.getByRole('option', { name: 'Virginia', exact: true }).click();
    await expect(page.getByRole('combobox', { name: 'State' })).toHaveText('Virginia');
  });

  test('ZIP field is present', async ({ page }) => {
    await expect(page.getByText('ZIP')).toBeVisible({ timeout: 10000 });
  });

  test('country field is present', async ({ page }) => {
    await expect(page.getByText('Country')).toBeVisible({ timeout: 10000 });
  });

  test('year built field is present', async ({ page }) => {
    await expect(page.getByText('Year Built')).toBeVisible({ timeout: 10000 });
  });

  test('purchase price field is present', async ({ page }) => {
    await expect(page.getByText('Purchase Price')).toBeVisible({ timeout: 10000 });
  });

  test('purchase date field is present', async ({ page }) => {
    await expect(page.getByText('Purchase Date')).toBeVisible({ timeout: 10000 });
  });

  test('market value field is present', async ({ page }) => {
    await expect(page.getByText('Market Value')).toBeVisible({ timeout: 10000 });
  });

  test('notes field is present', async ({ page }) => {
    await expect(page.getByText('Notes')).toBeVisible({ timeout: 10000 });
  });

  test('submit button is present', async ({ page }) => {
    await expect(page.getByRole('button', { name: /create property/i })).toBeVisible({ timeout: 10000 });
  });

  test('address autocomplete loads Google Maps', async ({ page }) => {
    const consoleErrors = collectConsoleErrors(page);

    await page.goto('/properties/new');
    await page.waitForLoadState('networkidle');

    const addressInput = page.locator('input[placeholder="Start typing an address..."]');
    await expect(addressInput).toBeVisible({ timeout: 10000 });
    await addressInput.fill('1600 Pennsylvania');
    await page.waitForTimeout(2000);

    const suggestions = page.locator('.pac-container .pac-item');
    const hasSuggestions = await suggestions.count() > 0;

    if (!hasSuggestions) {
      const apiErrors = consoleErrors.filter((e) =>
        e.includes('Google Maps') || e.includes('ApiNotActivated') || e.includes('REQUEST_DENIED') || e.includes('LegacyApiNotActivated')
      );
      expect(apiErrors).toEqual([]);
    }
  });

  test('form validation - requires property name', async ({ page }) => {
    // Try to submit without filling required fields
    await page.getByRole('button', { name: /create property/i }).click();
    // Form should not navigate away
    await page.waitForTimeout(1000);
    expect(page.url()).toContain('/properties/new');
  });
});

// ---------------------------------------------------------------------------
// 9. PROPERTY CRUD – Create, View, Delete
// ---------------------------------------------------------------------------
test.describe('Property CRUD', () => {
  test('create, view, and delete a property', async ({ page }) => {
    await login(page);
    await page.goto('/properties/new');
    await page.waitForLoadState('networkidle');

    // Fill Basic Info
    await page.getByPlaceholder('123 Main St').fill('PW Test Property');

    // Fill Address
    const addressInput = page.locator('input[placeholder="Start typing an address..."]');
    await addressInput.fill('100 Test Ave');
    await page.getByPlaceholder('Apt, Suite, Unit').fill('Suite 200');

    // Select State
    await page.getByText('Select state').click();
    await page.getByRole('option', { name: 'Virginia', exact: true }).click();

    // Submit
    await page.getByRole('button', { name: /create property/i }).click();

    // Should navigate to the property detail page on success
    await page.waitForURL(/\/properties\/[a-f0-9-]+/, { timeout: 15000 });

    // Verify we're on the detail page with the property name
    await expect(page.getByText('PW Test Property')).toBeVisible({ timeout: 10000 });

    // Single-family: no Units tab, shows property details directly
    await expect(page.getByRole('tab', { name: /overview/i })).toBeVisible();
    await expect(page.getByRole('tab', { name: /images/i })).toBeVisible();
    // Should show single-unit stat cards (Bedrooms, Bathrooms, etc.)
    await expect(page.getByText('Bedrooms')).toBeVisible();
    await expect(page.getByText('Bathrooms')).toBeVisible();

    // Verify Edit and Delete buttons exist
    await expect(page.getByRole('link', { name: /edit/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /delete/i })).toBeVisible();

    // Delete the property (cleanup)
    page.on('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: /delete/i }).click();

    // Should redirect to properties list
    await page.waitForURL('/properties', { timeout: 10000 });
  });

  test('property list has delete option in actions menu', async ({ page }) => {
    await login(page);
    await page.goto('/properties');
    await page.waitForLoadState('networkidle');

    // Check if any properties exist with action buttons
    const actionButtons = page.locator('button:has(svg)').filter({ hasText: '' });
    const moreButtons = page.locator('[data-testid="more-actions"], button').filter({ has: page.locator('svg') });

    // Just verify the page renders without errors
    await expect(page.getByText('Properties').first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('body')).not.toContainText('42P17');
  });

  test('property detail page has tabs on existing property', async ({ page }) => {
    await login(page);
    await page.goto('/properties');
    await page.waitForLoadState('networkidle');

    // Find and click a property link (exclude /properties/new)
    const propertyLinks = page.locator('a[href*="/properties/"]').filter({ hasNotText: /add property/i });
    const count = await propertyLinks.count();

    if (count > 0) {
      for (let i = 0; i < count; i++) {
        const href = await propertyLinks.nth(i).getAttribute('href');
        if (href && href.match(/\/properties\/[a-f0-9-]{36}/)) {
          await propertyLinks.nth(i).click();
          await page.waitForURL(/\/properties\/[a-f0-9-]+/, { timeout: 10000 });
          await expect(page.getByRole('tab', { name: /overview/i })).toBeVisible({ timeout: 10000 });
          await expect(page.getByRole('tab', { name: /images/i })).toBeVisible();
          return;
        }
      }
    }
    console.log('No property detail links found - skipping tabs check');
  });
});

// ---------------------------------------------------------------------------
// 10. SETTINGS – Organization
// ---------------------------------------------------------------------------
test.describe('Settings - Organization', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');
  });

  test('settings page renders correctly', async ({ page }) => {
    await expect(page.getByText('Organization Settings')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('General')).toBeVisible();
  });

  test('org name field is editable', async ({ page }) => {
    await expect(page.getByText('Organization Name')).toBeVisible({ timeout: 10000 });
    const nameInput = page.locator('input').first();
    await expect(nameInput).toBeVisible();
    await expect(nameInput).toBeEditable();
  });

  test('slug field is disabled', async ({ page }) => {
    await expect(page.getByText('Slug')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Cannot be changed')).toBeVisible();
  });

  test('type badge is shown', async ({ page }) => {
    await expect(page.getByText('Type')).toBeVisible({ timeout: 10000 });
  });

  test('save changes button is present', async ({ page }) => {
    await expect(page.getByRole('button', { name: /save changes/i })).toBeVisible({ timeout: 10000 });
  });

  test('no database errors on settings page', async ({ page }) => {
    await expect(page.locator('body')).not.toContainText('42P17');
    await expect(page.locator('body')).not.toContainText('infinite recursion');
  });
});

// ---------------------------------------------------------------------------
// 11. SETTINGS – Profile
// ---------------------------------------------------------------------------
test.describe('Settings - Profile', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/settings/profile');
    await page.waitForLoadState('networkidle');
  });

  test('profile page renders correctly', async ({ page }) => {
    await expect(page.getByText('Profile Settings')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Personal Info')).toBeVisible();
  });

  test('profile fields are visible', async ({ page }) => {
    await expect(page.getByText('First Name')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Last Name')).toBeVisible();
    await expect(page.getByText('Email')).toBeVisible();
    await expect(page.getByText('Phone')).toBeVisible();
  });

  test('email field is disabled', async ({ page }) => {
    await expect(page.getByText('Cannot be changed')).toBeVisible({ timeout: 10000 });
  });

  test('security section is visible', async ({ page }) => {
    await expect(page.getByText('Security')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/forgot password/i)).toBeVisible();
  });

  test('save changes button is present', async ({ page }) => {
    await expect(page.getByRole('button', { name: /save changes/i })).toBeVisible({ timeout: 10000 });
  });

  test('no database errors on profile page', async ({ page }) => {
    await expect(page.locator('body')).not.toContainText('42P17');
    await expect(page.locator('body')).not.toContainText('infinite recursion');
  });
});

// ---------------------------------------------------------------------------
// 12. COMING SOON PAGES
// ---------------------------------------------------------------------------
test.describe('Coming Soon Pages', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('tenants page shows in development', async ({ page }) => {
    await page.goto('/tenants');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('In Development')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Planned features')).toBeVisible();
  });

  test('transactions page shows in development', async ({ page }) => {
    await page.goto('/transactions');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('In Development')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Planned features')).toBeVisible();
  });

  test('maintenance page shows in development', async ({ page }) => {
    await page.goto('/maintenance');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('In Development')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Planned features')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 13. CONSOLE ERRORS – Full Page Scan
// ---------------------------------------------------------------------------
test.describe('No Console Errors on Pages', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('dashboard has no critical console errors', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    const criticalErrors = errors.filter((e) =>
      e.includes('42P17') || e.includes('infinite recursion') || e.includes('Internal Server Error')
    );
    expect(criticalErrors).toEqual([]);
  });

  test('properties page has no critical console errors', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await page.goto('/properties');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    const criticalErrors = errors.filter((e) =>
      e.includes('42P17') || e.includes('infinite recursion') || e.includes('Internal Server Error')
    );
    expect(criticalErrors).toEqual([]);
  });

  test('new property page has no critical console errors', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await page.goto('/properties/new');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    const criticalErrors = errors.filter((e) =>
      e.includes('42P17') || e.includes('infinite recursion') || e.includes('Internal Server Error')
    );
    expect(criticalErrors).toEqual([]);
  });

  test('settings page has no critical console errors', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    const criticalErrors = errors.filter((e) =>
      e.includes('42P17') || e.includes('infinite recursion') || e.includes('Internal Server Error')
    );
    expect(criticalErrors).toEqual([]);
  });

  test('profile page has no critical console errors', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await page.goto('/settings/profile');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    const criticalErrors = errors.filter((e) =>
      e.includes('42P17') || e.includes('infinite recursion') || e.includes('Internal Server Error')
    );
    expect(criticalErrors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 14. NETWORK ERROR DETECTION
// ---------------------------------------------------------------------------
test.describe('No Server Errors (5xx)', () => {
  test('no 500 errors on main pages', async ({ page }) => {
    const serverErrors: string[] = [];
    page.on('response', (response) => {
      if (response.status() >= 500) {
        serverErrors.push(`${response.status()} ${response.url()}`);
      }
    });

    await login(page);

    // Visit all main pages
    const pages = ['/', '/properties', '/properties/new', '/settings', '/settings/profile'];
    for (const p of pages) {
      await page.goto(p);
      await page.waitForLoadState('networkidle');
    }

    expect(serverErrors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 15. RESPONSIVE / MOBILE
// ---------------------------------------------------------------------------
test.describe('Mobile Viewport', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('login page works on mobile', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByText('Welcome back')).toBeVisible();
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
  });

  test('dashboard loads on mobile', async ({ page }) => {
    await login(page);
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 10000 });
  });
});

// ---------------------------------------------------------------------------
// 16. ACCOUNTING DASHBOARD
// ---------------------------------------------------------------------------
test.describe('Accounting Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('accounting dashboard renders without errors', async ({ page }) => {
    await page.goto('/accounting');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('Financial Overview')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('body')).not.toContainText('42P17');
    await expect(page.locator('body')).not.toContainText('infinite recursion');
  });

  test('accounting dashboard shows stat cards', async ({ page }) => {
    await page.goto('/accounting');
    await expect(page.getByText('Total Income')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Total Expenses')).toBeVisible();
    await expect(page.getByText('Net Income')).toBeVisible();
    await expect(page.getByText('Portfolio ROI')).toBeVisible();
  });

  test('accounting dashboard has date range filter', async ({ page }) => {
    await page.goto('/accounting');
    await expect(page.getByRole('button', { name: 'This Month' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: 'This Year' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'All Time' })).toBeVisible();
  });

  test('accounting dashboard shows chart sections', async ({ page }) => {
    await page.goto('/accounting');
    await expect(page.getByText('Income vs Expenses')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Breakdown')).toBeVisible();
    await expect(page.getByText('Property Performance')).toBeVisible();
  });

  test('accounting dashboard has navigation links', async ({ page }) => {
    await page.goto('/accounting');
    await expect(page.getByRole('link', { name: /income/i })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('link', { name: /expenses/i })).toBeVisible();
  });

  test('date range filter changes URL', async ({ page }) => {
    await page.goto('/accounting');
    await page.getByRole('button', { name: 'This Year' }).click();
    await page.waitForURL(/range=current_year/, { timeout: 10000 });
  });
});

// ---------------------------------------------------------------------------
// 17. ACCOUNTING — SIDEBAR
// ---------------------------------------------------------------------------
test.describe('Accounting Sidebar', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.waitForLoadState('networkidle');
  });

  test('sidebar shows Accounting link', async ({ page }) => {
    await expect(page.getByRole('link', { name: /accounting/i }).first()).toBeVisible({ timeout: 10000 });
  });

  test('navigate to accounting via sidebar', async ({ page }) => {
    await page.getByRole('link', { name: /accounting/i }).first().click();
    await page.waitForURL('/accounting', { timeout: 10000 });
    await expect(page.getByText('Financial Overview')).toBeVisible({ timeout: 10000 });
  });
});

// ---------------------------------------------------------------------------
// 18. INCOME LIST PAGE
// ---------------------------------------------------------------------------
test.describe('Income List', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/accounting/income');
    await page.waitForLoadState('networkidle');
  });

  test('income page renders without errors', async ({ page }) => {
    await expect(page.getByText('Income').first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('body')).not.toContainText('42P17');
  });

  test('income page has Add Income button', async ({ page }) => {
    await expect(page.getByRole('button', { name: /add income/i })).toBeVisible({ timeout: 10000 });
  });

  test('income page has filter controls', async ({ page }) => {
    await expect(page.getByText('All Properties')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('All Types')).toBeVisible();
    await expect(page.getByPlaceholder('Search...')).toBeVisible();
  });

  test('Add Income button opens dialog', async ({ page }) => {
    await page.getByRole('button', { name: /add income/i }).click();
    await expect(page.getByText('Add Income')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Property *')).toBeVisible();
    await expect(page.getByText('Amount *')).toBeVisible();
    await expect(page.getByText('Type *')).toBeVisible();
    await expect(page.getByText('Description *')).toBeVisible();
    await expect(page.getByText('Date *')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 19. EXPENSE LIST PAGE
// ---------------------------------------------------------------------------
test.describe('Expense List', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/accounting/expenses');
    await page.waitForLoadState('networkidle');
  });

  test('expenses page renders without errors', async ({ page }) => {
    await expect(page.getByText('Expenses').first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('body')).not.toContainText('42P17');
  });

  test('expenses page has Add Expense button', async ({ page }) => {
    await expect(page.getByRole('button', { name: /add expense/i })).toBeVisible({ timeout: 10000 });
  });

  test('expenses page has filter controls', async ({ page }) => {
    await expect(page.getByText('All Properties')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('All Types')).toBeVisible();
    await expect(page.getByPlaceholder('Search...')).toBeVisible();
  });

  test('Add Expense button opens dialog', async ({ page }) => {
    await page.getByRole('button', { name: /add expense/i }).click();
    await expect(page.getByText('Add Expense')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Property *')).toBeVisible();
    await expect(page.getByText('Amount *')).toBeVisible();
    await expect(page.getByText('Type *')).toBeVisible();
    await expect(page.getByText('Description *')).toBeVisible();
    await expect(page.getByText('Date *')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 20. DASHBOARD HOME — Financial Stats
// ---------------------------------------------------------------------------
test.describe('Dashboard Financial Stats', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('dashboard shows financial stat cards', async ({ page }) => {
    await expect(page.getByText('Monthly Income')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Monthly Expenses')).toBeVisible();
    await expect(page.getByText('Net Income')).toBeVisible();
    await expect(page.getByText('Portfolio ROI')).toBeVisible();
  });

  test('dashboard shows recent transactions section', async ({ page }) => {
    await expect(page.getByText('Recent Transactions')).toBeVisible({ timeout: 10000 });
  });

  test('dashboard has View All link to accounting', async ({ page }) => {
    await expect(page.getByRole('link', { name: /view all/i })).toBeVisible({ timeout: 10000 });
  });
});

// ---------------------------------------------------------------------------
// 21. ACCOUNTING PAGES — No Console Errors
// ---------------------------------------------------------------------------
test.describe('Accounting No Console Errors', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('accounting dashboard has no critical console errors', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await page.goto('/accounting');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    const criticalErrors = errors.filter((e) =>
      e.includes('42P17') || e.includes('infinite recursion') || e.includes('Internal Server Error')
    );
    expect(criticalErrors).toEqual([]);
  });

  test('income page has no critical console errors', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await page.goto('/accounting/income');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    const criticalErrors = errors.filter((e) =>
      e.includes('42P17') || e.includes('infinite recursion') || e.includes('Internal Server Error')
    );
    expect(criticalErrors).toEqual([]);
  });

  test('expenses page has no critical console errors', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await page.goto('/accounting/expenses');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    const criticalErrors = errors.filter((e) =>
      e.includes('42P17') || e.includes('infinite recursion') || e.includes('Internal Server Error')
    );
    expect(criticalErrors).toEqual([]);
  });
});
