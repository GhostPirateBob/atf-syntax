/**
 * Validator for the ATF ("tagz") format language, written to behave like WACUP 1.99.43: the same
 * error codes, the same 16-argument limit and the same quoting and bracket rules.
 *
 * The parser does not evaluate anything; it validates a format string as WACUP would and
 * records every function call, field and conditional section for the linter, hovers and tests.
 * All offsets are UTF-16 code units, which is also what WACUP indexes.
 *
 * @module parser
 */

/** A half-open range `[start, end)` of UTF-16 offsets into the parsed string. */
export interface Span {
  start: number;
  end: number;
}

/** A `$name(arg,…)` function call. */
export interface Call {
  /** The function name as written: everything between `$` and the first `(`. */
  name: string;
  /** Offset of the `$`. */
  start: number;
  /** Offset of the `(` that ends the name. */
  nameEnd: number;
  /** Offset of the closing `)`. */
  close: number;
  /** Evaluated arguments. `$f()` has one empty argument, exactly as in WACUP. */
  args: Span[];
  /** Arguments beyond {@link MAX_ARGS}, which WACUP silently ignores. */
  dropped: number;
}

/** A `%name%` field reference; the span includes both `%`. */
export interface Field extends Span {
  name: string;
}

/** A `[…]` conditional section; the span includes both brackets. */
export interface Cond extends Span {
  /** `%fields%` inside the section, including inside nested function arguments. */
  fieldCount: number;
}

/**
 * WACUP's `[SYNTAX ERROR IN FORMATTING STRING (n)]` codes. Values match the numbers WACUP prints;
 * see docs/atf-spec-wacup-advanced-title-formatting.md §2.2.
 */
export enum SyntaxErrorCode {
  /** An argument scan ran past its call's `)`. WACUP prints `[INTERNAL ERROR]`. */
  Internal = 0,
  /** The format string is empty. */
  Empty = 1,
  /** `%` with no closing `%`. WACUP prints `[TRUNCATED FORMATTING STRING …]`. */
  UnterminatedField = 2,
  /** `$name` with no `(` before the end of the string. */
  MissingArgumentList = 3,
  /** `$name(` with no balanced closing `)`. */
  UnclosedCall = 4,
  /** Defensive check in WACUP; unreachable in practice. */
  EmptyCallTail = 5,
  /** One argument has an unbalanced `(`/`[` or quote. */
  UnbalancedArgument = 6,
  /** `'` with no closing `'`. */
  UnterminatedQuote = 7,
  /** `[` with no balanced closing `]`. */
  UnclosedConditional = 8,
  /** A bare `]`, `(` or `)` in plain text. */
  StrayBracket = 9,
}

/** The first syntax error. WACUP stops here and replaces the whole output with its message. */
export interface ParseError extends Span {
  code: SyntaxErrorCode;
  /** Human-readable explanation, naming the offending construct and its column. */
  reason: string;
}

/** Everything the parser found. Calls and fields are in source order. */
export interface ParseResult {
  error?: ParseError;
  calls: Call[];
  fields: Field[];
  conds: Cond[];
}

/** WACUP evaluates at most this many arguments per call. */
export const MAX_ARGS = 16;

interface Scan {
  ok: boolean;
  pos: number;
}

/**
 * Scan from `p` to the first character in `stops` at paren/bracket depth 0. Quotes hide their
 * contents. Parens and brackets use independent counters (not a stack), as WACUP does, so
 * `([)]` counts as balanced. Reaching `end` is a failure.
 */
function skip(s: string, p: number, end: number, stops: string): Scan {
  let paren = 0;
  let bracket = 0;
  while (p < end) {
    const c = s[p];
    if (paren === 0 && bracket === 0 && stops.includes(c)) break;
    if (c === "'") {
      p++;
      while (p < end && s[p] !== "'") p++;
      if (p >= end) return { ok: false, pos: p };
    } else if (c === '(') {
      paren++;
    } else if (c === ')') {
      if (--paren < 0) return { ok: false, pos: p };
    } else if (c === '[') {
      bracket++;
    } else if (c === ']') {
      if (--bracket < 0) return { ok: false, pos: p };
    }
    p++;
  }
  return { ok: p < end && paren === 0 && bracket === 0, pos: p };
}

/**
 * Explain why a balanced scan of `s[from, end)` failed: a stray closer, a mismatched pair, an
 * unterminated quote, or every opener left unclosed (outermost first). Columns are 1-based.
 */
