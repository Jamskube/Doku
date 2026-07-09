// Résolution des sources d'images markdown (FR-2) — logique pure, testable.

export function isExternalUrl(url: string): boolean {
  return /^(https?:|data:|blob:|asset:)/i.test(url)
}

// Chemin absolu d'une image locale, résolu relativement au dossier du document.
// Un chemin déjà absolu (C:\…, /…, \\…) est renvoyé tel quel.
export function resolveLocalImagePath(url: string, dir: string): string {
  const clean = url.split(/[?#]/)[0].trim()
  if (/^([a-zA-Z]:[\\/]|\/|\\\\)/.test(clean)) return clean
  if (!dir) return clean
  const sep = dir.includes('\\') ? '\\' : '/'
  const rel = clean.replace(/\//g, sep)
  return dir.endsWith(sep) ? dir + rel : dir + sep + rel
}
