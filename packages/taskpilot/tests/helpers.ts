import { en } from '../src/client/locales.ts'

/** Translate stub using the real English dictionary, with {param} interpolation. */
export function t(key: string, params?: Record<string, unknown>): string {
  const value = (en as Record<string, string>)[key] ?? key
  if (params === undefined) return value
  return value.replace(/\{(\w+)\}/g, (_match, name: string) => String(params[name]))
}
