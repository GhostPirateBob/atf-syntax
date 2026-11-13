/**
 * Lint rules for ATF format strings. Pure functions with no VS Code dependency, so they can be
 * unit-tested and reused (e.g. from a CLI).
 *
 * @module lint
 */

import { ALWAYS_NONEMPTY, Dialect, FIELD_MAP, FUNCTION_MAP, NEGATIVE_COUNT_FREEZES, NUMERIC_ARGS, REMOVED } from './catalog';
import { topLevelItems } from './format';
import { MAX_DEPTH, parse, ParseResult, Span, SyntaxErrorCode } from './parser';

/** Diagnostic severity, mapped one-to-one onto VS Code's. */
export type Severity = 'error' | 'warning' | 'info' | 'hint';

/** A severity override, or `off` to disable a rule. */
export type SeveritySetting = Severity | 'off';

/** Stable rule identifiers, shown as the diagnostic code and used as `atf.lint.rules` keys. */
export type RuleId =
  | 'syntax'
  | 'too-deep'
  | 'name-too-long'
  | 'unknown-function'
  | 'removed-function'
  | 'dialect-function'
  | 'arity-strict'
  | 'arity-min'
  | 'arity-max'
  | 'too-many-args'
  | 'empty-number'
  | 'replace-empty-search'
  | 'replace-search-may-be-empty'
  | 'negative-count'
  | 'winamp-crash'
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

/** Every rule with its default severity. The wiki's Lint Rules page and the settings schema mirror this table. */
export const RULES: Record<RuleId, RuleInfo> = Object.fromEntries(
  (
    [
      ['syntax', 'error', 'A syntax error. WACUP shows `[SYNTAX ERROR IN FORMATTING STRING (n)]` in place of the whole title, or of just the function argument or `[…]` section the error is in.'],
      ['too-deep', 'warning', `Nested more than ${MAX_DEPTH} levels deep, so the format isn't checked.`],
      ['name-too-long', 'error', 'WACUP 1.99.57: a `%field%` or `$function(` name longer than 32 characters shows `[TRUNCATED FORMATTING STRING -> MISSING END TAG / WORKING BUFFER TOO SMALL]` or `[SYNTAX ERROR IN FORMATTING STRING (4)]`. 1.99.43 and Winamp 5 accept it.'],
      ['unknown-function', 'error', 'Function not in the WACUP/tagz function table; prints `[UNKNOWN FUNCTION -> $name]`.'],
      ['removed-function', 'error', 'Documented but not callable (`$and`, `$greater`, `$fill`).'],
      ['dialect-function', 'error', 'Function that only exists in the other dialect (e.g. `$strbetween` under `winamp`).'],
      ['arity-strict', 'error', 'Wrong argument count for `$if`, `$if2`, `$ifgreater`, `$iflonger` or `$IfStrEqual*`; prints `[INVALID $name() SYNTAX]` (Winamp 5: `[INVALID $IF SYNTAX]`, `[INVALID $IFLONGER SYNTAX]` or `[INVALID $IFGREATER SYNTAX]`).'],
      ['arity-min', 'warning', 'Too few arguments; the function silently outputs nothing.'],
      ['arity-max', 'warning', 'Too many arguments; the function silently outputs nothing.'],
      ['too-many-args', 'warning', 'More than 16 arguments; WACUP ignores the rest.'],
      ['empty-number', 'warning', 'An empty numeric argument (e.g. `$left(%artist%,)`), which counts as 0. An empty `$muldiv` argument crashes Winamp 5.'],
      ['replace-empty-search', 'error', '`$replace(a,,b)`: an empty search string never advances, so WACUP freezes and has to be killed (Winamp 5 crashes). Fixed in WACUP 1.99.56.25334.'],
      ['replace-search-may-be-empty', 'warning', '`$replace` search made only of fields or calls (e.g. `%artist%`); if it is empty for a track, WACUP freezes (Winamp 5 crashes). Fixed in WACUP 1.99.56.25334.'],
      ['negative-count', 'error', '`$tab(-1)`, `$directory(path,-1)` or `$padcut(a,-1)`: a negative count never finishes, so WACUP freezes. `$tab`/`$directory` fixed in WACUP 1.99.57.25452; `$padcut` still freezes in 1.99.57.25464.'],
      ['winamp-crash', 'error', 'Winamp 5: an argument that crashes it, e.g. an empty `$trim()`, `$pad`/`$lpad` pad string, `$strchr` character or `$split` token, or `$div(-2147483648,-1)`. Fields and calls that can be empty get a "may crash" message.'],
      ['always-true-condition', 'warning', 'WACUP: `$if($strchr(…),…)` and similar always take the first branch, because the result is never empty. `$if($strstr(…),…)` only tests that its arguments aren\'t empty.'],
      ['always-false-condition', 'warning', 'Winamp 5: a condition with no `%field%` always takes the else branch.'],
      ['get-before-put', 'warning', '`$get(x)` before any `$puts`/`$put` sets `x`.'],
      ['unknown-field', 'hint', 'Field not known to WACUP (input plugins may still provide it).'],
      ['cond-without-field', 'hint', '`[…]` containing no `%field%`, so it is never displayed.'],
    ] as [RuleId, Severity, string][]
  ).map(([id, severity, description]) => [id, { id, severity, description }]),
) as Record<RuleId, RuleInfo>;

