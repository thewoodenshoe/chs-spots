import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import FilterModal, { SpotType } from '../FilterModal';

const ALL_ACTIVITIES = [
  { name: 'Happy Hour', icon: 'Martini', emoji: '🍹', color: '#0d9488' },
  { name: 'Brunch', icon: 'Coffee', emoji: '🥞', color: '#d97706' },
  { name: 'Live Music', icon: 'Music', emoji: '🎵', color: '#7c3aed' },
  { name: 'Coffee Shops', icon: 'Coffee', emoji: '☕', color: '#92400e' },
  { name: 'Rooftop Bars', icon: 'Building', emoji: '🏙️', color: '#6366f1' },
  { name: 'Dog-Friendly', icon: 'Dog', emoji: '🐕', color: '#16a34a' },
  { name: 'Landmarks & Attractions', icon: 'Landmark', emoji: '🏛️', color: '#b45309' },
  { name: 'Recently Opened', icon: 'Sparkles', emoji: '🆕', color: '#16a34a' },
  { name: 'Coming Soon', icon: 'Clock', emoji: '🔜', color: '#7c3aed' },
];

jest.mock('@/contexts/ActivitiesContext', () => ({
  useActivities: () => ({
    activities: ALL_ACTIVITIES,
    loading: false,
    error: null,
  }),
}));

describe('FilterModal', () => {
  const mockOnClose = jest.fn();
  const mockOnActivityChange = jest.fn();

  const spotCounts: Record<string, number> = {
    'Happy Hour': 203,
    'Brunch': 118,
    'Live Music': 15,
    'Coffee Shops': 22,
    'Rooftop Bars': 8,
    'Dog-Friendly': 31,
    'Landmarks & Attractions': 12,
    'Recently Opened': 0,
    'Coming Soon': 0,
  };

  const defaultProps = {
    isOpen: true,
    onClose: mockOnClose,
    selectedActivity: 'Happy Hour' as SpotType,
    onActivityChange: mockOnActivityChange,
    spotCounts,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('displays grouped activity sections', () => {
    render(<FilterModal {...defaultProps} />);

    expect(screen.getByText("What's Happening")).toBeInTheDocument();
  });

  it('shows pipeline-backed activities and hides empty time-based ones', () => {
    render(<FilterModal {...defaultProps} />);

    expect(screen.getByText('Happy Hour')).toBeInTheDocument();
    expect(screen.getByText('Brunch')).toBeInTheDocument();
    expect(screen.getByText('Live Music')).toBeInTheDocument();

    expect(screen.queryByText('Recently Opened')).not.toBeInTheDocument();
    expect(screen.queryByText('Coming Soon')).not.toBeInTheDocument();
  });

  it('shows Recently Opened when it has spots', () => {
    const countsWithNew = { ...spotCounts, 'Recently Opened': 3 };
    render(<FilterModal {...defaultProps} spotCounts={countsWithNew} />);

    expect(screen.getByText('Recently Opened')).toBeInTheDocument();
    expect(screen.getByText("What's New")).toBeInTheDocument();
  });

  it('calls onActivityChange and closes menu when an activity is clicked', () => {
    render(<FilterModal {...defaultProps} />);

    screen.getByText('Brunch').click();

    expect(mockOnActivityChange).toHaveBeenCalledWith('Brunch');
    expect(mockOnActivityChange).toHaveBeenCalledTimes(1);
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('shows spot counts next to each activity', () => {
    render(<FilterModal {...defaultProps} />);

    expect(screen.getByText('203')).toBeInTheDocument();
    expect(screen.getByText('118')).toBeInTheDocument();
    expect(screen.getByText('15')).toBeInTheDocument();
  });

  it('does not render when isOpen is false', () => {
    render(<FilterModal {...defaultProps} isOpen={false} />);

    expect(screen.queryByText('Select Activity')).not.toBeInTheDocument();
    expect(screen.queryByText('Happy Hour')).not.toBeInTheDocument();
  });

  it('shows Explore group with all explore activities', () => {
    render(<FilterModal {...defaultProps} />);

    expect(screen.getByText('Explore')).toBeInTheDocument();
    expect(screen.getByText('Coffee Shops')).toBeInTheDocument();
    expect(screen.getByText('Rooftop Bars')).toBeInTheDocument();
    expect(screen.getByText('Dog-Friendly')).toBeInTheDocument();
    expect(screen.getByText('Landmarks & Attractions')).toBeInTheDocument();
  });

  it('every known activity appears in ACTIVITY_GROUPS', () => {
    render(<FilterModal {...defaultProps} spotCounts={{ ...spotCounts, 'Recently Opened': 1, 'Coming Soon': 1 }} />);

    for (const activity of ALL_ACTIVITIES) {
      expect(screen.getByText(activity.name)).toBeInTheDocument();
    }
  });
});
