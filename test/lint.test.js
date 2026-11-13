const test = require('node:test');
const assert = require('node:assert/strict');
const { parse } = require('../out/parser');
const { lint } = require('../out/lint');
const { splitBlocks, toLineChar } = require('../out/blocks');
const { formatBlock } = require('../out/format');

const BOB_LATEST =
  ".  ⇢  $puts(t,$if2(%title%,$filepart(%filename%)))$puts(araw,$if2(%albumartist%,%artist%))$puts(fp,$strstr($replace($replace($lower($get(araw)),'(',' '),' ft',' feat'),' feat'))$puts(a,$trim($ifgreater($get(fp),0,$left($get(araw),$sub($get(fp),1)),$get(araw))))$if($get(a),$abbr($get(a),20) ▹ ,)[$abbr(%album%,13) ▹ ]$iflonger($get(t),30,$left($get(t),29)…,$get(t))";
const SAVED_IN_WINAMP_INI = '.  ⇢  $puts(t,$if2(%title%,$filepart(%filename%)))$puts(araw[,$if2(%albumar';
const DOCS_ADVANCED =
  "[$if2(%albumartist%,%artist%) - ][%album% - ][$num(%track%,2) - ]$IfStrNotEqual(%artist%,$if2(%albumartist%,%artist%),[%artist% - ])[$if2(%title%,$filepart(%filename%))][$if($fileext(%filename%),'   [  ',)][%year%  |  ][$fileext(%filename%) ][$if(%bitrate%, '|'  ,)][%bitrate% 'kbps' ][$if($fileext(%filename%),']',)][   $repeat(*,%rating%) ]";

const rules = (s, dialect) => lint(s, { dialect }).map((f) => f.rule);

test('real-world formats lint clean', () => {
  assert.deepEqual(rules(BOB_LATEST), []);
  assert.deepEqual(rules(DOCS_ADVANCED), []);
  assert.deepEqual(rules('[%artist% - ]$if2(%title%,$filepart(%filename%))'), []);
});

test('the winamp.ini case is error 4, pointing at the stray [', () => {
  const { error } = parse(SAVED_IN_WINAMP_INI);
  assert.equal(error.code, 4);
  assert.equal(SAVED_IN_WINAMP_INI.slice(error.start, error.end), '$puts(');
  assert.match(error.reason, /unclosed '\[' at column 61, unclosed '\(' at column 67/);
  assert.equal(SAVED_IN_WINAMP_INI.indexOf('$puts(araw'), error.start);
});

test('syntax error codes match WACUP', () => {
  const code = (s) => parse(s).error?.code;
  assert.equal(code('%artist - '), 2);
  assert.equal(code('abc $if2'), 3);
  assert.equal(code('$if(a,b'), 4);
  assert.equal(code("'abc"), 7);
  assert.equal(code('[%artist% - '), 8);
  assert.equal(code('foo)'), 9);
  assert.equal(code('$if(a,(b),c)'), 9);
  assert.equal(code("$if(a,'('b')',c)"), undefined);
  assert.equal(code('100%% $$5 it\'\'s'), undefined);
});

test('function arity and availability', () => {
  assert.deepEqual(rules('$if(%artist%,b)'), ['arity-strict']);
  assert.deepEqual(rules('$if()'), ['arity-strict']);
  assert.deepEqual(rules('$left(%title%)'), ['arity-min']);
  assert.deepEqual(rules('$greater(3,2)'), ['removed-function']);
  assert.deepEqual(rules('$frobnicate(x)'), ['unknown-function']);
  assert.deepEqual(rules('$strbetween(a,b,c)', 'winamp'), ['dialect-function']);
  assert.deepEqual(rules('$leftbracket()feat$rightbracket()'), []);
  const many = '$add(' + Array.from({ length: 18 }, (_, i) => i).join(',') + ')';
  assert.deepEqual(rules(many), ['too-many-args']);
});

