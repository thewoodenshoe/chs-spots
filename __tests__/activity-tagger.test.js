const { detectSecondaryTypes } = require('../scripts/utils/activity-tagger');

describe('detectSecondaryTypes', () => {
  it('detects dog-friendly from description', () => {
    const text = 'Adults-only neighborhood bar with dog-friendly patio.';
    expect(detectSecondaryTypes(text, 'Recently Opened')).toEqual(['Dog-Friendly']);
  });

  it('detects pet-friendly variant', () => {
    const text = 'A pet-friendly café with outdoor seating.';
    const types = detectSecondaryTypes(text, 'Recently Opened');
    expect(types).toContain('Dog-Friendly');
    expect(types).toContain('Coffee Shops');
  });

  it('detects brunch from description', () => {
    const text = 'Bar serving brunch, smash burgers, and cocktails.';
    expect(detectSecondaryTypes(text, 'Coming Soon')).toEqual(['Brunch']);
  });

  it('detects rooftop bars', () => {
    const text = 'Restaurant with rooftop bar overlooking the harbor.';
    expect(detectSecondaryTypes(text, 'Recently Opened')).toEqual(['Rooftop Bars']);
  });

  it('detects live music', () => {
    const text = 'Venue featuring live music every weekend.';
    expect(detectSecondaryTypes(text, 'Recently Opened')).toEqual(['Live Music']);
  });

  it('detects multiple secondary types', () => {
    const text = 'Dog-friendly rooftop bar with live music and brunch.';
    const types = detectSecondaryTypes(text, 'Recently Opened');
    expect(types).toContain('Dog-Friendly');
    expect(types).toContain('Rooftop Bars');
    expect(types).toContain('Live Music');
    expect(types).toContain('Brunch');
    expect(types).toHaveLength(4);
  });

  it('excludes the primary type from results', () => {
    const text = 'Dog-friendly park with off-leash area.';
    expect(detectSecondaryTypes(text, 'Dog-Friendly')).toEqual([]);
  });

  it('returns empty for unmatched descriptions', () => {
    const text = 'Bakery specializing in house-made treats and pastries.';
    expect(detectSecondaryTypes(text, 'Recently Opened')).toEqual([]);
  });

  it('detects "dogs welcome"', () => {
    const text = 'Waterfront restaurant where dogs are welcome on the patio.';
    expect(detectSecondaryTypes(text, 'Recently Opened')).toEqual(['Dog-Friendly']);
  });

  it('detects off-leash', () => {
    const text = 'Park with off-leash dog area along the river.';
    expect(detectSecondaryTypes(text, 'Recently Opened')).toEqual(['Dog-Friendly']);
  });

  it('detects coffee shop variant café', () => {
    const text = 'New café opening on King Street.';
    expect(detectSecondaryTypes(text, 'Recently Opened')).toEqual(['Coffee Shops']);
  });

  it('does not false-positive on generic "dog" mentions', () => {
    const text = 'Hot dog stand with great mustard.';
    expect(detectSecondaryTypes(text, 'Recently Opened')).toEqual([]);
  });

  it('does not false-positive on generic "coffee" mentions', () => {
    const text = 'Restaurant serving lunch, dinner, and coffee.';
    expect(detectSecondaryTypes(text, 'Recently Opened')).toEqual([]);
  });
});
