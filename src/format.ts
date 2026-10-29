/**
 * Lossless formatting for `.atf` files.
 *
 * ATF whitespace is output text, so nothing may be indented or re-spaced. The only safe change is
 * where a block is split into lines: lines are joined back with no separator (see blocks.ts), so
 * a format can be wrapped at **top-level construct boundaries** and still evaluate identically.
 * A break is only made where:
 * - neither side of the break is whitespace (editors trim trailing whitespace on save);
 * - the new line does not start with `#` (which would make it a comment line);
 * - the block has no syntax error (otherwise it is left exactly as written).
 *
 * Invariant (tested): `formatDocument(lines).join` gives back each block's text unchanged.
 *
 * @module format
 */

import { splitBlocks } from './blocks';
import { parse, ParseResult, Span } from './parser';

export interface FormatOptions {
  /**
   * Wrap blocks at top-level boundaries to roughly this many characters per line.
   * `0` joins every block onto a single line (handy before pasting into WACUP).
   */
  lineWidth: number;
}

/** Split a valid format into its top-level items: calls, conditionals, fields, quotes, text runs. */
export function topLevelItems(text: string, result: ParseResult = parse(text)): Span[] {
  const ends = new Map<number, number>();
  for (const c of result.calls) ends.set(c.start, c.close + 1);
  for (const c of result.conds) ends.set(c.start, c.end);
  for (const f of result.fields) ends.set(f.start, f.end);

  const items: Span[] = [];
  let p = 0;
  let run = -1;
  const flush = () => {
    if (run >= 0) items.push({ start: run, end: p });
    run = -1;
  };
  while (p < text.length) {
    const c = text[p];
    const escaped = (c === '%' || c === '$' || c === "'") && text[p + 1] === c;
    if (escaped) {
      if (run < 0) run = p;
      p += 2;
    } else if (c === "'") {
      flush();
      const q = text.indexOf("'", p + 1);
      items.push({ start: p, end: q + 1 });
      p = q + 1;
    } else if (ends.has(p) && (c === '$' || c === '[' || c === '%')) {
      flush();
      const end = ends.get(p)!;
      items.push({ start: p, end });
      p = end;
    } else {
      if (run < 0) run = p;
      p++;
    }
  }
  flush();
  return items;
}

function canBreak(line: string, next: string): boolean {
  return line.length > 0 && !/\s$/.test(line) && !/^\s/.test(next) && !next.startsWith('#');
}

/**
 * Re-wrap one block. Returns `undefined` for blocks with a syntax error, which are left alone.
 * Items longer than the width stay whole; a break inside a call would also be lossless, but
 * top-level breaks match the hand-formatted style this follows.
 */
export function formatBlock(text: string, options: FormatOptions): string[] | undefined {
  const result = parse(text);
  if (result.error) return undefined;
  if (options.lineWidth <= 0) return [text];
  const lines: string[] = [];
  let line = '';
  for (const item of topLevelItems(text, result)) {
    const piece = text.slice(item.start, item.end);
    if (line.length + piece.length > options.lineWidth && canBreak(line, piece)) {
      lines.push(line);
      line = piece;
    } else {
      line += piece;
    }
  }
  lines.push(line);
  return lines;
}

/** Re-wrap every block of a document. Comments and blank lines are kept as they are. */
export function formatDocument(lines: string[], options: FormatOptions): string[] {
  const clean = lines.map((l) => l.replace(/\r$/, ''));
  const out: string[] = [];
  let next = 0;
  for (const block of splitBlocks(clean)) {
    const first = block.segments[0].line;
    const last = block.segments[block.segments.length - 1].line;
    out.push(...clean.slice(next, first));
    out.push(...(formatBlock(block.text, options) ?? clean.slice(first, last + 1)));
    next = last + 1;
  }
  out.push(...clean.slice(next));
  return out;
}
