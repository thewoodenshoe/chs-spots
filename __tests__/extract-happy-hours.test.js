const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Mock node-fetch
const mockFetch = jest.fn();
jest.mock('node-fetch', () => mockFetch);

const extractHappyHours = require('../scripts/extract-happy-hours');

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
    existsSync: jest.fn(),
    mkdirSync: jest.fn(),
}));

describe('extractHappyHours', () => {
    const MOCK_SILVER_TRIMMED_DIR = path.join(__dirname, '../data/silver_trimmed/all');
    const MOCK_GOLD_DIR = path.join(__dirname, '../data/gold');
    const MOCK_BULK_COMPLETE_FLAG = path.join(MOCK_GOLD_DIR, '.bulk-complete');

    beforeEach(() => {
        jest.clearAllMocks();
        process.env.GROK_API_KEY = 'mock-api-key'; // Ensure API key is set
        fs.existsSync.mockReturnValue(true); // Default to directories existing
        fs.mkdirSync.mockReturnValue(undefined); // Mock mkdirSync
        
        // Mock fetch to return successful responses
        mockFetch.mockImplementation((url, options) => {
            const body = JSON.parse(options.body);
            const prompt = body.messages[0].content;
            return createMockFetchResponse(prompt);
        });
        
        // Mock LLM instructions file read
        const mockLLMInstructions = `You are an expert analyst...
{VENUE_ID}
{VENUE_NAME}
{CONTENT_PLACEHOLDER}`;
        fs.readFileSync.mockImplementation((filePath, encoding) => {
            if (filePath && filePath.includes('llm-instructions.txt')) {
                return mockLLMInstructions;
            }
            // For other files, use the actual implementation or return empty
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
        fs.readFileSync.mockReturnValueOnce(JSON.stringify(mockSilverContent)); // For silver file
        fs.existsSync.mockReturnValue(false); // No existing gold file

        await extractHappyHours(false); // Run in bulk mode for simplicity here

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
        fs.readFileSync.mockReturnValueOnce(JSON.stringify(mockSilverContent));
        fs.existsSync.mockReturnValue(false); // No existing gold file

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
        fs.readFileSync.mockReturnValueOnce(JSON.stringify(mockSilverContent));
        fs.existsSync.mockReturnValue(false); // No existing gold file

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
        fs.readFileSync.mockReturnValueOnce(JSON.stringify(mockSilverContent));
        fs.existsSync.mockReturnValue(false);

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
        // Hash should match script's calculation: pages.map(p => p.text || p.html || '').join('\n')
        const mockSourceHash = crypto.createHash('md5').update(mockSilverContent.pages.map(p => p.text || p.html || '').join('\n')).digest('hex');

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
        let readCallIndex = 0;
        fs.readFileSync.mockImplementation((filePath) => {
            if (filePath && filePath.includes('config.json')) {
                return JSON.stringify({ pipeline: { maxIncrementalFiles: 15 } });
            }
            if (filePath && filePath.includes('llm-instructions.txt')) {
                return 'Mock LLM instructions';
            }
            if (filePath && filePath.includes(`${venueId}.json`)) {
                readCallIndex++;
                // First call is silver file, second is gold file
                if (readCallIndex === 1) {
                    return JSON.stringify(mockSilverContent);
                } else {
                    return JSON.stringify(mockGoldContent);
                }
            }
            return '';
        });
        fs.existsSync.mockImplementation((p) => {
            if (p === MOCK_BULK_COMPLETE_FLAG || p.includes('gold/venue5.json')) return true;
            if (p && p.includes('config.json')) return true;
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
        // Hash should match script's calculation: pages.map(p => p.text || p.html || '').join('\n')
        const oldSourceHash = crypto.createHash('md5').update(oldSilverContent.pages.map(p => p.text || p.html || '').join('\n')).digest('hex');

        const newSilverContent = {
            venueName: venueName,
            pages: [{ url: 'https://changed.com', text: 'Happy Hour: 5-7pm!' }] // Content changed
        };
        // Hash should match script's calculation: pages.map(p => p.text || p.html || '').join('\n')
        const newSourceHash = crypto.createHash('md5').update(newSilverContent.pages.map(p => p.text || p.html || '').join('\n')).digest('hex');

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
        let readCallCount = 0;
        fs.readFileSync.mockImplementation((filePath) => {
            if (filePath && filePath.includes('config.json')) {
                return JSON.stringify({ pipeline: { maxIncrementalFiles: 15 } });
            }
            if (filePath && filePath.includes('llm-instructions.txt')) {
                return 'Mock LLM instructions';
            }
            if (filePath && filePath.includes(`${venueId}.json`)) {
                readCallCount++;
                if (readCallCount === 1) {
                    return JSON.stringify(newSilverContent); // Read current silver file
                } else {
                    return JSON.stringify(mockGoldContent); // Read existing gold file
                }
            }
            return '';
        });
        fs.existsSync.mockImplementation((p) => {
            if (p === MOCK_BULK_COMPLETE_FLAG || p.includes('gold/venue6.json')) return true;
            if (p && p.includes('config.json')) return true;
            return jest.requireActual('fs').existsSync(p);
        });
        
        // Mock successful API response for changed content
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

        await extractHappyHours(true); // Run in incremental mode

        expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
        const writtenGoldContent = JSON.parse(fs.writeFileSync.mock.calls[0][1]);
        expect(writtenGoldContent.happyHour.found).toBe(true); // Expect new content to be processed
        expect(writtenGoldContent.sourceHash).toBe(newSourceHash); // Expect new hash
    });

    test('should log warning and exit if bulk complete flag is missing in incremental mode', async () => {
        // Ensure API key is set (checked first)
        process.env.GROK_API_KEY = 'mock-api-key';
        
        // Mock readdirSync to return at least one file so the script doesn't return early
        // The bulk flag check happens AFTER reading files but before processing
        fs.readdirSync.mockReturnValue(['venue1.json']);
        
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
});
