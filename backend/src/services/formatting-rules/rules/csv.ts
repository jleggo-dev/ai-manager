/**
 * CSV isolation, conversion, and repair rules for the formatting-rules engine.
 */

/** Isolate CSV formatted content — remove non-CSV text before/after. */
function trimToOnlyCsv(text: string): string {
  /* Look for lines that contain commas in a tabular pattern */
  const lines = text.split('\n');
  const csvLines: string[] = [];
  let inCsv = false;

  for (const line of lines) {
    const trimmed = line.trim();
    /* A CSV line typically has commas and may be quoted */
    if (trimmed.includes(',') && !trimmed.startsWith('#') && !trimmed.startsWith('//')) {
      inCsv = true;
      csvLines.push(trimmed);
    } else if (inCsv && trimmed === '') {
      /* Allow blank lines within CSV */
      csvLines.push('');
    } else if (inCsv && !trimmed.includes(',')) {
      /* End of CSV block */
      break;
    }
  }

  return csvLines.join('\n').trim() || text;
}

/** Convert CSV text to JSON. */
function convertCsvToJson(text: string): string {
  try {
    const lines = text
      .trim()
      .split('\n')
      .filter((l) => l.trim());
    if (lines.length < 2) return text;

    const headers = parseCsvLine(lines[0] ?? '');
    const rows = lines.slice(1).map((line) => {
      const values = parseCsvLine(line);
      const obj: Record<string, string> = {};
      headers.forEach((h, i) => {
        obj[h.trim()] = (values[i] || '').trim();
      });
      return obj;
    });

    return JSON.stringify(rows, null, 2);
  } catch {
    return text;
  }
}

/** Simple CSV line parser that handles quoted fields. */
function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

/** Attempt to repair broken CSV (unmatched quotes, line breaks in fields). */
function repairBrokenCsv(text: string): string {
  const lines = text.split('\n');
  const repaired: string[] = [];

  let buffer = '';
  for (const line of lines) {
    buffer += (buffer ? '\n' : '') + line;
    const quoteCount = (buffer.match(/"/g) || []).length;
    /* If quotes are balanced, this is a complete line */
    if (quoteCount % 2 === 0) {
      repaired.push(buffer);
      buffer = '';
    }
  }
  if (buffer) repaired.push(buffer);

  return repaired.join('\n');
}

export { trimToOnlyCsv, convertCsvToJson, parseCsvLine, repairBrokenCsv };