export function findCulprit(s: string, from: number, end: number): { at: number; what: string } {
  const stack: { at: number; ch: string }[] = [];
  for (let p = from; p < end; p++) {
    const c = s[p];
    if (c === "'") {
      const q = s.indexOf("'", p + 1);
      if (q < 0 || q >= end) return { at: p, what: `unterminated quote at column ${p + 1}` };
      p = q;
    } else if (c === '(' || c === '[') {
      stack.push({ at: p, ch: c });
    } else if (c === ')' || c === ']') {
      const want = c === ')' ? '(' : '[';
      const top = stack[stack.length - 1];
      if (!top) return { at: p, what: `stray '${c}' at column ${p + 1}` };
      if (top.ch !== want) return { at: top.at, what: `'${top.ch}' at column ${top.at + 1} closed by '${c}' at column ${p + 1}` };
      stack.pop();
    }
  }
  // Skip the opener we were asked about (a call's own '(' or a '[') and list the rest, outermost first.
  const open = stack.filter((o) => o.at !== from);
  if (open.length === 0) return { at: from, what: `unclosed '${s[from]}' at column ${from + 1}` };
  return { at: open[0].at, what: open.map((o) => `unclosed '${o.ch}' at column ${o.at + 1}`).join(', ') };
}

class Parser {
  calls: Call[] = [];
  fields: Field[] = [];
  conds: Cond[] = [];

  constructor(private s: string) {}

  fail(code: SyntaxErrorCode, start: number, end: number, reason: string): ParseError {
    return { code, start, end, reason };
  }

  /** Validate `s[from, to)`; arguments and conditionals recurse with their own bounds. */
  run(from: number, to: number): ParseError | undefined {
    const s = this.s;
    let p = from;
    while (p < to) {
      const c = s[p];
      if (c === '%') {
        if (s[p + 1] === '%' && p + 1 < to) {
          p += 2;
          continue;
        }
        const q = s.indexOf('%', p + 2);
        if (q < 0 || q >= to) return this.fail(SyntaxErrorCode.UnterminatedField, p, to, "'%' has no closing '%'");
        this.fields.push({ name: s.slice(p + 1, q), start: p, end: q + 1 });
        p = q + 1;
      } else if (c === '$') {
        if (s[p + 1] === '$' && p + 1 < to) {
          p += 2;
          continue;
        }
        const q = s.indexOf('(', p + 2);
        if (q < 0 || q >= to) return this.fail(SyntaxErrorCode.MissingArgumentList, p, to, "'$' is not followed by a function call '(…)'");
        const close = skip(s, q + 1, to, ')');
        if (!close.ok) {
          const culprit = findCulprit(s, q, to);
          return this.fail(SyntaxErrorCode.UnclosedCall, p, q + 1, `no balanced ')' for $${s.slice(p + 1, q)}( — ${culprit.what}`);
        }
        const s2 = close.pos;
        const call: Call = { name: s.slice(p + 1, q), start: p, nameEnd: q, close: s2, args: [], dropped: 0 };
        this.calls.push(call);
        let a = q + 1;
        while (a <= s2) {
          const arg = skip(s, a, to, ',)');
          if (call.args.length >= MAX_ARGS) {
            // WACUP stops scanning here; count what it ignores for the linter.
            if (!arg.ok || arg.pos > s2) break;
            call.dropped++;
            a = arg.pos + 1;
            continue;
          }
          if (!arg.ok) return this.fail(SyntaxErrorCode.UnbalancedArgument, a, s2, 'unbalanced argument');
          if (arg.pos > s2) return this.fail(SyntaxErrorCode.Internal, a, s2, 'internal error');
          const err = this.run(a, arg.pos);
          if (err) return err;
          call.args.push({ start: a, end: arg.pos });
          a = arg.pos + 1;
        }
        p = s2 + 1;
      } else if (c === "'") {
        if (s[p + 1] === "'" && p + 1 < to) {
          p += 2;
          continue;
        }
        const q = s.indexOf("'", p + 2);
        if (q < 0 || q >= to) return this.fail(SyntaxErrorCode.UnterminatedQuote, p, to, 'unterminated quote');
        p = q + 1;
      } else if (c === '[') {
        const close = skip(s, p + 1, to, ']');
        if (!close.ok) {
          const culprit = findCulprit(s, p, to);
          return this.fail(SyntaxErrorCode.UnclosedConditional, p, p + 1, `no balanced ']' — ${culprit.what}`);
        }
        const before = this.fields.length;
        const err = this.run(p + 1, close.pos);
        if (err) return err;
        this.conds.push({ start: p, end: close.pos + 1, fieldCount: this.fields.length - before });
        p = close.pos + 1;
      } else if (c === ']' || c === '(' || c === ')') {
        const alt = c === ']' ? '' : ` or use $${c === '(' ? 'left' : 'right'}bracket()`;
        return this.fail(SyntaxErrorCode.StrayBracket, p, p + 1, `bare '${c}' — quote it as '${c}'${alt}`);
      } else {
        p++;
      }
    }
    return undefined;
  }
}

/**
 * Parse one ATF format string.
 *
 * Runs in O(length × nesting depth): like WACUP, each call re-scans its own extent to find its
 * closing `)`. Real-world formats (depth under 10) parse in microseconds.
 *
 * An empty string is reported as valid, although WACUP shows error 1 for an empty global format.
 */
export function parse(s: string): ParseResult {
  const parser = new Parser(s);
  const error = s.length === 0 ? undefined : parser.run(0, s.length);
  return { error, calls: parser.calls, fields: parser.fields, conds: parser.conds };
}
