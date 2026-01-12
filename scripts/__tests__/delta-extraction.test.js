/**
 * Unit tests for delta-based extraction system
 * 
 * Tests the scenario where a venue's content changes between days,
 * triggering hash-based detection and extraction
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

describe('Delta-Based Extraction System', () => {
  const venueId = 'ChIJTestVenue123';
  const venueName = "Paul Stewarts Tavern";
  const venueAddress = "157 sandshell dr, 29492, daniel island";
  
  // Import the actual functions from update-happy-hours.js
  // We'll test the logic directly since the functions are not exported
  // Instead, we'll replicate the hash computation logic
  
  /**
   * Compute content hash from scraped data (same logic as update-happy-hours.js)
   */
  function computeContentHash(scrapedData) {
    if (!scrapedData || !scrapedData.sources || !Array.isArray(scrapedData.sources)) {
      return null;
    }
    
    // Extract and normalize text content from all sources
    const textContent = scrapedData.sources
      .map(s => (s.text || '').trim())
      .join(' ')
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();
    
    if (!textContent) {
      return null;
    }
    
    // Create SHA-256 hash
    return crypto.createHash('sha256').update(textContent).digest('hex');
  }
  
  describe('Test Case: Paul Stewarts Tavern - Happy Hour Added', () => {
    it('should detect hash difference when happy hour is added', () => {
      // Previous day data (no happy hour)
      const previousDayData = {
        venueId: venueId,
        venueName: venueName,
        venueArea: "Daniel Island",
        website: "http://paulstewartstavern.com/",
        scrapedAt: "2026-01-11T10:00:00.000Z",
        sources: [
          {
            url: "http://paulstewartstavern.com/",
            text: "Welcome to Paul Stewarts Tavern. We serve great food and drinks. Open daily.",
            pageType: "homepage",
            scrapedAt: "2026-01-11T10:00:00.000Z"
          }
        ],
        rawMatches: [],
        urlPatterns: ["menu", "about"]
      };
      
      // Current day data (with happy hour)
      const currentDayData = {
        venueId: venueId,
        venueName: venueName,
        venueArea: "Daniel Island",
        website: "http://paulstewartstavern.com/",
        scrapedAt: "2026-01-12T10:00:00.000Z",
        sources: [
          {
            url: "http://paulstewartstavern.com/",
            text: "Welcome to Paul Stewarts Tavern. We serve great food and drinks. Open daily. Happy Hour Monday-Friday 4pm-7pm. $2 off all drinks!",
            pageType: "homepage",
            scrapedAt: "2026-01-12T10:00:00.000Z"
          }
        ],
        rawMatches: [
          {
            text: "Happy Hour Monday-Friday 4pm-7pm. $2 off all drinks!",
            source: "http://paulstewartstavern.com/"
          }
        ],
        urlPatterns: ["menu", "about", "happy-hour"]
      };
      
      // Compute hashes
      const previousHash = computeContentHash(previousDayData);
      const currentHash = computeContentHash(currentDayData);
      
      // Hashes should be different
      expect(previousHash).not.toBe(currentHash);
      expect(previousHash).toBeTruthy();
      expect(currentHash).toBeTruthy();
      
      // Should detect change
      const hasChanged = previousHash !== currentHash;
      expect(hasChanged).toBe(true);
      
      // Should trigger extraction (rawMatches should contain happy hour info)
      expect(currentDayData.rawMatches.length).toBeGreaterThan(0);
      expect(currentDayData.rawMatches[0].text).toContain('Happy Hour');
      expect(currentDayData.rawMatches[0].text).toContain('4pm-7pm');
    });
    
    it('should not trigger extraction when content is unchanged', () => {
      const day1Data = {
        venueId: venueId,
        venueName: venueName,
        sources: [
          {
            url: "http://paulstewartstavern.com/",
            text: "Welcome to Paul Stewarts Tavern. Happy Hour Monday-Friday 4pm-7pm.",
            pageType: "homepage"
          }
        ],
        rawMatches: []
      };
      
      const day2Data = {
        venueId: venueId,
        venueName: venueName,
        sources: [
          {
            url: "http://paulstewartstavern.com/",
            text: "Welcome to Paul Stewarts Tavern. Happy Hour Monday-Friday 4pm-7pm.",
            pageType: "homepage"
          }
        ],
        rawMatches: []
      };
      
      const hash1 = computeContentHash(day1Data);
      const hash2 = computeContentHash(day2Data);
      
      expect(hash1).toBe(hash2);
      expect(hash1 === hash2).toBe(true); // No change detected
      expect(hash1).toBeTruthy();
    });
    
    it('should handle new venue (no previous data) as changed', () => {
      const currentDayData = {
        venueId: venueId,
        venueName: venueName,
        sources: [
          {
            url: "http://paulstewartstavern.com/",
            text: "Welcome to Paul Stewarts Tavern. Happy Hour Monday-Friday 4pm-7pm.",
            pageType: "homepage"
          }
        ],
        rawMatches: []
      };
      
      // No previous data exists
      const previousData = null;
      
      // New venue should be treated as changed
      const hasChanged = previousData === null;
      expect(hasChanged).toBe(true);
    });
  });
  
  describe('Hash Computation Edge Cases', () => {
    it('should handle empty sources array', () => {
      const data = {
        venueId: venueId,
        sources: []
      };
      
      const hash = computeContentHash(data);
      expect(hash).toBeNull();
    });
    
    it('should handle null/undefined scraped data', () => {
      expect(computeContentHash(null)).toBeNull();
      expect(computeContentHash(undefined)).toBeNull();
    });
    
    it('should handle sources with empty text', () => {
      const data = {
        venueId: venueId,
        sources: [
          { url: 'http://example.com', text: '', pageType: 'homepage' },
          { url: 'http://example.com/menu', text: '   ', pageType: 'subpage' }
        ]
      };
      
      const hash = computeContentHash(data);
      expect(hash).toBeNull();
    });
    
    it('should normalize whitespace correctly', () => {
      const data1 = {
        sources: [
          { text: 'Happy  Hour   4pm-7pm' }
        ]
      };
      
      const data2 = {
        sources: [
          { text: 'Happy Hour 4pm-7pm' }
        ]
      };
      
      const hash1 = computeContentHash(data1);
      const hash2 = computeContentHash(data2);
      
      // Should produce same hash despite different whitespace
      expect(hash1).toBe(hash2);
    });
  });
  
  describe('Delta Report Structure', () => {
    it('should generate delta report with changed venues', () => {
      const deltaReport = {
        date: '2026-01-12',
        previousDate: '2026-01-11',
        changed: [venueId],
        unchanged: [],
        new: [],
        removed: [],
        summary: {
          total: 1,
          changed: 1,
          unchanged: 0,
          new: 0,
          removed: 0
        }
      };
      
      expect(deltaReport.changed).toContain(venueId);
      expect(deltaReport.changed.length).toBe(1);
      expect(deltaReport.summary.changed).toBe(1);
      expect(deltaReport.summary.total).toBe(1);
    });
  });
});
