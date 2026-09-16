// Read the current document language at the point of use. Shared players and
// lazily loaded author panels must not keep the language from their first mount.
export function uiText(zh, en, locale = globalThis.document?.documentElement?.lang || 'zh') {
  return locale.startsWith('en') ? en : zh;
}
