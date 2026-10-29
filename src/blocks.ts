// File convention for .atf: a `#` in column 0 starts a comment line, and consecutive non-blank
// lines are concatenated (with no separator) into one format string, so long formats can wrap.

export interface Segment {
  line: number;
  /** Offset of this line's first character within the block text. */
  offset: number;
}

export interface Block {
  text: string;
  segments: Segment[];
}

export function splitBlocks(lines: string[]): Block[] {
  const blocks: Block[] = [];
  let current: Block | undefined;
  lines.forEach((raw, line) => {
    const text = raw.replace(/\r$/, '');
    if (text.trim() === '' || text.startsWith('#')) {
      current = undefined;
      return;
    }
    if (!current) {
      current = { text: '', segments: [] };
      blocks.push(current);
    }
    current.segments.push({ line, offset: current.text.length });
    current.text += text;
  });
  return blocks;
}

export function toLineChar(block: Block, offset: number): { line: number; character: number } {
  let seg = block.segments[0];
  for (const s of block.segments) {
    if (s.offset <= offset) seg = s;
    else break;
  }
  return { line: seg.line, character: offset - seg.offset };
}

export function toOffset(block: Block, line: number, character: number): number | undefined {
  const seg = block.segments.find((s) => s.line === line);
  return seg ? seg.offset + character : undefined;
}
