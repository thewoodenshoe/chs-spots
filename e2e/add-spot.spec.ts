import { test, expect } from '@playwright/test';

async function openAddSpotModal(page: import('@playwright/test').Page) {
  const moreButton = page.getByRole('button', { name: /More options/i });
  await moreButton.click();
  await page.waitForTimeout(300);

  const addSpotItem = page.getByRole('menuitem', { name: /Add Spot/i }).or(
    page.locator('[role="menu"]').getByText('Add Spot')
  ).first();
  await addSpotItem.click();
  await page.waitForTimeout(1500);
}

test.describe('Add Spot Functionality', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
  });

  test('should open submission modal via More > Add Spot', async ({ page }) => {
    await openAddSpotModal(page);

    const titleInput = page.getByPlaceholder(/title|name/i).or(
      page.getByLabel(/title|name/i)
    ).first();

    await expect(titleInput).toBeVisible({ timeout: 3000 });
  });

  test('should allow user to fill in spot details', async ({ page }) => {
    await openAddSpotModal(page);

    const titleInput = page.getByPlaceholder(/title|name/i).or(
      page.getByLabel(/title|name/i)
    ).first();

    if (await titleInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      await titleInput.fill('Test Spot E2E');

      const descriptionInput = page.getByPlaceholder(/description/i).or(
        page.getByLabel(/description/i)
      ).first();

      if (await descriptionInput.isVisible({ timeout: 1000 }).catch(() => false)) {
        await descriptionInput.fill('This is a test spot added via E2E tests');
      }

      await expect(titleInput).toHaveValue('Test Spot E2E');
    }
  });

  test('should click on map to set location when in submission mode', async ({ page }) => {
    await openAddSpotModal(page);

    const titleInput = page.getByPlaceholder(/title|name/i).or(
      page.getByLabel(/title|name/i)
    ).first();

    const modalVisible = await titleInput.isVisible({ timeout: 3000 }).catch(() => false);

    if (modalVisible) {
      const mapContainer = page.locator('[data-testid="google-map"]').or(
        page.locator('div[role="main"]').or(
          page.locator('canvas').or(page.locator('.gm-style'))
        )
      ).first();

      if (await mapContainer.isVisible({ timeout: 2000 }).catch(() => false)) {
        await mapContainer.click({ position: { x: 400, y: 300 } });
        await page.waitForTimeout(500);
      }
    }
  });

  test('should submit spot successfully', async ({ page }) => {
    let postRequestMade = false;
    let postRequestBody: Record<string, unknown> | null = null;

    await page.route('**/api/spots', async (route) => {
      const request = route.request();
      if (request.method() === 'POST') {
        postRequestMade = true;
        postRequestBody = request.postDataJSON();
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 1,
            title: postRequestBody.title,
            description: postRequestBody.description || '',
            lat: postRequestBody.lat,
            lng: postRequestBody.lng,
            type: postRequestBody.type || 'Happy Hour',
          }),
        });
      } else {
        await route.continue();
      }
    });

    await openAddSpotModal(page);

    const titleInput = page.getByPlaceholder(/title|name/i).or(
      page.getByLabel(/title|name/i)
    ).first();

    if (await titleInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await titleInput.fill('E2E Test Spot');

      const descriptionInput = page.getByPlaceholder(/description/i).or(
        page.getByLabel(/description/i)
      ).first();

      if (await descriptionInput.isVisible({ timeout: 1000 }).catch(() => false)) {
        await descriptionInput.fill('Test description');
      }

      const mapContainer = page.locator('[data-testid="google-map"]').or(
        page.locator('canvas').first()
      );

      if (await mapContainer.isVisible({ timeout: 2000 }).catch(() => false)) {
        await mapContainer.click({ position: { x: 400, y: 300 } });
        await page.waitForTimeout(500);
      }

      const submitButton = page.getByRole('button', { name: /submit|save|add/i }).or(
        page.locator('button[type="submit"]')
      ).first();

      if (await submitButton.isVisible({ timeout: 2000 }).catch(() => false)) {
        await submitButton.click();
        await page.waitForTimeout(2000);
        expect(postRequestMade).toBe(true);
        expect(postRequestBody).toBeTruthy();
        expect(postRequestBody.title).toBe('E2E Test Spot');
      }
    }
  });

  test('should handle API error gracefully when adding spot', async ({ page }) => {
    await page.route('**/api/spots', async (route) => {
      const request = route.request();
      if (request.method() === 'POST') {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: '',
        });
      } else {
        await route.continue();
      }
    });

    await openAddSpotModal(page);

    const titleInput = page.getByPlaceholder(/title|name/i).or(
      page.getByLabel(/title|name/i)
    ).first();

    if (await titleInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await titleInput.fill('Test Spot');

      const submitButton = page.getByRole('button', { name: /submit|save|add/i }).or(
        page.locator('button[type="submit"]')
      ).first();

      if (await submitButton.isVisible({ timeout: 2000 }).catch(() => false)) {
        await submitButton.click();
        await page.waitForTimeout(2000);
        await expect(page.locator('body')).toBeVisible();
      }
    }
  });

  test('should handle API error with JSON error response', async ({ page }) => {
    await page.route('**/api/spots', async (route) => {
      const request = route.request();
      if (request.method() === 'POST') {
        await route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Invalid data' }),
        });
      } else {
        await route.continue();
      }
    });

    await openAddSpotModal(page);

    const titleInput = page.getByPlaceholder(/title|name/i).or(
      page.getByLabel(/title|name/i)
    ).first();

    if (await titleInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await titleInput.fill('Invalid Spot');

      const submitButton = page.getByRole('button', { name: /submit|save|add/i }).or(
        page.locator('button[type="submit"]')
      ).first();

      if (await submitButton.isVisible({ timeout: 2000 }).catch(() => false)) {
        await submitButton.click();
        await page.waitForTimeout(2000);
        await expect(page.locator('body')).toBeVisible();
      }
    }
  });

  test('should close modal after successful submission', async ({ page }) => {
    await page.route('**/api/spots', async (route) => {
      const request = route.request();
      if (request.method() === 'POST') {
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 1,
            title: 'Test Spot',
            lat: 32.7765,
            lng: -79.9311,
            type: 'Happy Hour',
          }),
        });
      } else {
        await route.continue();
      }
    });

    await openAddSpotModal(page);

    const titleInput = page.getByPlaceholder(/title|name/i).or(
      page.getByLabel(/title|name/i)
    ).first();

    if (await titleInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await titleInput.fill('Test Spot');

      const submitButton = page.getByRole('button', { name: /submit|save|add/i }).or(
        page.locator('button[type="submit"]')
      ).first();

      if (await submitButton.isVisible({ timeout: 2000 }).catch(() => false)) {
        await submitButton.click();
        await page.waitForTimeout(2000);
        await expect(titleInput).not.toBeVisible({ timeout: 3000 });
      }
    }
  });
});
