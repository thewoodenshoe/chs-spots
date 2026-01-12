# Test Architecture & Implementation Plan

## Feature: Show All Venues Toggle

### Overview
Add a toggle that displays all venues from `venues.json` as red markers on the map, without happy hour information. This is for testing and visualizing all found venues per area.

---

## Architecture Design

### 1. API Layer

#### New Endpoint: `/api/venues`
- **Purpose**: Fetch all venues from `venues.json`
- **Method**: GET
- **Response**: Array of venue objects with `{ id, name, lat, lng, area, website, address }`
- **Filtering**: Optional query params for area filtering
- **Error Handling**: Graceful fallback to empty array if file missing

#### Existing Endpoints (to test):
- `/api/spots` - GET, POST
- `/api/spots/[id]` - GET, PUT, DELETE
- `/api/areas` - GET
- `/api/areas/config` - GET

### 2. Context Layer

#### New Context: `VenuesContext`
- **Purpose**: Manage venues state (similar to SpotsContext)
- **Methods**:
  - `venues: Venue[]` - Array of all venues
  - `loading: boolean` - Loading state
  - `refreshVenues: () => Promise<void>` - Refresh venues from API
- **Integration**: Can be combined with SpotsContext or separate

#### Existing Context (to test):
- `SpotsContext` - CRUD operations for spots

### 3. Component Layer

#### New Component: `VenuesToggle`
- **Purpose**: Toggle button to show/hide all venues
- **Location**: Top bar (near AreaSelector)
- **State**: `showAllVenues: boolean`
- **Visual**: Toggle switch or button with label

#### Modified Component: `MapComponent`
- **New Props**:
  - `showAllVenues?: boolean` - Toggle state
  - `venues?: Venue[]` - Venues data
- **New Logic**:
  - Render red markers for venues when `showAllVenues` is true
  - Filter venues by `selectedArea`
  - Create red marker icon (different from spot markers)
  - Show venue info in InfoWindow (name, address, area, website - no happy hour)

#### Existing Components (to test):
- `AreaSelector` - Area selection dropdown
- `ActivityChip` - Activity type display/selection
- `FilterModal` - Activity filter modal
- `SubmissionModal` - Add new spot
- `EditSpotModal` - Edit existing spot
- `MapComponent` - Map rendering and interactions

---

## Unit Test Architecture

### Test Categories

#### 1. API Route Tests (`src/app/api/__tests__/`)

##### `venues-route.test.ts` (NEW)
```typescript
describe('GET /api/venues', () => {
  - Should return all venues from venues.json
  - Should filter by area query param
  - Should return empty array if file missing
  - Should handle JSON parse errors gracefully
  - Should return correct venue structure
  - Should handle large venue lists (>1000)
})
```

##### `spots-route.test.ts` (ENHANCE)
```typescript
describe('GET /api/spots', () => {
  - Should return all spots from spots.json
  - Should enrich spots with venue area data
  - Should handle missing files gracefully
  - Should transform old format to new format
})

describe('POST /api/spots', () => {
  - Should create new spot with valid data
  - Should validate required fields (title, lat, lng)
  - Should generate unique IDs
  - Should handle file write errors
})
```

##### `spots-[id]-route.test.ts` (NEW)
```typescript
describe('GET /api/spots/[id]', () => {
  - Should return spot by ID
  - Should return 404 for non-existent ID
})

describe('PUT /api/spots/[id]', () => {
  - Should update existing spot
  - Should validate required fields
  - Should return 404 for non-existent ID
})

describe('DELETE /api/spots/[id]', () => {
  - Should delete spot by ID
  - Should return 404 for non-existent ID
})
```

##### `areas-route.test.ts` (ENHANCE)
```typescript
describe('GET /api/areas', () => {
  - Should return all areas
  - Should handle missing file gracefully
})

describe('GET /api/areas/config', () => {
  - Should return areas config with centers
  - Should include all required fields
})
```

#### 2. Context Tests (`src/contexts/__tests__/`)

##### `VenuesContext.test.tsx` (NEW)
```typescript
describe('VenuesContext', () => {
  - Should load venues on mount
  - Should handle API errors gracefully
  - Should provide refreshVenues function
  - Should update loading state correctly
  - Should return empty array on error
})
```

##### `SpotsContext.test.tsx` (ENHANCE)
```typescript
describe('SpotsContext', () => {
  - Should load spots on mount
  - Should add spot successfully
  - Should update spot successfully
  - Should delete spot successfully
  - Should handle API errors gracefully
  - Should refresh spots after mutations
  - Should update loading state correctly
})
```

#### 3. Component Tests (`src/components/__tests__/`)

##### `VenuesToggle.test.tsx` (NEW)
```typescript
describe('VenuesToggle', () => {
  - Should render toggle button
  - Should toggle state on click
  - Should call onToggle callback
  - Should show correct label (Show/Hide All Venues)
  - Should be accessible (ARIA labels)
})
```

##### `MapComponent.test.tsx` (ENHANCE)
```typescript
describe('MapComponent', () => {
  // Existing tests
  - Should render map with spots
  - Should filter spots by area and activity
  - Should show info window on marker click
  - Should handle map click in submission mode
  
  // New tests for venues
  - Should render red venue markers when showAllVenues is true
  - Should filter venues by selectedArea
  - Should show venue info window (name, address, area, website)
  - Should not show happy hour info for venues
  - Should render both spots and venues when both enabled
  - Should handle venue marker clicks
  - Should cluster venue markers
  - Should prioritize spot markers over venue markers (z-index)
})
```

##### `AreaSelector.test.tsx` (ENHANCE)
```typescript
describe('AreaSelector', () => {
  - Should render area dropdown
  - Should call onAreaChange on selection
  - Should display selected area
  - Should load areas from API
  - Should handle API errors gracefully
  - Should be accessible
})
```

