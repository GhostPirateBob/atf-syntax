const test = require('node:test');
const assert = require('node:assert/strict');
const { parse } = require('../out/parser');
const { lint } = require('../out/lint');
const { splitBlocks, toLineChar } = require('../out/blocks');

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

test('dialect-specific $if truth', () => {
  assert.deepEqual(rules('$if($strstr(%artist%,feat),y,n)', 'wacup'), ['always-true-condition']);
  assert.deepEqual(rules('$if($get(x),y,n)', 'winamp'), ['always-false-condition', 'get-before-put']);
  assert.deepEqual(rules('$puts(x,1)$if($get(x),y,n)', 'wacup'), []);
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
