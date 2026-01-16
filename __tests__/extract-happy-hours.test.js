const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Mock the GoogleGenerativeAI module
jest.mock('@google/generative-ai', () => {
    return {
        GoogleGenerativeAI: jest.fn(() => ({
            getGenerativeModel: jest.fn(() => ({
                startChat: jest.fn(() => ({
                    sendMessage: jest.fn((prompt) => {
                        // Simulate LLM responses based on prompt content
                        if (prompt.includes("Happy Hour: 4pm-7pm Monday-Friday")) {
                            return Promise.resolve({
                                response: {
                                    text: () => `
{ 
                                        "found": true,
                                        "times": "4pm-7pm",
                                        "days": "Monday-Friday",
                                        "specials": ["$5 draft beers", "half-off appetizers"],
                                        "source": "https://example.com/specials",
                                        "confidence": 95
                                    }
`
                                }
                            });
                        } else if (prompt.includes("Opening hours: 9am-10pm daily") || prompt.includes("Our full menu")) {
                            return Promise.resolve({
                                response: {
                                    text: () => `
{ 
                                        "found": false,
                                        "confidence": 80
                                    }
`
                                }
                            });
                        } else if (prompt.includes("Heavy's Hour from 3-6pm")) {
                            return Promise.resolve({
                                response: {
                                    text: () => `
{ 
                                        "found": true,
                                        "times": "3pm-6pm",
                                        "days": "daily",
                                        "specials": ["Special 'Heavy's Hour' pricing"],
                                        "source": "https://heavy.com/menu",
                                        "confidence": 90
                                    }
`
                                }
                            });
                        } else if (prompt.includes("Happy Hour: 5-7pm") || prompt.includes("Happy Hour: 5-7pm!") || 
                                   prompt.includes("Happy Hour daily from 5pm-7pm") ||
                                   prompt.includes("Specials available from 5-7pm") ||
                                   prompt.includes("Test Venue 3") && prompt.includes("5pm-7pm")) {
                            return Promise.resolve({
                                response: {
                                    text: () => `
{ 
                                        "found": true,
                                        "times": "5pm-7pm",
                                        "days": "daily",
                                        "specials": ["discounted drinks"],
                                        "source": "https://example.com/specials",
                                        "confidence": 95
                                    }
`
                                }
                            });
                        }
                        return Promise.resolve({
                            response: {
                                text: () => `
{ 
                                    "found": false,
                                    "confidence": 50
                                }
`
                            }
                        });
                    }),
                })),
            })),
        })),
    };
});

// Import the function to be tested AFTER mocking
const { GoogleGenerativeAI } = require('@google/generative-ai'); // Re-import to get the mocked version
const extractHappyHours = require('../scripts/extract-happy-hours');

// Mock file system operations
jest.mock('fs', () => ({
    ...jest.requireActual('fs'), // Import and retain default behavior
    readdirSync: jest.fn(),
    readFileSync: jest.fn(),
    writeFileSync: jest.fn(),
    existsSync: jest.fn(),
    mkdirSync: jest.fn(),
}));

