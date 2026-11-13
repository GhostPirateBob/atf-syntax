const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluate } = require('../out/evaluate');

/** Rendered text with no fields (as in the oracle runs, where every %field% is empty). */
const text = (f, fields = {}) => evaluate(f, fields).text;

test('known facts on WACUP 1.99.57.25464', () => {
  const cases = [
    ['$replace(ABC,b,x,1)', 'AxC'],
    ['$replace(abc,,x)', ''],
    ['$cut(abcdef,-2)', 'abcd'],
    ['$left(abcdef,-2)', ''],
    ['$right(abcdef,-2)', ''],
    ['$padcut(ab,5,x)', 'ab'],
    ['$padcut(ab,5,x,y)', 'abyyy'],
    ['$padcut(ab,6,_,xy)', 'abyxyx'],
    ['$abbr(The Notorious B.I.G.,20)', 'TNB.I.G.'],
    ['$abbr(Magna Carta... Holy Grail,18)', 'MC...HG'],
    ['$abbr(...And Then There Was X,18)', '...ATTWX'],
    ['$abbr(MTV Ultimate Mash-Ups Presents: Collision Course,18)', 'MUM-UP:CC'],
    ['$abbr(The 18th Letter / The Book of Life,18)', 'T1L/TBoL'],
    ["$abbr('365 (Thr33 6ix 5ive)',18)", '365(T65)'],
    ['$abbr(Everything Everything,20)', 'EE'],
    ['$left(abcdef, 3)', 'abc'],
  ];
  for (const [f, want] of cases) assert.equal(text(f), want, f);
});

