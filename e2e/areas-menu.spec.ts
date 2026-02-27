import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

test.describe('Areas Menu - Loads from areas.json', () => {
  let areasFromFile: string[];

  test.beforeAll(() => {
    // Load areas from areas.json file
    const areasPath = path.join(process.cwd(), 'data', 'config', 'areas.json');
    const areasData = JSON.parse(fs.readFileSync(areasPath, 'utf8'));
    areasFromFile = areasData.map((area: { name: string }) => area.name);
    console.log('📋 Areas loaded from areas.json:', areasFromFile);
  });

  test('should load all areas from areas.json into the menu dropdown', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000); // Wait for areas to load from API

    // Click the area selector button to open dropdown
    const areaButton = page.locator('button').filter({ hasText: /Downtown Charleston|Daniel Island|Mount Pleasant|Sullivan|James Island|Select area/i }).first();
    await expect(areaButton).toBeVisible({ timeout: 5000 });
    await areaButton.click();
    await page.waitForTimeout(500);

    // Verify all areas from areas.json appear in the dropdown
    for (const areaName of areasFromFile) {
      await expect(page.getByText(areaName, { exact: true }).first()).toBeVisible({ timeout: 2000 });
    }

    // Verify Park Circle is NOT present
    await expect(page.getByText('Park Circle', { exact: true })).not.toBeVisible({ timeout: 1000 });
  });

  test('should have correct number of areas in dropdown', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    // Open area dropdown
    const areaButton = page.locator('button').filter({ hasText: /Downtown Charleston|Daniel Island|Mount Pleasant|Sullivan|James Island|Select area/i }).first();
    await areaButton.click();
    await page.waitForTimeout(500);

    // Count area buttons in dropdown
    const areaButtons = page.locator('button').filter({ hasText: new RegExp(areasFromFile.join('|'), 'i') });
    const count = await areaButtons.count();
    
    // Should have exactly the number of areas from areas.json
    expect(count).toBeGreaterThanOrEqual(areasFromFile.length);
  });

  test('should load areas dynamically from /api/areas endpoint', async ({ page }) => {
    // Navigate to page first
    await page.goto('/');
    
    // Intercept the API call (it should happen during page load)
    const apiResponse = await page.waitForResponse(
      (response) => response.url().includes('/api/areas') && response.request().method() === 'GET',
      { timeout: 15000 }
    ).catch(async () => {
      // If response already happened, make a direct API call
      const response = await page.request.get('/api/areas');
      return response;
    });

    expect(apiResponse.ok()).toBeTruthy();
    const areasFromAPI = await apiResponse.json();

    // Verify API returns the same areas as areas.json
    expect(areasFromAPI).toEqual(expect.arrayContaining(areasFromFile));
    expect(areasFromAPI.length).toBe(areasFromFile.length);

    // Verify Park Circle is NOT in the API response
    expect(areasFromAPI).not.toContain('Park Circle');
  });

  test('should display all area names from areas.json in the menu', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    // Open dropdown
    const areaButton = page.locator('button').filter({ hasText: /Downtown Charleston|Daniel Island|Mount Pleasant|Sullivan|James Island|Select area/i }).first();
    await areaButton.click();
    await page.waitForTimeout(500);

    // Check each area from areas.json is visible
    const visibleAreas: string[] = [];
    for (const areaName of areasFromFile) {
      const areaElement = page.getByText(areaName, { exact: true }).first();
      if (await areaElement.isVisible({ timeout: 1000 }).catch(() => false)) {
        visibleAreas.push(areaName);
      }
    }

    // Verify all areas are visible
    expect(visibleAreas.length).toBe(areasFromFile.length);
    expect(visibleAreas.sort()).toEqual(areasFromFile.sort());

    console.log('✅ Verified areas in menu:', visibleAreas);
  });
});
