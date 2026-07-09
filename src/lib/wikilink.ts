// Résolution des wikilinks `[[note]]` (FR-7) — logique pure, testable.

// Normalise une cible de wikilink pour comparaison : enlève l'ancre `#…`,
// ne garde que le dernier segment de chemin, retire l'extension, insensible à la casse.
export function normalizeTarget(name: string): string {
  const noAnchor = name.split('#')[0]
  const last = noAnchor.split(/[\\/]/).pop() ?? noAnchor
  return last.replace(/\.(md|markdown|txt|html?)$/i, '').trim().toLowerCase()
}

// Trouve dans une liste de fichiers celui qui correspond à la cible. Préfère
// .md/.markdown en cas d'égalité de nom. Renvoie le chemin, ou null si absent.
export function matchWikilink(target: string, files: { path: string; name: string }[]): string | null {
  const t = normalizeTarget(target)
  if (!t) return null
  const matches = files.filter((f) => normalizeTarget(f.name) === t)
  if (matches.length === 0) return null
  const md = matches.find((f) => /\.(md|markdown)$/i.test(f.name))
  return (md ?? matches[0]).path
}
