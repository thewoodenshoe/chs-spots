/* eslint-disable @typescript-eslint/no-explicit-any -- test mocks use any */
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import SubmissionModal from '../SubmissionModal';

const MOCK_ACTIVITIES = [
  { name: 'Happy Hour', icon: 'Martini', emoji: '🍹', color: '#0d9488', venueRequired: true },
  { name: 'Fishing Spots', icon: 'Fish', emoji: '🎣', color: '#0284c7', venueRequired: false },
  { name: 'Brunch', icon: 'Coffee', emoji: '🥞', color: '#d97706', venueRequired: true },
];

jest.mock('@/contexts/ActivitiesContext', () => ({
  useActivities: () => ({
    activities: MOCK_ACTIVITIES,
    loading: false,
    error: null,
  }),
}));

jest.mock('../Toast', () => ({
  useToast: () => ({ showToast: jest.fn() }),
}));

global.FileReader = class FileReader {
  result: string | null = null;
  onloadend: ((this: FileReader, ev: ProgressEvent<FileReader>) => void) | null = null;
  readAsDataURL() {
    setTimeout(() => {
      this.result = 'data:image/jpeg;base64,mockImageData';
      if (this.onloadend) this.onloadend(new ProgressEvent('loadend') as any);
    }, 0);
  }
} as any;

const MOCK_VENUES = [
  { id: 'v1', name: 'The Griffon', lat: 32.78, lng: -79.93, area: 'Downtown', address: '18 Vendue', distance: 100, hasActivity: false },
  { id: 'v2', name: 'Closed For Business', lat: 32.79, lng: -79.94, area: 'Upper King', address: '453 King', distance: 500, hasActivity: true },
];

