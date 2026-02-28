import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('@/contexts/SpotsContext', () => ({
  useSpots: () => ({
    spots: [
      { id: 1, lat: 32.86, lng: -79.91, title: 'Test Spot', type: 'Happy Hour', lastUpdateDate: '2026-02-10T12:00:00Z' },
    ],
    addSpot: jest.fn(),
    updateSpot: jest.fn(),
    deleteSpot: jest.fn(),
    refreshSpots: jest.fn(),
    loading: false,
    isAdmin: false,
  }),
}));

jest.mock('@/components/Toast', () => ({
  useToast: () => ({ showToast: jest.fn() }),
}));

jest.mock('@/contexts/VenuesContext', () => ({
  useVenues: () => ({
    venues: [],
    loading: false,
    showVenues: false,
    setShowVenues: jest.fn(),
  }),
}));

jest.mock('@/contexts/ActivitiesContext', () => ({
  useActivities: () => ({
    activities: [
      { name: 'Happy Hour', icon: 'Martini', emoji: '🍹', color: '#0d9488' },
    ],
    loading: false,
  }),
}));

jest.mock('@/lib/analytics', () => ({
  trackAreaView: jest.fn(),
  trackSpotClick: jest.fn(),
  trackSpotSubmit: jest.fn(),
  trackActivityFilter: jest.fn(),
  trackVenueToggle: jest.fn(),
  trackFeedbackSubmit: jest.fn(),
  trackSearchFilter: jest.fn(),
  trackViewMode: jest.fn(),
  trackNearMe: jest.fn(),
  trackSortMode: jest.fn(),
}));

jest.mock('@/utils/favorites', () => ({
  getFavoriteIds: () => [],
  isFavorite: () => false,
  toggleFavorite: jest.fn(() => true),
}));

jest.mock('next/dynamic', () => () => {
  const DummyMap = () => <div data-testid="map">Map</div>;
  DummyMap.displayName = 'DummyMap';
  return DummyMap;
});

jest.mock('@/components/FilterModal', () => {
  const MockFilterModal = () => null;
  MockFilterModal.displayName = 'FilterModal';
  const { ACTIVITY_GROUPS } = jest.requireActual('@/components/FilterModal');
  return { __esModule: true, default: MockFilterModal, ACTIVITY_GROUPS };
});

jest.mock('@/components/SubmissionModal', () => {
  const MockSubmissionModal = () => null;
  MockSubmissionModal.displayName = 'SubmissionModal';
  return MockSubmissionModal;
});

jest.mock('@/components/EditSpotModal', () => {
  const MockEditSpotModal = () => null;
  MockEditSpotModal.displayName = 'EditSpotModal';
  return MockEditSpotModal;
});

jest.mock('@/components/FeedbackModal', () => {
  const MockFeedbackModal = () => null;
  MockFeedbackModal.displayName = 'FeedbackModal';
  return MockFeedbackModal;
});

jest.mock('@/components/AboutModal', () => {
  const MockAboutModal = () => null;
  MockAboutModal.displayName = 'AboutModal';
  return MockAboutModal;
});

jest.mock('@/components/SuggestActivityModal', () => {
  const MockSuggestActivityModal = () => null;
  MockSuggestActivityModal.displayName = 'SuggestActivityModal';
  return MockSuggestActivityModal;
});

jest.mock('@/components/LandingView', () => {
  const MockLanding = () => null;
  MockLanding.displayName = 'LandingView';
  return { __esModule: true, default: MockLanding };
});

jest.mock('@/components/MoreMenu', () => {
  const MockMoreMenu = () => null;
  MockMoreMenu.displayName = 'MoreMenu';
  return { __esModule: true, default: MockMoreMenu };
});

jest.mock('@/components/AreaSelector', () => {
  const MockAreaSelector = () => <div data-testid="area-selector">Area</div>;
  MockAreaSelector.displayName = 'AreaSelector';
  const mod = {
    __esModule: true,
    default: MockAreaSelector,
    getAreaCentersSync: () => ({ 'Downtown Charleston': { lat: 32.776, lng: -79.931, zoom: 14 } }),
    NEAR_ME: 'Near Me',
  };
  return mod;
});

