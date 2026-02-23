import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import CommunityBanner, { shouldShowBanner, dismissBanner } from '../CommunityBanner';

const mockLocalStorage = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: jest.fn((key: string) => store[key] || null),
    setItem: jest.fn((key: string, value: string) => { store[key] = value; }),
    removeItem: jest.fn((key: string) => { delete store[key]; }),
    clear: jest.fn(() => { store = {}; }),
  };
})();

Object.defineProperty(window, 'localStorage', { value: mockLocalStorage });

describe('CommunityBanner', () => {
  beforeEach(() => {
    mockLocalStorage.clear();
    jest.clearAllMocks();
  });

  it('renders the banner with activity name', () => {
    render(<CommunityBanner activityName="Fishing Spots" onDismiss={jest.fn()} />);
    expect(screen.getByTestId('community-banner')).toBeInTheDocument();
    expect(screen.getByText('Community-Powered Spots')).toBeInTheDocument();
    expect(screen.getByText(/Fishing Spots/)).toBeInTheDocument();
    expect(screen.getByText(/Add Spot/)).toBeInTheDocument();
  });

  it('has "don\'t show again" checkbox checked by default', () => {
    render(<CommunityBanner activityName="Fishing Spots" onDismiss={jest.fn()} />);
    const checkbox = screen.getByTestId('dont-show-checkbox') as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
  });

  it('calls onDismiss when close button is clicked', () => {
    jest.useFakeTimers();
    const onDismiss = jest.fn();
    render(<CommunityBanner activityName="Fishing Spots" onDismiss={onDismiss} />);

    fireEvent.click(screen.getByTestId('close-banner'));
    jest.advanceTimersByTime(300);

    expect(onDismiss).toHaveBeenCalled();
    jest.useRealTimers();
  });

  it('persists dismissal to localStorage when checkbox is checked', () => {
    jest.useFakeTimers();
    render(<CommunityBanner activityName="Fishing Spots" onDismiss={jest.fn()} />);
    fireEvent.click(screen.getByTestId('close-banner'));
    jest.advanceTimersByTime(300);

    expect(mockLocalStorage.setItem).toHaveBeenCalled();
    const stored = JSON.parse(mockLocalStorage.setItem.mock.calls[0][1]);
    expect(stored).toContain('Fishing Spots');
    jest.useRealTimers();
  });
});

describe('shouldShowBanner', () => {
  beforeEach(() => {
    mockLocalStorage.clear();
    jest.clearAllMocks();
  });

  it('returns true when activity has not been dismissed', () => {
    expect(shouldShowBanner('Fishing Spots')).toBe(true);
  });

  it('returns false after dismissal', () => {
    dismissBanner('Fishing Spots');
    expect(shouldShowBanner('Fishing Spots')).toBe(false);
  });

  it('tracks dismissal per activity type', () => {
    dismissBanner('Fishing Spots');
    expect(shouldShowBanner('Fishing Spots')).toBe(false);
    expect(shouldShowBanner('Must-See Spots')).toBe(true);
  });
});
