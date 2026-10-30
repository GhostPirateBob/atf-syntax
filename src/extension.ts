/**
 * VS Code entry point: diagnostics, hovers, completion, formatting and the copy command for the
 * `atf` language.
 *
 * Settings:
 * - `atf.dialect`: `wacup` | `winamp`
 * - `atf.lint.enable`: turn diagnostics off entirely
 * - `atf.lint.rules`: per-rule severity overrides, e.g. `{ "unknown-field": "off" }`
 * - `atf.format.lineWidth`: wrap width for Format Document; `0` joins each block onto one line
 *
 * @module extension
 */

import * as vscode from 'vscode';
import { Block, splitBlocks, toLineChar, toOffset } from './blocks';
import { Dialect, FIELD_MAP, FIELDS, FUNCTION_MAP, FUNCTIONS, REMOVED } from './catalog';
import { formatDocument } from './format';
import { lint, RuleId, Severity, SeveritySetting } from './lint';
import { parse, ParseResult } from './parser';

const SEVERITY: Record<Severity, vscode.DiagnosticSeverity> = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
  info: vscode.DiagnosticSeverity.Information,
  hint: vscode.DiagnosticSeverity.Hint,
};

/** Rules whose findings mean the format hangs the player, checked before copying a format out. */
const FREEZE_RULES = new Set<RuleId>(['replace-empty-search', 'negative-count']);

/** Debounce for re-linting while typing. */
const LINT_DELAY_MS = 150;

interface Settings {
  dialect: Dialect;
  enabled: boolean;
  rules: Partial<Record<RuleId, SeveritySetting>>;
}

function settings(): Settings {
  const config = vscode.workspace.getConfiguration('atf');
  return {
    dialect: config.get<Dialect>('dialect', 'wacup'),
    enabled: config.get<boolean>('lint.enable', true),
    rules: config.get<Partial<Record<RuleId, SeveritySetting>>>('lint.rules', {}),
  };
}

interface Analysed {
  block: Block;
  result: ParseResult;
}

/** One parse per document version, shared by diagnostics, hover and completion. */
class AnalysisCache {
  private entries = new Map<string, { version: number; blocks: Analysed[] }>();

  get(doc: vscode.TextDocument): Analysed[] {
    const key = doc.uri.toString();
    const hit = this.entries.get(key);
    if (hit && hit.version === doc.version) return hit.blocks;
    const blocks = splitBlocks(doc.getText().split('\n')).map((block) => ({ block, result: parse(block.text) }));
    this.entries.set(key, { version: doc.version, blocks });
    return blocks;
  }

  /** The block containing a position, with the position as a block offset. */
  at(doc: vscode.TextDocument, pos: vscode.Position): (Analysed & { offset: number }) | undefined {
    for (const entry of this.get(doc)) {
      const offset = toOffset(entry.block, pos.line, pos.character);
      if (offset !== undefined) return { ...entry, offset };
    }
    return undefined;
  }

  delete(doc: vscode.TextDocument): void {
    this.entries.delete(doc.uri.toString());
  }
}

function rangeOf(block: Block, start: number, end: number): vscode.Range {
  const a = toLineChar(block, start);
  const b = toLineChar(block, end);
  return new vscode.Range(a.line, a.character, b.line, b.character);
}

function refresh(doc: vscode.TextDocument, cache: AnalysisCache, collection: vscode.DiagnosticCollection): void {
  if (doc.languageId !== 'atf') return;
  const { dialect, enabled, rules } = settings();
  if (!enabled) {
    collection.delete(doc.uri);
    return;
  }
  const diagnostics: vscode.Diagnostic[] = [];
  for (const { block, result } of cache.get(doc)) {
    for (const f of lint(block.text, { dialect, rules, result })) {
      const d = new vscode.Diagnostic(rangeOf(block, f.start, f.end), f.message, SEVERITY[f.severity]);
      d.source = 'atf';
      d.code = f.rule;
      diagnostics.push(d);
    }
  }
  collection.set(doc.uri, diagnostics);
}

function functionDoc(name: string): vscode.MarkdownString | undefined {
  const info = FUNCTION_MAP.get(name.toLowerCase());
  if (info) {
    const flags = [info.exact !== undefined ? `exactly ${info.exact} args` : '', info.only ? `${info.only} only` : ''].filter(Boolean).join(' · ');
    return new vscode.MarkdownString(`**$${info.name}**\`${info.sig}\`${flags ? ` — _${flags}_` : ''}\n\n${info.doc}`);
  }
  const removed = REMOVED[name.toLowerCase()];
  return removed ? new vscode.MarkdownString(`**$${name}** — not available\n\n${removed}`) : undefined;
}

class HoverProvider implements vscode.HoverProvider {
  constructor(private cache: AnalysisCache) {}

