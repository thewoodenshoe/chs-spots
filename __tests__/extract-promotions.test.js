const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Mock node-fetch
const mockFetch = jest.fn();
jest.mock('node-fetch', () => mockFetch);

// Mock database module
jest.mock('../scripts/utils/db', () => ({
    ensureSchema: jest.fn(),
    gold: {
        get: jest.fn(),
        upsert: jest.fn(),
    },
    venues: {
        getAll: jest.fn(() => []),
    },
    config: {
        loadConfig: jest.fn(() => ({
            run_date: '20260120',
            last_run_status: 'idle',
            pipeline: { maxIncrementalFiles: 15 },
        })),
        set: jest.fn(),
        saveConfig: jest.fn(),
    },
    watchlist: {
        getAll: jest.fn(() => []),
    },
}));

const extractHappyHours = require('../scripts/extract-promotions');
const db = require('../scripts/utils/db');

// Helper function to create mock fetch responses
function createMockFetchResponse(prompt) {
    // Simulate LLM responses based on prompt content
    // IMPORTANT: Check happy hour conditions BEFORE general business hours conditions
    // to ensure happy hours are detected even when both are present
    let responseText = '';
    
    if (prompt.includes("Happy Hour: 4pm-7pm Monday-Friday")) {
        responseText = `{ 
            "found": true,
            "times": "4pm-7pm",
            "days": "Monday-Friday",
            "specials": ["$5 draft beers", "half-off appetizers"],
            "source": "https://example.com/specials",
            "confidence": 95
        }`;
    } else if (prompt.includes("Happy Hour: 5-7pm") || prompt.includes("Happy Hour: 5-7pm!") || 
               prompt.includes("Happy Hour daily from 5pm-7pm") ||
               prompt.includes("Happy Hour daily from 5pm") ||
               (prompt.includes("Test Venue 3") && prompt.includes("Happy Hour daily from 5pm-7pm")) ||
               (prompt.includes("discounted drinks") && prompt.includes("Happy Hour daily"))) {
        responseText = `{ 
            "found": true,
            "times": "5pm-7pm",
            "days": "daily",
            "specials": ["discounted drinks"],
            "source": "https://example.com/specials",
            "confidence": 95
        }`;
    } else if (prompt.includes("Heavy's Hour from 3-6pm")) {
        responseText = `{ 
            "found": true,
            "times": "3pm-6pm",
            "days": "daily",
            "specials": ["Special 'Heavy's Hour' pricing"],
            "source": "https://heavy.com/menu",
            "confidence": 90
        }`;
    } else if (prompt.includes("Opening hours: 9am-10pm daily") || 
               prompt.includes("Our full menu") ||
               prompt.includes("We open at 8am and close at midnight")) {
        responseText = `{ 
            "found": false,
            "confidence": 80
        }`;
    } else {
        responseText = `{ 
            "found": false,
            "confidence": 50
        }`;
    }
    
    return Promise.resolve({
        ok: true,
        json: async () => ({
            choices: [{
                message: {
                    content: responseText
                }
            }]
        })
    });
}

// Mock file system operations
jest.mock('fs', () => ({
    ...jest.requireActual('fs'), // Import and retain default behavior
    readdirSync: jest.fn(),
    readFileSync: jest.fn(),
    writeFileSync: jest.fn(),
    appendFileSync: jest.fn(),
    existsSync: jest.fn(),
    mkdirSync: jest.fn(),
}));

