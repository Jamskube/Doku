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

// --- Liens entrants ---------------------------------------------------------------------

export interface Backlink {
  path: string
  name: string
  line: number
  col: number
  length: number
  // La ligne qui porte le lien, pour situer sans ouvrir.
  context: string
}

const WIKILINK = /\[\[([^\]\n]+?)\]\]/g
const MAX_CONTEXT_CHARS = 140

// Quels documents du dossier pointent vers `targetName` par un `[[wikilink]]` ? Pur :
// reçoit les documents déjà indexés par la recherche (le même index, pas une seconde
// lecture du disque). `[[cible|alias]]` et `[[cible#ancre]]` comptent comme `[[cible]]`.
export function findBacklinks(
  targetPath: string,
  targetName: string,
  docs: readonly { path: string; name: string; content: string; lower: string }[],
): Backlink[] {
  const wanted = normalizeTarget(targetName)
  if (!wanted) return []
  const out: Backlink[] = []
  for (const doc of docs) {
    if (doc.path === targetPath || !doc.lower.includes('[[')) continue
    WIKILINK.lastIndex = 0
    let match: RegExpExecArray | null
    let line = 1
    let scanned = 0
    while ((match = WIKILINK.exec(doc.content))) {
      const inner = match[1].split('|')[0]
      if (normalizeTarget(inner) !== wanted) continue
      for (let i = scanned; i < match.index; i += 1) if (doc.content.charCodeAt(i) === 10) line += 1
      scanned = match.index
      const start = doc.content.lastIndexOf('\n', match.index) + 1
      const endIndex = doc.content.indexOf('\n', match.index)
      const raw = doc.content.slice(start, endIndex < 0 ? undefined : endIndex).trim()
      out.push({
        path: doc.path,
        name: doc.name,
        line,
        col: match.index - start + 1,
        length: match[0].length,
        context: raw.length > MAX_CONTEXT_CHARS ? `${raw.slice(0, MAX_CONTEXT_CHARS - 1)}…` : raw,
      })
    }
  }
  return out
}
