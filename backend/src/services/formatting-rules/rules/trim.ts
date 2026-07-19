/**
 * Whitespace / punctuation trim rules for the formatting-rules engine.
 */

/** Remove all leading spaces from each line. */
function trimLeadingSpaces(text: string): string {
  return text
    .split('\n')
    .map((line) => line.trimStart())
    .join('\n');
}

/** Remove all trailing spaces from each line. */
function trimTrailingSpaces(text: string): string {
  return text
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n');
}

/** Remove all leading line breaks from the beginning of the text. */
function trimLeadingLineBreaks(text: string): string {
  return text.replace(/^[\r\n]+/, '');
}

/** Remove a trailing period at the end of the response if present. */
function trimTrailingPeriod(text: string): string {
  return text.replace(/\.\s*$/, '').trim();
}

export { trimLeadingSpaces, trimTrailingSpaces, trimLeadingLineBreaks, trimTrailingPeriod };
