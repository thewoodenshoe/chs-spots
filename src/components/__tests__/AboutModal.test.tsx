import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import AboutModal from '../AboutModal';

describe('AboutModal', () => {
  const defaultProps = {
    isOpen: true,
    onClose: jest.fn(),
    lastUpdated: '2026-02-11 12:00:00',
    healthIndicator: <span data-testid="health">OK</span>,
    spotCount: 42,
  };

  beforeEach(() => jest.clearAllMocks());

  it('renders when open', () => {
    render(<AboutModal {...defaultProps} />);
    expect(screen.getByText('About Charleston Finds')).toBeInTheDocument();
  });

  it('does not render when closed', () => {
    render(<AboutModal {...defaultProps} isOpen={false} />);
    expect(screen.queryByText('About Charleston Finds')).not.toBeInTheDocument();
  });

  it('shows spot count', () => {
    render(<AboutModal {...defaultProps} />);
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('spots')).toBeInTheDocument();
  });

  it('shows last updated timestamp', () => {
    render(<AboutModal {...defaultProps} />);
    expect(screen.getByText(/2026-02-11 12:00:00/)).toBeInTheDocument();
  });

  it('shows health indicator', () => {
    render(<AboutModal {...defaultProps} />);
    expect(screen.getByTestId('health')).toBeInTheDocument();
  });

  it('contains privacy & terms section', () => {
    render(<AboutModal {...defaultProps} />);
    expect(screen.getByText(/free community project/i)).toBeInTheDocument();
    expect(screen.getByText(/your own discretion/i)).toBeInTheDocument();
    expect(screen.getByText(/Privacy & Terms/i)).toBeInTheDocument();
  });

  it('contains how-it-works steps', () => {
    render(<AboutModal {...defaultProps} />);
    expect(screen.getByText(/pick an area/i)).toBeInTheDocument();
    expect(screen.getByText(/suggest a new spot/i)).toBeInTheDocument();
    expect(screen.getByText(/suggest an activity/i)).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', () => {
    render(<AboutModal {...defaultProps} />);
    fireEvent.click(screen.getByLabelText('Close'));
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when backdrop is clicked', () => {
    render(<AboutModal {...defaultProps} />);
    const backdrop = document.querySelector('.bg-black\\/40');
    if (backdrop) fireEvent.click(backdrop);
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });

  it('has proper aria attributes for accessibility', () => {
    render(<AboutModal {...defaultProps} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-label', 'About Charleston Finds');
  });
});