describe('extractHappyHours', () => {
    const MOCK_SILVER_TRIMMED_DIR = path.join(__dirname, '../data/silver_trimmed/all');
    const MOCK_GOLD_DIR = path.join(__dirname, '../data/gold');
    const MOCK_BULK_COMPLETE_FLAG = path.join(MOCK_GOLD_DIR, '.bulk-complete');
    const mockLLMInstructions = `You are an expert analyst...
{VENUE_ID}
{VENUE_NAME}
{CONTENT_PLACEHOLDER}`;
    let testFileMocks;

    beforeEach(() => {
        jest.clearAllMocks();
        process.env.GROK_API_KEY = 'mock-api-key';
        fs.existsSync.mockReturnValue(true);
        fs.mkdirSync.mockReturnValue(undefined);
        fs.readdirSync.mockReturnValue([]);
        db.gold.get.mockReturnValue(null);
        db.gold.upsert.mockReturnValue(undefined);
        testFileMocks = {};

        mockFetch.mockImplementation((url, options) => {
            const body = JSON.parse(options.body);
            const prompt = body.messages.map(m => m.content).join('\n');
            return createMockFetchResponse(prompt);
        });

        fs.readFileSync.mockImplementation((filePath) => {
            if (filePath && filePath.includes('llm-instructions.txt')) {
                return mockLLMInstructions;
            }
            for (const [key, value] of Object.entries(testFileMocks)) {
                if (filePath && filePath.includes(key)) return value;
            }
            return '';
        });
    });

    afterEach(() => {
        delete process.env.GROK_API_KEY;
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
        const mockSilverFilePath = path.join(MOCK_SILVER_TRIMMED_DIR, `${venueId}.json`);

        fs.readdirSync.mockReturnValueOnce([`${venueId}.json`]);
        testFileMocks[`${venueId}.json`] = JSON.stringify(mockSilverContent);

        await extractHappyHours(false);

        expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
        const writtenGoldContent = JSON.parse(fs.writeFileSync.mock.calls[0][1]);
        expect(writtenGoldContent.venueId).toBe(venueId);
        expect(writtenGoldContent.venueName).toBe(venueName);
        expect(writtenGoldContent.happyHour.found).toBe(true);
        // New format uses entries array - check first entry
        expect(writtenGoldContent.happyHour.entries).toBeDefined();
        expect(writtenGoldContent.happyHour.entries.length).toBeGreaterThan(0);
        expect(writtenGoldContent.happyHour.entries[0].times).toBe('4pm-7pm');
        expect(writtenGoldContent.happyHour.entries[0].days).toBe('Monday-Friday');
        expect(writtenGoldContent.happyHour.entries[0].specials).toEqual(['$5 draft beers', 'half-off appetizers']);
        expect(writtenGoldContent.happyHour.entries[0].confidence).toBe(95);
        // Hash calculation must match script: pages.map(p => p.text || p.html || '').join('\n')
        const expectedHash = crypto.createHash('md5').update(mockSilverContent.pages.map(p => p.text || p.html || '').join('\n')).digest('hex');
        expect(writtenGoldContent.sourceHash).toBe(expectedHash);
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
        testFileMocks[`${venueId}.json`] = JSON.stringify(mockSilverContent);

        await extractHappyHours(false);

        expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
        const writtenGoldContent = JSON.parse(fs.writeFileSync.mock.calls[0][1]);
        expect(writtenGoldContent.happyHour.found).toBe(false);
        // New format uses reason instead of confidence when found is false
        expect(writtenGoldContent.happyHour.reason).toBeDefined();
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
        testFileMocks[`${venueId}.json`] = JSON.stringify(mockSilverContent);

        await extractHappyHours(false);

        expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
        const writtenGoldContent = JSON.parse(fs.writeFileSync.mock.calls[0][1]);
        expect(writtenGoldContent.happyHour.found).toBe(true);
        // New format uses entries array - check first entry
        expect(writtenGoldContent.happyHour.entries).toBeDefined();
        expect(writtenGoldContent.happyHour.entries[0].times).toBe('5pm-7pm');
        expect(writtenGoldContent.happyHour.entries[0].days).toBe('daily');
        expect(writtenGoldContent.happyHour.entries[0].specials).toEqual(['discounted drinks']);
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
        testFileMocks[`${venueId}.json`] = JSON.stringify(mockSilverContent);

        await extractHappyHours(false);

        expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
        const writtenGoldContent = JSON.parse(fs.writeFileSync.mock.calls[0][1]);
        expect(writtenGoldContent.happyHour.found).toBe(true);
        // New format uses entries array - check first entry
        expect(writtenGoldContent.happyHour.entries).toBeDefined();
        expect(writtenGoldContent.happyHour.entries[0].times).toBe('3pm-6pm');
        expect(writtenGoldContent.happyHour.entries[0].days).toBe('daily');
        expect(writtenGoldContent.happyHour.entries[0].specials).toEqual(["Special 'Heavy's Hour' pricing"]);
        expect(writtenGoldContent.happyHour.entries[0].confidence).toBe(90);
    });

    test('should skip processing if GROK_API_KEY is not set', async () => {
        delete process.env.GROK_API_KEY; // Unset the mock API key
        const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        process.exit = jest.fn(); // Mock process.exit

        await extractHappyHours(false);

        expect(consoleErrorSpy).toHaveBeenCalledWith('Error: GROK_API_KEY is not set in environment variables.');
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
        const mockSourceHash = crypto.createHash('md5').update(mockSilverContent.pages.map(p => p.text || p.html || '').join('\n')).digest('hex');

        fs.readdirSync.mockReturnValueOnce([`${venueId}.json`]);
        testFileMocks[`${venueId}.json`] = JSON.stringify(mockSilverContent);
        testFileMocks['config.json'] = JSON.stringify({ pipeline: { maxIncrementalFiles: 15 } });

        db.gold.get.mockReturnValue({
            venue_id: venueId,
            venue_name: venueName,
            promotions: JSON.stringify({ found: false, confidence: 80 }),
            source_hash: mockSourceHash,
            normalized_source_hash: null,
            processed_at: new Date().toISOString(),
        });

        const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

        await extractHappyHours(true);

        expect(consoleLogSpy).toHaveBeenCalledWith(`Skipping ${venueName} (${venueId}): No changes detected (raw hash match).`);
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
        const oldSourceHash = crypto.createHash('md5').update(oldSilverContent.pages.map(p => p.text || p.html || '').join('\n')).digest('hex');

        const newSilverContent = {
            venueName: venueName,
            pages: [{ url: 'https://changed.com', text: 'Happy Hour: 5-7pm!' }]
        };
        const newSourceHash = crypto.createHash('md5').update(newSilverContent.pages.map(p => p.text || p.html || '').join('\n')).digest('hex');

        fs.readdirSync.mockReturnValueOnce([`${venueId}.json`]);
        testFileMocks[`${venueId}.json`] = JSON.stringify(newSilverContent);
        testFileMocks['config.json'] = JSON.stringify({ pipeline: { maxIncrementalFiles: 15 } });

        db.gold.get.mockReturnValue({
            venue_id: venueId,
            venue_name: venueName,
            promotions: JSON.stringify({ found: false, confidence: 80 }),
            source_hash: oldSourceHash,
            normalized_source_hash: null,
            processed_at: new Date().toISOString(),
        });

        mockFetch.mockResolvedValue({
            ok: true,
            json: async () => ({
                choices: [{
                    message: {
                        content: JSON.stringify({ found: true, times: '5pm-7pm', days: 'daily', specials: ['discounted drinks'] })
                    }
                }]
            })
        });

        await extractHappyHours(true);

        expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
        const writtenGoldContent = JSON.parse(fs.writeFileSync.mock.calls[0][1]);
        expect(writtenGoldContent.happyHour.found).toBe(true);
        expect(writtenGoldContent.sourceHash).toBe(newSourceHash);
    });

    test('should log warning and exit if bulk complete flag is missing in incremental mode', async () => {
        process.env.GROK_API_KEY = 'mock-api-key';

        fs.readdirSync.mockReturnValueOnce(['venue1.json']);
        
        // Mock existsSync to return false for the bulk complete flag
        fs.existsSync.mockImplementation((p) => {
            if (!p) return false;
            const pathStr = p ? p.toString() : '';
            
            // Check if this is the bulk complete flag path (check for .bulk-complete in the path)
            if (pathStr.includes('.bulk-complete') || 
                pathStr.endsWith('/.bulk-complete') || 
                pathStr.endsWith('\\.bulk-complete') ||
                pathStr === MOCK_BULK_COMPLETE_FLAG) {
                return false; // Flag missing - this should trigger the warning
            }
            // All other paths should exist (directories, etc.)
            return true;
        });

        const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
        process.exit = jest.fn();

        await extractHappyHours(true); // Run in incremental mode

        // Verify the warning was called
        expect(consoleWarnSpy).toHaveBeenCalledWith(
            'Bulk extraction not marked as complete. Running in incremental mode requires prior bulk extraction.'
        );
        expect(process.exit).toHaveBeenCalledWith(1);
        consoleWarnSpy.mockRestore();
    });

    test('should log error and exit if silver_trimmed directory cannot be read', async () => {
        fs.readdirSync.mockImplementation(() => {
            throw new Error('Permission denied');
        });
        fs.existsSync.mockReturnValue(true); // Bulk flag exists

        const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        process.exit = jest.fn();

        await extractHappyHours(true);

        expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Error reading silver_trimmed directory: Permission denied'));
        expect(process.exit).toHaveBeenCalledWith(1);
        consoleErrorSpy.mockRestore();
    });

    describe('Cost fail-safe: maxIncrementalFiles', () => {
        beforeEach(() => {
            process.env.GROK_API_KEY = 'mock-api-key';
            fs.existsSync.mockReturnValue(true); // Directories exist
            fs.mkdirSync.mockReturnValue(undefined);
        });

        test('should abort if incremental files count exceeds maxIncrementalFiles (16 > 15)', async () => {
            // Mock 16 files in incremental directory
            const mockFiles = Array.from({ length: 16 }, (_, i) => `venue${i}.json`);
            fs.readdirSync.mockReturnValue(mockFiles);
            
            // Mock config with maxIncrementalFiles = 15
            fs.readFileSync.mockImplementation((filePath) => {
                if (filePath && filePath.includes('config.json')) {
                    return JSON.stringify({ pipeline: { maxIncrementalFiles: 15 } });
                }
                if (filePath && filePath.includes('llm-instructions.txt')) {
                    return 'Mock LLM instructions';
                }
                return '';
            });

            const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
            process.exit = jest.fn();

            await extractHappyHours(true);

            // Check that error was called with the abort message (ANSI codes are separate args)
            const errorCalls = consoleErrorSpy.mock.calls;
            const abortCall = errorCalls.find(call => 
                call.some(arg => typeof arg === 'string' && arg.includes('ABORTING: Too many incremental files (16 > 15)'))
            );
            expect(abortCall).toBeDefined();
            expect(process.exit).toHaveBeenCalledWith(1);
            consoleErrorSpy.mockRestore();
        });

        test('should continue if incremental files count is within limit (14 <= 15)', async () => {
            // Mock 14 files in incremental directory
            const mockFiles = Array.from({ length: 14 }, (_, i) => `venue${i}.json`);
            fs.readdirSync.mockReturnValue(mockFiles);
            
            // Mock config with maxIncrementalFiles = 15
            fs.readFileSync.mockImplementation((filePath) => {
                if (filePath && filePath.includes('config.json')) {
                    return JSON.stringify({ pipeline: { maxIncrementalFiles: 15 } });
                }
                if (filePath && filePath.includes('llm-instructions.txt')) {
                    return 'Mock LLM instructions';
                }
                return '';
            });

            // Mock successful API response
            mockFetch.mockResolvedValue({
                ok: true,
                json: async () => ({
                    choices: [{
                        message: {
                            content: JSON.stringify({ found: false })
                        }
                    }]
                })
            });

            const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
            process.exit = jest.fn();

            await extractHappyHours(true);

            // Should NOT call process.exit(1) for cost fail-safe
            expect(consoleErrorSpy).not.toHaveBeenCalledWith(
                expect.stringContaining('ABORTING: Too many incremental files')
            );
            consoleErrorSpy.mockRestore();
        });

        test('should default to 15 if config is missing', async () => {
            // Mock 16 files (exceeds default 15)
            const mockFiles = Array.from({ length: 16 }, (_, i) => `venue${i}.json`);
            fs.readdirSync.mockReturnValue(mockFiles);
            
            // Mock config file doesn't exist
            fs.existsSync.mockImplementation((filePath) => {
                if (filePath && filePath.includes('config.json')) {
                    return false; // Config file doesn't exist
                }
                return true; // Other files/directories exist
            });
            
            fs.readFileSync.mockImplementation((filePath) => {
                if (filePath && filePath.includes('llm-instructions.txt')) {
                    return 'Mock LLM instructions';
                }
                return '';
            });

            const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
            const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
            process.exit = jest.fn();

            await extractHappyHours(true);

            // Should use default 15 and abort
            const errorCalls = consoleErrorSpy.mock.calls;
            const abortCall = errorCalls.find(call => 
                call.some(arg => typeof arg === 'string' && arg.includes('ABORTING: Too many incremental files (16 > 15)'))
            );
            expect(abortCall).toBeDefined();
            expect(process.exit).toHaveBeenCalledWith(1);
            consoleErrorSpy.mockRestore();
            consoleWarnSpy.mockRestore();
        });

        test('should allow unlimited files when maxIncrementalFiles is -1', async () => {
            // Mock 100 files (would normally exceed limit)
            const mockFiles = Array.from({ length: 100 }, (_, i) => `venue${i}.json`);
            fs.readdirSync.mockReturnValue(mockFiles);
            
            // Mock config with maxIncrementalFiles = -1 (unlimited)
            fs.readFileSync.mockImplementation((filePath) => {
                if (filePath && filePath.includes('config.json')) {
                    return JSON.stringify({ pipeline: { maxIncrementalFiles: -1 } });
                }
                if (filePath && filePath.includes('llm-instructions.txt')) {
                    return 'Mock LLM instructions';
                }
                return '';
            });

            // Mock successful API response
            mockFetch.mockResolvedValue({
                ok: true,
                json: async () => ({
                    choices: [{
                        message: {
                            content: JSON.stringify({ found: false })
                        }
                    }]
                })
            });

            const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
            process.exit = jest.fn();

            await extractHappyHours(true);

            // Should NOT abort even with 100 files when maxIncrementalFiles = -1
            expect(consoleErrorSpy).not.toHaveBeenCalledWith(
                expect.stringContaining('ABORTING: Too many incremental files')
            );
            consoleErrorSpy.mockRestore();
        });

        test('should not apply fail-safe in bulk mode (non-incremental)', async () => {
            // Mock many files in bulk mode
            const mockFiles = Array.from({ length: 100 }, (_, i) => `venue${i}.json`);
            fs.readdirSync.mockReturnValue(mockFiles);
            
            // Mock config with maxIncrementalFiles = 15
            fs.readFileSync.mockImplementation((filePath) => {
                if (filePath && filePath.includes('config.json')) {
                    return JSON.stringify({ pipeline: { maxIncrementalFiles: 15 } });
                }
                if (filePath && filePath.includes('llm-instructions.txt')) {
                    return 'Mock LLM instructions';
                }
                return '';
            });

            // Mock successful API response
            mockFetch.mockResolvedValue({
                ok: true,
                json: async () => ({
                    choices: [{
                        message: {
                            content: JSON.stringify({ found: false })
                        }
                    }]
                })
            });

            const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
            process.exit = jest.fn();

            await extractHappyHours(false); // Bulk mode

            // Should NOT abort in bulk mode (fail-safe only applies to incremental)
            expect(consoleErrorSpy).not.toHaveBeenCalledWith(
                expect.stringContaining('ABORTING: Too many incremental files')
            );
            consoleErrorSpy.mockRestore();
        });
    });

    describe('LLM candidates history log', () => {
        const MOCK_HISTORY_PATH = path.join(__dirname, '../logs/llm-candidates-history.txt');
        const MOCK_VENUES_JSON_PATH = path.join(__dirname, '../data/reporting/venues.json');

        beforeEach(() => {
            process.env.GROK_API_KEY = 'mock-api-key';
            fs.existsSync.mockReturnValue(true);
            fs.mkdirSync.mockReturnValue(undefined);
            // Mock today's date for consistent testing
            jest.useFakeTimers();
            jest.setSystemTime(new Date('2026-01-20T12:00:00Z'));
        });

        afterEach(() => {
            jest.useRealTimers();
        });

        test('should append LLM candidates to history file in incremental mode', async () => {
            const mockFiles = ['ChIJabc123.json', 'ChIJxyz789.json'];
            fs.readdirSync.mockReturnValue(mockFiles);

            db.venues.getAll.mockReturnValue([
                { id: 'ChIJabc123', name: 'Some Cool Bar', area: 'Downtown Charleston' },
                { id: 'ChIJxyz789', name: 'Another Hip Spot', area: 'Mount Pleasant' }
            ]);

            fs.readFileSync.mockImplementation((filePath) => {
                if (filePath && filePath.includes('config.json')) {
                    return JSON.stringify({ pipeline: { maxIncrementalFiles: 15 } });
                }
                if (filePath && filePath.includes('llm-instructions.txt')) {
                    return 'Mock LLM instructions';
                }
                return '';
            });

            // Mock successful API response
            mockFetch.mockResolvedValue({
                ok: true,
                json: async () => ({
                    choices: [{
                        message: {
                            content: JSON.stringify({ found: false })
                        }
                    }]
                })
            });

            await extractHappyHours(true);

            // Verify appendFileSync was called with correct format
            expect(fs.appendFileSync).toHaveBeenCalled();
            const appendCall = fs.appendFileSync.mock.calls.find(call => 
                call[0] === MOCK_HISTORY_PATH || call[0].includes('llm-candidates-history.txt')
            );
            expect(appendCall).toBeDefined();

            const logContent = appendCall[1];
            expect(logContent).toContain('date 2026-01-20:');
            expect(logContent).toContain('venueId: ChIJabc123');
            expect(logContent).toContain('venueName: Some Cool Bar');
            expect(logContent).toContain('venueArea: Downtown Charleston');
            expect(logContent).toContain('venueId: ChIJxyz789');
            expect(logContent).toContain('venueName: Another Hip Spot');
            expect(logContent).toContain('venueArea: Mount Pleasant');
            // Should end with blank line
            expect(logContent.endsWith('\n\n')).toBe(true);
        });

        test('should not append to history file if incremental folder is empty', async () => {
            fs.readdirSync.mockReturnValue([]);

            await extractHappyHours(true);

            // Should not call appendFileSync when no files
            const appendCalls = fs.appendFileSync.mock.calls.filter(call => 
                call[0] === MOCK_HISTORY_PATH || (call[0] && call[0].includes('llm-candidates-history.txt'))
            );
            expect(appendCalls.length).toBe(0);
        });

        test('should handle missing venue data gracefully', async () => {
            const mockFiles = ['ChIJabc123.json', 'ChIJunknown.json'];
            fs.readdirSync.mockReturnValue(mockFiles);

            db.venues.getAll.mockReturnValue([
                { id: 'ChIJabc123', name: 'Some Cool Bar', area: 'Downtown Charleston' }
            ]);

            fs.readFileSync.mockImplementation((filePath) => {
                if (filePath && filePath.includes('config.json')) {
                    return JSON.stringify({ pipeline: { maxIncrementalFiles: 15 } });
                }
                if (filePath && filePath.includes('llm-instructions.txt')) {
                    return 'Mock LLM instructions';
                }
                return '';
            });

            // Mock successful API response
            mockFetch.mockResolvedValue({
                ok: true,
                json: async () => ({
                    choices: [{
                        message: {
                            content: JSON.stringify({ found: false })
                        }
                    }]
                })
            });

            await extractHappyHours(true);

            // Verify appendFileSync was called
            const appendCall = fs.appendFileSync.mock.calls.find(call => 
                call[0] === MOCK_HISTORY_PATH || call[0].includes('llm-candidates-history.txt')
            );
            expect(appendCall).toBeDefined();

            const logContent = appendCall[1];
            expect(logContent).toContain('venueId: ChIJabc123');
            expect(logContent).toContain('venueName: Some Cool Bar');
            expect(logContent).toContain('venueId: ChIJunknown');
            expect(logContent).toContain('venueName: Unknown');
            expect(logContent).toContain('venueArea: Unknown');
        });

        test('should not log in bulk mode (non-incremental)', async () => {
            const mockFiles = ['ChIJabc123.json'];
            fs.readdirSync.mockReturnValue(mockFiles);

            fs.readFileSync.mockImplementation((filePath) => {
                if (filePath && filePath.includes('llm-instructions.txt')) {
                    return 'Mock LLM instructions';
                }
                return '';
            });

            // Mock successful API response
            mockFetch.mockResolvedValue({
                ok: true,
                json: async () => ({
                    choices: [{
                        message: {
                            content: JSON.stringify({ found: false })
                        }
                    }]
                })
            });

            await extractHappyHours(false); // Bulk mode

            // Should not call appendFileSync in bulk mode
            const appendCalls = fs.appendFileSync.mock.calls.filter(call => 
                call[0] === MOCK_HISTORY_PATH || (call[0] && call[0].includes('llm-candidates-history.txt'))
            );
            expect(appendCalls.length).toBe(0);
        });
    });
});
