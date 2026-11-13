/** A setting the extension contributes in package.json, as the docs page and the search show it. */
export interface Setting {
  key: string
  type?: string
  default?: unknown
  enum?: string[]
  description: string
}

/** The settings in an extension manifest's `contributes.configuration` (one object or an array). */
export function settingsFrom(pkg: unknown): Setting[] {
  const contributes = (pkg as any)?.contributes ?? {}
  const configs = Array.isArray(contributes.configuration) ? contributes.configuration : [contributes.configuration ?? {}]
  return configs.flatMap((c: any) =>
    Object.entries(c.properties ?? {}).map(([key, v]: [string, any]) => ({
      key,
      type: v.type,
      default: v.default,
      enum: v.enum,
      description: v.markdownDescription ?? v.description ?? '',
    })),
  )
}
