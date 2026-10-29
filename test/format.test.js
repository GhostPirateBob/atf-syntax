const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { formatDocument, formatBlock } = require('../out/format');
const { splitBlocks } = require('../out/blocks');

const sample = fs.readFileSync(path.join(__dirname, '..', 'samples', 'winamp-playlist-titles.atf'), 'utf8').split('\n');
const texts = (lines) => splitBlocks(lines).map((b) => b.text);

test('formatting never changes what a block evaluates to', () => {
  for (const lineWidth of [0, 20, 40, 60, 80, 100, 200]) {
    const out = formatDocument(sample, { lineWidth });
    assert.deepEqual(texts(out), texts(sample), `lineWidth ${lineWidth}`);
  }
});

test('formatting is idempotent', () => {
  for (const lineWidth of [0, 40, 100]) {
    const once = formatDocument(sample, { lineWidth });
    assert.deepEqual(formatDocument(once, { lineWidth }), once);
  }
});

test('breaks only between non-space characters and never start a line with #', () => {
  const out = formatBlock("[%artist% - ]' ▹ '$if2(%title%,x) ▹ #1 [%album%]", { lineWidth: 1 });
  for (let i = 1; i < out.length; i++) {
    assert.ok(!/\s$/.test(out[i - 1]) && !/^\s/.test(out[i]) && !out[i].startsWith('#'), JSON.stringify(out));
  }
  assert.equal(out.join(''), "[%artist% - ]' ▹ '$if2(%title%,x) ▹ #1 [%album%]");
});

test('blocks with syntax errors, comments and blank lines are left alone', () => {
  const lines = ['# keep me', '$puts(araw[,x', '', '[%artist% - ]$if2(%title%,x)'];
  const out = formatDocument(lines, { lineWidth: 10 });
  assert.deepEqual(out.slice(0, 3), lines.slice(0, 3));
  assert.deepEqual(out.slice(3), ['[%artist% - ]', '$if2(%title%,x)']);
  assert.deepEqual(formatDocument(out, { lineWidth: 0 }), lines);
});

test('fuzz: random valid formats survive every width', () => {
  const pieces = ['[%artist% - ]', '$if2(%title%,$filepart(%filename%))', ' ▹ ', "'('", '%%', '$$', "''", '#', ' - ', '$abbr(%album%,13)', '[%year%  |  ]', 'x'];
  let seed = 42;
  const rand = (n) => (seed = (seed * 1103515245 + 12345) % 2147483648) % n;
  for (let i = 0; i < 3000; i++) {
    const text = Array.from({ length: 1 + rand(12) }, () => pieces[rand(pieces.length)]).join('');
    if (text.startsWith('#') || text.trim() === '' || text !== text.trim()) continue;
    for (const lineWidth of [0, 1, 15, 50]) {
      const lines = formatBlock(text, { lineWidth });
      assert.equal(lines.join(''), text);
      assert.deepEqual(texts(lines), [text], JSON.stringify(lines));
    }
  }
});
