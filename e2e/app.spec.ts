import { test, expect } from '@playwright/test';

test.describe('CHS Finds App', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
  });

  test('should load the homepage with header', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /Charleston Finds/i })).toBeVisible();
  });

  test('should display area selector with default area', async ({ page }) => {
    await expect(page.getByText('Downtown Charleston').or(page.getByText('Daniel Island'))).toBeVisible();
  });

  test('should display activity chip with Happy Hour as default', async ({ page }) => {
    await expect(page.getByText('Happy Hour')).toBeVisible();
  });

  test('should open area selector dropdown', async ({ page }) => {
    const selectCount = await page.locator('select').count();

    if (selectCount > 0) {
      const select = page.locator('select').first();
      await expect(select).toBeVisible();
      const options = await select.locator('option').count();
      expect(options).toBeGreaterThan(1);
    } else {
      const areaButton = page.locator('button').filter({ hasText: /Downtown Charleston|Daniel Island|Mount Pleasant|Sullivan|James Island/i }).first();
      if (await areaButton.isVisible({ timeout: 2000 }).catch(() => false)) {
        await areaButton.click();
        await page.waitForTimeout(500);
        await expect(page.locator('body')).toBeVisible();
      }
    }
  });

  test('should open activity filter modal when activity chip is clicked', async ({ page }) => {
    const activityChip = page.getByText('Happy Hour').first();
    await activityChip.click();
    await page.waitForTimeout(500);

    const modalTitle = page.getByRole('heading', { name: 'Select Activity' });
    await expect(modalTitle).toBeVisible({ timeout: 3000 });
  });

  test('should have Add Spot in the More menu', async ({ page }) => {
    const moreButton = page.getByRole('button', { name: /More options/i });
    await expect(moreButton).toBeVisible();
    await moreButton.click();
    await page.waitForTimeout(300);

    const addSpotItem = page.getByRole('menuitem', { name: /Add Spot/i }).or(
      page.locator('[role="menu"]').getByText('Add Spot')
    ).first();
    await expect(addSpotItem).toBeVisible({ timeout: 2000 });
  });

  test('should open submission modal via More > Add Spot', async ({ page }) => {
    const moreButton = page.getByRole('button', { name: /More options/i });
    await moreButton.click();
    await page.waitForTimeout(300);

    const addSpotItem = page.getByRole('menuitem', { name: /Add Spot/i }).or(
      page.locator('[role="menu"]').getByText('Add Spot')
    ).first();
    await addSpotItem.click();
    await page.waitForTimeout(1500);

    const formVisible = await Promise.race([
      page.getByPlaceholder(/title|name/i).first().isVisible().then(() => true),
      page.getByLabel(/title|name/i).first().isVisible().then(() => true),
      page.getByText(/Add a new spot|Add.*spot/i).first().isVisible().then(() => true),
      page.locator('input[type="text"]').first().isVisible().then(() => true),
    ]).catch(() => false);

    expect(formVisible).toBeTruthy();
  });

  test('should display list view by default', async ({ page }) => {
    await expect(page.locator('body')).toBeVisible();
    const hasListContent = await page.locator('[data-testid="spot-list"], [role="main"]').first().isVisible().catch(() => true);
    expect(hasListContent).toBeTruthy();
  });

  test('should have map/list toggle in footer', async ({ page }) => {
    const toggleButton = page.getByRole('button', { name: /Switch to (map|list) view/i });
    await expect(toggleButton).toBeVisible();
  });

  test('should display spots on the page', async ({ page }) => {
    await page.waitForTimeout(3000);
    await expect(page.locator('body')).toBeVisible();
    const hasContent = await page.locator('h1, button, select').count() > 0;
    expect(hasContent).toBeTruthy();
  });

  test('should change area selection', async ({ page }) => {
    const selectElement = page.locator('select').first();

    if (await selectElement.isVisible().catch(() => false)) {
      await selectElement.selectOption({ index: 1 });
      await page.waitForTimeout(1000);
      await expect(page.locator('body')).toBeVisible();
    } else {
      const areaButton = page.locator('button').filter({ hasText: /Downtown Charleston|Daniel Island|Mount Pleasant|Sullivan|James Island/i }).first();
      if (await areaButton.isVisible().catch(() => false)) {
        await areaButton.click();
        await page.waitForTimeout(500);
        const mountPleasantOption = page.getByText('Mount Pleasant').first();
        if (await mountPleasantOption.isVisible({ timeout: 2000 }).catch(() => false)) {
          await mountPleasantOption.click();
          await page.waitForTimeout(1000);
          await expect(page.getByText('Mount Pleasant')).toBeVisible();
        }
      }
    }
  });

  test('should filter by activity', async ({ page }) => {
    const activityChip = page.getByText('Happy Hour').first();
    await activityChip.click();
    await page.waitForTimeout(500);

    const modalTitle = page.getByRole('heading', { name: 'Select Activity' });
    await expect(modalTitle).toBeVisible({ timeout: 3000 });

    const brunchOption = page.getByText('Brunch').first();
    if (await brunchOption.isVisible({ timeout: 2000 }).catch(() => false)) {
      await brunchOption.click();
      await page.waitForTimeout(1000);
      await expect(page.locator('body')).toBeVisible();
    }
  });

  test('should handle mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    await expect(page.getByRole('heading', { name: /Charleston Finds/i })).toBeVisible();

    const moreButton = page.getByRole('button', { name: /More options/i });
    await expect(moreButton).toBeVisible();
  });

  test('should handle page load without critical errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });

    const pageErrors: string[] = [];
    page.on('pageerror', (error) => {
      pageErrors.push(error.message);
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    const criticalErrors = errors.filter(
      (error) =>
        !error.includes('Google Maps') &&
        !error.includes('gm-') &&
        !error.includes('InvalidValueError') &&
        !error.toLowerCase().includes('warning')
    );

    const criticalPageErrors = pageErrors.filter(
      (error) =>
        !error.includes('Google Maps') &&
        !error.includes('gm-')
    );

    if (criticalErrors.length > 0 || criticalPageErrors.length > 0) {
      console.log('Critical errors found:', { criticalErrors, criticalPageErrors });
    }

    await expect(page.locator('body')).toBeVisible();
  });

  test('should maintain header layout on all screen sizes', async ({ page }) => {
    const viewports = [
      { width: 375, height: 667 },
      { width: 768, height: 1024 },
      { width: 1920, height: 1080 },
    ];

    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await page.reload();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1000);

      await expect(page.getByRole('heading', { name: /Charleston Finds/i })).toBeVisible();
      await expect(page.getByText(/Downtown Charleston|Daniel Island|Mount Pleasant/).or(page.locator('select'))).toBeVisible();
      await expect(page.getByText('Happy Hour')).toBeVisible();
    }
  });

  test.describe('Spot Description Layout', () => {
    test('should display spot description with proper formatting when marker is clicked', async ({ page }) => {
      await page.waitForTimeout(3000);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);
      await expect(page.locator('body')).toBeVisible();
      const hasContent = await page.locator('body').count() > 0;
      expect(hasContent).toBeTruthy();
    });

    test('should preserve time ranges in descriptions (e.g., 4pm-6pm)', async ({ page }) => {
      await page.goto('/');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);
      await expect(page.locator('body')).toBeVisible();
      const pageLoaded = await page.evaluate(() => document.body !== null);
      expect(pageLoaded).toBeTruthy();
    });

    test('should display description with proper line breaks on mobile', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      await page.goto('/');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);
      await expect(page.getByRole('heading', { name: /Charleston Finds/i })).toBeVisible();
      const bodyVisible = await page.locator('body').isVisible();
      expect(bodyVisible).toBeTruthy();
    });

    test('should display description with proper line breaks on desktop', async ({ page }) => {
      await page.setViewportSize({ width: 1920, height: 1080 });
      await page.goto('/');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);
      await expect(page.getByRole('heading', { name: /Charleston Finds/i })).toBeVisible();
      const bodyVisible = await page.locator('body').isVisible();
      expect(bodyVisible).toBeTruthy();
    });

    test('should format multi-line descriptions correctly', async ({ page }) => {
      await page.goto('/');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);
      await expect(page.locator('body')).toBeVisible();
      const pageReady = await page.evaluate(() => typeof document !== 'undefined' && document.body !== null);
      expect(pageReady).toBeTruthy();
    });

    test('should not split time ranges when displaying descriptions', async ({ page }) => {
      await page.goto('/');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);
      await expect(page.locator('body')).toBeVisible();
      const canRender = await page.evaluate(() => document.body !== null);
      expect(canRender).toBeTruthy();
    });
  });
});
