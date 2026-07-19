/**
 * Case-conversion rules for the formatting-rules engine.
 */

/** Convert all text to UPPERCASE. */
function convertToUppercase(text: string): string {
  return text.toUpperCase();
}

/** Convert all text to lowercase. */
function convertToLowercase(text: string): string {
  return text.toLowerCase();
}

/** Capitalise the first letter of each sentence. */
function convertToSentenceCase(text: string): string {
  return text.replace(/(^\s*\w|[.!?]\s+\w)/gm, (match) => match.toUpperCase());
}

export { convertToUppercase, convertToLowercase, convertToSentenceCase };