test('oracle-confirmed function behaviour', () => {
  const cases = [
    ['$abbr(Final Fantasy VI)', 'FFVI'],
    ['$abbr(Mega Man x2,0,2)', 'MMX2'],
    ['$abbr(Advanced Title Formatting,10)', 'ATF'],
    ['$abbr(abc,5)', 'abc'],
    ["$abbr(it''s)", 'i'],
    ["$abbr(it''s,0,2)", "I'S"],
    ['$abbr(Mix Tape)', 'MixT'],
    ['$caps(hELLO wORLD)', 'Hello World'],
    ["$caps(it''s mc-donald)", "It's Mc-Donald"],
    ['$caps2(hELLO wORLD)', 'HELLO WORLD'],
    ['$upper(àéî straße)', 'ÀÉÎ STRAßE'],
    ['$lower(ΣΑΣ)', 'σασ'],
    ['$len(😀)', '2'],
    ['$char(9733)', '★'],
    ['$char(128512)', '😀'],
    ['$char(65535)', '\u{10ffff}'],
    ['$add(2147483647,1)', '-2147483648'],
    ['$add(4294967296)', '2147483647'],
    ['$mul(,3)', '3'],
    ['$div(7,0)', '7'],
    ['$mod(-2147483648,7)', '-2'],
    ['$div(-2147483648,-1)', ''],
    ['$muldiv(7,3,2)', '11'],
    ['$muldiv(-5,1,2)', '-3'],
    ['$muldiv(7,3,0)', '-1'],
    ['$num(-1,4)', '4294967295'],
    ['$num(3,-2)', '3 '],
    ['$num(1,99)', '000000000000000'],
    ['$hex(255,4)', '00ff'],
    ['$left(abcdef,３)', 'abc'],
    ['$left(abcdef,٣)', 'abc'],
    ['$left(abcdef,- 2)', ''],
    ['$right(abc,4)', ''],
    ['$substr(abcdef,2,3)', 'bcd'],
    ['$substr(abcdef,-2)', 'ef'],
    ['$substr(abcdef,0)', ''],
    ['$strstr(abc,z)', '0'],
    ['$strstr(,a)', ''],
    ['$strchr(xＡx,A)', '2'],
    ['$strrchr(aacbbabb,a)', '6'],
    ["$strbetween('title [other info]','[',']')", 'other info'],
    ['$strbetween(abcabc,a,c)', 'bcab'],
    ['$strbetween(abcdef,e,b)', 'f'],
    ['$replace(xＡx,A,_)', 'x_x'],
    ['$replace(xéx,É,_,1)', 'x_x'],
    ['$pad(ab,8,xy)', 'abxyxyxyxyxyxy'],
    ['$lpad(ab,8,xy)', 'yxyxyxab'],
    ['$padout(ab,3,xy)', 'abxyxyxy'],
    ['$lpadout(ab,3,xyz)', 'zyxab'],
    ['$pad(*5,#)', '#####'],
    ['$pad(3)', '  '],
    ['$pad(x😀,4)', 'x😀  '],
    ['$repeat(ab,3)', 'ababab'],
    ['$repeat(ab,-1)', ''],
    ['$split(a/b/c,/,0)', 'a'],
    ['$split(a/b/c,/,1)', 'b/c'],
    ['$split(a/b/c,/,3)', ''],
    ['$select(2,a,b,c)', 'b'],
    ['$select(0,a,b,c)', '0'],
    ['$select(x,a,b,c)', 'x'],
    ['$if3(,,c)', 'c'],
    ['$decode(a,b,c,d)', 'd'],
    ['$decode(a,b,c,a,e,f)', 'e'],
    ['$decode(,,c,d)', 'd'],
    ['$ifstrequal(a,A,y)', 'y'],
    ['$ifstrequal(é,É,y)', ''],
    ['$ifstrequal(,,y)', ''],
    ['$ifstrnotequal(,,y)', ''],
    ['$ifstrnotequal(,a,y)', 'y'],
    ['$tab(2)', '\t\t'],
    ['$tab()', ''],
    ['$tab(-1)', ''],
    ['$crlf()', '\r\n'],
    ['$leftbracket()feat$rightbracket()', '(feat)'],
    ['$longest(ab,xy,z)', 'ab'],
    ['$shortest(,xy)', ''],
    ['$trim(  a b  )', 'a b'],
    ['$pathsafe(a<b>c:d"e/f\\g|h?i*j)', "a(b)c-d'e-f-g_h_i_j"],
    ['$filepart(C:\\a\\b.c.mp3)', 'b.c'],
    ['$filepart(noext)', ''],
    ['$filename(C:\\a\\b\\)', 'b\\'],
    ['$fileext(a.tar.gz)', 'GZ'],
    ['$directory(C:\\a\\b.mp3)', 'a'],
    ['$directory(C:\\a\\b.mp3,2)', 'C:'],
    ['$directory(\\\\srv\\share\\x\\y.flac,3)', 'share'],
    ['$pathltrim(C:\\a\\b.mp3,1)', 'a\\b.mp3'],
    ['$pathlpart(C:\\a\\b.mp3,1)', 'C:\\'],
    ['$pathrpart(http://x.y/z.mp3,2)', '/x.y/z.mp3'],
    ['$pathrtrim(C:\\a\\b\\,1)', 'C'],
    ['$pathrtrim(C:\\a\\b.mp3)X', 'C:\\a'],
    ['$is_stream(http://x.y/z.mp3)', '1'],
    ['$is_stream(zip://x)', ''],
    ['$is_stream(C:\\a.mp3)', ''],
    ['$null(a,b)', ''],
  ];
  for (const [f, want] of cases) assert.equal(text(f), want, f);
});

test('syntax errors: whole scope replaced, enclosing scope carries on', () => {
  assert.equal(text('ab$if(a'), '[SYNTAX ERROR IN FORMATTING STRING (4)]');
  assert.equal(text('ab%x'), '[TRUNCATED FORMATTING STRING -> MISSING END TAG / WORKING BUFFER TOO SMALL]');
  assert.equal(text("ab'x"), '[SYNTAX ERROR IN FORMATTING STRING (7)]');
  assert.equal(text('ab[x'), '[SYNTAX ERROR IN FORMATTING STRING (8)]');
  assert.equal(text('ab)x'), '[SYNTAX ERROR IN FORMATTING STRING (9)]');
  assert.equal(text('ab$x'), '[SYNTAX ERROR IN FORMATTING STRING (3)]');
  assert.equal(text('$if(a,(b),c)'), '[SYNTAX ERROR IN FORMATTING STRING (9)]');
  // An error inside an argument is that argument's value.
  assert.equal(text('abc$upper(x(y)z)def'), 'abc[SYNTAX ERROR IN FORMATTING STRING (9)]def');
  assert.equal(text('abc$null(x(y)z)def'), 'abcdef');
  assert.equal(text('abc[x(y)]def'), 'abcdef');
  const r = evaluate('ab)x', {});
  assert.equal(r.error.code, 9);
  assert.equal(text(''), '');
});

