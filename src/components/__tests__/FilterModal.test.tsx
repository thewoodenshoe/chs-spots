import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import FilterModal, { SpotType } from '../FilterModal';

jest.mock('@/contexts/ActivitiesContext', () => ({
  useActivities: () => ({
    activities: [
      { name: 'Happy Hour', icon: 'Martini', emoji: '🍹', color: '#0d9488' },
      { name: 'Brunch', icon: 'Coffee', emoji: '🥞', color: '#d97706' },
      { name: 'Live Music', icon: 'Music', emoji: '🎵', color: '#7c3aed' },
      { name: 'Recently Opened', icon: 'Sparkles', emoji: '🆕', color: '#16a34a' },
      { name: 'Coming Soon', icon: 'Clock', emoji: '🔜', color: '#7c3aed' },
    ],
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
});