/** The WACUP build that fixed each freeze (from WACUP's developer, GhostPirateBob/atf-syntax#2). Classic Winamp 5 still freezes. */
const FREEZE_FIXED_IN: Partial<Record<RuleId, string>> = {
  'replace-empty-search': '1.99.56.25334',
  'replace-search-may-be-empty': '1.99.56.25334',
};

/** `negative-count` is fixed per function; `$padcut` still freezes on 1.99.57.25464, the newest build checked. */
const NEGATIVE_COUNT_FIXED_IN: Record<string, string> = { tab: '1.99.57.25452', directory: '1.99.57.25452' };

/** What Winamp 5 prints for a wrong argument count, per exact-arity function (WACUP prints `[INVALID $name() SYNTAX -> …]`). */
const WINAMP_ARITY_ERROR: Record<string, string> = {
  if: '$IF',
  if2: '$IF',
  ifstrequal: '$IF',
  ifstrequal2: '$IF',
  ifstrnotequal: '$IF',
  iflonger: '$IFLONGER',
  ifgreater: '$IFGREATER',
};

/** Longest `%field%` or `$function(` name WACUP 1.99.57.25464 accepts, in UTF-16 code units (1.99.43 and Winamp 5 have no limit). */
const MAX_NAME = 32;

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
  return `[SYNTAX ERROR IN FORMATTING STRING (${code})] — ${reason}. WACUP shows this error in place of the whole title, or of just the function argument or […] section the error is in.`;
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

/**
 * Whether a format can evaluate to an empty string: true when it is made only of `%fields%`,
 * `[conditionals]` and calls that can return nothing, with no literal text.
 */
function canBeEmpty(text: string): boolean {
  const result = parse(text);
  const calls = new Map(result.calls.map((c) => [c.start, c]));
  const dynamic = new Set([...result.fields, ...result.conds].map((x) => x.start));
  return topLevelItems(text, result).every((item) => {
    const call = calls.get(item.start);
    return dynamic.has(item.start) || (call !== undefined && !ALWAYS_NONEMPTY.has(call.name.toLowerCase()));
  });
}