##### `ActivityChip.test.tsx` (ENHANCE)
```typescript
describe('ActivityChip', () => {
  - Should display current activity
  - Should call onClick handler
  - Should show correct icon/emoji
  - Should be accessible
})
```

##### `FilterModal.test.tsx` (ENHANCE)
```typescript
describe('FilterModal', () => {
  - Should render when isOpen is true
  - Should not render when isOpen is false
  - Should call onClose on close button
  - Should call onActivityChange on selection
  - Should display all activity types
  - Should highlight selected activity
  - Should be accessible (modal, focus trap)
})
```

##### `SubmissionModal.test.tsx` (ENHANCE)
```typescript
describe('SubmissionModal', () => {
  - Should render when isOpen is true
  - Should not render when isOpen is false
  - Should validate required fields
  - Should call onSubmit with correct data
  - Should handle photo upload
  - Should use pinLocation if provided
  - Should reset form on close
  - Should be accessible
})
```

##### `EditSpotModal.test.tsx` (ENHANCE)
```typescript
describe('EditSpotModal', () => {
  - Should render when isOpen is true
  - Should populate form with spot data
  - Should call onSubmit with updated data
  - Should call onDelete on delete button
  - Should handle photo update
  - Should use editPinLocation if provided
  - Should be accessible
})
```

#### 4. Integration Tests (`src/__tests__/integration/`)

##### `page.integration.test.tsx` (NEW)
```typescript
describe('Home Page Integration', () => {
  - Should render all components
  - Should handle area selection flow
  - Should handle activity selection flow
  - Should handle spot submission flow
  - Should handle spot editing flow
  - Should handle spot deletion flow
  - Should handle venues toggle flow
  - Should maintain state across interactions
  - Should handle errors gracefully
})
```

#### 5. E2E Tests (`e2e/`)

##### `venues-toggle.spec.ts` (NEW)
```typescript
describe('Venues Toggle E2E', () => {
  - Should toggle venues visibility
  - Should show red markers for venues
  - Should filter venues by area
  - Should show venue info on click
  - Should work with spots simultaneously
})
```

##### `app.spec.ts` (ENHANCE)
```typescript
// Add tests for:
  - Venues toggle interaction
  - Combined spots + venues display
  - Area filtering with venues
```

---

## Test Implementation Strategy

### Phase 1: API Tests
1. Create `venues-route.test.ts`
2. Enhance `spots-route.test.ts`
3. Create `spots-[id]-route.test.ts`
4. Enhance `areas-route.test.ts`

### Phase 2: Context Tests
1. Create `VenuesContext` and `VenuesContext.test.tsx`
2. Enhance `SpotsContext.test.tsx`

### Phase 3: Component Tests
1. Create `VenuesToggle` component and test
2. Enhance `MapComponent.test.tsx` with venues tests
3. Enhance all other component tests

### Phase 4: Integration Tests
1. Create `page.integration.test.tsx`

### Phase 5: E2E Tests
1. Create `venues-toggle.spec.ts`
2. Enhance `app.spec.ts`

---

## Test Coverage Goals

### Minimum Coverage Targets:
- **API Routes**: 90%+
- **Contexts**: 85%+
- **Components**: 80%+
- **Integration**: 70%+
- **E2E**: Critical paths only

### Critical Paths to Test:
1. ✅ Load venues from API
2. ✅ Toggle venues visibility
3. ✅ Filter venues by area
4. ✅ Display venue markers (red)
5. ✅ Show venue info window
6. ✅ Combine spots + venues display
7. ✅ Handle errors gracefully

---

## Mock Data

### Venues Mock (`__mocks__/venues.json`)
```json
[
  {
    "id": "ChIJ...",
    "name": "Test Venue 1",
    "lat": 32.845,
    "lng": -79.908,
    "area": "Daniel Island",
    "website": "https://example.com",
    "address": "123 Test St"
  }
]
```

### Spots Mock (`__mocks__/spots.json`)
```json
[
  {
    "id": 1,
    "title": "Test Spot",
    "lat": 32.845,
    "lng": -79.908,
    "description": "Test description",
    "type": "Happy Hour"
  }
]
```

---

## Testing Tools & Setup

### Unit Testing:
- **Framework**: Jest + React Testing Library
- **Location**: `src/**/__tests__/**/*.test.{ts,tsx}`
- **Config**: `jest.config.js`

### E2E Testing:
- **Framework**: Playwright
- **Location**: `e2e/**/*.spec.ts`
- **Config**: `playwright.config.ts`

### Mocking:
- **API**: MSW (Mock Service Worker) for API mocking
- **Google Maps**: Mock `@react-google-maps/api`
- **File System**: Mock `fs` for API route tests

---

## Implementation Checklist

### Backend:
- [ ] Create `/api/venues` route
- [ ] Add area filtering to venues route
- [ ] Add error handling
- [ ] Write API tests

### Frontend:
- [ ] Create `VenuesContext`
- [ ] Create `VenuesToggle` component
- [ ] Modify `MapComponent` to render venues
- [ ] Add red marker icon for venues
- [ ] Add venue InfoWindow
- [ ] Integrate toggle in `page.tsx`
- [ ] Write component tests

### Testing:
- [ ] Write all unit tests
- [ ] Write integration tests
- [ ] Write E2E tests
- [ ] Achieve coverage targets

---

## Notes

- **Performance**: Consider virtualizing markers for large venue lists (>500)
- **Accessibility**: Ensure toggle is keyboard accessible and screen reader friendly
- **UX**: Add visual distinction between spots (colored) and venues (red)
- **State Management**: Consider using Zustand or Redux if state becomes complex