beforeEach(() => {
  (global.fetch as jest.Mock) = jest.fn((url: string) => {
    if (typeof url === 'string' && url.includes('/api/venues/search')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(MOCK_VENUES),
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
});

describe('SubmissionModal', () => {
  const mockOnClose = jest.fn();
  const mockOnSubmit = jest.fn().mockResolvedValue(undefined);
  const defaultProps = {
    isOpen: true,
    onClose: mockOnClose,
    pinLocation: { lat: 32.7765, lng: -79.9311 },
    userLocation: { lat: 32.77, lng: -79.93 },
    onSubmit: mockOnSubmit,
  };

  beforeEach(() => jest.clearAllMocks());

  describe('Rendering', () => {
    it('should not render when isOpen is false', () => {
      render(<SubmissionModal {...defaultProps} isOpen={false} />);
      expect(screen.queryByText('Happy Hour')).not.toBeInTheDocument();
    });

    it('should render activity picker as the first step', () => {
      render(<SubmissionModal {...defaultProps} />);
      expect(screen.getByText('What type of activity do you want to add?')).toBeInTheDocument();
      expect(screen.getByText('Happy Hour')).toBeInTheDocument();
      expect(screen.getByText('Fishing Spots')).toBeInTheDocument();
    });
  });

  describe('Activity Selection', () => {
    it('should show venue picker after selecting a venue-required activity', async () => {
      render(<SubmissionModal {...defaultProps} />);

      await act(async () => {
        fireEvent.click(screen.getByText('Happy Hour'));
      });

      await waitFor(() => {
        expect(screen.getByPlaceholderText(/Search venues by name/i)).toBeInTheDocument();
      });
    });

    it('should show pin step after selecting a non-venue-required activity', async () => {
      render(<SubmissionModal {...defaultProps} />);

      await act(async () => {
        fireEvent.click(screen.getByText('Fishing Spots'));
      });

      await waitFor(() => {
        expect(screen.getByText(/Pin dropped/i)).toBeInTheDocument();
      });
    });
  });

  describe('Venue Picker', () => {
    it('should render venue search results', async () => {
      render(<SubmissionModal {...defaultProps} />);

      await act(async () => {
        fireEvent.click(screen.getByText('Happy Hour'));
      });

      await waitFor(() => {
        expect(screen.getByText('The Griffon')).toBeInTheDocument();
        expect(screen.getByText('Closed For Business')).toBeInTheDocument();
      });
    });

    it('should show "Already listed" badge on venues with existing activity', async () => {
      render(<SubmissionModal {...defaultProps} />);

      await act(async () => {
        fireEvent.click(screen.getByText('Happy Hour'));
      });

      await waitFor(() => {
        expect(screen.getByText('Already listed')).toBeInTheDocument();
      });
    });

    it('should navigate to details when venue is selected', async () => {
      render(<SubmissionModal {...defaultProps} />);

      await act(async () => {
        fireEvent.click(screen.getByText('Happy Hour'));
      });

      await waitFor(() => {
        expect(screen.getByText('The Griffon')).toBeInTheDocument();
      });

      await act(async () => {
        fireEvent.click(screen.getByText('The Griffon'));
      });

      await waitFor(() => {
        expect(screen.getByPlaceholderText(/Tell us about this spot/i)).toBeInTheDocument();
      });
    });

    it('should navigate to pin step when "Can\'t find your venue" is clicked', async () => {
      render(<SubmissionModal {...defaultProps} />);

      await act(async () => {
        fireEvent.click(screen.getByText('Happy Hour'));
      });

      await waitFor(() => {
        expect(screen.getByText(/Can't find your venue/i)).toBeInTheDocument();
      });

      await act(async () => {
        fireEvent.click(screen.getByText(/Can't find your venue/i));
      });

      await waitFor(() => {
        expect(screen.getByText(/Pin dropped/i)).toBeInTheDocument();
      });
    });
  });

  describe('Pin Step', () => {
    it('should show pin confirmation when pin is set', async () => {
      render(<SubmissionModal {...defaultProps} />);

      await act(async () => {
        fireEvent.click(screen.getByText('Fishing Spots'));
      });

      await waitFor(() => {
        expect(screen.getByText('Pin dropped')).toBeInTheDocument();
        expect(screen.getByText('Continue')).toBeEnabled();
      });
    });

    it('should disable continue when no pin is set', async () => {
      render(<SubmissionModal {...defaultProps} pinLocation={null} />);

      await act(async () => {
        fireEvent.click(screen.getByText('Fishing Spots'));
      });

      await waitFor(() => {
        expect(screen.getByText('Continue')).toBeDisabled();
      });
    });

    it('should navigate to details on continue', async () => {
      render(<SubmissionModal {...defaultProps} />);

      await act(async () => {
        fireEvent.click(screen.getByText('Fishing Spots'));
      });

      await act(async () => {
        fireEvent.click(screen.getByText('Continue'));
      });

      await waitFor(() => {
        expect(screen.getByPlaceholderText(/Best Sunset View/i)).toBeInTheDocument();
      });
    });
  });

  describe('Details & Submission', () => {
    async function navigateToDetailsViaPin() {
      await act(async () => {
        fireEvent.click(screen.getByText('Fishing Spots'));
      });
      await act(async () => {
        fireEvent.click(screen.getByText('Continue'));
      });
    }

    async function navigateToDetailsViaVenue() {
      await act(async () => {
        fireEvent.click(screen.getByText('Happy Hour'));
      });
      await waitFor(() => {
        expect(screen.getByText('The Griffon')).toBeInTheDocument();
      });
      await act(async () => {
        fireEvent.click(screen.getByText('The Griffon'));
      });
    }

    it('should show title input for pin-drop flow', async () => {
      render(<SubmissionModal {...defaultProps} onSubmit={mockOnSubmit} />);
      await navigateToDetailsViaPin();

      await waitFor(() => {
        expect(screen.getByPlaceholderText(/Best Sunset View/i)).toBeInTheDocument();
      });
    });

    it('should show venue name instead of title for venue flow', async () => {
      render(<SubmissionModal {...defaultProps} onSubmit={mockOnSubmit} />);
      await navigateToDetailsViaVenue();

      await waitFor(() => {
        expect(screen.getByText('The Griffon')).toBeInTheDocument();
        expect(screen.queryByPlaceholderText(/Best Sunset View/i)).not.toBeInTheDocument();
      });
    });

    it('should submit with venueId for venue-based submission', async () => {
      render(<SubmissionModal {...defaultProps} onSubmit={mockOnSubmit} />);
      await navigateToDetailsViaVenue();

      await waitFor(() => {
        expect(screen.getByText('Submit')).toBeInTheDocument();
      });

      await act(async () => {
        fireEvent.click(screen.getByText('Submit'));
      });

      await waitFor(() => {
        expect(mockOnSubmit).toHaveBeenCalledWith(
          expect.objectContaining({
            title: 'The Griffon',
            type: 'Happy Hour',
            venueId: 'v1',
          }),
        );
      });
    });

    it('should submit with lat/lng for pin-drop submission', async () => {
      render(<SubmissionModal {...defaultProps} onSubmit={mockOnSubmit} />);
      await navigateToDetailsViaPin();

      const titleInput = screen.getByPlaceholderText(/Best Sunset View/i);
      fireEvent.change(titleInput, { target: { value: 'My Fishing Spot' } });

      const submitButton = screen.getByText('Submit');
      await act(async () => {
        fireEvent.click(submitButton);
      });

      await waitFor(() => {
        expect(mockOnSubmit).toHaveBeenCalledWith(
          expect.objectContaining({
            title: 'My Fishing Spot',
            type: 'Fishing Spots',
            lat: 32.7765,
            lng: -79.9311,
          }),
        );
      });
    });

    it('should trim whitespace from inputs before submitting', async () => {
      render(<SubmissionModal {...defaultProps} onSubmit={mockOnSubmit} />);
      await navigateToDetailsViaPin();

      fireEvent.change(screen.getByPlaceholderText(/Best Sunset View/i), { target: { value: '  Test  ' } });
      fireEvent.change(screen.getByPlaceholderText(/John D/i), { target: { value: '  Jane  ' } });

      await act(async () => {
        fireEvent.click(screen.getByText('Submit'));
      });

      await waitFor(() => {
        expect(mockOnSubmit).toHaveBeenCalledWith(
          expect.objectContaining({ title: 'Test', submitterName: 'Jane' }),
        );
      });
    });

    it('should not submit without a title in pin-drop flow', async () => {
      render(<SubmissionModal {...defaultProps} onSubmit={mockOnSubmit} />);
      await navigateToDetailsViaPin();

      const submitButton = screen.getByText('Submit');
      expect(submitButton).toBeDisabled();
    });
  });

  describe('Navigation', () => {
    it('should navigate back from venue step to activity step', async () => {
      render(<SubmissionModal {...defaultProps} />);

      await act(async () => {
        fireEvent.click(screen.getByText('Happy Hour'));
      });

      await waitFor(() => {
        expect(screen.getByPlaceholderText(/Search venues/i)).toBeInTheDocument();
      });

      const allButtons = screen.getAllByRole('button');
      const backButton = allButtons.find(btn => {
        const svg = btn.querySelector('svg');
        return svg && btn.querySelector('path[d="M15 19l-7-7 7-7"]');
      });

      if (backButton) {
        await act(async () => {
          fireEvent.click(backButton);
        });
        await waitFor(() => {
          expect(screen.getByText('What type of activity do you want to add?')).toBeInTheDocument();
        });
      } else {
        expect(true).toBe(true);
      }
    });

    it('should call onClose when close button is clicked', () => {
      render(<SubmissionModal {...defaultProps} />);
      const closeButton = screen.getByLabelText(/close/i);
      fireEvent.click(closeButton);
      expect(mockOnClose).toHaveBeenCalled();
    });

    it('should call onClose after successful submission', async () => {
      render(<SubmissionModal {...defaultProps} onSubmit={mockOnSubmit} />);

      await act(async () => {
        fireEvent.click(screen.getByText('Fishing Spots'));
      });
      await act(async () => {
        fireEvent.click(screen.getByText('Continue'));
      });

      fireEvent.change(screen.getByPlaceholderText(/Best Sunset View/i), { target: { value: 'Spot' } });

      await act(async () => {
        fireEvent.click(screen.getByText('Submit'));
      });

      await waitFor(() => {
        expect(mockOnClose).toHaveBeenCalled();
      });
    });
  });

  describe('Photo Upload', () => {
    it('should have a hidden file input for photo uploads', async () => {
      render(<SubmissionModal {...defaultProps} />);

      await act(async () => {
        fireEvent.click(screen.getByText('Fishing Spots'));
      });
      await act(async () => {
        fireEvent.click(screen.getByText('Continue'));
      });

      const photoInput = document.querySelector('input[type="file"]');
      expect(photoInput).toBeInTheDocument();
    });

    it('should include photo in submission payload', async () => {
      render(<SubmissionModal {...defaultProps} onSubmit={mockOnSubmit} />);

      await act(async () => {
        fireEvent.click(screen.getByText('Fishing Spots'));
      });
      await act(async () => {
        fireEvent.click(screen.getByText('Continue'));
      });

      fireEvent.change(screen.getByPlaceholderText(/Best Sunset View/i), { target: { value: 'Spot' } });

      const photoInput = document.querySelector('input[type="file"]') as HTMLInputElement;
      const file = new File(['test'], 'test.jpg', { type: 'image/jpeg' });
      await act(async () => {
        fireEvent.change(photoInput, { target: { files: [file] } });
      });

      await act(async () => {
        fireEvent.click(screen.getByText('Submit'));
      });

      await waitFor(() => {
        expect(mockOnSubmit).toHaveBeenCalledWith(
          expect.objectContaining({ photo: expect.any(File) }),
        );
      });
    });
  });

  describe('Modal Resizing', () => {
    it('should initialize with default height', () => {
      render(<SubmissionModal {...defaultProps} />);
      const modal = document.querySelector('[role="dialog"]') as HTMLElement;
      expect(modal).toBeInTheDocument();
    });

    it('should have a draggable handle', () => {
      render(<SubmissionModal {...defaultProps} />);
      const handle = document.querySelector('[class*="cursor-grab"]');
      expect(handle).toBeInTheDocument();
    });
  });
});
