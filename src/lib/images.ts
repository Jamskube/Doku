// Résolution des sources d'images markdown (FR-2) — logique pure, testable.
// Doku est hors-ligne par principe : on ne laisse charger qu'une image `data:`
// (inline) ou un fichier local ; tout schéma réseau (http/https/blob/asset/file…),
// une UNC (`\\host`) ou un protocole-relatif (`//host`) est bloqué — un `<img>`
// distant serait un phone-home silencieux (fuite IP), et une UNC une fuite NTLM.

// Chemin de lecteur Windows (C:\… / C:/…) — un fichier local, pas un schéma d'URL.
function isDrivePath(url: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(url)
}

// true si l'URL d'image doit être bloquée (ni chargée ni résolue localement).
export function isBlockedImageUrl(url: string): boolean {
  const u = url.trim()
  if (/^data:/i.test(u)) return false // inline autorisé
  if (/^(\\\\|\/\/)/.test(u)) return true // UNC ou protocole-relatif → réseau
  if (isDrivePath(u)) return false // fichier local absolu (lecteur)
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(u) // tout autre schéma → distant/non-fichier
}

// Chemin absolu d'une image locale, résolu relativement au dossier du document.
// Un chemin absolu de lecteur (C:\…) ou POSIX (/…) est renvoyé tel quel ; l'UNC
// n'est PAS traitée comme absolue (elle est bloquée en amont par isBlockedImageUrl).
export function resolveLocalImagePath(url: string, dir: string): string {
  const clean = url.split(/[?#]/)[0].trim()
  if (/^([a-zA-Z]:[\\/]|\/)/.test(clean)) return clean
  if (!dir) return clean
  const sep = dir.includes('\\') ? '\\' : '/'
  const rel = clean.replace(/\//g, sep)
  return dir.endsWith(sep) ? dir + rel : dir + sep + rel
}

// Une copie Markdown portable peut contenir plusieurs Mo de base64. Le modèle n'a
// besoin que de savoir qu'une image est présente, jamais de recevoir ses octets.
export function omitEmbeddedImageData(markdown: string): string {
  return markdown
    .replace(/!\[([^\]\r\n]*)\]\(data:image\/[^)\r\n]+\)/gi, (_match, alt: string) =>
      alt.trim() ? `[Image intégrée : ${alt.trim()}]` : '[Image intégrée]',
    )
    // Un onglet HTML (export autonome de Doku rouvert) porte ses images en balises.
    .replace(/<img\b[^>]*\bsrc\s*=\s*["']data:image\/[^"']*["'][^>]*>/gi, '[Image intégrée]')
}

export function markdownTextLength(markdown: string): number {
  return omitEmbeddedImageData(markdown).length
}
