/**
 * Tronque un nom de fichier AU MILIEU : le début et la fin (extension comprise) restent
 * lisibles, là où une ellipse de fin cache justement ce qui distingue deux versions
 * (« Rapport final (v2).md » / « Rapport final (v3).md »). Compte en points de code,
 * sans mesure DOM — la colonne CSS garde son ellipse de fin en dernier recours.
 */
export function middleTruncate(name: string, max = 36): string {
  const chars = Array.from(name)
  if (chars.length <= max) return name
  const keep = Math.max(1, max - 1)
  const tail = Math.ceil(keep * 0.4)
  const head = keep - tail
  return chars.slice(0, head).join('').trimEnd() + '…' + chars.slice(chars.length - tail).join('').trimStart()
}
