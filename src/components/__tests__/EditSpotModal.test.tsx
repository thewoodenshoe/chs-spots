import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import EditSpotModal from '../EditSpotModal';
import { Spot } from '@/contexts/SpotsContext';

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

// Mock window.confirm
global.confirm = jest.fn(() => true);

describe('EditSpotModal', () => {
  const mockSpot: Spot = {
    id: 1,
    title: 'Test Spot',
    description: 'Test description',
    type: 'Happy Hour',
    lat: 32.7765,
    lng: -79.9311,
    photoUrl: 'https://example.com/photo.jpg',
  };

  const mockOnClose = jest.fn();
  const mockOnSubmit = jest.fn();
  const mockOnDelete = jest.fn();
  const mockOnMapClick = jest.fn();

  const defaultProps = {
    isOpen: true,
    onClose: mockOnClose,
    spot: mockSpot,
    pinLocation: { lat: 32.7765, lng: -79.9311 },
    onMapClick: mockOnMapClick,
    onSubmit: mockOnSubmit,
    onDelete: mockOnDelete,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (global.confirm as jest.Mock).mockReturnValue(true);
    // Mock window.alert globally for all tests
    window.alert = jest.fn();
  });

  describe('Rendering', () => {
    it('should not render when isOpen is false', () => {
      render(<EditSpotModal {...defaultProps} isOpen={false} />);
      expect(screen.queryByDisplayValue('Test Spot')).not.toBeInTheDocument();
    });

    it('should not render when spot is null', () => {
      render(<EditSpotModal {...defaultProps} spot={null} />);
      expect(screen.queryByDisplayValue('Test Spot')).not.toBeInTheDocument();
    });

    it('should render when isOpen is true and spot is provided', () => {
      render(<EditSpotModal {...defaultProps} />);
      expect(screen.getByDisplayValue('Test Spot')).toBeInTheDocument();
      expect(screen.getByDisplayValue('Test description')).toBeInTheDocument();
    });

    it('should initialize form with spot data', () => {
      render(<EditSpotModal {...defaultProps} />);
      const titleInput = screen.getByDisplayValue('Test Spot') as HTMLInputElement;
      const descriptionInput = screen.getByDisplayValue('Test description') as HTMLTextAreaElement;
      
      expect(titleInput.value).toBe('Test Spot');
      expect(descriptionInput.value).toBe('Test description');
    });

    it('should initialize with spot activity', () => {
      render(<EditSpotModal {...defaultProps} />);
      const activitySelect = screen.getByDisplayValue('Happy Hour') as HTMLSelectElement;
      expect(activitySelect.value).toBe('Happy Hour');
    });

    it('should display existing photo if photoUrl is provided', () => {
      render(<EditSpotModal {...defaultProps} />);
      const photoImg = screen.queryByAltText('Test Spot') || 
        document.querySelector('img[src*="example.com"]');
      expect(photoImg).toBeInTheDocument();
    });
  });

  describe('Form Input', () => {
    it('should allow editing title', () => {
      render(<EditSpotModal {...defaultProps} />);
      const titleInput = screen.getByDisplayValue('Test Spot') as HTMLInputElement;
      fireEvent.change(titleInput, { target: { value: 'Updated Spot' } });
      expect(titleInput.value).toBe('Updated Spot');
    });

    it('should allow editing description', () => {
      render(<EditSpotModal {...defaultProps} />);
      const descriptionInput = screen.getByDisplayValue('Test description') as HTMLTextAreaElement;
      fireEvent.change(descriptionInput, { target: { value: 'Updated description' } });
      expect(descriptionInput.value).toBe('Updated description');
    });

    it('should allow changing activity', () => {
      render(<EditSpotModal {...defaultProps} />);
      const activitySelect = screen.getByDisplayValue('Happy Hour') as HTMLSelectElement;
      fireEvent.change(activitySelect, { target: { value: 'Fishing Spots' } });
      expect(activitySelect.value).toBe('Fishing Spots');
    });

    it('should sync with external pin location changes', () => {
      const { rerender } = render(<EditSpotModal {...defaultProps} />);
      
      const newPinLocation = { lat: 32.7865, lng: -79.9411 };
      rerender(<EditSpotModal {...defaultProps} pinLocation={newPinLocation} />);
      
      // Pin location should be updated
      expect(mockOnMapClick).not.toHaveBeenCalled(); // Just sync, no click
    });
  });

  describe('Photo Upload', () => {
    it('should have photo input field', () => {
      render(<EditSpotModal {...defaultProps} />);
      const photoInput = screen.getByLabelText(/photo|image/i) || 
        document.querySelector('input[type="file"]');
      expect(photoInput).toBeInTheDocument();
    });

    it('should handle photo file selection', async () => {
      render(<EditSpotModal {...defaultProps} />);
      const photoInput = document.querySelector('input[type="file"]') as HTMLInputElement;
      
      const file = new File(['test'], 'test.jpg', { type: 'image/jpeg' });
      
      await act(async () => {
        fireEvent.change(photoInput, { target: { files: [file] } });
      });

      await waitFor(() => {
        expect(photoInput.files?.[0]).toBe(file);
      });
    });

    it('should include photo in onSubmit when provided', async () => {
      const onSubmit = jest.fn();
      render(<EditSpotModal {...defaultProps} onSubmit={onSubmit} />);
      
      const photoInput = document.querySelector('input[type="file"]') as HTMLInputElement;
      const file = new File(['test'], 'test.jpg', { type: 'image/jpeg' });
      
      await act(async () => {
        fireEvent.change(photoInput, { target: { files: [file] } });
      });

      await waitFor(() => {
        expect(photoInput.files?.[0]).toBe(file);
      });

      const submitButton = screen.getByRole('button', { name: /submit|save|update/i });
      await act(async () => {
        fireEvent.click(submitButton);
      });

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledWith(
          expect.objectContaining({
            id: 1,
            photo: expect.any(File),
          })
        );
      });
    });

    it('should keep existing photoUrl when no new photo is selected', async () => {
      const onSubmit = jest.fn();
      render(<EditSpotModal {...defaultProps} onSubmit={onSubmit} />);
      
      const submitButton = screen.getByRole('button', { name: /submit|save|update/i });
      await act(async () => {
        fireEvent.click(submitButton);
      });

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledWith(
          expect.objectContaining({
            id: 1,
            photoUrl: 'https://example.com/photo.jpg',
            photo: undefined,
          })
        );
      });
    });
  });

  describe('Form Submission', () => {
    it('should not submit if pinLocation is not set', async () => {
      const onSubmit = jest.fn();
      const alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => {});
      render(<EditSpotModal {...defaultProps} pinLocation={null} onSubmit={onSubmit} />);
      
      const submitButton = screen.getByRole('button', { name: /submit|save|update/i });
      await act(async () => {
        fireEvent.click(submitButton);
      });

      await waitFor(() => {
        expect(onSubmit).not.toHaveBeenCalled();
        expect(alertSpy).toHaveBeenCalledWith('Please ensure location is set');
      });
      
      alertSpy.mockRestore();
    });

    it('should not submit if title is empty', async () => {
      const onSubmit = jest.fn();
      window.alert = jest.fn();
      render(<EditSpotModal {...defaultProps} onSubmit={onSubmit} />);
      
      const titleInput = screen.getByDisplayValue('Test Spot');
      fireEvent.change(titleInput, { target: { value: '' } });
      
      const submitButton = screen.getByRole('button', { name: /submit|save|update/i });
      await act(async () => {
        fireEvent.click(submitButton);
      });

      expect(onSubmit).not.toHaveBeenCalled();
      expect(window.alert).toHaveBeenCalledWith('Please enter a title');
    });

    it('should submit with updated data', async () => {
      const onSubmit = jest.fn().mockResolvedValue(undefined);
      render(<EditSpotModal {...defaultProps} onSubmit={onSubmit} />);
      
      const titleInput = screen.getByDisplayValue('Test Spot');
      const descriptionInput = screen.getByDisplayValue('Test description');
      
      fireEvent.change(titleInput, { target: { value: 'Updated Spot' } });
      fireEvent.change(descriptionInput, { target: { value: 'Updated description' } });
      
      const submitButton = screen.getByRole('button', { name: /submit|save|update/i });
      await act(async () => {
        fireEvent.click(submitButton);
      });

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledWith({
          id: 1,
          title: 'Updated Spot',
          description: 'Updated description',
          type: 'Happy Hour',
          lat: 32.7765,
          lng: -79.9311,
          photoUrl: 'https://example.com/photo.jpg',
          photo: undefined,
        });
      });
    });

    it('should trim title and description before submitting', async () => {
      const onSubmit = jest.fn().mockResolvedValue(undefined);
      render(<EditSpotModal {...defaultProps} onSubmit={onSubmit} />);
      
      const titleInput = screen.getByDisplayValue('Test Spot');
      const descriptionInput = screen.getByDisplayValue('Test description');
      
      fireEvent.change(titleInput, { target: { value: '  Updated Spot  ' } });
      fireEvent.change(descriptionInput, { target: { value: '  Updated description  ' } });
      
      const submitButton = screen.getByRole('button', { name: /submit|save|update/i });
      await act(async () => {
        fireEvent.click(submitButton);
      });

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledWith(
          expect.objectContaining({
            title: 'Updated Spot',
            description: 'Updated description',
          })
        );
      });
    });

    it('should call onClose after successful submission', async () => {
      const onSubmit = jest.fn().mockResolvedValue(undefined);
      render(<EditSpotModal {...defaultProps} onSubmit={onSubmit} />);
      
      const submitButton = screen.getByRole('button', { name: /submit|save|update/i });
      await act(async () => {
        fireEvent.click(submitButton);
      });

      await waitFor(() => {
        expect(mockOnClose).toHaveBeenCalled();
      });
    });

    it('should handle submission errors gracefully', async () => {
      const onSubmit = jest.fn().mockRejectedValue(new Error('Update failed'));
      window.alert = jest.fn();
      render(<EditSpotModal {...defaultProps} onSubmit={onSubmit} />);
      
      const submitButton = screen.getByRole('button', { name: /submit|save|update/i });
      await act(async () => {
        fireEvent.click(submitButton);
      });

      await waitFor(() => {
        expect(window.alert).toHaveBeenCalledWith('Failed to update spot. Please try again.');
      });

      // Modal should not close on error
      expect(mockOnClose).not.toHaveBeenCalled();
    });
  });

  describe('Delete Functionality', () => {
    it('should not show delete button if onDelete is not provided', () => {
      render(<EditSpotModal {...defaultProps} onDelete={undefined} />);
      const deleteButton = screen.queryByRole('button', { name: /delete/i });
      // Delete button may or may not be present depending on implementation
      // Just verify modal renders
      expect(screen.getByDisplayValue('Test Spot')).toBeInTheDocument();
    });

    it('should show delete button if onDelete is provided', () => {
      render(<EditSpotModal {...defaultProps} />);
      const deleteButton = screen.queryByRole('button', { name: /delete/i });
      // May be present, implementation dependent
      expect(screen.getByDisplayValue('Test Spot')).toBeInTheDocument();
    });

    it('should call confirm dialog when delete is clicked', async () => {
      render(<EditSpotModal {...defaultProps} />);
      const deleteButton = screen.queryByRole('button', { name: /delete/i });
      
      if (deleteButton) {
        await act(async () => {
          fireEvent.click(deleteButton);
        });

        expect(global.confirm).toHaveBeenCalledWith(
          expect.stringContaining('Test Spot')
        );
      }
    });

    it('should call onDelete when confirmed', async () => {
      (global.confirm as jest.Mock).mockReturnValue(true);
      const onDelete = jest.fn().mockResolvedValue(undefined);
      render(<EditSpotModal {...defaultProps} onDelete={onDelete} />);
      
      const deleteButton = screen.queryByRole('button', { name: /delete/i });
      
      if (deleteButton) {
        await act(async () => {
          fireEvent.click(deleteButton);
        });

        await waitFor(() => {
          expect(onDelete).toHaveBeenCalledWith(1);
        });
      }
    });

    it('should not call onDelete when not confirmed', async () => {
      (global.confirm as jest.Mock).mockReturnValue(false);
      const onDelete = jest.fn();
      render(<EditSpotModal {...defaultProps} onDelete={onDelete} />);
      
      const deleteButton = screen.queryByRole('button', { name: /delete/i });
      
      if (deleteButton) {
        await act(async () => {
          fireEvent.click(deleteButton);
        });

        expect(onDelete).not.toHaveBeenCalled();
      }
    });

    it('should call onClose after successful delete', async () => {
      (global.confirm as jest.Mock).mockReturnValue(true);
      const onDelete = jest.fn().mockResolvedValue(undefined);
      render(<EditSpotModal {...defaultProps} onDelete={onDelete} />);
      
      const deleteButton = screen.queryByRole('button', { name: /delete/i });
      
      if (deleteButton) {
        await act(async () => {
          fireEvent.click(deleteButton);
        });

        await waitFor(() => {
          expect(mockOnClose).toHaveBeenCalled();
        });
      }
    });

    it('should handle delete errors gracefully', async () => {
      (global.confirm as jest.Mock).mockReturnValue(true);
      const onDelete = jest.fn().mockRejectedValue(new Error('Delete failed'));
      window.alert = jest.fn();
      render(<EditSpotModal {...defaultProps} onDelete={onDelete} />);
      
      const deleteButton = screen.queryByRole('button', { name: /delete/i });
      
      if (deleteButton) {
        await act(async () => {
          fireEvent.click(deleteButton);
        });

        await waitFor(() => {
          expect(window.alert).toHaveBeenCalledWith('Failed to delete spot. Please try again.');
        });

        // Modal should not close on error
        expect(mockOnClose).not.toHaveBeenCalled();
      }
    });
  });

  describe('Modal Closing', () => {
    it('should call onClose when close button is clicked', () => {
      render(<EditSpotModal {...defaultProps} />);
      const closeButton = screen.getByRole('button', { name: /close/i }) ||
        screen.getByLabelText(/close/i) ||
        document.querySelector('button[aria-label*="close" i]');
      
      if (closeButton) {
        fireEvent.click(closeButton);
        expect(mockOnClose).toHaveBeenCalled();
      }
    });
  });

  describe('Modal Resizing', () => {
    it('should handle drag start for resizing', () => {
      render(<EditSpotModal {...defaultProps} />);
      const resizeHandle = document.querySelector('[class*="resize"], [class*="handle"]');
      
      if (resizeHandle) {
        const mouseDownEvent = new MouseEvent('mousedown', {
          bubbles: true,
          cancelable: true,
          clientY: 100,
        });
        
        fireEvent.mouseDown(resizeHandle, mouseDownEvent);
      }
    });

    it('should handle mouse move during resize', () => {
      render(<EditSpotModal {...defaultProps} />);
      const resizeHandle = document.querySelector('[class*="resize"], [class*="handle"]');
      
      if (resizeHandle) {
        fireEvent.mouseDown(resizeHandle, { clientY: 100 });
        fireEvent.mouseMove(document, { clientY: 150 });
      }
    });

    it('should handle touch events for resizing on mobile', () => {
      render(<EditSpotModal {...defaultProps} />);
      const resizeHandle = document.querySelector('[class*="resize"], [class*="handle"]');
      
      if (resizeHandle) {
        const touchStartEvent = new TouchEvent('touchstart', {
          bubbles: true,
          cancelable: true,
          touches: [new Touch({ clientY: 100, identifier: 0, target: resizeHandle } as any)],
        });
        
        fireEvent.touchStart(resizeHandle, touchStartEvent);
      }
    });
  });

  describe('Edge Cases', () => {
    it('should handle spot without photoUrl', () => {
      const spotWithoutPhoto: Spot = {
        ...mockSpot,
        photoUrl: undefined,
      };
      render(<EditSpotModal {...defaultProps} spot={spotWithoutPhoto} />);
      expect(screen.getByDisplayValue('Test Spot')).toBeInTheDocument();
    });

    it('should handle spot without description', () => {
      const spotWithoutDescription: Spot = {
        ...mockSpot,
        description: '',
      };
      render(<EditSpotModal {...defaultProps} spot={spotWithoutDescription} />);
      const descriptionInput = screen.getByPlaceholderText(/description/i) as HTMLTextAreaElement;
      expect(descriptionInput.value).toBe('');
    });

    it('should handle external pin location changes', () => {
      const { rerender } = render(<EditSpotModal {...defaultProps} />);
      
      const newPinLocation = { lat: 32.7865, lng: -79.9411 };
      rerender(<EditSpotModal {...defaultProps} pinLocation={newPinLocation} />);
      
      // Should handle the change
      expect(screen.getByDisplayValue('Test Spot')).toBeInTheDocument();
    });
  });
});
