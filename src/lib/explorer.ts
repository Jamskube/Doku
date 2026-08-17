// Helpers purs de l'explorateur de dossier (FR-6). Aucune dépendance Tauri ici
// pour rester testables en Node.
import { OPENABLE_EXTENSIONS } from './doc-kind'
import { extensionOf, joinPath, sepOf } from './paths'

// mtime : renseigné seulement quand le tri « Modifié le » est actif (un stat par
// entrée coûte cher sur un gros dossier — on ne le paie pas si on ne trie pas dessus).
export type FsEntry = { name: string; isDir: boolean; mtime?: number }

export type SortKey = 'name' | 'modified' | 'type'
export type SortOrder = 'asc' | 'desc'
export type ExplorerSort = { key: SortKey; order: SortOrder }

export const DEFAULT_SORT: ExplorerSort = { key: 'name', order: 'asc' }

// Même liste que le dialogue d'ouverture, et pour cause : un fichier visible dans
// l'explorateur mais absent du dialogue (ou l'inverse) est une incohérence que
// l'utilisateur finit par rencontrer.
const SUPPORTED = OPENABLE_EXTENSIONS

export function isSupportedFile(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  return SUPPORTED.includes(ext)
}

// Collators réutilisés : localeCompare avec options reconstruit un collateur ICU à
// chaque appel (~10-50× plus lent) — sensible quand flattenTree re-trie chaque dossier
// déplié de l'arbre à chaque invalidation.
const nameCollator = new Intl.Collator('fr', { sensitivity: 'base' })
const extCollator = new Intl.Collator('fr')

function byName(a: FsEntry, b: FsEntry): number {
  return nameCollator.compare(a.name, b.name)
}

// Dossiers TOUJOURS d'abord (convention explorateur) : l'ordre ne s'applique qu'à
// l'intérieur de chaque groupe — un tri décroissant ne renvoie pas les dossiers en bas.
export function sortEntries(entries: FsEntry[], sort: ExplorerSort = DEFAULT_SORT): FsEntry[] {
  const dir = sort.order === 'desc' ? -1 : 1
  return [...entries].sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
    if (sort.key === 'modified') {
      // Entrée sans mtime (stat échoué/non demandé) : reléguée en fin, jamais
      // mélangée aux dates réelles — sinon l'ordre paraît aléatoire.
      const am = a.mtime, bm = b.mtime
      if (am == null && bm == null) return byName(a, b)
      if (am == null) return 1
      if (bm == null) return -1
      // « asc » = le plus récent d'abord : c'est ce qu'on attend d'un tri par date.
      if (am !== bm) return (bm - am) * dir
      return byName(a, b)
    }
    if (sort.key === 'type' && !a.isDir) {
      const cmp = extCollator.compare(extensionOf(a.name), extensionOf(b.name))
      if (cmp !== 0) return cmp * dir
      return byName(a, b)
    }
    return byName(a, b) * dir
  })
}

// Entrées à afficher : dossiers + fichiers supportés (les autres masqués — 4.1).
export function visibleEntries(entries: FsEntry[], sort: ExplorerSort = DEFAULT_SORT): FsEntry[] {
  return sortEntries(
    entries.filter((e) => e.isDir || isSupportedFile(e.name)),
    sort,
  )
}

// --- Création d'entrées (couche pure : validation avant toute I/O) ---

