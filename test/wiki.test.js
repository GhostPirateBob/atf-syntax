'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const { render, PAGE } = require('../scripts/wiki-lint-rules');

test('wiki/Lint-Rules.md matches the RULES table (run scripts/wiki-lint-rules.js)', () => {
  assert.equal(fs.readFileSync(PAGE, 'utf8').replace(/\r\n/g, '\n'), render());
});