test('field and function names are read for at most 32 characters', () => {
  assert.equal(text('1%' + 'x'.repeat(31) + ']Z'), '1');
  assert.equal(text('1%' + 'x'.repeat(32) + ']Z'), '1Z');
  assert.equal(text('1%' + 'x'.repeat(30) + ']Z'), '[TRUNCATED FORMATTING STRING -> MISSING END TAG / WORKING BUFFER TOO SMALL]');
  assert.equal(text('1$' + 'a'.repeat(33) + '(x)Z'), '[SYNTAX ERROR IN FORMATTING STRING (4)]');
});

test('unknown functions and strict arity print in place, replacing the scope so far', () => {
  assert.equal(text('$foo(x)'), '[UNKNOWN FUNCTION -> $foo(x)]');
  assert.equal(text('x$foo(a)y'), '[UNKNOWN FUNCTION -> $foo(a)y]y');
  assert.equal(text('$upper($foo(x)y)z'), '[UNKNOWN FUNCTION -> $FOO(X)Y]Yz');
  assert.equal(text('$and(a,b)'), '[UNKNOWN FUNCTION -> $and(a,b)]');
  assert.equal(text('x$if(a)y'), '[INVALID $if() SYNTAX -> if(a)y]y');
  assert.equal(text('$ifstrequal(a,b)'), '[INVALID $IfStrEqual() SYNTAX -> ifstrequal(a,b)]');
  assert.equal(text('$IF(a,b,c)'), 'b');
  assert.equal(text('$foo(' + 'a'.repeat(200) + ')').length, 127);
});

test('escapes and quoting', () => {
  assert.equal(text("100%% $$5 it''s"), "100% $5 it's");
  assert.equal(text("'it''s'"), 'its');
  assert.equal(text("''''"), "''");
  assert.equal(text("'%x%'"), '%x%');
  assert.equal(text('a,b,c'), 'a,b,c');
  assert.equal(text("$upper('a,b',c)"), 'A,B');
});

test('freezes: $padcut with a negative length; fixed freezes return nothing', () => {
  const r = evaluate('ab$padcut(%title%,-1)cd', { title: 'x' });
  assert.equal(r.text, '');
  assert.deepEqual(r.freeze, { fn: 'padcut', start: 2, end: 21 });
  assert.ok(evaluate('$padcut(ab, -1)', {}).freeze);
  // No padding character, so nothing to pad with: no freeze.
  assert.equal(evaluate('$padcut(ab,-1,x)', {}).freeze, undefined);
  assert.equal(text('$padcut(ab,-1,x)'), 'ab');
  for (const f of ['$replace(abc,,x)', '$tab(-1)', '$directory(C:\\a\\b.mp3,-1)']) {
    const e = evaluate(f, {});
    assert.equal(e.freeze, undefined, f);
    assert.equal(e.text, '', f);
  }
  // Huge counts take WACUP seconds and gigabytes.
  assert.equal(evaluate('$repeat(a,2147483647)', {}).freeze.fn, 'repeat');
  assert.equal(evaluate('$split(abc,b,2000000000)', {}).freeze.fn, 'split');
  assert.equal(evaluate('$repeat(,2147483647)', {}).freeze, undefined);
});