test('argument counts WACUP accepts are not flagged', () => {
  for (const f of ['$div(7)', '$mod(7)', '$div(7,2,2)', '$if3(x)', '$pathltrim(a)', '$pathlpart(a)', '$pathrtrim(a)', '$pathrpart(a)']) {
    assert.deepEqual(rules(f), [], f);
  }
  assert.deepEqual(rules('$split(a/b,/)'), ['arity-min']);
  assert.deepEqual(rules('$split(a/b,/,1,x)'), ['arity-max']);
  // Exactly 2 (or 3) arguments, otherwise they output nothing (WACUP 1.99.57 and Winamp 5).
  for (const f of ['$strstr(a,b,c)', '$strchr(a,b,c)', '$strrchr(a,b,c)', '$num(5,3,1)', '$hex(255,4,1)', '$muldiv(10,6,3,1)']) {
    assert.deepEqual(rules(f), ['arity-max'], f);
    assert.deepEqual(rules(f, 'winamp'), ['arity-max'], f);
  }
});

test('dialect-specific $if truth', () => {
  assert.deepEqual(rules('$if($strchr(%artist%,/),y,n)', 'wacup'), ['always-true-condition']);
  assert.deepEqual(rules('$if($num(%track%,2),y,n)', 'wacup'), ['always-true-condition']);
  assert.deepEqual(rules('$if($get(x),y,n)', 'winamp'), ['always-false-condition', 'get-before-put']);
  assert.deepEqual(rules('$puts(x,1)$if($get(x),y,n)', 'wacup'), []);
});

