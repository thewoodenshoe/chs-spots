import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import ActivityChip from '../ActivityChip';
import { SpotType } from '../FilterModal';

describe('ActivityChip', () => {
  const mockOnClick = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should not display "All Activities" text', () => {
    render(<ActivityChip activity="Happy Hour" />);

    // Verify "All Activities" is NOT in the document
    expect(screen.queryByText('All Activities')).not.toBeInTheDocument();
  });

  it('should display the provided activity name', () => {
    render(<ActivityChip activity="Happy Hour" />);

    expect(screen.getByText('Happy Hour')).toBeInTheDocument();
    expect(screen.queryByText('All Activities')).not.toBeInTheDocument();
  });

  it('should display different activity names correctly', () => {
    const { rerender } = render(<ActivityChip activity="Fishing Spots" />);
    expect(screen.getByText('Fishing Spots')).toBeInTheDocument();
    expect(screen.queryByText('All Activities')).not.toBeInTheDocument();

    rerender(<ActivityChip activity="Sunset Spots" />);
    expect(screen.getByText('Sunset Spots')).toBeInTheDocument();
    expect(screen.queryByText('All Activities')).not.toBeInTheDocument();
  });

  it('should call onClick when clicked if provided', () => {
    render(<ActivityChip activity="Happy Hour" onClick={mockOnClick} />);

    const button = screen.getByRole('button');
    button.click();

    expect(mockOnClick).toHaveBeenCalledTimes(1);
  });

  it('should render as a div when onClick is not provided', () => {
    render(<ActivityChip activity="Happy Hour" />);

    // Should not be a button
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    // Should contain the activity text
    expect(screen.getByText('Happy Hour')).toBeInTheDocument();
    // Should not contain "All Activities"
    expect(screen.queryByText('All Activities')).not.toBeInTheDocument();
  });

  it('should display icon for each activity type', () => {
    const activities: SpotType[] = [
      'Happy Hour',
      'Fishing Spots',
      'Christmas Spots',
      'Sunset Spots',
      'Pickleball Games',
      'Bike Routes',
      'Golf Cart Hacks',
    ];

    activities.forEach((activity) => {
      const { unmount } = render(<ActivityChip activity={activity} />);
      expect(screen.getByText(activity)).toBeInTheDocument();
      expect(screen.queryByText('All Activities')).not.toBeInTheDocument();
      unmount();
    });
  });
});
