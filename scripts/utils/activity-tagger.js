const ACTIVITY_SIGNALS = [
  {
    type: 'Dog-Friendly',
    patterns: [
      /\bdog[- ]?friendly\b/i,
      /\bpet[- ]?friendly\b/i,
      /\bdogs?\s+(?:are\s+)?welcome\b/i,
      /\bleashed\s+(?:dogs?|pets?)\b/i,
      /\bdog\s+(?:patio|deck|menu|park|area|beach)\b/i,
      /\boff[- ]?leash\b/i,
      /\bpup[- ]?friendly\b/i,
    ],
  },
  {
    type: 'Brunch',
    patterns: [
      /\bbrunch\b/i,
    ],
  },
  {
    type: 'Rooftop Bars',
    patterns: [
      /\brooftop\s+(?:bar|deck|dining|patio|seating|lounge|terrace|restaurant)\b/i,
      /\broof\s*top\b/i,
    ],
  },
  {
    type: 'Live Music',
    patterns: [
      /\blive\s+music\b/i,
      /\blive\s+entertainment\b/i,
      /\blive\s+(?:bands?|acts?|performances?|shows?)\b/i,
    ],
  },
  {
    type: 'Coffee Shops',
    patterns: [
      /\bcoffee\s+(?:shop|house|bar|roaster)\b/i,
      /\bcafe\b/i,
      /\bcafé(?:\s|$|[.,;!?])/i,
    ],
  },
];

/**
 * Detect secondary activity types from text (title + description).
 * Returns types that differ from the primary type.
 */
function detectSecondaryTypes(text, primaryType) {
  const detected = [];
  for (const signal of ACTIVITY_SIGNALS) {
    if (signal.type === primaryType) continue;
    if (signal.patterns.some((p) => p.test(text))) {
      detected.push(signal.type);
    }
  }
  return detected;
}

module.exports = { detectSecondaryTypes, ACTIVITY_SIGNALS };
