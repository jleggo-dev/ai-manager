/**
 * Concatenate speech fragments without gluing words together.
 *
 * WebKit does not reliably prefix continuation transcripts with a space the way Chrome does, so
 * naive concatenation produces "helloworld". A doubled space is the far cheaper failure, and the
 * collapse below tidies it anyway.
 */
export function joinSpeech(base: string, finals: string, interim: string): string {
  const join = (a: string, b: string) => {
    if (!b) return a;
    if (!a) return b;
    return /\s$/.test(a) || /^\s/.test(b) ? a + b : `${a} ${b}`;
  };
  return join(join(base, finals), interim).replace(/\s+/g, ' ').trimStart();
}