describe('extractHappyHours', () => {
    const MOCK_SILVER_MERGED_DIR = path.join(__dirname, '../data/silver_merged/all');
    const MOCK_GOLD_DIR = path.join(__dirname, '../data/gold');
    const MOCK_BULK_COMPLETE_FLAG = path.join(MOCK_GOLD_DIR, '.bulk-complete');

    beforeEach(() => {
        jest.clearAllMocks();
        process.env.GEMINI_API_KEY = 'mock-api-key'; // Ensure API key is set
        fs.existsSync.mockReturnValue(true); // Default to directories existing
        fs.mkdirSync.mockReturnValue(undefined); // Mock mkdirSync
    });

    afterEach(() => {
        delete process.env.GEMINI_API_KEY;
    });

    test('should extract happy hour information correctly for a venue', async () => {
        const venueId = 'venue1';
        const venueName = 'Test Venue 1';
        const mockSilverContent = {
            venueName: venueName,
            pages: [
                { url: 'https://example.com/menu', text: 'Delicious food. Happy Hour: 4pm-7pm Monday-Friday with $5 draft beers and half-off appetizers.' },
                { url: 'https://example.com/about', text: 'About our place. Opening hours: 11am-10pm daily.' }
            ]
        };
        const mockSilverFilePath = path.join(MOCK_SILVER_MERGED_DIR, `${venueId}.json`);

        fs.readdirSync.mockReturnValueOnce([`${venueId}.json`]);
        fs.readFileSync.mockReturnValueOnce(JSON.stringify(mockSilverContent)); // For silver file
        fs.existsSync.mockReturnValue(false); // No existing gold file

        await extractHappyHours(false); // Run in bulk mode for simplicity here

        expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
        const writtenGoldContent = JSON.parse(fs.writeFileSync.mock.calls[0][1]);
        expect(writtenGoldContent.venueId).toBe(venueId);
        expect(writtenGoldContent.venueName).toBe(venueName);
        expect(writtenGoldContent.happyHour.found).toBe(true);
        expect(writtenGoldContent.happyHour.times).toBe('4pm-7pm');
        expect(writtenGoldContent.happyHour.days).toBe('Monday-Friday');
        expect(writtenGoldContent.happyHour.specials).toEqual(['$5 draft beers', 'half-off appetizers']);
        expect(writtenGoldContent.happyHour.confidence).toBe(95);
        expect(writtenGoldContent.sourceHash).toBe(crypto.createHash('md5').update(JSON.stringify(mockSilverContent.pages)).digest('hex'));
    });

    test('should handle cases where no happy hour is found', async () => {
        const venueId = 'venue2';
        const venueName = 'Test Venue 2';
        const mockSilverContent = {
            venueName: venueName,
            pages: [
                { url: 'https://example.com/menu', text: 'Our full menu. We open at 8am and close at midnight.' },
                { url: 'https://example.com/contact', text: 'Contact us for events.' }
            ]
        };

        fs.readdirSync.mockReturnValueOnce([`${venueId}.json`]);
        fs.readFileSync.mockReturnValueOnce(JSON.stringify(mockSilverContent));
        fs.existsSync.mockReturnValue(false); // No existing gold file

        await extractHappyHours(false);

        expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
        const writtenGoldContent = JSON.parse(fs.writeFileSync.mock.calls[0][1]);
        expect(writtenGoldContent.happyHour.found).toBe(false);
        expect(writtenGoldContent.happyHour.confidence).toBe(80);
    });

    test('should differentiate happy hours from regular business hours', async () => {
        const venueId = 'venue3';
        const venueName = 'Test Venue 3';
        const mockSilverContent = {
            venueName: venueName,
            pages: [
                { url: 'https://example.com/hours', text: 'Opening hours: 9am-10pm daily. Specials available from 5-7pm.' },
                { url: 'https://example.com/specials', text: 'Happy Hour daily from 5pm-7pm with discounted drinks.' }
            ]
        };

        fs.readdirSync.mockReturnValueOnce([`${venueId}.json`]);
        fs.readFileSync.mockReturnValueOnce(JSON.stringify(mockSilverContent));
        fs.existsSync.mockReturnValue(false); // No existing gold file

        await extractHappyHours(false);

        expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
        const writtenGoldContent = JSON.parse(fs.writeFileSync.mock.calls[0][1]);
        expect(writtenGoldContent.happyHour.found).toBe(true);
        expect(writtenGoldContent.happyHour.times).toBe('5pm-7pm');
        expect(writtenGoldContent.happyHour.days).toBe('daily');
        expect(writtenGoldContent.happyHour.specials).toEqual(['discounted drinks']);
    });

    test('should recognize non-standard happy hour names (e.g., Heavy\'s Hour)', async () => {
        const venueId = 'venue4';
        const venueName = "Heavy's Hamburger";
        const mockSilverContent = {
            venueName: venueName,
            pages: [
                { url: 'https://heavy.com/menu', text: "Welcome to Heavy's. Enjoy Heavy's Hour from 3-6pm daily with special 'Heavy's Hour' pricing." }
            ]
        };

        fs.readdirSync.mockReturnValueOnce([`${venueId}.json`]);
        fs.readFileSync.mockReturnValueOnce(JSON.stringify(mockSilverContent));
        fs.existsSync.mockReturnValue(false);

        await extractHappyHours(false);

        expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
        const writtenGoldContent = JSON.parse(fs.writeFileSync.mock.calls[0][1]);
        expect(writtenGoldContent.happyHour.found).toBe(true);
        expect(writtenGoldContent.happyHour.times).toBe('3pm-6pm');
        expect(writtenGoldContent.happyHour.days).toBe('daily');
        expect(writtenGoldContent.happyHour.specials).toEqual(["Special 'Heavy's Hour' pricing"]);
        expect(writtenGoldContent.happyHour.confidence).toBe(90);
    });

    test('should skip processing if GEMINI_API_KEY is not set', async () => {
        delete process.env.GEMINI_API_KEY; // Unset the mock API key
        const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        process.exit = jest.fn(); // Mock process.exit

        await extractHappyHours(false);

        expect(consoleErrorSpy).toHaveBeenCalledWith('Error: GEMINI_API_KEY is not set in environment variables.');
        expect(process.exit).toHaveBeenCalledWith(1);
        // API key is checked after reading files in current implementation, so readdirSync will be called
        // But exit happens immediately after API key check
        consoleErrorSpy.mockRestore();
    });

    test('should correctly handle incremental updates, skipping unchanged files', async () => {
        const venueId = 'venue5';
        const venueName = 'Incremental Venue';
        const mockSilverContent = {
            venueName: venueName,
            pages: [{ url: 'https://incremental.com', text: 'No happy hour.' }]
        };
        // Hash should match script's calculation: JSON.stringify(venueData.pages)
        const mockSourceHash = crypto.createHash('md5').update(JSON.stringify(mockSilverContent.pages)).digest('hex');

        const mockGoldContent = {
            venueId: venueId,
            venueName: venueName,
            happyHour: { found: false, confidence: 80 },
            sourceHash: mockSourceHash,
            processedAt: new Date().toISOString()
        };

        // Simulate:
        // 1. Silver file exists
        // 2. Gold file exists with matching hash
        // 3. Bulk complete flag exists
        fs.readdirSync.mockReturnValueOnce([`${venueId}.json`]);
        fs.readFileSync
            .mockReturnValueOnce(JSON.stringify(mockSilverContent)) // Read silver file
            .mockReturnValueOnce(JSON.stringify(mockGoldContent));   // Read existing gold file
        fs.existsSync.mockImplementation((p) => {
            if (p === MOCK_BULK_COMPLETE_FLAG || p.includes('gold/venue5.json')) return true;
            return jest.requireActual('fs').existsSync(p);
        });

        const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

        await extractHappyHours(true); // Run in incremental mode

        expect(consoleLogSpy).toHaveBeenCalledWith(`Skipping ${venueName} (${venueId}): No changes detected.`);
        expect(fs.writeFileSync).not.toHaveBeenCalledWith(path.join(MOCK_GOLD_DIR, `${venueId}.json`), expect.any(String), 'utf8');
        consoleLogSpy.mockRestore();
    });

    test('should re-process changed files in incremental mode', async () => {
        const venueId = 'venue6';
        const venueName = 'Changed Venue';
        const oldSilverContent = {
            venueName: venueName,
            pages: [{ url: 'https://changed.com', text: 'No happy hour.' }]
        };
        // Hash should match script's calculation: JSON.stringify(venueData.pages)
        const oldSourceHash = crypto.createHash('md5').update(JSON.stringify(oldSilverContent.pages)).digest('hex');

        const newSilverContent = {
            venueName: venueName,
            pages: [{ url: 'https://changed.com', text: 'Happy Hour: 5-7pm!' }] // Content changed
        };
        // Hash should match script's calculation: JSON.stringify(venueData.pages)
        const newSourceHash = crypto.createHash('md5').update(JSON.stringify(newSilverContent.pages)).digest('hex');

        const mockGoldContent = {
            venueId: venueId,
            venueName: venueName,
            happyHour: { found: false, confidence: 80 },
            sourceHash: oldSourceHash, // Old hash
            processedAt: new Date().toISOString()
        };

        // Simulate:
        // 1. Silver file exists (with new content)
        // 2. Gold file exists (with old hash)
        // 3. Bulk complete flag exists
        fs.readdirSync.mockReturnValueOnce([`${venueId}.json`]);
        fs.readFileSync
            .mockReturnValueOnce(JSON.stringify(newSilverContent)) // Read current silver file
            .mockReturnValueOnce(JSON.stringify(mockGoldContent));   // Read existing gold file
        fs.existsSync.mockImplementation((p) => {
            if (p === MOCK_BULK_COMPLETE_FLAG || p.includes('gold/venue6.json')) return true;
            return jest.requireActual('fs').existsSync(p);
        });

        await extractHappyHours(true); // Run in incremental mode

        expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
        const writtenGoldContent = JSON.parse(fs.writeFileSync.mock.calls[0][1]);
        expect(writtenGoldContent.happyHour.found).toBe(true); // Expect new content to be processed
        expect(writtenGoldContent.sourceHash).toBe(newSourceHash); // Expect new hash
    });

    test('should log warning and exit if bulk complete flag is missing in incremental mode', async () => {
        // Ensure API key is set (checked before bulk flag)
        process.env.GEMINI_API_KEY = 'mock-api-key';
        
        // Mock existsSync to return false for the bulk complete flag, true for directories
        fs.existsSync.mockImplementation((p) => {
            const pathStr = p ? p.toString() : '';
            if (pathStr.includes('.bulk-complete') || pathStr === MOCK_BULK_COMPLETE_FLAG) {
                return false; // Flag missing
            }
            if (pathStr.includes('silver_merged') || pathStr.includes('gold')) {
                return true; // Directories exist
            }
            return jest.requireActual('fs').existsSync(p);
        });
        fs.readdirSync.mockReturnValue([]); // No files to read

        const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
        process.exit = jest.fn();

        await extractHappyHours(true); // Run in incremental mode

        expect(consoleWarnSpy).toHaveBeenCalledWith(
            'Bulk extraction not marked as complete. Running in incremental mode requires prior bulk extraction.'
        );
        expect(process.exit).toHaveBeenCalledWith(1);
        consoleWarnSpy.mockRestore();
    });

    test('should log error and exit if silver_merged directory cannot be read', async () => {
        fs.readdirSync.mockImplementation(() => {
            throw new Error('Permission denied');
        });
        fs.existsSync.mockReturnValue(true); // Bulk flag exists

        const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        process.exit = jest.fn();

        await extractHappyHours(true);

        expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Error reading silver_merged directory: Permission denied'));
        expect(process.exit).toHaveBeenCalledWith(1);
        consoleErrorSpy.mockRestore();
    });
});