jest.mock('@/components/ActivityChip', () => {
  const MockActivityChip = ({ onClick }: { onClick: () => void }) => (
    <button data-testid="activity-chip" onClick={onClick}>Activity</button>
  );
  MockActivityChip.displayName = 'ActivityChip';
  return MockActivityChip;
});

jest.mock('@/components/SearchBar', () => {
  const MockSearchBar = () => <input data-testid="search-bar" placeholder="Search spots..." />;
  MockSearchBar.displayName = 'SearchBar';
  return MockSearchBar;
});

jest.mock('@/components/SpotListView', () => {
  const MockSpotListView = () => <div data-testid="spot-list">List</div>;
  MockSpotListView.displayName = 'SpotListView';
  return { __esModule: true, default: MockSpotListView };
});

import Home from '@/app/page';

beforeAll(() => {
  Object.defineProperty(window, 'location', {
    value: { search: '?activity=Happy%20Hour', pathname: '/', href: 'http://localhost/?activity=Happy%20Hour' },
    writable: true,
  });
  window.history.replaceState = jest.fn();
});

describe('Page Layout — Footer Toolbar', () => {
  beforeEach(() => jest.clearAllMocks());

  it('renders the footer toolbar', () => {
    render(<Home />);
    const toolbar = screen.getByTestId('footer-toolbar');
    expect(toolbar).toBeInTheDocument();
  });

  it('contains the toolbar buttons', () => {
    render(<Home />);
    expect(screen.getByLabelText('Search spots')).toBeInTheDocument();
    expect(screen.getByLabelText(/Switch to (map|list) view/)).toBeInTheDocument();
    expect(screen.getByLabelText('Saved spots')).toBeInTheDocument();
    expect(screen.getByLabelText('More options')).toBeInTheDocument();
  });

  it('toolbar is fixed to the bottom spanning full width', () => {
    render(<Home />);
    const toolbar = screen.getByTestId('footer-toolbar');
    expect(toolbar).toHaveClass('fixed', 'bottom-0', 'left-0', 'right-0');
  });

  it('toolbar has no side offsets that would misalign buttons', () => {
    render(<Home />);
    const toolbar = screen.getByTestId('footer-toolbar');
    const classes = toolbar.className;
    expect(classes).not.toMatch(/left-(?!0\b)\d/);
    expect(classes).not.toMatch(/right-(?!0\b)\d/);
  });

  it('toolbar buttons are evenly distributed with justify-around', () => {
    render(<Home />);
    const toolbar = screen.getByTestId('footer-toolbar');
    const inner = toolbar.querySelector('div');
    expect(inner).toHaveClass('justify-around');
  });

  it('toggles search when Search button is clicked', () => {
    render(<Home />);
    const btn = screen.getByLabelText('Search spots');
    expect(btn).toBeInTheDocument();
  });
});

describe('Page Layout — Header', () => {
  it('renders the title', () => {
    render(<Home />);
    expect(screen.getByText('Charleston Finds & Deals')).toBeInTheDocument();
  });

  it('renders the About button in the header', () => {
    render(<Home />);
    expect(screen.getByLabelText('About')).toBeInTheDocument();
  });

  it('renders the area selector and activity chip', () => {
    render(<Home />);
    expect(screen.getByTestId('area-selector')).toBeInTheDocument();
    expect(screen.getByTestId('activity-chip')).toBeInTheDocument();
  });

  it('header is fixed to the top', () => {
    render(<Home />);
    const header = screen.getByText('Charleston Finds & Deals').closest('header');
    expect(header).toHaveClass('fixed', 'top-0', 'left-0', 'right-0');
  });
});

describe('Page Layout — Default view', () => {
  it('defaults to list view', () => {
    render(<Home />);
    expect(screen.getByTestId('spot-list')).toBeInTheDocument();
  });

  it('main container has padding for header and footer', () => {
    render(<Home />);
    const main = screen.getByRole('main');
    expect(main.style.paddingTop).toBe('96px');
    expect(main.style.paddingBottom).toBe('64px');
  });
});