test('pathological formats stay bounded', () => {
  const t0 = Date.now();
  const r = evaluate('$repeat($repeat(x,10000),10000)'.repeat(3), {});
  assert.ok(r.freeze || r.text.length <= 1 << 20);
  const nest = (n) => '$trim('.repeat(n) + 'x' + ')'.repeat(n);
  assert.equal(text(nest(300)), 'x');
  assert.equal(typeof text(nest(5000)), 'string');
  assert.ok(Date.now() - t0 < 10000);
});

test('[...] shows only when a field inside resolved', () => {
  assert.equal(text('[%artist% - ]%title%', { title: 'T' }), 'T');
  assert.equal(text('[%artist% - ]%title%', { artist: 'A', title: 'T' }), 'A - T');
  assert.equal(text('[$upper(%artist%) - ]x', { artist: 'a' }), 'A - x');
  assert.equal(text('[$len(x)]'), '');
  assert.equal(text('[$if(%a%,,)]x', { a: '1' }), 'x');
  assert.equal(text('[[%a%]b]', { a: '1' }), '1b');
  assert.equal(text('%ARTIST%', { artist: 'A' }), 'A');
  assert.equal(text('%constructor%%__proto__%'), '');
});

test('$if family tests for a non-empty string (WACUP)', () => {
  assert.equal(text('$if(%artist%,yes,no)', { artist: 'A' }), 'yes');
  assert.equal(text('$if(%artist%,yes,no)'), 'no');
  assert.equal(text('$if(%title%, yes,no)', { title: 't' }), ' yes');
  assert.equal(text('$if($strstr(abc,z),y,n)'), 'y');
  assert.equal(text('$if2(%album%,no-album)'), 'no-album');
  assert.equal(text('$if3(%artist%,%filename%,%album%,no field)', { album: 'B' }), 'B');
  assert.equal(text('$ifgreater(%rating%,2,Highly rated song,Not highly rated song)', { rating: '3' }), 'Highly rated song');
  assert.equal(text('$iflonger(%title%,15,A long title,A short title)', { title: 'short' }), 'A short title');
  // Arguments are evaluated eagerly, so both branches run.
  assert.equal(text('$if(a,$puts(x,1),$puts(x,2))$get(x)'), '2');
});

test('$put / $puts / $get', () => {
  assert.equal(text('$put(x,ab)-$get(x)'), 'ab-ab');
  assert.equal(text('$puts(X,1)$get(x)'), '1');
  assert.equal(text('$puts(é,1)$get(É)'), '');
  assert.equal(text('$get(x)$puts(x,1)'), '');
  assert.equal(text('$puts(x,a)$puts(x,)$get(x)'), 'a');
  assert.equal(text('$put(,v)'), '');
  assert.equal(text('$puts(v,%artist%)$get(v)', { artist: 'A' }), 'A');
  // Variables live for one evaluate() call.
  assert.equal(text('$get(v)'), '');
});

test('unconfirmed behaviour renders as ? and is listed', () => {
  assert.deepEqual(evaluate('$rating()', {}), { text: '?', unsure: ['rating'] });
  assert.deepEqual(evaluate('x$bitdepth(%filename%)$rating()', {}), { text: 'x??', unsure: ['bitdepth', 'rating'] });
  // A trailing "mix" depends on WACUP's memory layout.
  assert.deepEqual(evaluate('$abbr(The Mix)', {}), { text: '?', unsure: ['abbr'] });
  assert.equal(text('$abbr(Mix Tape)'), 'MixT');
});

test('$systime_* are not zero-padded', () => {
  for (const f of ['month', 'day', 'hour', 'minute', 'second']) assert.match(text(`$systime_${f}()`), /^[1-9]?\d$/);
  assert.match(text('$systime_year()'), /^\d{4}$/);
});

