import { createSpotSchema, updateSpotSchema, feedbackSchema, parseOrError } from '../validations';

describe('createSpotSchema', () => {
  const validSpot = {
    title: 'Test Spot',
    lat: 32.845,
    lng: -79.908,
  };

  it('accepts valid minimal spot', () => {
    const result = createSpotSchema.safeParse(validSpot);
    expect(result.success).toBe(true);
  });

  it('rejects missing title', () => {
    const result = createSpotSchema.safeParse({ lat: 32.845, lng: -79.908 });
    expect(result.success).toBe(false);
  });

  it('rejects invalid latitude', () => {
    const result = createSpotSchema.safeParse({ ...validSpot, lat: 200 });
    expect(result.success).toBe(false);
  });

  it('rejects invalid longitude', () => {
    const result = createSpotSchema.safeParse({ ...validSpot, lng: -200 });
    expect(result.success).toBe(false);
  });

  it('rejects title exceeding max length', () => {
    const result = createSpotSchema.safeParse({ ...validSpot, title: 'x'.repeat(201) });
    expect(result.success).toBe(false);
  });

  it('applies defaults for optional fields', () => {
    const result = createSpotSchema.safeParse(validSpot);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.submitterName).toBe('Anonymous');
      expect(result.data.description).toBe('');
      expect(result.data.type).toBe('Happy Hour');
    }
  });

  it('rejects photoUrl exceeding max length', () => {
    const result = createSpotSchema.safeParse({ ...validSpot, photoUrl: 'x'.repeat(1_500_001) });
    expect(result.success).toBe(false);
  });
});

describe('feedbackSchema', () => {
  it('accepts valid feedback', () => {
    const result = feedbackSchema.safeParse({
      name: 'Test User',
      email: 'test@example.com',
      message: 'Great app!',
    });
    expect(result.success).toBe(true);
  });

  it('accepts empty email string', () => {
    const result = feedbackSchema.safeParse({
      name: 'Test',
      email: '',
      message: 'Hello',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid email', () => {
    const result = feedbackSchema.safeParse({
      name: 'Test',
      email: 'not-an-email',
      message: 'Hello',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty message', () => {
    const result = feedbackSchema.safeParse({
      name: 'Test',
      message: '',
    });
    expect(result.success).toBe(false);
  });
});

describe('parseOrError', () => {
  it('returns data on success', () => {
    const result = parseOrError(createSpotSchema, { title: 'Test', lat: 32, lng: -79 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.title).toBe('Test');
    }
  });

  it('returns field-specific error on failure', () => {
    const result = parseOrError(createSpotSchema, { lat: 32, lng: -79 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('title');
    }
  });
});
