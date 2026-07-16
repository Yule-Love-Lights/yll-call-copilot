// Splits a transcripts.raw_text blob into speaker turns for the owner's
// call-review browser (/coach/calls). Every raw_text this app writes is
// built the same way: one turn per paragraph, each starting with a
// "Label: " prefix (see ringcentral.ts's `${speaker}: ${text}` join and the
// plain "Rep: ... / Customer: ..." shape used by manual call logging),
// blocks separated by a blank line. Pure -- no I/O -- so it is unit
// testable on its own.

export type Turn = { speaker: string | null; text: string };

// The label sits on the first line of a block, before the first colon.
// [^:\n] keeps the label search from crossing a line break, so a block
// whose first line has no colon at all (a stray line, or dialogue that
// never got a speaker prefix) correctly falls through to the "no speaker"
// branch below instead of matching some later colon deep in the text. The
// length cap (60) is a heuristic, same tradeoff parse.ts's HEADER_LINE
// documents: a genuine speaker label ("Speaker 0", "Jake", "Customer") is
// always short, so capping the match keeps a long sentence that happens to
// contain an early colon from being misread as a label.
const TURN_LABEL = /^([^:\n]{1,60}):\s*([\s\S]*)$/;

export function splitRawTextIntoTurns(rawText: string): Turn[] {
  const blocks = rawText
    .split(/\r?\n\s*\r?\n/)
    .map(block => block.trim())
    .filter(block => block.length > 0);

  return blocks.map((block): Turn => {
    const match = block.match(TURN_LABEL);
    if (!match) return { speaker: null, text: block };
    return { speaker: match[1].trim(), text: match[2].trim() };
  });
}
