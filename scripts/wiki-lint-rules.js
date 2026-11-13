// wiki/Lint-Rules.md is generated from the RULES table in src/lint.ts, like the settings schema
// and the docs page, so it can't drift. After changing a rule:
//   npm run compile && node scripts/wiki-lint-rules.js
// test/wiki.test.js fails if the committed page is out of date.
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const PAGE = path.join(__dirname, '..', 'wiki', 'Lint-Rules.md');

function render() {
  const { RULES } = require('../out/lint');
  const rows = Object.values(RULES).map((r) => `| \`${r.id}\` | ${r.severity} | ${r.description.replace(/\|/g, '\\|')} |`);
  return [
    '<!-- Generated from RULES in src/lint.ts by scripts/wiki-lint-rules.js. Edit the rules there, not this page. -->',
    '',
    `The extension has ${rows.length} lint rules. Change a rule's severity, or turn it off, with the \`atf.lint.rules\` setting, e.g. \`{ "unknown-field": "off" }\`. Each rule also has an anchor on the [docs page](https://ghostpiratebob.me/atf-syntax/extension/#rules).`,
    '',
    '| Rule | Default | What it catches |',
    '|---|---|---|',
    ...rows,
    '',
  ].join('\n');
}

if (require.main === module) {
  fs.writeFileSync(PAGE, render());
  console.log(`wrote ${path.relative(process.cwd(), PAGE)}`);
}

module.exports = { render, PAGE };