test('$if($strstr(…)) in WACUP tests that the arguments are non-empty, not that the text was found', () => {
  const message = (s, dialect) => lint(s, { dialect }).map((f) => `${f.rule}: ${f.message}`);
  // $strstr is empty when either argument is, otherwise a number, and "0" (not found) is true.
  const [title] = message('$if($strstr(%title%,live),y,n)', 'wacup');
  assert.match(title, /^always-true-condition: .*only tests that %title% isn't empty\. Compare with \$ifgreater\(\$strstr\(…\),0,then,else\)/);
  const [both] = message('$puts(s,x)$if2($strstr(%title%,$get(s)),n)', 'wacup');
  assert.match(both, /only tests that %title% and \$get\(s\) aren't empty/);
  // Neither argument can be empty: truly always true.
  assert.match(message('$if($strstr(abc,x),y,n)', 'wacup')[0], /^always-true-condition: \$strstr\(\) never returns an empty string/);
  // A literally empty argument makes it always false instead: not this rule.
  assert.deepEqual(rules('$if($strstr(%title%,),y,n)', 'wacup'), []);
  // Wrong argument count outputs nothing, so it isn't always true either (arity-max reports it).
  assert.deepEqual(rules('$if($strstr(%title%,a,b),y,n)', 'wacup'), ['arity-max']);
  // Winamp 5 tests whether a %field% resolved, so the WACUP reasoning doesn't apply.
  assert.deepEqual(rules('$if($strstr(%artist%,x),y,n)', 'winamp'), []);
  assert.deepEqual(rules('$if($strstr(abc,x),y,n)', 'winamp'), ['always-false-condition']);
});

test('formats that freeze WACUP', () => {
  for (const dialect of ['wacup', 'winamp']) {
    assert.deepEqual(rules('$replace(%album%,,)', dialect), ['replace-empty-search']);
  }
  assert.deepEqual(rules('$replace(%album%, ,)'), []);
  assert.deepEqual(rules("$replace(%album%,' ',)"), []);
  assert.deepEqual(rules('$replace(%title%,%artist% ft,)'), []);
  assert.deepEqual(rules('$replace(%title%,$len(%artist%),)'), []);
  assert.deepEqual(rules('$replace(%title%,%artist%,)'), ['replace-search-may-be-empty']);
  assert.deepEqual(rules('$replace(%title%,[%artist%],)'), ['replace-search-may-be-empty']);
  assert.deepEqual(rules('$puts(s,-)$replace(%title%,$get(s),)'), ['replace-search-may-be-empty']);
  assert.deepEqual(rules('$tab(-1)'), ['negative-count']);
  assert.deepEqual(rules('$directory(%filename%,-2)'), ['negative-count']);
  assert.deepEqual(rules('$tab(2)$directory(%filename%,1)$repeat(x,-1)'), []);
  assert.deepEqual(rules('$padcut(%title%,-1)'), ['negative-count']);
  assert.deepEqual(rules('$padcut(,-20)'), ['negative-count']);
  assert.deepEqual(rules('$padcut(%title%,0)$padcut(%title%,20)'), []);
  // Winamp 5 evaluates both $if branches, so a freeze in the untaken one still counts.
  assert.deepEqual(rules('$if(,$tab(-1),x)', 'winamp'), ['negative-count']);
  assert.deepEqual(rules('$replace(%title%,$strstr(%artist%,x),)'), ['replace-search-may-be-empty']);
});

test('freeze messages name the WACUP build that fixed them, under wacup only', () => {
  const message = (s, dialect) => lint(s, { dialect })[0].message;
  const cases = [
    ['$replace(%album%,,)', '1.99.56.25334'],
    ['$replace(%title%,%artist%,)', '1.99.56.25334'],
    ['$tab(-1)', '1.99.57.25452'],
    ['$directory(%filename%,-2)', '1.99.57.25452'],
  ];
  for (const [format, build] of cases) {
    assert.match(message(format, 'wacup'), new RegExp(`Fixed in WACUP ${build.replaceAll('.', '\\.')}\\.$`), format);
    assert.doesNotMatch(message(format, 'winamp'), /Fixed in/, format);
  }
});

test('$padcut freezes on every WACUP build checked, so its message names no fix', () => {
  for (const dialect of ['wacup', 'winamp']) {
    const msg = lint('$padcut(%title%,-1)', { dialect })[0].message;
    assert.doesNotMatch(msg, /Fixed in/, dialect);
    assert.match(msg, /\$padcut\(\)/, dialect);
  }
});

test('Winamp 5 messages say it crashes, not freezes', () => {
  const message = (s, dialect) => lint(s, { dialect })[0].message;
  for (const f of ['$replace(abc,,x)', '$replace(abc,%album%,x)']) {
    assert.match(message(f, 'winamp'), /crashes Winamp 5 \(access violation\)/, f);
    assert.doesNotMatch(message(f, 'winamp'), /freez/, f);
    assert.match(message(f, 'wacup'), /freez/, f);
  }
  // An empty $muldiv argument crashes Winamp 5; empty $div/$mod arguments really count as 0.
  for (const f of ['$muldiv(,2,3)', '$muldiv(2,,3)', '$muldiv(2,3,)']) {
    assert.deepEqual(rules(f, 'winamp'), ['empty-number'], f);
    assert.match(message(f, 'winamp'), /crashes Winamp 5 \(invalid parameter, 0xc0000417\)/, f);
    assert.match(message(f, 'wacup'), /counts as 0/, f);
  }
  for (const f of ['$div(,2)', '$div(2,)', '$mod(,2)', '$mod(2,)']) assert.match(message(f, 'winamp'), /counts as 0/, f);
});

test('arity-strict names the error each engine prints', () => {
  const message = (s, dialect) => lint(s, { dialect })[0].message;
  const cases = [
    ['$if(a,b)', '$IF'],
    ['$if2(a)', '$IF'],
    ['$ifstrequal(a,b)', '$IF'],
    ['$ifstrequal2(a,b,c)', '$IF'],
    ['$IfStrNotEqual(a,b,c,d)', '$IF'],
    ['$iflonger(a,1,b)', '$IFLONGER'],
    ['$ifgreater(1,2,b,c,d)', '$IFGREATER'],
  ];
  for (const [format, tag] of cases) {
    assert.ok(message(format, 'winamp').startsWith(`[INVALID ${tag} SYNTAX] — `), format);
    assert.ok(message(format, 'wacup').startsWith(`[INVALID ${format.slice(0, format.indexOf('('))}() SYNTAX] — `), format);
  }
  // Every exact-arity function has a known Winamp 5 error.
  const { FUNCTIONS } = require('../out/catalog');
  for (const f of FUNCTIONS.filter((f) => f.exact !== undefined)) {
    assert.match(message(`$${f.name}()`, 'winamp'), /^\[INVALID \$IF(LONGER|GREATER)? SYNTAX\]/, f.name);
  }
});

test('formats that crash Winamp 5', () => {
  const crash = (s) => lint(s, { dialect: 'winamp' }).filter((f) => f.rule === 'winamp-crash').map((f) => [s.slice(f.start, f.end), f.message.startsWith('Crashes') ? 'crash' : 'may']);
  // Empty arguments passed as NULL pointers.
  assert.deepEqual(crash('x$trim()y').map((c) => c[1]), ['crash']);
  assert.match(lint('$trim()', { dialect: 'winamp' })[0].message, /^Crashes Winamp 5: an empty argument is passed as a NULL pointer \(access violation\)\.$/);
  assert.deepEqual(crash('$trim(%album%)'), [['%album%', 'may']]);
  assert.deepEqual(crash('$trim($trim())').map((c) => c[1]), ['may', 'crash']);
  assert.deepEqual(crash('$pad(ab,5,)').map((c) => c[1]), ['crash']);
  assert.deepEqual(crash('$lpad(abc,1,)').map((c) => c[1]), ['crash']);
  assert.deepEqual(crash('$pad(ab,5,%album%)'), [['%album%', 'may']]);
  assert.deepEqual(crash('$strchr(abc,)').map((c) => c[1]), ['crash']);
  assert.deepEqual(crash('$strlchr(abc,%album%)'), [['%album%', 'may']]);
  assert.deepEqual(crash('$strrchr(,a)').map((c) => c[1]), ['crash']);
  assert.deepEqual(crash('$strrchr(%album%,a)'), [['%album%', 'may']]);
  assert.deepEqual(crash('$split(x,,3)').map((c) => c[1]), ['crash']);
  // $padcut: an empty custom argument, or no/empty pad string when it has to pad (divide by zero).
  assert.deepEqual(crash('$padcut(ab,5,,y)').map((c) => c[1]), ['crash']);
  assert.deepEqual(crash('$padcut(ab,1,)').map((c) => c[1]), ['crash']);
  assert.deepEqual(crash('$padcut(ab,5,x)'), [['x', 'crash']]);
  assert.deepEqual(crash('$padcut(ab,5,x,)').map((c) => c[1]), ['crash']);
  assert.deepEqual(crash('$padcut(ab,5,x,%album%)'), [['%album%', 'may']]);
  assert.match(lint('$padcut(ab,5,x)', { dialect: 'winamp' })[0].message, /whenever \$padcut\(\) has to pad: with no pad string \(4th argument\), it divides by zero \(0xc0000094\)/);
  // $muldiv: a literal empty is empty-number's; an empty-able one is ours. $div/$mod overflow.
  assert.deepEqual(crash('$muldiv(2,3,%album%)'), [['%album%', 'may']]);
  assert.deepEqual(crash('$muldiv(,2,3)'), []);
  assert.deepEqual(crash('$div(-2147483648,-1)'), [['-2147483648,-1', 'crash']]);
  assert.deepEqual(crash('$mod( -2147483648, -1,5)').map((c) => c[1]), ['crash']);
  assert.deepEqual(crash('$div(-2147483647,-1)$div(-2147483648,1)'), []);
  // Safe: non-empty arguments, and wrong counts for functions that check them before reading.
  for (const f of ['$trim( )', '$pad(ab,5)', '$pad(ab,5,%album%x)', '$strchr(,a)', '$strlchr(,a)', '$padcut(ab,5,x,y)', '$padcut(ab,5)', '$split(x/y,/,1)', '$strchr(abc,,x)', '$muldiv(,2,3,4)', '$split(x,,3,4)']) {
    assert.deepEqual(crash(f), [], f);
  }
  // $replace is left to the replace rules; nothing under wacup.
  assert.deepEqual(rules('$replace(a,,b)', 'winamp'), ['replace-empty-search']);
  for (const f of ['$trim()', '$pad(ab,5,)', '$strrchr(,a)', '$split(x,,3)', '$padcut(ab,5,x)', '$div(-2147483648,-1)']) assert.deepEqual(rules(f, 'wacup'), [], f);
});

test('$div/$mod overflow follows the running value over literal arguments (Winamp 5)', () => {
  // Checked on Winamp 5.666 and 5.9.2: <<EXCEPTION 0xc0000095>> for each crash below. WACUP 1.99.43
  // and 1.99.57 output nothing for the same formats instead of crashing.
  const crash = (s) => lint(s, { dialect: 'winamp' }).filter((f) => f.rule === 'winamp-crash').map((f) => s.slice(f.start, f.end));
  assert.deepEqual(crash('$div(-2147483648,1,-1)'), ['-2147483648,1,-1']);
  assert.deepEqual(crash('$div(-2147483648,1,1,-1)'), ['-2147483648,1,1,-1']);
  assert.deepEqual(crash('$div( -2147483648 ,1,-1)'), [' -2147483648 ,1,-1']);
  assert.deepEqual(crash('$div(-2147483648,-1,-1)'), ['-2147483648,-1']);
  assert.match(lint('$div(-2147483648,1,-1)', { dialect: 'winamp' })[0].message, /dividing by 1 or 0 leaves the running value at -2147483648/);
  // A 0 divisor is skipped, and so is an empty or non-numeric one (it reads as 0).
  assert.deepEqual(crash('$div(-2147483648,0,-1)'), ['-2147483648,0,-1']);
  assert.deepEqual(crash('$div(-2147483648,x,-1)'), ['-2147483648,x,-1']);
  assert.deepEqual(crash('$mod(-2147483648,0,-1)'), ['-2147483648,0,-1']);
  // Out-of-range numbers are clamped to 32 bits (wcstol), not wrapped; a numeric prefix is read.
  assert.deepEqual(crash('$div(-2147483649,-1)'), ['-2147483649,-1']);
  assert.deepEqual(crash('$div(-9999999999,-1)'), ['-9999999999,-1']);
  assert.match(lint('$div(-9999999999,-1)', { dialect: 'winamp' })[0].message, /-9999999999 is read as -2147483648 \(numbers are clamped to 32 bits\)/);
  assert.deepEqual(crash('$div(-2147483648,-1x)'), ['-2147483648,-1x']);
  assert.deepEqual(crash('$mod(-2147483648,-1,5)'), ['-2147483648,-1']);
  // No crash: the value has moved off -2147483648 (2147483648 clamps to 2147483647; x % 1 is 0).
  for (const f of ['$div(-2147483648,2,-1)', '$div(2147483648,-1)', '$mod(-2147483648,1,-1)', '$mod(-2147483648,5,-1)', '$div(-2147483648,2147483647,-1)']) {
    assert.deepEqual(crash(f), [], f);
  }
  // Unknown from the first non-literal argument on (Winamp 5 does crash on '-1' and $sub(0,1); not modelled).
  for (const f of ['$div(-2147483648,%album%,-1)', '$div(%album%,1,-1)', "$div(-2147483648,'-1')", '$div(-2147483648,$sub(0,1))']) {
    assert.deepEqual(crash(f), [], f);
  }
  for (const f of ['$div(-2147483648,1,-1)', '$div(-9999999999,-1)']) assert.deepEqual(rules(f, 'wacup'), [], f);
});

test('Winamp 5 never returns an empty $strstr, so it can\'t make an argument empty', () => {
  // Winamp 5.666/5.9.2: $strstr(,x), $strstr(%album%,x) → 0 and $trim($strstr(%album%,x)) → 0; WACUP gives nothing.
  const crash = (s) => lint(s, { dialect: 'winamp' }).filter((f) => f.rule === 'winamp-crash').map((f) => s.slice(f.start, f.end));
  assert.deepEqual(crash('$trim($strstr(%album%,x))'), []);
  assert.deepEqual(crash('$pad(ab,5,$strstr(%album%,x))'), []);
  assert.deepEqual(crash('$trim(%album%)'), ['%album%']);
  assert.deepEqual(rules('$replace(%title%,$strstr(%album%,x),)', 'winamp'), []);
  // WACUP unchanged.
  assert.deepEqual(rules('$replace(%title%,$strstr(%album%,x),)', 'wacup'), ['replace-search-may-be-empty']);
  assert.match(lint('$if($strstr(%title%,live),y,n)')[0].message, /only tests that %title% isn't empty/);
});

test('Copy Format as Single Line warnings', () => {
  const { copyWarning } = require('../out/lint');
  // WACUP: freezes only, as before.
  assert.match(copyWarning('$replace(%title%,,x)'), /freezes WACUP/);
  assert.match(copyWarning('$tab(-1)', 'wacup'), /freezes WACUP/);
  for (const f of ['$trim()', '$div(-2147483648,-1)', '$replace(%title%,%artist%,x)', '[%artist% - ]%title%']) assert.equal(copyWarning(f), undefined, f);
  // Winamp 5: crashes (winamp-crash, an empty $replace search, an empty $muldiv argument), freezes, may crash.
  for (const f of ['$trim()', '$div(-2147483648,1,-1)', '$replace(%title%,,x)', '$muldiv(,2,3)', '$tab(-1)$trim()']) {
    assert.equal(copyWarning(f, 'winamp'), 'ATF: copied, but this format crashes Winamp 5 (see the error in the editor). Fix it before pasting.', f);
  }
  assert.equal(copyWarning('$padcut(%title%,-1)', 'winamp'), 'ATF: copied, but this format freezes Winamp 5 (see the error in the editor). Fix it before pasting.');
  for (const f of ['$trim(%album%)', '$replace(%title%,%artist%,x)']) assert.match(copyWarning(f, 'winamp'), /may crash Winamp 5 for some tracks/, f);
  for (const f of ['$trim($strstr(%album%,x))', '[%artist% - ]%title%']) assert.equal(copyWarning(f, 'winamp'), undefined, f);
});

test('names longer than 32 characters (WACUP 1.99.57)', () => {
  const field = (n) => `x%${'a'.repeat(n)}%y`;
  const fn = (n) => `x$${'b'.repeat(n)}(1)y`;
  assert.deepEqual(rules(field(32)), ['unknown-field']);
  assert.deepEqual(rules(field(33)), ['name-too-long']);
  assert.deepEqual(rules(`x%${'😀'.repeat(16)}%y`), ['unknown-field']); // counted in UTF-16 code units
  assert.deepEqual(rules(`x%${'😀'.repeat(17)}%y`), ['name-too-long']);
  assert.deepEqual(rules(fn(32)), ['unknown-function']);
  assert.deepEqual(rules(fn(33)), ['name-too-long']);
  assert.match(lint(field(33))[0].message, /\[TRUNCATED FORMATTING STRING -> MISSING END TAG \/ WORKING BUFFER TOO SMALL\]/);
  assert.match(lint(fn(33))[0].message, /^\[SYNTAX ERROR IN FORMATTING STRING \(4\)\] in WACUP 1\.99\.57/);
  assert.match(lint('x$left%title%,5)zzzzzzzzzzzzzzzzzzzz(1)y')[0].message, /runs up to the first "\("/);
  // 1.99.43 and Winamp 5 accept long names; variable names have no limit.
  assert.deepEqual(rules(field(33), 'winamp'), ['unknown-field']);
  assert.deepEqual(rules(fn(33), 'winamp'), ['unknown-function']);
  const v = 'v'.repeat(300);
  assert.deepEqual(rules(`$puts(${v},1)$get(${v})`), []);
});

test('formats nested deeper than MAX_DEPTH are skipped, not parsed', () => {
  const nest = (n) => '$trim('.repeat(n) + 'x' + ')'.repeat(n);
  assert.deepEqual(rules(nest(128)), []);
  assert.deepEqual(rules(nest(129)), ['too-deep']);
  assert.deepEqual(rules(nest(20000)), ['too-deep']);
  assert.deepEqual(rules("'" + '('.repeat(500) + "'"), []);
  assert.equal(formatBlock(nest(129), { lineWidth: 10 }), undefined);
});

test('variables, fields, conditionals', () => {
  assert.deepEqual(rules('$get(nope)'), ['get-before-put']);
  assert.deepEqual(rules('$puts(x,$get(x))'), ['get-before-put']);
  assert.deepEqual(rules('%nosuchfield%'), ['unknown-field']);
  assert.deepEqual(rules('%WM/Mood%'), []);
  assert.deepEqual(rules('[static text]'), ['cond-without-field']);
});

test('blocks join wrapped lines and skip comments', () => {
  const lines = ['# heading', '[%artist% - ]', '$if2(%title%,x)', '', '# other', '$if(%a%,b,c)'];
  const blocks = splitBlocks(lines);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].text, '[%artist% - ]$if2(%title%,x)');
  assert.deepEqual(toLineChar(blocks[0], 13), { line: 2, character: 0 });
  assert.deepEqual(toLineChar(blocks[1], 4), { line: 5, character: 4 });
});

test('package.json rule settings match the RULES table', () => {
  const { RULES } = require('../out/lint');
  const pkg = require('../package.json');
  const schema = pkg.contributes.configuration.properties['atf.lint.rules'].properties;
  assert.deepEqual(Object.keys(schema).sort(), Object.keys(RULES).sort());
  for (const [id, info] of Object.entries(RULES)) assert.equal(schema[id].default, info.severity, id);
});
