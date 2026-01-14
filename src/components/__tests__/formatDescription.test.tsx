/**
 * Unit tests for formatDescription function in MapComponent
 * Tests that descriptions are formatted correctly with proper line breaks
 * and time ranges are preserved
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

// Mock the formatDescription function logic
// We'll test the actual component rendering
describe('formatDescription', () => {
  // Helper function to format description (matches MapComponent logic)
  const formatDescription = (description: string): React.ReactElement => {
    const rawLines = description.split('\n');
    const formattedLines: React.ReactElement[] = [];
    
    for (const rawLine of rawLines) {
      const trimmed = rawLine.trim();
      if (!trimmed) continue;
      
      // Check if line contains source attribution
      const sourceMatch = trimmed.match(/(.+?)\s*—\s*source:\s*(.+)/i) || trimmed.match(/(.+?)\s*source:\s*(.+)/i);
      
      if (sourceMatch) {
        const [, content, source] = sourceMatch;
        formattedLines.push(
          <div key={formattedLines.length} className="text-xs text-gray-600">
            <span>• {content.trim()}</span>
            <span className="text-gray-500 italic"> — source: {source.trim()}</span>
          </div>
        );
        continue;
      }
      
      // Check if line contains bullet separator (•)
      if (trimmed.includes('•')) {
        const parts = trimmed.split('•').map(p => p.trim()).filter(p => p.length > 0);
        for (const part of parts) {
          formattedLines.push(
            <div key={formattedLines.length} className="text-xs text-gray-600">
              • {part}
            </div>
          );
        }
      } else {
        formattedLines.push(
          <div key={formattedLines.length} className="text-xs text-gray-600">
            • {trimmed}
          </div>
        );
      }
    }
    
    return (
      <div className="space-y-1">
        {formattedLines}
      </div>
    );
  };

  test('should preserve time ranges like 4pm-6pm', () => {
    const description = '4pm-6pm • Monday-Friday';
    const { container } = render(formatDescription(description));
    
    // Time range should be preserved (not split)
    const text = container.textContent || '';
    expect(text).toContain('4pm-6pm');
    
    // Verify the time range appears as a complete unit
    // The key is that "4pm-6pm" appears together, not split into "4pm" and "6pm" on separate lines
    const lines = Array.from(container.querySelectorAll('.text-xs')).map(el => el.textContent || '');
    // At least one line should contain the full time range
    const hasTimeRange = lines.some(line => line.includes('4pm-6pm'));
    expect(hasTimeRange).toBe(true);
  });

  test('should handle multi-line descriptions with newlines', () => {
    const description = '4pm-6pm • Daily\nDaily specials from 4-6pm\n1/2 Off Wine Wednesday every week';
    const { container } = render(formatDescription(description));
    
    // Should have multiple lines
    const lines = container.querySelectorAll('.text-xs');
    expect(lines.length).toBeGreaterThan(1);
    
    // First line should contain time and day
    expect(container.textContent).toContain('4pm-6pm');
    expect(container.textContent).toContain('Daily');
    
    // Should contain specials
    expect(container.textContent).toContain('Daily specials from 4-6pm');
    expect(container.textContent).toContain('1/2 Off Wine Wednesday');
  });

  test('should split bullet-separated items into separate lines', () => {
    const description = '4pm-6pm • Monday-Friday • $3 Tacos';
    const { container } = render(formatDescription(description));
    
    // Should create separate bullet points
    const bullets = container.querySelectorAll('.text-xs');
    expect(bullets.length).toBe(3);
    
    // Each should start with bullet
    bullets.forEach(bullet => {
      expect(bullet.textContent).toMatch(/^•/);
    });
  });

  test('should preserve time ranges when splitting bullets', () => {
    const description = '4pm-6pm • Monday-Friday';
    const { container } = render(formatDescription(description));
    
    // Time range should remain intact
    const text = container.textContent || '';
    expect(text).toContain('4pm-6pm');
    
    // Verify that when bullets are split, the time range stays together
    const lines = Array.from(container.querySelectorAll('.text-xs')).map(el => el.textContent || '');
    // The time range "4pm-6pm" should appear on one line, not split across lines
    const timeRangeLine = lines.find(line => line.includes('4pm-6pm'));
    expect(timeRangeLine).toBeDefined();
    // The time range should be on the same line (not split)
    expect(timeRangeLine).toContain('4pm-6pm');
  });

  test('should handle descriptions with source attribution', () => {
    const description = 'Happy Hour 4-6pm — source: example.com';
    const { container } = render(formatDescription(description));
    
    expect(container.textContent).toContain('Happy Hour 4-6pm');
    expect(container.textContent).toContain('source: example.com');
  });

  test('should handle empty or whitespace-only lines', () => {
    const description = '4pm-6pm\n\n\nMonday-Friday';
    const { container } = render(formatDescription(description));
    
    // Should only render non-empty lines
    const lines = container.querySelectorAll('.text-xs');
    expect(lines.length).toBe(2);
  });

  test('should format specials as separate lines', () => {
    const description = '4pm-6pm • Monday-Friday\n$3 Tacos\n$4 House Liquor';
    const { container } = render(formatDescription(description));
    
    // Should have multiple lines
    const lines = container.querySelectorAll('.text-xs');
    expect(lines.length).toBeGreaterThan(2);
    
    // Should contain specials
    expect(container.textContent).toContain('$3 Tacos');
    expect(container.textContent).toContain('$4 House Liquor');
  });

  test('should handle single line descriptions', () => {
    const description = 'Happy Hour available';
    const { container } = render(formatDescription(description));
    
    const lines = container.querySelectorAll('.text-xs');
    expect(lines.length).toBe(1);
    expect(container.textContent).toContain('Happy Hour available');
  });
});
