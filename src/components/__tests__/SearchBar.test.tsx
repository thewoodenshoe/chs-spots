import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import SearchBar from '../SearchBar';

describe('SearchBar', () => {
  const defaultProps = {
    value: '',
    onChange: jest.fn(),
  };

  beforeEach(() => jest.clearAllMocks());

  it('renders with placeholder', () => {
    render(<SearchBar {...defaultProps} />);
    expect(screen.getByPlaceholderText('Search spots...')).toBeInTheDocument();
  });

  it('renders with custom placeholder', () => {
    render(<SearchBar {...defaultProps} placeholder="Find a bar..." />);
    expect(screen.getByPlaceholderText('Find a bar...')).toBeInTheDocument();
  });

  it('calls onChange when typing', () => {
    render(<SearchBar {...defaultProps} />);
    const input = screen.getByPlaceholderText('Search spots...');
    fireEvent.change(input, { target: { value: 'tacos' } });
    expect(defaultProps.onChange).toHaveBeenCalledWith('tacos');
  });

  it('shows clear button when value is present', () => {
    render(<SearchBar {...defaultProps} value="test" />);
    expect(screen.getByLabelText('Clear search')).toBeInTheDocument();
  });

  it('does not show clear button when empty', () => {
    render(<SearchBar {...defaultProps} value="" />);
    expect(screen.queryByLabelText('Clear search')).not.toBeInTheDocument();
  });

  it('clears value when clear button is clicked', () => {
    render(<SearchBar {...defaultProps} value="test" />);
    fireEvent.click(screen.getByLabelText('Clear search'));
    expect(defaultProps.onChange).toHaveBeenCalledWith('');
  });

  it('focuses on / key press', () => {
    render(<SearchBar {...defaultProps} />);
    const input = screen.getByPlaceholderText('Search spots...');
    fireEvent.keyDown(window, { key: '/' });
    expect(document.activeElement).toBe(input);
  });

  it('has proper touch target size for mobile (min 40px)', () => {
    render(<SearchBar {...defaultProps} />);
    const input = screen.getByPlaceholderText('Search spots...');
    expect(input.className).toContain('h-10');
  });
});