  provideHover(doc: vscode.TextDocument, pos: vscode.Position): vscode.Hover | undefined {
    const hit = this.cache.at(doc, pos);
    if (!hit) return undefined;
    const { block, result, offset } = hit;
    const call = result.calls.find((c) => offset >= c.start && offset < c.nameEnd);
    if (call) {
      const md = functionDoc(call.name);
      return md && new vscode.Hover(md, rangeOf(block, call.start, call.nameEnd));
    }
    const field = result.fields.find((f) => offset >= f.start && offset < f.end);
    if (field) {
      const info = FIELD_MAP.get(field.name.toLowerCase());
      const md = new vscode.MarkdownString(`**%${field.name}%**\n\n${info ? info.doc : 'Not a known WACUP field (input plugins may still provide it).'}`);
      return new vscode.Hover(md, rangeOf(block, field.start, field.end));
    }
    return undefined;
  }
}

class CompletionProvider implements vscode.CompletionItemProvider {
  provideCompletionItems(doc: vscode.TextDocument, pos: vscode.Position): vscode.CompletionItem[] {
    const before = doc.lineAt(pos.line).text.slice(0, pos.character);
    const fn = /\$([A-Za-z_0-9]*)$/.exec(before);
    if (fn) {
      const range = new vscode.Range(pos.line, pos.character - fn[1].length, pos.line, pos.character);
      const { dialect } = settings();
      return FUNCTIONS.filter((f) => !f.only || f.only === dialect).map((f) => {
        const item = new vscode.CompletionItem(f.name, f.kind === 'control' ? vscode.CompletionItemKind.Keyword : vscode.CompletionItemKind.Function);
        item.detail = `$${f.name}${f.sig}`;
        item.documentation = new vscode.MarkdownString(f.doc);
        item.insertText = new vscode.SnippetString(`${f.name}($0)`);
        item.range = range;
        return item;
      });
    }
    // Only offer fields after an opening '%' (an odd number of '%' before the cursor).
    const field = /%([A-Za-z_0-9]*)$/.exec(before);
    if (field && (before.slice(0, -field[0].length).split('%').length - 1) % 2 === 0) {
      const range = new vscode.Range(pos.line, pos.character - field[1].length, pos.line, pos.character);
      return FIELDS.map((f) => {
        const item = new vscode.CompletionItem(f.name, vscode.CompletionItemKind.Field);
        item.detail = `%${f.name}%`;
        item.documentation = new vscode.MarkdownString(f.doc);
        item.insertText = `${f.name}%`;
        item.range = range;
        return item;
      });
    }
    return [];
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const cache = new AnalysisCache();
  const collection = vscode.languages.createDiagnosticCollection('atf');
  const timers = new Map<string, NodeJS.Timeout>();
  const schedule = (doc: vscode.TextDocument) => {
    const key = doc.uri.toString();
    clearTimeout(timers.get(key));
    timers.set(key, setTimeout(() => refresh(doc, cache, collection), LINT_DELAY_MS));
  };
  const refreshAll = () => vscode.workspace.textDocuments.forEach((doc) => refresh(doc, cache, collection));

  context.subscriptions.push(
    collection,
    vscode.workspace.onDidOpenTextDocument((doc) => refresh(doc, cache, collection)),
    vscode.workspace.onDidChangeTextDocument((e) => schedule(e.document)),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      collection.delete(doc.uri);
      cache.delete(doc);
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('atf')) refreshAll();
    }),
    vscode.languages.registerHoverProvider('atf', new HoverProvider(cache)),
    vscode.languages.registerCompletionItemProvider('atf', new CompletionProvider(), '$', '%'),
    vscode.languages.registerDocumentFormattingEditProvider('atf', {
      provideDocumentFormattingEdits(doc) {
        const lineWidth = vscode.workspace.getConfiguration('atf', doc).get<number>('format.lineWidth', 100);
        const before = doc.getText().split('\n').map((l) => l.replace(/\r$/, ''));
        const after = formatDocument(before, { lineWidth });
        if (after.join('\n') === before.join('\n')) return [];
        const all = new vscode.Range(0, 0, doc.lineCount, 0);
        return [vscode.TextEdit.replace(doc.validateRange(all), after.join('\n'))];
      },
    }),
    vscode.commands.registerTextEditorCommand('atf.copySingleLine', async (editor) => {
      const hit = cache.at(editor.document, editor.selection.active);
      if (!hit) {
        vscode.window.showInformationMessage('ATF: the cursor is not inside a format block.');
        return;
      }
      await vscode.env.clipboard.writeText(hit.block.text);
      const freezes = lint(hit.block.text, { result: hit.result }).some((f) => FREEZE_RULES.has(f.rule));
      if (freezes) {
        vscode.window.showWarningMessage('ATF: copied, but this format freezes WACUP (see the error in the editor). Fix it before pasting.');
        return;
      }
      const note = hit.result.error ? ' (note: it has a syntax error)' : '';
      vscode.window.setStatusBarMessage(`ATF: copied ${hit.block.text.length} characters as one line${note}`, 4000);
    }),
  );
  refreshAll();
}

export function deactivate(): void {}