test('worked examples (spec §8)', () => {
  const def = '[%artist% - ]$if2(%title%,$filepart(%filename%))';
  assert.equal(text(def, { artist: 'Pink Floyd', title: 'Dogs' }), 'Pink Floyd - Dogs');
  assert.equal(text(def, { filename: 'C:\\Music\\Animals\\02 - Dogs.mp3' }), '02 - Dogs');
  const std = '[%artist% - ][%album% - ][$num(%track%,2) - ]$if2(%title%,$filepart(%filename%))';
  assert.equal(text(std, { artist: 'Pink Floyd', album: 'Animals', track: '2', title: 'Dogs' }), 'Pink Floyd - Animals - 02 - Dogs');
  const adv =
    "[$if2(%albumartist%,%artist%) - ][%album% - ][$num(%track%,2) - ]$IfStrNotEqual(%artist%,$if2(%albumartist%,%artist%),[%artist% - ])[$if2(%title%,$filepart(%filename%))][$if($fileext(%filename%),'   [  ',)][%year%  |  ][$fileext(%filename%) ][$if(%bitrate%, '|'  ,)][%bitrate% 'kbps' ][$if($fileext(%filename%),']',)][   $repeat(*,%rating%) ]";
  const fields = { albumartist: 'Various', artist: 'Tripswitch', album: 'Arcana', track: '1', title: 'Calabi Yau', year: '2006', filename: 'C:\\Music\\Arcana\\01 Calabi Yau.mp3', bitrate: '205', rating: '5' };
  // WACUP upper-cases $fileext (the help page shows "mp3").
  assert.equal(text(adv, fields), 'Various - Arcana - 01 - Tripswitch - Calabi Yau   [  2006  |  MP3  |  205 kbps ]   ***** ');
  assert.equal(text('$div(%length_seconds%,60):$num($mod(%length_seconds%,60),2)', { length_seconds: '260' }), '4:20');
  const bob =
    ".  ⇢  $puts(t,$if2(%title%,$filepart(%filename%)))$puts(araw,$if2(%albumartist%,%artist%))$puts(fp,$strstr($replace($replace($lower($get(araw)),'(',' '),' ft',' feat'),' feat'))$puts(a,$trim($ifgreater($get(fp),0,$left($get(araw),$sub($get(fp),1)),$get(araw))))$if($get(a),$abbr($get(a),20) ▹ ,)[$abbr(%album%,13) ▹ ]$iflonger($get(t),30,$left($get(t),29)…,$get(t))";
  assert.equal(text(bob, { artist: 'Kanye West ft. Jay-Z', album: 'Watch the Throne', title: 'Otis' }), '.  ⇢  Kanye West ▹ WtT ▹ Otis');
  assert.equal(text(bob, { artist: 'The Notorious B.I.G. (feat. Diddy)', album: 'Life After Death', title: 'A very long title that exceeds thirty chars' }), '.  ⇢  TNB.I.G. ▹ LAD ▹ A very long title that exceed…');
  assert.equal(text(bob, {}), '.  ⇢  ');
});

test('real-world playlist format', () => {
  const f = '[$abbr(%artist%,20) ▸ ]$abbr(%album%,18) ▹ %title%';
  const fields = { artist: 'Alfie Templeman', album: 'Happiness in Liquid Form', title: 'Things I Thought Were Mine' };
  assert.deepEqual(evaluate(f, fields), { text: 'Alfie Templeman ▸ HiLF ▹ Things I Thought Were Mine', unsure: [] });
  // Field-free parts, checked against the oracle: the [...] vanishes, $abbr of nothing is nothing.
  assert.equal(text(f), ' ▹ ');
});

test('a work budget stops enormous formats quickly, without claiming WACUP freezes', () => {
  const heavy = '$len($repeat(a,1000000))'.repeat(80);
  const started = Date.now();
  const r = evaluate(heavy, {});
  assert.equal(r.tooHeavy, true);
  assert.equal(r.freeze, undefined);
  assert.equal(r.text, '');
  assert.ok(Date.now() - started < 2000, 'should stop well under the worker limit');
  // A few big calls are fine: the budget only trips on many of them.
  const ok = evaluate('$len($repeat(a,1000000))'.repeat(3), {});
  assert.equal(ok.tooHeavy, undefined);
  assert.equal(ok.text, '100000010000001000000');
});
