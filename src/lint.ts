/**
 * Lint rules for ATF format strings. Pure functions with no VS Code dependency, so they can be
 * unit-tested and reused (e.g. from a CLI).
 *
 * @module lint
 */

import { ALWAYS_NONEMPTY, Dialect, FIELD_MAP, FUNCTION_MAP, NUMERIC_ARGS, REMOVED } from './catalog';
import { Call, parse, ParseResult, Span, SyntaxErrorCode } from './parser';

/** Diagnostic severity, mapped one-to-one onto VS Code's. */
export type Severity = 'error' | 'warning' | 'info' | 'hint';

/** A severity override, or `off` to disable a rule. */
export type SeveritySetting = Severity | 'off';

/** Stable rule identifiers, shown as the diagnostic code and used as `atf.lint.rules` keys. */
export type RuleId =
  | 'syntax'
  | 'unknown-function'
  | 'removed-function'
  | 'dialect-function'
  | 'arity-strict'
  | 'arity-min'
  | 'arity-max'
  | 'too-many-args'
  | 'empty-number'
  | 'always-true-condition'
  | 'always-false-condition'
  | 'get-before-put'
  | 'unknown-field'
  | 'cond-without-field';

export interface RuleInfo {
  id: RuleId;
  severity: Severity;
  description: string;
}

/** Every rule with its default severity. The README and the settings schema mirror this table. */
export const RULES: Record<RuleId, RuleInfo> = Object.fromEntries(
  (
    [
      ['syntax', 'error', 'A syntax error. WACUP replaces the whole title with `[SYNTAX ERROR IN FORMATTING STRING (n)]`.'],
      ['unknown-function', 'error', 'Function not in the WACUP/tagz function table; prints `[UNKNOWN FUNCTION -> $name]`.'],
      ['removed-function', 'error', 'Documented but not callable (`$and`, `$greater`, `$fill`).'],
      ['dialect-function', 'error', 'Function that only exists in the other dialect (e.g. `$strbetween` under `winamp`).'],
      ['arity-strict', 'error', 'Wrong argument count for `$if`, `$if2`, `$ifgreater`, `$iflonger` or `$IfStrEqual*`; prints `[INVALID $name() SYNTAX]`.'],
      ['arity-min', 'warning', 'Too few arguments; the function silently outputs nothing.'],
      ['arity-max', 'warning', 'Too many arguments; the function silently outputs nothing.'],
      ['too-many-args', 'warning', 'More than 16 arguments; WACUP ignores the rest.'],
      ['empty-number', 'warning', 'An empty numeric argument (e.g. `$left(%artist%,)`), which counts as 0.'],
      ['always-true-condition', 'warning', 'WACUP: `$if($strstr(…),…)` and similar always take the first branch, because the result is never empty.'],
      ['always-false-condition', 'warning', 'Winamp 5: a condition with no `%field%` always takes the else branch.'],
      ['get-before-put', 'warning', '`$get(x)` before any `$puts`/`$put` sets `x`.'],
      ['unknown-field', 'hint', 'Field not known to WACUP (input plugins may still provide it).'],
      ['cond-without-field', 'hint', '`[…]` containing no `%field%`, so it is never displayed.'],
    ] as [RuleId, Severity, string][]
  ).map(([id, severity, description]) => [id, { id, severity, description }]),
) as Record<RuleId, RuleInfo>;

/** One lint result; offsets are relative to the linted string. */
export interface Finding extends Span {
  rule: RuleId;
  severity: Severity;
  message: string;
  /** Set for `syntax` findings. */
  code?: SyntaxErrorCode;
}

export interface LintOptions {
  /** Which implementation to lint against. Default `wacup`. */
  dialect?: Dialect;
  /** Per-rule severity overrides; `off` disables a rule. */
  rules?: Partial<Record<RuleId, SeveritySetting>>;
  /** A parse result to reuse, to avoid parsing twice. */
  result?: ParseResult;
}

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

function syntaxMessage(code: SyntaxErrorCode, reason: string): string {
  if (code === SyntaxErrorCode.Internal) return `[INTERNAL ERROR] — ${reason}`;
  if (code === SyntaxErrorCode.UnterminatedField) return `[TRUNCATED FORMATTING STRING -> MISSING END TAG] — ${reason}`;
  return `[SYNTAX ERROR IN FORMATTING STRING (${code})] — ${reason}. WACUP replaces the whole title with this error.`;
}

