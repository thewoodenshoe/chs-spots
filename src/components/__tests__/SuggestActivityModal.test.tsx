import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import SuggestActivityModal from '../SuggestActivityModal';

// Suppress scrollIntoView not implemented in jsdom
beforeAll(() => {
  Element.prototype.scrollIntoView = jest.fn();
});

describe('SuggestActivityModal', () => {
  const defaultProps = {
    isOpen: true,
    onClose: jest.fn(),
    onSuccess: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
  });

  it('renders when open', () => {
    render(<SuggestActivityModal {...defaultProps} />);
    expect(screen.getByText('Suggest an Activity')).toBeInTheDocument();
  });

  it('does not render when closed', () => {
    render(<SuggestActivityModal {...defaultProps} isOpen={false} />);
    expect(screen.queryByText('Suggest an Activity')).not.toBeInTheDocument();
  });

  it('has name input', () => {
    render(<SuggestActivityModal {...defaultProps} />);
    const nameInput = screen.getByPlaceholderText('Your name (optional)');
    expect(nameInput).toBeInTheDocument();
  });

  it('has activity name input marked as required', () => {
    render(<SuggestActivityModal {...defaultProps} />);
    const activityInput = screen.getByPlaceholderText(/activity name/i);
    expect(activityInput).toHaveAttribute('required');
  });

  it('submits successfully and calls onSuccess', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true });

    render(<SuggestActivityModal {...defaultProps} />);
    fireEvent.change(screen.getByPlaceholderText('Your name (optional)'), { target: { value: 'John' } });
    fireEvent.change(screen.getByPlaceholderText(/activity name/i), { target: { value: 'Sunset Tours' } });
    fireEvent.click(screen.getByText('Submit Suggestion'));

    await waitFor(() => {
      expect(defaultProps.onSuccess).toHaveBeenCalledTimes(1);
    });

    expect(global.fetch).toHaveBeenCalledWith('/api/activities/suggest', expect.objectContaining({
      method: 'POST',
    }));
  });

  it('shows error message on API failure', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ error: 'Rate limited' }),
    });

    render(<SuggestActivityModal {...defaultProps} />);
    fireEvent.change(screen.getByPlaceholderText('Your name (optional)'), { target: { value: 'John' } });
    fireEvent.change(screen.getByPlaceholderText(/activity name/i), { target: { value: 'Sunset Tours' } });
    fireEvent.click(screen.getByText('Submit Suggestion'));

    expect(await screen.findByText('Rate limited')).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', () => {
    render(<SuggestActivityModal {...defaultProps} />);
    fireEvent.click(screen.getByLabelText('Close'));
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });

  it('has required activity name field', () => {
    render(<SuggestActivityModal {...defaultProps} />);
    const activityInput = screen.getByPlaceholderText(/activity name/i);
    expect(activityInput).toHaveAttribute('required');
  });
});
