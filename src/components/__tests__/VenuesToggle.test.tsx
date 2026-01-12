import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import VenuesToggle from '../VenuesToggle';

describe('VenuesToggle', () => {
  const mockOnToggle = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should render toggle button', () => {
    render(<VenuesToggle showVenues={false} onToggle={mockOnToggle} />);
    
    const button = screen.getByRole('button');
    expect(button).toBeInTheDocument();
  });

  it('should call onToggle when clicked', () => {
    render(<VenuesToggle showVenues={false} onToggle={mockOnToggle} />);
    
    const button = screen.getByRole('button');
    fireEvent.click(button);
    
    expect(mockOnToggle).toHaveBeenCalledTimes(1);
  });

  it('should show correct label when venues are hidden', () => {
    render(<VenuesToggle showVenues={false} onToggle={mockOnToggle} />);
    
    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('aria-label', 'Show all venues');
    expect(button).toHaveAttribute('aria-pressed', 'false');
  });

  it('should show correct label when venues are shown', () => {
    render(<VenuesToggle showVenues={true} onToggle={mockOnToggle} />);
    
    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('aria-label', 'Hide all venues');
    expect(button).toHaveAttribute('aria-pressed', 'true');
  });

  it('should have red background when venues are shown', () => {
    render(<VenuesToggle showVenues={true} onToggle={mockOnToggle} />);
    
    const button = screen.getByRole('button');
    expect(button).toHaveClass('bg-red-600');
  });

  it('should have gray background when venues are hidden', () => {
    render(<VenuesToggle showVenues={false} onToggle={mockOnToggle} />);
    
    const button = screen.getByRole('button');
    expect(button).toHaveClass('bg-gray-600');
  });

  it('should be accessible with ARIA attributes', () => {
    render(<VenuesToggle showVenues={false} onToggle={mockOnToggle} />);
    
    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('aria-label');
    expect(button).toHaveAttribute('aria-pressed');
  });

  it('should hide text on mobile (sm breakpoint)', () => {
    render(<VenuesToggle showVenues={false} onToggle={mockOnToggle} />);
    
    const text = screen.getByText('Show Venues');
    expect(text).toHaveClass('hidden', 'sm:inline');
  });

  it('should show text on desktop (sm breakpoint and above)', () => {
    // Mock window.matchMedia for desktop viewport
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: jest.fn().mockImplementation(query => ({
        matches: query === '(min-width: 640px)',
        media: query,
        onchange: null,
        addListener: jest.fn(),
        removeListener: jest.fn(),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        dispatchEvent: jest.fn(),
      })),
    });

    render(<VenuesToggle showVenues={false} onToggle={mockOnToggle} />);
    
    const text = screen.getByText('Show Venues');
    expect(text).toBeInTheDocument();
  });

  it('should handle touch events (mobile)', () => {
    render(<VenuesToggle showVenues={false} onToggle={mockOnToggle} />);
    
    const button = screen.getByRole('button');
    expect(button).toHaveClass('touch-manipulation');
  });

  it('should have hover and active states', () => {
    render(<VenuesToggle showVenues={false} onToggle={mockOnToggle} />);
    
    const button = screen.getByRole('button');
    expect(button).toHaveClass('hover:scale-105', 'active:scale-95');
  });
});
