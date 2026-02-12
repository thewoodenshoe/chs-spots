import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import FilterModal, { SpotType } from '../FilterModal';

// Mock activities context
jest.mock('@/contexts/ActivitiesContext', () => ({
  useActivities: () => ({
    activities: [
      { name: 'Happy Hour', icon: 'Martini', emoji: '🍹', color: '#0d9488' },
      { name: 'Fishing Spots', icon: 'Fish', emoji: '🎣', color: '#0284c7' },
      { name: 'Sunset Spots', icon: 'Sunset', emoji: '🌅', color: '#f59e0b' },
      { name: 'Christmas Spots', icon: 'Gift', emoji: '🎄', color: '#f97316' },
      { name: 'Pickleball Games', icon: 'Activity', emoji: '🏓', color: '#10b981' },
      { name: 'Bike Routes', icon: 'Bike', emoji: '🚴', color: '#6366f1' },
      { name: 'Golf Cart Hacks', icon: 'Car', emoji: '🛺', color: '#8b5cf6' },
    ],
    loading: false,
    error: null,
  }),
}));

describe('FilterModal', () => {
  const mockOnClose = jest.fn();
  const mockOnActivityChange = jest.fn();

  const defaultProps = {
    isOpen: true,
    onClose: mockOnClose,
    selectedActivity: 'Happy Hour' as SpotType,
    onActivityChange: mockOnActivityChange,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should not display "All Activities" option', () => {
    render(<FilterModal {...defaultProps} />);

    // Verify "All Activities" is NOT in the document
    expect(screen.queryByText('All Activities')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/all activities/i)).not.toBeInTheDocument();
  });

  it('should display all activity options except "All Activities"', () => {
    render(<FilterModal {...defaultProps} />);

    // Verify all expected activities are present
    expect(screen.getByText('Happy Hour')).toBeInTheDocument();
    expect(screen.getByText('Fishing Spots')).toBeInTheDocument();
    expect(screen.getByText('Christmas Spots')).toBeInTheDocument();
    expect(screen.getByText('Sunset Spots')).toBeInTheDocument();
    expect(screen.getByText('Pickleball Games')).toBeInTheDocument();
    expect(screen.getByText('Bike Routes')).toBeInTheDocument();
    expect(screen.getByText('Golf Cart Hacks')).toBeInTheDocument();

    // Verify "All Activities" is NOT present
    expect(screen.queryByText('All Activities')).not.toBeInTheDocument();
  });

  it('should have correct number of activity options (7, not 8)', () => {
    render(<FilterModal {...defaultProps} />);

    // Count radio buttons - should be 7 activities (no "All Activities")
    const radioButtons = screen.getAllByRole('radio');
    expect(radioButtons).toHaveLength(7);

    // Verify none of them are "All Activities"
    radioButtons.forEach((radio) => {
      const label = radio.closest('label');
      if (label) {
        expect(label.textContent).not.toContain('All Activities');
      }
    });
  });

  it('should call onActivityChange when an activity is selected', () => {
    render(<FilterModal {...defaultProps} />);

    const fishingSpotsRadio = screen.getByLabelText('Fishing Spots');
    fishingSpotsRadio.click();

    expect(mockOnActivityChange).toHaveBeenCalledWith('Fishing Spots');
    expect(mockOnActivityChange).toHaveBeenCalledTimes(1);
  });

  it('should highlight the selected activity', () => {
    render(<FilterModal {...defaultProps} selectedActivity="Fishing Spots" />);

    const fishingSpotsRadio = screen.getByLabelText('Fishing Spots') as HTMLInputElement;
    expect(fishingSpotsRadio.checked).toBe(true);

    const happyHourRadio = screen.getByLabelText('Happy Hour') as HTMLInputElement;
    expect(happyHourRadio.checked).toBe(false);
  });

  it('should not render when isOpen is false', () => {
    render(<FilterModal {...defaultProps} isOpen={false} />);

    expect(screen.queryByText('Select Activity')).not.toBeInTheDocument();
    expect(screen.queryByText('Happy Hour')).not.toBeInTheDocument();
  });
});
