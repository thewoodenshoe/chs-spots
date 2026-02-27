import React from 'react';

export function formatDescription(description: string): React.ReactElement {
  const rawLines = description.split('\n');
  const formattedLines: React.ReactElement[] = [];

  for (const rawLine of rawLines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

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

    if (trimmed.includes('•')) {
      const hasTime = /\d+(?:am|pm|AM|PM)/i.test(trimmed);
      const hasDays = /(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Daily|Weekday|Weekend|Weekdays|Weekends)/i.test(trimmed);

      if (hasTime && hasDays) {
        formattedLines.push(
          <div key={formattedLines.length} className="text-xs text-gray-600">
            • {trimmed}
          </div>
        );
      } else {
        const parts = trimmed.split('•').map(p => p.trim()).filter(p => p.length > 0);
        for (const part of parts) {
          formattedLines.push(
            <div key={formattedLines.length} className="text-xs text-gray-600">
              • {part}
            </div>
          );
        }
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
}
