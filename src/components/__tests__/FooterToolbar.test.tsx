import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
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
}));

jest.mock('next/dynamic', () => () => {
  const DummyMap = () => <div data-testid="map">Map</div>;
  DummyMap.displayName = 'DummyMap';
  return DummyMap;
});

jest.mock('@/components/FilterModal', () => {
  const MockFilterModal = () => null;
  MockFilterModal.displayName = 'FilterModal';
  return MockFilterModal;
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

jest.mock('@/components/WelcomeOverlay', () => {
  const MockWelcome = () => null;
  MockWelcome.displayName = 'WelcomeOverlay';
  return { __esModule: true, default: MockWelcome, hasSeenWelcome: () => true };
});

jest.mock('@/components/AreaSelector', () => {
  const MockAreaSelector = () => <div data-testid="area-selector">Area</div>;
  MockAreaSelector.displayName = 'AreaSelector';
  MockAreaSelector.getAreaCentersSync = () => ({ 'Daniel Island': { lat: 32.862, lng: -79.908, zoom: 14 } });
  return MockAreaSelector;
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

import Home from '@/app/page';

describe('Page Layout — Footer Toolbar', () => {
  beforeEach(() => jest.clearAllMocks());

  it('renders the footer toolbar', () => {
    render(<Home />);
    const toolbar = screen.getByTestId('footer-toolbar');
    expect(toolbar).toBeInTheDocument();
  });

  it('contains exactly 5 action buttons', () => {
    render(<Home />);
    const toolbar = screen.getByTestId('footer-toolbar');
    const buttons = toolbar.querySelectorAll('button');
    expect(buttons).toHaveLength(5);
  });

  it('has Nearby button with correct aria-label', () => {
    render(<Home />);
    const btn = screen.getByLabelText('Find closest spot');
    expect(btn).toBeInTheDocument();
    expect(btn.textContent).toContain('Nearby');
  });

  it('has Venues toggle with correct aria-label and aria-pressed', () => {
    render(<Home />);
    const btn = screen.getByLabelText('Show venues');
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveAttribute('aria-pressed', 'false');
    expect(btn.textContent).toContain('Venues');
  });

  it('has Add Spot button in the center', () => {
    render(<Home />);
    const btn = screen.getByLabelText('Add new spot');
    expect(btn).toBeInTheDocument();
    expect(btn.textContent).toContain('Add Spot');
  });

  it('has Suggest button', () => {
    render(<Home />);
    const btn = screen.getByLabelText('Suggest an activity');
    expect(btn).toBeInTheDocument();
    expect(btn.textContent).toContain('Suggest');
  });

  it('has Feedback button', () => {
    render(<Home />);
    const btn = screen.getByLabelText('Send feedback');
    expect(btn).toBeInTheDocument();
    expect(btn.textContent).toContain('Feedback');
  });

  it('toolbar is fixed to the bottom spanning full width (left-0 to right-0)', () => {
    render(<Home />);
    const toolbar = screen.getByTestId('footer-toolbar');
    expect(toolbar).toHaveClass('fixed', 'bottom-0', 'left-0', 'right-0');
  });

  it('toolbar has no side offsets that would misalign buttons', () => {
    render(<Home />);
    const toolbar = screen.getByTestId('footer-toolbar');
    const classes = toolbar.className;
    // Must NOT have old-style offsets like left-24, right-6, etc.
    expect(classes).not.toMatch(/left-(?!0\b)\d/);
    expect(classes).not.toMatch(/right-(?!0\b)\d/);
  });

  it('toolbar buttons are evenly distributed with justify-around', () => {
    render(<Home />);
    const toolbar = screen.getByTestId('footer-toolbar');
    const inner = toolbar.querySelector('div');
    expect(inner).toHaveClass('justify-around');
  });

  it('no floating button groups exist outside the toolbar', () => {
    render(<Home />);
    const root = screen.getByTestId('footer-toolbar').closest('div.relative');
    // There should be no bottom-6 positioned divs (old FAB groups)
    const floatingDivs = root?.querySelectorAll('div.fixed.bottom-6') ?? [];
    expect(floatingDivs).toHaveLength(0);
  });

  it('Venues toggle changes aria-label when clicked', () => {
    render(<Home />);
    const btn = screen.getByLabelText('Show venues');
    fireEvent.click(btn);
    expect(screen.getByLabelText('Hide venues')).toBeInTheDocument();
    expect(screen.getByLabelText('Hide venues')).toHaveAttribute('aria-pressed', 'true');
  });

  it('dispatches findClosestSpot event when Nearby is clicked', () => {
    const spy = jest.fn();
    window.addEventListener('findClosestSpot', spy);

    render(<Home />);
    fireEvent.click(screen.getByLabelText('Find closest spot'));
    expect(spy).toHaveBeenCalledTimes(1);

    window.removeEventListener('findClosestSpot', spy);
  });
});

describe('Page Layout — Header', () => {
  it('renders the title', () => {
    render(<Home />);
    expect(screen.getByText('Charleston Finds')).toBeInTheDocument();
  });

  it('renders the About button in the header', () => {
    render(<Home />);
    expect(screen.getByLabelText('About Charleston Finds')).toBeInTheDocument();
  });

  it('renders the search bar', () => {
    render(<Home />);
    expect(screen.getByTestId('search-bar')).toBeInTheDocument();
  });

  it('renders the area selector and activity chip', () => {
    render(<Home />);
    expect(screen.getByTestId('area-selector')).toBeInTheDocument();
    expect(screen.getByTestId('activity-chip')).toBeInTheDocument();
  });

  it('header is fixed to the top', () => {
    render(<Home />);
    const header = screen.getByText('Charleston Finds').closest('div.fixed');
    expect(header).toHaveClass('fixed', 'top-0', 'left-0', 'right-0');
  });
});

describe('Page Layout — Map area', () => {
  it('renders the map component', () => {
    render(<Home />);
    expect(screen.getByTestId('map')).toBeInTheDocument();
  });

  it('map container has padding for header and footer', () => {
    render(<Home />);
    const mapContainer = screen.getByTestId('map').parentElement;
    expect(mapContainer).toBeTruthy();
    expect(mapContainer!.style.paddingTop).toBe('165px');
    expect(mapContainer!.style.paddingBottom).toBe('72px');
  });
});
