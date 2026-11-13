// The extension's core, shared unchanged with the VS Code extension. Import it from here so the
// path lives in one place.
export { parse, MAX_ARGS } from '@core/parser'
export type { ParseResult, ParseError, Span, Call, Field, Cond } from '@core/parser'
export { lint, RULES } from '@core/lint'
export type { Finding, Severity, RuleId } from '@core/lint'
export { FUNCTIONS, FIELDS, FUNCTION_MAP, FIELD_MAP, REMOVED } from '@core/catalog'
export type { FunctionInfo, FieldInfo } from '@core/catalog'
export { topLevelItems } from '@core/format'
export { splitBlocks } from '@core/blocks'
