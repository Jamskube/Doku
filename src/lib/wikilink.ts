// Résolution des wikilinks `[[note]]` (FR-7) — logique pure, testable.

// Normalise une cible de wikilink pour comparaison : enlève l'ancre `#…`,
// ne garde que le dernier segment de chemin, retire l'extension, insensible à la casse.
export function normalizeTarget(name: string): string {
  const noAnchor = name.split('#')[0]
  const last = noAnchor.split(/[\\/]/).pop() ?? noAnchor
  return last.replace(/\.(md|markdown|txt|html?)$/i, '').trim().toLowerCase()
}

export interface WikiCandidate {
  path: string
  name: string
}

// Tous les fichiers correspondant à une cible, avec préférence .md/.markdown :
// s'il existe des .md, seuls ceux-ci sont candidats (les autres extensions sont
// ignorées) ; sinon tous les fichiers correspondants. Sert à la désambiguïsation (4.5).
export function wikilinkCandidates(target: string, files: WikiCandidate[]): WikiCandidate[] {
  const t = normalizeTarget(target)
  if (!t) return []
  const matches = files.filter((f) => normalizeTarget(f.name) === t)
  const md = matches.filter((f) => /\.(md|markdown)$/i.test(f.name))
  return md.length ? md : matches
}

// Nom de fichier à créer pour une cible inexistante : dernier segment uniquement
// (jamais un chemin — neutralise une traversée `../`), ancre retirée, extension .md
// ajoutée si aucune extension supportée n'est déjà écrite. '' si la cible est vide.
export function wikilinkFileName(target: string): string {
  const last = (target.split('#')[0].split(/[\\/]/).pop() ?? '').trim()
  if (!last) return ''
  return /\.(md|markdown|txt|html?)$/i.test(last) ? last : `${last}.md`
}

// Résout une cible en un seul chemin (préférence .md), ou null si absente.
export function matchWikilink(target: string, files: WikiCandidate[]): string | null {
  const c = wikilinkCandidates(target, files)
  return c.length ? c[0].path : null
}
