/**
 * Tag / reasoning strip rules for the formatting-rules engine.
 */

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* ── Rule Implementations ─────────────────────────────────────── */

/** Remove everything between <think></think> tags (including the tags).
 *  Also strips free-text reasoning that precedes a JSON code block. */
function removeReasoning(text: string): string {
  let cleaned = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  /* Many models write reasoning as plain text before a ```json block.
     If a markdown-fenced JSON block exists, discard everything before it. */
  const fenceMatch = cleaned.match(/^[\s\S]*?(```(?:json)?\s*\n[\s\S]*?```)/im);
  const fenced = fenceMatch?.[1];
  if (fenced) {
    cleaned = fenced.trim();
  }

  return cleaned;
}

/** Remove footnote reference tags like <#1#>, <#3#>, <#15#>. */
function removeFootnoteTags(text: string): string {
  return text.replace(/<#\d+#>/g, '');
}

/** Remove content between custom tags. Options: { tagName: string } */
function removeCustomTags(text: string, options: Record<string, unknown> = {}): string {
  const tag = (options.tagName || options.tag) as string | undefined;
  if (!tag) return text;
  const regex = new RegExp(`<${escapeRegex(tag)}>[\\s\\S]*?<\\/${escapeRegex(tag)}>`, 'gi');
  return text.replace(regex, '').trim();
}

/** Keep only the content between specified tags. Options: { tagName: string } */
function extractBetweenTags(text: string, options: Record<string, unknown> = {}): string {
  const tag = (options.tagName || options.tag) as string | undefined;
  if (!tag) return text;
  const regex = new RegExp(`<${escapeRegex(tag)}>([\\s\\S]*?)<\\/${escapeRegex(tag)}>`, 'gi');
  const matches: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    matches.push(match[1] ?? '');
  }
  return matches.length > 0 ? matches.join('\n').trim() : text;
}

export { escapeRegex, removeReasoning, removeFootnoteTags, removeCustomTags, extractBetweenTags };