// Caractères interdits par Windows + noms de périphériques réservés. On valide côté
// app plutôt que de laisser l'OS échouer : le message d'erreur est en français et
// arrive AVANT l'écriture disque.
const ILLEGAL_CHARS = /[\\/:*?"<>|]/
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i

export type NameCheck = { ok: true; name: string } | { ok: false; error: string }

// Valide et normalise le nom saisi. `kind: 'file'` ajoute « .md » si aucune extension
// supportée n'est fournie (taper « Notes » crée « Notes.md »).
export function normalizeNewName(raw: string, kind: 'file' | 'dir'): NameCheck {
  const name = raw.trim()
  if (!name) return { ok: false, error: 'Entrez un nom.' }
  if (ILLEGAL_CHARS.test(name)) return { ok: false, error: 'Caractères interdits : \\ / : * ? " < > |' }
  if (RESERVED.test(name)) return { ok: false, error: `« ${name} » est un nom réservé par Windows.` }
  // Un nom terminé par un point ou un espace est créé puis inaccessible sous Windows.
  if (/[. ]$/.test(name)) return { ok: false, error: 'Un nom ne peut pas finir par un point ou un espace.' }
  if (name === '.' || name === '..') return { ok: false, error: 'Nom invalide.' }
  if (name.length > 120) return { ok: false, error: 'Nom trop long (120 caractères max).' }
  if (kind === 'dir') return { ok: true, name }
  return { ok: true, name: isSupportedFile(name) ? name : `${name}.md` }
}

// Conflit de nom : insensible à la casse, car Windows l'est (créer « notes.md » à côté
// de « Notes.md » écraserait silencieusement le fichier existant).
export function nameExists(name: string, entries: FsEntry[]): boolean {
  const lower = name.toLowerCase()
  return entries.some((e) => e.name.toLowerCase() === lower)
}

// Les helpers de chemin vivent dans `paths.ts` (module pur, sans dépendance). Réexportés
// ici pour que les appelants historiques n'aient pas à savoir qu'ils ont déménagé.
export { baseName, extensionOf, joinPath, parentPath } from './paths'

// --- Arborescence dépliable ---

// Ligne d'arbre prête à rendre : l'entrée, son chemin complet et sa profondeur
// (0 = enfant direct de la racine affichée). L'indentation visuelle en découle.
export type TreeRow = { entry: FsEntry; path: string; depth: number }

// Garde-fou contre les boucles de jonctions/liens Windows (C:\a\lien\a\lien\…) :
// au-delà, on arrête de descendre — un vrai projet n'a pas 16 niveaux utiles.
export const MAX_TREE_DEPTH = 16

// Aplatit l'arborescence en lignes ordonnées : pour chaque dossier DÉPLIÉ dont les
// enfants sont chargés (présents dans childrenByDir), ses entrées visibles suivent
// immédiatement, indentées. Un dossier déplié mais pas encore chargé n'affiche rien
// (le chargement paresseux remplira childrenByDir et re-rendra). Pure : aucune I/O.
// Mémo filtrage+tri par tableau d'enfants (référence stable tant que le dossier n'est
// pas relu) : déplier un dossier ne re-trie plus TOUS les dossiers chargés de l'arbre,
// seulement ceux dont les entrées ou le tri ont réellement changé.
const visibleMemo = new WeakMap<FsEntry[], { sort: ExplorerSort; rows: FsEntry[] }>()

function visibleEntriesMemo(children: FsEntry[], sort: ExplorerSort): FsEntry[] {
  const m = visibleMemo.get(children)
  if (m && m.sort.key === sort.key && m.sort.order === sort.order) return m.rows
  const rows = visibleEntries(children, sort)
  visibleMemo.set(children, { sort: { key: sort.key, order: sort.order }, rows })
  return rows
}

export function flattenTree(
  rootDir: string,
  childrenByDir: ReadonlyMap<string, FsEntry[]>,
  expanded: ReadonlySet<string>,
  sort: ExplorerSort = DEFAULT_SORT,
): TreeRow[] {
  const rows: TreeRow[] = []
  const walk = (dir: string, depth: number) => {
    if (depth > MAX_TREE_DEPTH) return
    const children = childrenByDir.get(dir)
    if (!children) return
    for (const entry of visibleEntriesMemo(children, sort)) {
      const path = joinPath(dir, entry.name)
      rows.push({ entry, path, depth })
      if (entry.isDir && expanded.has(path)) walk(path, depth + 1)
    }
  }
  walk(rootDir, 0)
  return rows
}

// Dossiers dépliés à re-matérialiser au rendu : ceux atteignables depuis la racine
// (la persistance peut contenir des chemins d'autres racines — ils restent stockés
// mais ne déclenchent aucun chargement tant qu'on n'affiche pas leur racine).
export function reachableExpanded(
  rootDir: string,
  expanded: ReadonlySet<string>,
): string[] {
  const sep = sepOf(rootDir)
  const prefix = rootDir.endsWith(sep) ? rootDir : rootDir + sep
  return [...expanded]
    .filter((p) => p.startsWith(prefix))
    .sort((a, b) => a.length - b.length)
}

// Validation d'un état déplié venu du stockage (settings potentiellement corrompus) :
// tableau de chaînes non vides, borné — tout le reste est jeté sans casser le boot.
export function validateExpandedPaths(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((v): v is string => typeof v === 'string' && v.length > 0).slice(0, 300)
}

export type PathCrumb = { label: string; path: string }

// Segments cliquables d'un chemin. Les racines Windows, POSIX et UNC restent de
// vrais chemins navigables : le fil d'Ariane ne reconstruit jamais un chemin à
// partir du libellé affiché.
export function pathCrumbs(path: string): PathCrumb[] {
  const sep = sepOf(path)
  const trimmed = path.length > 1 && path.endsWith(sep) ? path.slice(0, -1) : path

  if (sep === '\\' && /^[A-Za-z]:/.test(trimmed)) {
    const root = `${trimmed.slice(0, 2)}\\`
    const parts = trimmed.slice(2).split('\\').filter(Boolean)
    const crumbs: PathCrumb[] = [{ label: trimmed.slice(0, 2), path: root }]
    let current = root
    for (const part of parts) {
      current = joinPath(current, part)
      crumbs.push({ label: part, path: current })
    }
    return crumbs
  }

  if (sep === '\\' && trimmed.startsWith('\\\\')) {
    const parts = trimmed.slice(2).split('\\').filter(Boolean)
    if (parts.length >= 2) {
      let current = `\\\\${parts[0]}\\${parts[1]}`
      const crumbs: PathCrumb[] = [{ label: parts[1], path: current }]
      for (const part of parts.slice(2)) {
        current = joinPath(current, part)
        crumbs.push({ label: part, path: current })
      }
      return crumbs
    }
  }

  const absolute = trimmed.startsWith('/')
  const parts = trimmed.split('/').filter(Boolean)
  const crumbs: PathCrumb[] = absolute ? [{ label: '/', path: '/' }] : []
  let current = absolute ? '/' : ''
  for (const part of parts) {
    current = current ? joinPath(current, part) : part
    crumbs.push({ label: part, path: current })
  }
  return crumbs
}
