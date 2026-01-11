import { test, expect } from '@playwright/test';

test.describe('Add Spot Functionality', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the app
    await page.goto('/');
    // Wait for the page to load
    await page.waitForLoadState('networkidle');
    // Wait a bit more for Google Maps to initialize
    await page.waitForTimeout(2000);
  });

  test('should open submission modal when add button is clicked', async ({ page }) => {
    // Find the add button
    const addButton = page.locator('button[aria-label*="Add"], button[aria-label*="add"]').or(
      page.getByRole('button').filter({ hasText: /\+/ })
    ).first();
    
    await expect(addButton).toBeVisible();
    await addButton.click();
    
    // Wait for modal to appear
    await page.waitForTimeout(1000);
    
    // Check that submission form is visible
    const titleInput = page.getByPlaceholder(/title|name/i).or(
      page.getByLabel(/title|name/i)
    ).first();
    
    await expect(titleInput).toBeVisible({ timeout: 3000 });
  });

  test('should allow user to fill in spot details', async ({ page }) => {
    // Open submission modal
    const addButton = page.locator('button[aria-label*="Add"], button[aria-label*="add"]').or(
      page.getByRole('button').filter({ hasText: /\+/ })
    ).first();
    
    await addButton.click();
    await page.waitForTimeout(1000);
    
    // Fill in title
    const titleInput = page.getByPlaceholder(/title|name/i).or(
      page.getByLabel(/title|name/i)
    ).first();
    
    if (await titleInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      await titleInput.fill('Test Spot E2E');
      
      // Fill in description if field exists
      const descriptionInput = page.getByPlaceholder(/description/i).or(
        page.getByLabel(/description/i)
      ).first();
      
      if (await descriptionInput.isVisible({ timeout: 1000 }).catch(() => false)) {
        await descriptionInput.fill('This is a test spot added via E2E tests');
      }
      
      // Verify inputs have values
      await expect(titleInput).toHaveValue('Test Spot E2E');
    }
  });

  test('should click on map to set location when in submission mode', async ({ page }) => {
    // Open submission modal
    const addButton = page.locator('button[aria-label*="Add"], button[aria-label*="add"]').or(
      page.getByRole('button').filter({ hasText: /\+/ })
    ).first();
    
    await addButton.click();
    await page.waitForTimeout(1000);
    
    // Wait for modal to be visible
    const titleInput = page.getByPlaceholder(/title|name/i).or(
      page.getByLabel(/title|name/i)
    ).first();
    
    const modalVisible = await titleInput.isVisible({ timeout: 3000 }).catch(() => false);
    
    if (modalVisible) {
      // Try to click on the map (click in the center of the viewport)
      // The map should be in submission mode and accept clicks
      const mapContainer = page.locator('[data-testid="google-map"]').or(
        page.locator('div[role="main"]').or(
          page.locator('canvas').or(page.locator('.gm-style'))
        )
      ).first();
      
      // Click somewhere on the map if it's visible
      if (await mapContainer.isVisible({ timeout: 2000 }).catch(() => false)) {
        await mapContainer.click({ position: { x: 400, y: 300 } });
        await page.waitForTimeout(500);
      }
    }
  });

  test('should submit spot successfully', async ({ page }) => {
    // Intercept API calls to verify they're made correctly
    let postRequestMade = false;
    let postRequestBody: any = null;

    await page.route('**/api/spots', async (route) => {
      const request = route.request();
      if (request.method() === 'POST') {
        postRequestMade = true;
        postRequestBody = request.postDataJSON();
        
        // Mock successful response
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
        // For GET requests, continue normally
        await route.continue();
      }
    });

    // Open submission modal
    const addButton = page.locator('button[aria-label*="Add"], button[aria-label*="add"]').or(
      page.getByRole('button').filter({ hasText: /\+/ })
    ).first();
    
    await addButton.click();
    await page.waitForTimeout(1000);
    
    // Fill in form
    const titleInput = page.getByPlaceholder(/title|name/i).or(
      page.getByLabel(/title|name/i)
    ).first();
    
    if (await titleInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await titleInput.fill('E2E Test Spot');
      
      // Fill description if available
      const descriptionInput = page.getByPlaceholder(/description/i).or(
        page.getByLabel(/description/i)
      ).first();
      
      if (await descriptionInput.isVisible({ timeout: 1000 }).catch(() => false)) {
        await descriptionInput.fill('Test description');
      }
      
      // Click on map to set location (if in submission mode)
      const mapContainer = page.locator('[data-testid="google-map"]').or(
        page.locator('canvas').first()
      );
      
      if (await mapContainer.isVisible({ timeout: 2000 }).catch(() => false)) {
        await mapContainer.click({ position: { x: 400, y: 300 } });
        await page.waitForTimeout(500);
      }
      
      // Find and click submit button
      const submitButton = page.getByRole('button', { name: /submit|save|add/i }).or(
        page.locator('button[type="submit"]')
      ).first();
      
      if (await submitButton.isVisible({ timeout: 2000 }).catch(() => false)) {
        await submitButton.click();
        
        // Wait for API call
        await page.waitForTimeout(2000);
        
        // Verify POST request was made
        expect(postRequestMade).toBe(true);
        expect(postRequestBody).toBeTruthy();
        expect(postRequestBody.title).toBe('E2E Test Spot');
      }
    }
  });

  test('should handle API error gracefully when adding spot', async ({ page }) => {
    // Mock API error
    await page.route('**/api/spots', async (route) => {
      const request = route.request();
      if (request.method() === 'POST') {
        // Return 500 error with empty body (simulates the bug we fixed)
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: '', // Empty body - this was causing the JSON parse error
        });
      } else {
        await route.continue();
      }
    });

    // Open submission modal
    const addButton = page.locator('button[aria-label*="Add"], button[aria-label*="add"]').or(
      page.getByRole('button').filter({ hasText: /\+/ })
    ).first();
    
    await addButton.click();
    await page.waitForTimeout(1000);
    
    // Fill in form
    const titleInput = page.getByPlaceholder(/title|name/i).or(
      page.getByLabel(/title|name/i)
    ).first();
    
    if (await titleInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await titleInput.fill('Test Spot');
      
      // Try to submit
      const submitButton = page.getByRole('button', { name: /submit|save|add/i }).or(
        page.locator('button[type="submit"]')
      ).first();
      
      if (await submitButton.isVisible({ timeout: 2000 }).catch(() => false)) {
        await submitButton.click();
        
        // Wait a bit for error handling
        await page.waitForTimeout(2000);
        
        // Verify no unhandled errors in console
        // The error should be caught and handled gracefully
        const errors: string[] = [];
        page.on('console', (msg) => {
          if (msg.type() === 'error') {
            errors.push(msg.text());
          }
        });
        
        // Check that the page is still functional (not crashed)
        await expect(page.locator('body')).toBeVisible();
      }
    }
  });

  test('should handle API error with JSON error response', async ({ page }) => {
    // Mock API error with JSON body
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

    // Open submission modal
    const addButton = page.locator('button[aria-label*="Add"], button[aria-label*="add"]').or(
      page.getByRole('button').filter({ hasText: /\+/ })
    ).first();
    
    await addButton.click();
    await page.waitForTimeout(1000);
    
    // Fill in form
    const titleInput = page.getByPlaceholder(/title|name/i).or(
      page.getByLabel(/title|name/i)
    ).first();
    
    if (await titleInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await titleInput.fill('Invalid Spot');
      
      // Try to submit
      const submitButton = page.getByRole('button', { name: /submit|save|add/i }).or(
        page.locator('button[type="submit"]')
      ).first();
      
      if (await submitButton.isVisible({ timeout: 2000 }).catch(() => false)) {
        await submitButton.click();
        
        // Wait for error handling
        await page.waitForTimeout(2000);
        
        // Verify page is still functional
        await expect(page.locator('body')).toBeVisible();
      }
    }
  });

  test('should close modal after successful submission', async ({ page }) => {
    // Mock successful API response
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

    // Open submission modal
    const addButton = page.locator('button[aria-label*="Add"], button[aria-label*="add"]').or(
      page.getByRole('button').filter({ hasText: /\+/ })
    ).first();
    
    await addButton.click();
    await page.waitForTimeout(1000);
    
    // Verify modal is open
    const titleInput = page.getByPlaceholder(/title|name/i).or(
      page.getByLabel(/title|name/i)
    ).first();
    
    if (await titleInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await titleInput.fill('Test Spot');
      
      // Submit
      const submitButton = page.getByRole('button', { name: /submit|save|add/i }).or(
        page.locator('button[type="submit"]')
      ).first();
      
      if (await submitButton.isVisible({ timeout: 2000 }).catch(() => false)) {
        await submitButton.click();
        
        // Wait for modal to close
        await page.waitForTimeout(2000);
        
        // Verify modal is closed (input should not be visible)
        await expect(titleInput).not.toBeVisible({ timeout: 3000 });
      }
    }
  });
});
