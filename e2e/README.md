# Playwright E2E Tests

End-to-end tests for CHS Finds using Playwright.

## Running Tests

```bash
# Run all tests (headless)
npm run test:e2e

# Run tests with UI mode (interactive)
npm run test:e2e:ui

# Run tests in headed mode (see browser)
npm run test:e2e:headed

# Debug tests
npm run test:e2e:debug
```

## Test Coverage

The tests cover:
- ✅ Page load and header visibility
- ✅ Area selector functionality
- ✅ Activity filter modal
- ✅ Add spot button and submission modal
- ✅ Map display
- ✅ Mobile viewport support
- ✅ Error handling
- ✅ Closest nearby button

## Configuration

Tests are configured in `playwright.config.ts`:
- Automatically starts dev server before tests
- Tests against Chrome, Firefox, Safari, and mobile viewports
- Generates HTML reports on failure
- Screenshots on failure

## Notes

- Tests require the dev server to be running (auto-started)
- Google Maps may take a moment to load - tests include appropriate waits
- Some Google Maps warnings in console are expected and filtered out