/** Lint one format string (one block of an `.atf` file). */
export function lint(text: string, options: LintOptions = {}): Finding[] {
  const dialect = options.dialect ?? 'wacup';
  const { error, calls, fields, conds, tooDeep } = options.result ?? parse(text);
  const out: Finding[] = [];
  const report = (rule: RuleId, span: Span, message: string, code?: SyntaxErrorCode, fixedIn = FREEZE_FIXED_IN[rule]) => {
    const setting = options.rules?.[rule] ?? RULES[rule].severity;
    if (dialect === 'wacup' && fixedIn) message += ` Fixed in WACUP ${fixedIn}.`;
    if (setting !== 'off') out.push({ start: span.start, end: span.end, rule, severity: setting, message, code });
  };

  if (tooDeep) {
    report('too-deep', tooDeep, `Nested more than ${MAX_DEPTH} levels deep, so this format isn't checked.`);
  }

  if (error) {
    report('syntax', { start: error.start, end: Math.max(error.end, error.start + 1) }, syntaxMessage(error.code, error.reason), error.code);
  }

  /** `empty` for a literally empty argument, `maybe` for one made only of fields or calls that can be empty. */
  const emptiness = (arg: Span | undefined): 'empty' | 'maybe' | undefined => {
    if (!arg) return undefined;
    if (arg.start === arg.end) return 'empty';
    return canBeEmpty(text.slice(arg.start, arg.end)) ? 'maybe' : undefined;
  };
  const widen = (arg: Span) => ({ start: arg.start, end: Math.max(arg.end, arg.start + 1) });
  /** `winamp-crash` for an argument Winamp 5 dereferences as a NULL pointer when it is empty. */
  const nullCrash = (arg: Span | undefined, noun: string) => {
    const e = emptiness(arg);
    if (!arg || !e) return;
    report(
      'winamp-crash',
      widen(arg),
      e === 'empty'
        ? `Crashes Winamp 5: an empty ${noun} is passed as a NULL pointer (access violation).`
        : `May crash Winamp 5: this ${noun} can be empty for some tracks, and an empty ${noun} is passed as a NULL pointer (access violation).`,
    );
  };

  const varEvents: { pos: number; set: boolean; name: string; span: Span }[] = [];
  for (const call of calls) {
    const name = call.name.toLowerCase();
    const head = { start: call.start, end: call.nameEnd };
    const info = FUNCTION_MAP.get(name);
    const why = IDENT.test(call.name) ? '' : ' (the name runs up to the first "(", so check for a typo or missing ")")';

    if (dialect === 'wacup' && call.name.length > MAX_NAME) {
      report(
        'name-too-long',
        head,
        `[SYNTAX ERROR IN FORMATTING STRING (4)] in WACUP 1.99.57: a function name longer than ${MAX_NAME} characters (this one is ${call.name.length}) is rejected${why}. WACUP 1.99.43 prints [UNKNOWN FUNCTION -> $${call.name}].`,
      );
      continue;
    }

    if (!info) {
      const removed = REMOVED[name];
      if (removed) {
        report('removed-function', head, `[UNKNOWN FUNCTION -> $${call.name}] — ${removed}`);
      } else {
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
    let arityOk = false;
    if (info.exact !== undefined && n !== info.exact) {
      const winampError = WINAMP_ARITY_ERROR[name];
      report(
        'arity-strict',
        head,
        dialect === 'winamp' && winampError
          ? `[INVALID ${winampError} SYNTAX] — $${call.name}() takes exactly ${info.exact} arguments, got ${n}.`
          : `[INVALID $${call.name}() SYNTAX] — takes exactly ${info.exact} arguments, got ${n}.`,
      );
    } else if (info.min !== undefined && n < info.min) {
      report('arity-min', head, `$${call.name}${info.sig} needs at least ${info.min} arguments, got ${n} — it will output nothing.`);
    } else if (max !== undefined && n > max) {
      report('arity-max', head, `$${call.name}${info.sig} takes at most ${max} arguments, got ${n} — it will output nothing.`);
    } else {
      arityOk = true;
    }
    if (call.dropped > 0) report('too-many-args', head, `Only the first 16 arguments are evaluated; ${call.dropped} ignored.`);

    for (const i of NUMERIC_ARGS[name] ?? []) {
      const arg = call.args[i];
      if (arg && text.slice(arg.start, arg.end).trim() === '') {
        const effect = dialect === 'winamp' && name === 'muldiv' && arityOk ? 'which crashes Winamp 5 (invalid parameter, 0xc0000417)' : 'so it counts as 0';
        report('empty-number', widen(arg), `Argument ${i + 1} of $${call.name}${info.sig} is empty, ${effect}.`);
      }
    }

    const search = call.args[1];
    if (name === 'replace' && search) {
      const at = widen(search);
      if (search.start === search.end) {
        const effect = dialect === 'winamp' ? 'crashes Winamp 5 (access violation)' : 'never finishes: WACUP freezes and has to be killed';
        report('replace-empty-search', at, `$${call.name}() with an empty search string ${effect}. To remove spaces, search for one: $replace(x, ,).`);
      } else if (canBeEmpty(text.slice(search.start, search.end))) {
        const effect = dialect === 'winamp' ? 'crashes Winamp 5 (access violation)' : 'freezes WACUP';
        report('replace-search-may-be-empty', at, `This search can be empty for some tracks, and an empty search ${effect}. Wrapping it in $if() doesn't help (arguments are evaluated first); give it literal text or a fallback, e.g. $if2(…,¤).`);
      }
    }

    // Winamp 5 passes an empty argument as a NULL pointer. Functions with a maximum argument count
    // output nothing before reading them when the count is wrong; the others crash regardless.
    if (dialect === 'winamp' && arityOk) {
      if (name === 'trim') nullCrash(call.args[0], 'argument');
      if (name === 'pad' || name === 'lpad') nullCrash(call.args[2], 'pad string');
      if (name === 'strchr' || name === 'strlchr' || name === 'strrchr') nullCrash(call.args[1], 'search character');
      if (name === 'strrchr') nullCrash(call.args[0], 'string');
      if (name === 'split') nullCrash(call.args[1], 'token');
      const custom = call.args[2];
      if (name === 'padcut' && custom) {
        if (emptiness(custom)) {
          nullCrash(custom, 'custom argument');
        } else {
          // A non-empty custom pads from the 4th argument; without one, padding divides by its length, 0.
          const padstr = call.args[3];
          const e = padstr ? emptiness(padstr) : 'empty';
          if (e) {
            const which = !padstr ? 'with no pad string (4th argument)' : e === 'empty' ? 'with an empty pad string' : 'when this pad string is empty for a track';
            report('winamp-crash', widen(padstr ?? custom), `${e === 'maybe' ? 'May crash' : 'Crashes'} Winamp 5 whenever $${call.name}() has to pad: ${which}, it divides by zero (0xc0000094).`);
          }
        }
      }
      if (name === 'muldiv') {
        // A literally empty argument is reported by empty-number.
        for (const arg of call.args) {
          if (emptiness(arg) === 'maybe') {
            report('winamp-crash', widen(arg), `May crash Winamp 5: this argument can be empty for some tracks, and an empty $${call.name}() argument raises an invalid-parameter error (0xc0000417).`);
          }
        }
      }
      const [x1, x2] = call.args;
      if ((name === 'div' || name === 'mod') && x2 && text.slice(x1.start, x1.end).trim() === '-2147483648' && text.slice(x2.start, x2.end).trim() === '-1') {
        report('winamp-crash', { start: x1.start, end: x2.end }, 'Crashes Winamp 5: -2147483648 divided by -1 overflows (integer overflow, 0xc0000095).');
      }
    }

    const countIndex = NEGATIVE_COUNT_FREEZES[name];
    const count = countIndex === undefined ? undefined : call.args[countIndex];
    if (count && /^\s*-0*[1-9]/.test(text.slice(count.start, count.end))) {
      const message = name === 'padcut'
        ? `A negative length makes $${call.name}() pad ~4 billion characters (it is read as unsigned): WACUP freezes, still on 1.99.57.25464.`
        : `A negative count makes $${call.name}() loop ~4 billion times: WACUP freezes or runs out of memory.`;
      report('negative-count', count, message, undefined, NEGATIVE_COUNT_FIXED_IN[name]);
    }

    const first = call.args[0];
    if (first && (name === 'if' || name === 'if2' || name === 'if3')) {
      const ci = lowerBound(calls, first.start);
      const inner = calls[ci]?.start === first.start && calls[ci].close === first.end - 1 ? calls[ci] : undefined;
      const fi = lowerBound(fields, first.start);
      const hasField = fi < fields.length && fields[fi].end <= first.end;
      const innerName = inner?.name.toLowerCase();
      // $strstr is empty when either argument is, otherwise a number ("0" when not found).
      const strstrArgs = innerName === 'strstr' && inner?.args.length === 2 && inner.dropped === 0 ? inner.args : undefined;
      const emptyable = strstrArgs?.filter((a) => emptiness(a)).map((a) => text.slice(a.start, a.end));
      if (dialect === 'wacup' && inner && emptyable?.length && !strstrArgs?.some((a) => a.start === a.end)) {
        report(
          'always-true-condition',
          { start: inner.start, end: inner.nameEnd },
          `$${inner.name}() returns "0" when it doesn't find the text, and "0" counts as true, so this $${call.name}() only tests that ${emptyable.join(' and ')} ${emptyable.length > 1 ? "aren't" : "isn't"} empty. Compare with $ifgreater($${inner.name}(…),0,then,else) instead.`,
        );
      } else if (dialect === 'wacup' && inner && (ALWAYS_NONEMPTY.has(innerName!) || (strstrArgs && !emptyable?.length))) {
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
    if (dialect === 'wacup' && f.name.length > MAX_NAME) {
      report(
        'name-too-long',
        f,
        `WACUP 1.99.57 rejects a field name longer than ${MAX_NAME} characters (this one is ${f.name.length}): it shows [TRUNCATED FORMATTING STRING -> MISSING END TAG / WORKING BUFFER TOO SMALL] in place of the whole title, or of just the function argument it's in (a […] section is dropped). WACUP 1.99.43 and Winamp 5 accept it.`,
      );
    } else if (!FIELD_MAP.has(key) && !key.includes('/')) {
      report('unknown-field', f, `%${f.name}% is not a known WACUP field (input plugins may still provide it).`);
    }
  }

  for (const c of conds) {
    if (c.fieldCount === 0) report('cond-without-field', { start: c.start, end: c.start + 1 }, 'This [...] contains no %field%, so it is never displayed.');
  }

  return out.sort((a, b) => a.start - b.start);
}
