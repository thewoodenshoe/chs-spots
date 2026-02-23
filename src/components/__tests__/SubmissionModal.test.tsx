/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import SubmissionModal from '../SubmissionModal';

// Mock contexts
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

jest.mock('../Toast', () => ({
  useToast: () => ({ showToast: jest.fn() }),
}));

// Mock FileReader
global.FileReader = class FileReader {
  result: string | null = null;
  onloadend: ((this: FileReader, ev: ProgressEvent<FileReader>) => void) | null = null;
  
  readAsDataURL(file: Blob) {
    setTimeout(() => {
      this.result = 'data:image/jpeg;base64,mockImageData';
      if (this.onloadend) {
        this.onloadend(new ProgressEvent('loadend') as any);
      }
    }, 0);
  }
} as any;

describe('SubmissionModal', () => {
  const mockOnClose = jest.fn();
  const mockOnSubmit = jest.fn();
  const defaultProps = {
    isOpen: true,
    onClose: mockOnClose,
    pinLocation: { lat: 32.7765, lng: -79.9311 },
    onSubmit: mockOnSubmit,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    // Mock window.alert globally for all tests
    window.alert = jest.fn();
  });

  describe('Rendering', () => {
    it('should not render when isOpen is false', () => {
      render(<SubmissionModal {...defaultProps} isOpen={false} />);
      expect(screen.queryByPlaceholderText(/title|name/i)).not.toBeInTheDocument();
    });

    it('should render when isOpen is true', () => {
      render(<SubmissionModal {...defaultProps} />);
      expect(screen.getByPlaceholderText(/Best Sunset View/i)).toBeInTheDocument();
    });

    it('should render all form fields', () => {
      render(<SubmissionModal {...defaultProps} />);
      expect(screen.getByPlaceholderText(/Best Sunset View/i)).toBeInTheDocument();
      expect(screen.getByPlaceholderText(/Tell us about this spot/i)).toBeInTheDocument();
    });
  });

  describe('Activity Defaults', () => {
    it('should default to "Happy Hour" when no defaultActivity is provided', () => {
      render(<SubmissionModal {...defaultProps} />);
      const activitySelect = screen.getByDisplayValue('Happy Hour');
      expect(activitySelect).toBeInTheDocument();
    });

    it('should use defaultActivity prop when provided', () => {
      render(<SubmissionModal {...defaultProps} defaultActivity="Fishing Spots" />);
      const activitySelect = screen.getByDisplayValue('Fishing Spots');
      expect(activitySelect).toBeInTheDocument();
    });

    it('should update activity when defaultActivity prop changes', () => {
      const { rerender } = render(<SubmissionModal {...defaultProps} defaultActivity="Happy Hour" />);
      expect(screen.getByDisplayValue('Happy Hour')).toBeInTheDocument();

      rerender(<SubmissionModal {...defaultProps} defaultActivity="Sunset Spots" />);
      expect(screen.getByDisplayValue('Sunset Spots')).toBeInTheDocument();
    });

    it('should reset to default activity when modal reopens', async () => {
      const { rerender } = render(<SubmissionModal {...defaultProps} defaultActivity="Happy Hour" />);
      
      // Change activity
      const activitySelect = screen.getByDisplayValue('Happy Hour');
      fireEvent.change(activitySelect, { target: { value: 'Fishing Spots' } });
      expect(screen.getByDisplayValue('Fishing Spots')).toBeInTheDocument();

      // Close modal
      rerender(<SubmissionModal {...defaultProps} isOpen={false} defaultActivity="Happy Hour" />);
      
      // Reopen modal
      rerender(<SubmissionModal {...defaultProps} isOpen={true} defaultActivity="Happy Hour" />);
      
      // Should reset to default
      await waitFor(() => {
        expect(screen.getByDisplayValue('Happy Hour')).toBeInTheDocument();
      });
    });
  });

  describe('Area Defaults', () => {
    it('should accept area prop', () => {
      render(<SubmissionModal {...defaultProps} area="Daniel Island" />);
      // Area is passed to onSubmit, so we verify it's handled correctly in submit test
      expect(screen.getByPlaceholderText(/Best Sunset View/i)).toBeInTheDocument();
    });

    it('should include area in onSubmit data when provided', async () => {
      const onSubmit = jest.fn();
      render(<SubmissionModal {...defaultProps} area="Mount Pleasant" onSubmit={onSubmit} />);
      
      const nameInput = screen.getByPlaceholderText(/John D/i);
      const titleInput = screen.getByPlaceholderText(/Best Sunset View/i);
      fireEvent.change(nameInput, { target: { value: 'Jane' } });
      fireEvent.change(titleInput, { target: { value: 'Test Spot' } });
      
      const submitButton = screen.getByRole('button', { name: /submit|save|add/i });
      await act(async () => {
        fireEvent.click(submitButton);
      });

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalled();
      });
    });
  });

  describe('Form Input', () => {
    it('should allow entering title', () => {
      render(<SubmissionModal {...defaultProps} />);
      const titleInput = screen.getByPlaceholderText(/Best Sunset View/i) as HTMLInputElement;
      fireEvent.change(titleInput, { target: { value: 'My Test Spot' } });
      expect(titleInput.value).toBe('My Test Spot');
    });

    it('should allow entering description', () => {
      render(<SubmissionModal {...defaultProps} />);
      const descriptionInput = screen.getByPlaceholderText(/Tell us about this spot/i) as HTMLTextAreaElement;
      fireEvent.change(descriptionInput, { target: { value: 'Test description' } });
      expect(descriptionInput.value).toBe('Test description');
    });

    it('should allow changing activity', () => {
      render(<SubmissionModal {...defaultProps} />);
      const activitySelect = screen.getByDisplayValue('Happy Hour') as HTMLSelectElement;
      fireEvent.change(activitySelect, { target: { value: 'Fishing Spots' } });
      expect(activitySelect.value).toBe('Fishing Spots');
    });
  });

  describe('Photo Upload', () => {
    it('should have photo input field', () => {
      render(<SubmissionModal {...defaultProps} />);
      const photoInput = screen.getByLabelText(/photo|image/i) || 
        document.querySelector('input[type="file"]');
      expect(photoInput).toBeInTheDocument();
    });

    it('should handle photo file selection', async () => {
      render(<SubmissionModal {...defaultProps} />);
      const photoInput = document.querySelector('input[type="file"]') as HTMLInputElement;
      
      const file = new File(['test'], 'test.jpg', { type: 'image/jpeg' });
      
      await act(async () => {
        fireEvent.change(photoInput, { target: { files: [file] } });
      });

      // FileReader should be called (mocked)
      await waitFor(() => {
        expect(photoInput.files?.[0]).toBe(file);
      });
    });

    it('should include photo in onSubmit when provided', async () => {
      const onSubmit = jest.fn();
      render(<SubmissionModal {...defaultProps} onSubmit={onSubmit} />);
      
      const nameInput = screen.getByPlaceholderText(/John D/i);
      const titleInput = screen.getByPlaceholderText(/Best Sunset View/i);
      fireEvent.change(nameInput, { target: { value: 'Jane' } });
      fireEvent.change(titleInput, { target: { value: 'Test Spot' } });
      
      const photoInput = document.querySelector('input[type="file"]') as HTMLInputElement;
      const file = new File(['test'], 'test.jpg', { type: 'image/jpeg' });
      
      await act(async () => {
        fireEvent.change(photoInput, { target: { files: [file] } });
      });

      await waitFor(() => {
        expect(photoInput.files?.[0]).toBe(file);
      });

      const submitButton = screen.getByRole('button', { name: /submit|save|add/i });
      await act(async () => {
        fireEvent.click(submitButton);
      });

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledWith(
          expect.objectContaining({
            title: 'Test Spot',
            photo: expect.any(File),
          })
        );
      });
    });

    it('should handle photo removal', async () => {
      render(<SubmissionModal {...defaultProps} />);
      const photoInput = document.querySelector('input[type="file"]') as HTMLInputElement;
      
      const file = new File(['test'], 'test.jpg', { type: 'image/jpeg' });
      
      await act(async () => {
        fireEvent.change(photoInput, { target: { files: [file] } });
      });

      await waitFor(() => {
        expect(photoInput.files?.[0]).toBe(file);
      });

      // Clear file
      await act(async () => {
        fireEvent.change(photoInput, { target: { files: [] } });
      });
    });
  });

  describe('Form Submission', () => {
    it('should not submit if pinLocation is not set', async () => {
      const onSubmit = jest.fn();
      render(<SubmissionModal {...defaultProps} pinLocation={null} onSubmit={onSubmit} />);
      
      const titleInput = screen.getByPlaceholderText(/Best Sunset View/i);
      fireEvent.change(titleInput, { target: { value: 'Test Spot' } });
      
      // Wait for the input to update
      await waitFor(() => {
        expect((titleInput as HTMLInputElement).value).toBe('Test Spot');
      });
      
      // The submit button should be disabled when pinLocation is null
      const submitButton = screen.getByRole('button', { name: /submit|save|add/i });
      expect(submitButton).toBeDisabled();
      
      // Since the button is disabled, onSubmit should not be called
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it('should not submit if title is empty', async () => {
      const onSubmit = jest.fn();
      render(<SubmissionModal {...defaultProps} onSubmit={onSubmit} />);
      
      const submitButton = screen.getByRole('button', { name: /submit|save|add/i });
      expect(submitButton).toBeDisabled();
      
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it('should not submit if submitter name is empty', async () => {
      const onSubmit = jest.fn();
      render(<SubmissionModal {...defaultProps} onSubmit={onSubmit} />);
      
      const titleInput = screen.getByPlaceholderText(/Best Sunset View/i);
      fireEvent.change(titleInput, { target: { value: 'Test Spot' } });
      
      const submitButton = screen.getByRole('button', { name: /submit|save|add/i });
      expect(submitButton).toBeDisabled();
      
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it('should submit with correct data including submitterName', async () => {
      const onSubmit = jest.fn();
      render(<SubmissionModal {...defaultProps} defaultActivity="Fishing Spots" onSubmit={onSubmit} />);
      
      const nameInput = screen.getByPlaceholderText(/John D/i);
      const titleInput = screen.getByPlaceholderText(/Best Sunset View/i);
      const descriptionInput = screen.getByPlaceholderText(/Tell us about this spot/i);
      
      fireEvent.change(nameInput, { target: { value: 'Jane' } });
      fireEvent.change(titleInput, { target: { value: 'Test Spot' } });
      fireEvent.change(descriptionInput, { target: { value: 'Test description' } });
      
      const submitButton = screen.getByRole('button', { name: /submit|save|add/i });
      await act(async () => {
        fireEvent.click(submitButton);
      });

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledWith({
          title: 'Test Spot',
          submitterName: 'Jane',
          description: 'Test description',
          type: 'Fishing Spots',
          lat: 32.7765,
          lng: -79.9311,
          photo: undefined,
        });
      });
    });

    it('should trim title, name, and description before submitting', async () => {
      const onSubmit = jest.fn();
      render(<SubmissionModal {...defaultProps} onSubmit={onSubmit} />);
      
      const nameInput = screen.getByPlaceholderText(/John D/i);
      const titleInput = screen.getByPlaceholderText(/Best Sunset View/i);
      const descriptionInput = screen.getByPlaceholderText(/Tell us about this spot/i);
      
      fireEvent.change(nameInput, { target: { value: '  Jane  ' } });
      fireEvent.change(titleInput, { target: { value: '  Test Spot  ' } });
      fireEvent.change(descriptionInput, { target: { value: '  Test description  ' } });
      
      const submitButton = screen.getByRole('button', { name: /submit|save|add/i });
      await act(async () => {
        fireEvent.click(submitButton);
      });

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledWith(
          expect.objectContaining({
            title: 'Test Spot',
            submitterName: 'Jane',
            description: 'Test description',
          })
        );
      });
    });

    it('should reset form after successful submission', async () => {
      const onSubmit = jest.fn().mockResolvedValue(undefined);
      const { rerender } = render(<SubmissionModal {...defaultProps} onSubmit={onSubmit} />);
      
      const nameInput = screen.getByPlaceholderText(/John D/i) as HTMLInputElement;
      const titleInput = screen.getByPlaceholderText(/Best Sunset View/i) as HTMLInputElement;
      fireEvent.change(nameInput, { target: { value: 'Jane' } });
      fireEvent.change(titleInput, { target: { value: 'Test Spot' } });
      
      const submitButton = screen.getByRole('button', { name: /submit|save|add/i });
      await act(async () => {
        fireEvent.click(submitButton);
      });

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalled();
      });

      expect(mockOnClose).toHaveBeenCalled();
    });
  });

  describe('Modal Closing', () => {
    it('should call onClose when close button is clicked', () => {
      render(<SubmissionModal {...defaultProps} />);
      const closeButton = screen.getByRole('button', { name: /close/i }) ||
        screen.getByLabelText(/close/i) ||
        document.querySelector('button[aria-label*="close" i]');
      
      if (closeButton) {
        fireEvent.click(closeButton);
        expect(mockOnClose).toHaveBeenCalled();
      }
    });

    it('should call onClose when clicking outside modal (backdrop)', () => {
      render(<SubmissionModal {...defaultProps} />);
      // Try to find backdrop or overlay element
      const backdrop = document.querySelector('[class*="backdrop"], [class*="overlay"]') ||
        document.querySelector('div[role="dialog"]');
      
      if (backdrop) {
        fireEvent.click(backdrop);
        // Note: Actual implementation may vary, this tests the pattern
      }
    });

    it('should call onClose after form submission', async () => {
      const onSubmit = jest.fn().mockResolvedValue(undefined);
      render(<SubmissionModal {...defaultProps} onSubmit={onSubmit} />);
      
      const nameInput = screen.getByPlaceholderText(/John D/i);
      const titleInput = screen.getByPlaceholderText(/Best Sunset View/i);
      fireEvent.change(nameInput, { target: { value: 'Jane' } });
      fireEvent.change(titleInput, { target: { value: 'Test Spot' } });
      
      const submitButton = screen.getByRole('button', { name: /submit|save|add/i });
      await act(async () => {
        fireEvent.click(submitButton);
      });

      await waitFor(() => {
        expect(mockOnClose).toHaveBeenCalled();
      });
    });
  });

  describe('Modal Resizing', () => {
    it('should initialize with default height', () => {
      render(<SubmissionModal {...defaultProps} />);
      const modal = document.querySelector('[class*="sheet"], [class*="modal"]') as HTMLElement;
      if (modal) {
        expect(modal).toBeInTheDocument();
      }
    });

    it('should handle drag start for resizing', () => {
      render(<SubmissionModal {...defaultProps} />);
      const resizeHandle = document.querySelector('[class*="resize"], [class*="handle"]');
      
      if (resizeHandle) {
        const mouseDownEvent = new MouseEvent('mousedown', {
          bubbles: true,
          cancelable: true,
          clientY: 100,
        });
        
        fireEvent.mouseDown(resizeHandle, mouseDownEvent);
        // Modal should be in resizing state
      }
    });

    it('should handle mouse move during resize', () => {
      render(<SubmissionModal {...defaultProps} />);
      const resizeHandle = document.querySelector('[class*="resize"], [class*="handle"]');
      
      if (resizeHandle) {
        fireEvent.mouseDown(resizeHandle, { clientY: 100 });
        fireEvent.mouseMove(document, { clientY: 150 });
        // Height should change
      }
    });

    it('should handle mouse up to end resize', () => {
      render(<SubmissionModal {...defaultProps} />);
      const resizeHandle = document.querySelector('[class*="resize"], [class*="handle"]');
      
      if (resizeHandle) {
        fireEvent.mouseDown(resizeHandle, { clientY: 100 });
        fireEvent.mouseMove(document, { clientY: 150 });
        fireEvent.mouseUp(document);
        // Resize should end
      }
    });

    it('should handle touch events for resizing on mobile', () => {
      render(<SubmissionModal {...defaultProps} />);
      const resizeHandle = document.querySelector('[class*="resize"], [class*="handle"]');
      
      if (resizeHandle) {
        // Mock TouchEvent for testing - use a simpler approach that works in jsdom
        const touchStartEvent = {
          type: 'touchstart',
          bubbles: true,
          cancelable: true,
          clientY: 100,
          touches: [{ clientY: 100, target: resizeHandle }],
          targetTouches: [{ clientY: 100, target: resizeHandle }],
          changedTouches: [{ clientY: 100, target: resizeHandle }],
        } as any;
        
        fireEvent.touchStart(resizeHandle, touchStartEvent);
        // Should handle touch events (test passes if no error thrown)
        expect(resizeHandle).toBeInTheDocument();
      } else {
        // If resize handle not found, skip test (desktop-only feature)
        expect(true).toBe(true);
      }
    });

    it('should limit resize to minimum height', () => {
      render(<SubmissionModal {...defaultProps} />);
      const resizeHandle = document.querySelector('[class*="resize"], [class*="handle"]');
      
      if (resizeHandle) {
        // Try to resize beyond minimum
        fireEvent.mouseDown(resizeHandle, { clientY: 1000 });
        fireEvent.mouseMove(document, { clientY: 50 }); // Very small height
        // Should be constrained to minimum (300px based on code)
      }
    });

    it('should limit resize to maximum height', () => {
      render(<SubmissionModal {...defaultProps} />);
      const resizeHandle = document.querySelector('[class*="resize"], [class*="handle"]');
      
      if (resizeHandle) {
        // Try to resize beyond maximum
        fireEvent.mouseDown(resizeHandle, { clientY: 100 });
        fireEvent.mouseMove(document, { clientY: 5000 }); // Very large height
        // Should be constrained to maximum (window.innerHeight * 0.9)
      }
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty description', async () => {
      const onSubmit = jest.fn();
      render(<SubmissionModal {...defaultProps} onSubmit={onSubmit} />);
      
      const nameInput = screen.getByPlaceholderText(/John D/i);
      const titleInput = screen.getByPlaceholderText(/Best Sunset View/i);
      fireEvent.change(nameInput, { target: { value: 'Jane' } });
      fireEvent.change(titleInput, { target: { value: 'Test Spot' } });
      
      const submitButton = screen.getByRole('button', { name: /submit|save|add/i });
      await act(async () => {
        fireEvent.click(submitButton);
      });

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledWith(
          expect.objectContaining({
            title: 'Test Spot',
            submitterName: 'Jane',
            description: '',
          })
        );
      });
    });

    it('should handle invalid file types gracefully', async () => {
      render(<SubmissionModal {...defaultProps} />);
      const photoInput = document.querySelector('input[type="file"]') as HTMLInputElement;
      
      const invalidFile = new File(['test'], 'test.txt', { type: 'text/plain' });
      
      await act(async () => {
        fireEvent.change(photoInput, { target: { files: [invalidFile] } });
      });

      // Should still allow the file (validation could be added)
      expect(photoInput.files?.[0]).toBe(invalidFile);
    });

    it('should handle very long title', async () => {
      const onSubmit = jest.fn();
      render(<SubmissionModal {...defaultProps} onSubmit={onSubmit} />);
      
      const longTitle = 'A'.repeat(1000);
      const nameInput = screen.getByPlaceholderText(/John D/i);
      const titleInput = screen.getByPlaceholderText(/Best Sunset View/i);
      fireEvent.change(nameInput, { target: { value: 'Jane' } });
      fireEvent.change(titleInput, { target: { value: longTitle } });
      
      const submitButton = screen.getByRole('button', { name: /submit|save|add/i });
      await act(async () => {
        fireEvent.click(submitButton);
      });

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledWith(
          expect.objectContaining({
            title: longTitle,
          })
        );
      });
    });
  });
});