/** Index of the first item whose `start` is ≥ `pos`, in an array sorted by `start`. */
function lowerBound(items: readonly { start: number }[], pos: number): number {
  let lo = 0;
  let hi = items.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (items[mid].start < pos) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Lint one format string (one block of an `.atf` file). */
export function lint(text: string, options: LintOptions = {}): Finding[] {
  const dialect = options.dialect ?? 'wacup';
  const { error, calls, fields, conds } = options.result ?? parse(text);
  const out: Finding[] = [];
  const report = (rule: RuleId, span: Span, message: string, code?: SyntaxErrorCode) => {
    const setting = options.rules?.[rule] ?? RULES[rule].severity;
    if (setting !== 'off') out.push({ start: span.start, end: span.end, rule, severity: setting, message, code });
  };

  if (error) {
    report('syntax', { start: error.start, end: Math.max(error.end, error.start + 1) }, syntaxMessage(error.code, error.reason), error.code);
  }

  const varEvents: { pos: number; set: boolean; name: string; span: Span }[] = [];
  for (const call of calls) {
    const name = call.name.toLowerCase();
    const head = { start: call.start, end: call.nameEnd };
    const info = FUNCTION_MAP.get(name);

    if (!info) {
      const removed = REMOVED[name];
      if (removed) {
        report('removed-function', head, `[UNKNOWN FUNCTION -> $${call.name}] — ${removed}`);
      } else {
        const why = IDENT.test(call.name) ? '' : ' (the name runs up to the first "(", so check for a typo or missing ")")';
        report('unknown-function', head, `[UNKNOWN FUNCTION -> $${call.name}]${why}`);
      }
      continue;
    }
    if (info.only && info.only !== dialect) {
      report('dialect-function', head, `$${call.name}() only exists in ${info.only === 'wacup' ? 'WACUP' : 'Winamp 5'}.`);
      continue;
    }

    const n = call.args.length + call.dropped;
    const max = dialect === 'winamp' && info.maxWinamp !== undefined ? info.maxWinamp : info.max;
    if (info.exact !== undefined && n !== info.exact) {
      report('arity-strict', head, `[INVALID $${call.name}() SYNTAX] — takes exactly ${info.exact} arguments, got ${n}.`);
    } else if (info.min !== undefined && n < info.min) {
      report('arity-min', head, `$${call.name}${info.sig} needs at least ${info.min} arguments, got ${n} — it will output nothing.`);
    } else if (max !== undefined && n > max) {
      report('arity-max', head, `$${call.name}${info.sig} takes at most ${max} arguments, got ${n} — it will output nothing.`);
    }
    if (call.dropped > 0) report('too-many-args', head, `Only the first 16 arguments are evaluated; ${call.dropped} ignored.`);

    for (const i of NUMERIC_ARGS[name] ?? []) {
      const arg = call.args[i];
      if (arg && text.slice(arg.start, arg.end).trim() === '') {
        const at = { start: arg.start, end: Math.max(arg.end, arg.start + 1) };
        report('empty-number', at, `Argument ${i + 1} of $${call.name}${info.sig} is empty, so it counts as 0.`);
      }
    }

    const first = call.args[0];
    if (first && (name === 'if' || name === 'if2' || name === 'if3')) {
      const ci = lowerBound(calls, first.start);
      const inner = calls[ci]?.start === first.start && calls[ci].close === first.end - 1 ? calls[ci] : undefined;
      const fi = lowerBound(fields, first.start);
      const hasField = fi < fields.length && fields[fi].end <= first.end;
      if (dialect === 'wacup' && inner && ALWAYS_NONEMPTY.has(inner.name.toLowerCase())) {
        report(
          'always-true-condition',
          { start: inner.start, end: inner.nameEnd },
          `$${inner.name}() never returns an empty string (no match → "0"), so this $${call.name}() always takes its first branch in WACUP. Use $ifgreater(…,0,then,else).`,
        );
      } else if (dialect === 'winamp' && !hasField && text.slice(first.start, first.end).trim() !== '') {
        report('always-false-condition', first, `Winamp 5 tests whether a %field% resolved, and this condition contains none, so $${call.name}() always takes its else branch.`);
      }
    }

    if ((name === 'put' || name === 'puts' || name === 'get') && first) {
      const varName = text.slice(first.start, first.end);
      if (IDENT.test(varName)) {
        // A $put assigns once its value has been evaluated, i.e. at its closing ')'.
        varEvents.push({ pos: name === 'get' ? call.start : call.close, set: name !== 'get', name: varName, span: first });
      }
    }
  }

  const assigned = new Set<string>();
  for (const ev of varEvents.sort((a, b) => a.pos - b.pos)) {
    const key = ev.name.toLowerCase();
    if (ev.set) assigned.add(key);
    else if (!assigned.has(key)) report('get-before-put', ev.span, `Variable "${ev.name}" is read before any $puts/$put sets it, so this is empty.`);
  }

  for (const f of fields) {
    const key = f.name.toLowerCase();
    if (!FIELD_MAP.has(key) && !key.includes('/')) {
      report('unknown-field', f, `%${f.name}% is not a known WACUP field (input plugins may still provide it).`);
    }
  }

  for (const c of conds) {
    if (c.fieldCount === 0) report('cond-without-field', { start: c.start, end: c.start + 1 }, 'This [...] contains no %field%, so it is never displayed.');
  }

  return out.sort((a, b) => a.start - b.start);
}
