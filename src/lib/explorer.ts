// Helpers purs de l'explorateur de dossier (FR-6). Aucune dépendance Tauri ici
// pour rester testables en Node.

// mtime : renseigné seulement quand le tri « Modifié le » est actif (un stat par
// entrée coûte cher sur un gros dossier — on ne le paie pas si on ne trie pas dessus).
export type FsEntry = { name: string; isDir: boolean; mtime?: number }

export type SortKey = 'name' | 'modified' | 'type'
export type SortOrder = 'asc' | 'desc'
export type ExplorerSort = { key: SortKey; order: SortOrder }

export const DEFAULT_SORT: ExplorerSort = { key: 'name', order: 'asc' }

const SUPPORTED = ['md', 'markdown', 'txt', 'html', 'htm', 'pdf']

export function isSupportedFile(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  return SUPPORTED.includes(ext)
}

export function extensionOf(name: string): string {
  const idx = name.lastIndexOf('.')
  return idx <= 0 ? '' : name.slice(idx + 1).toLowerCase()
}

function byName(a: FsEntry, b: FsEntry): number {
  return a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' })
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
      const cmp = extensionOf(a.name).localeCompare(extensionOf(b.name), 'fr')
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

function sepOf(path: string): '\\' | '/' {
  return path.includes('\\') ? '\\' : '/'
}

// Dossier parent d'un chemin, ou null à la racine.
export function parentPath(path: string | null): string | null {
  if (!path) return null
  const sep = sepOf(path)
  const trimmed = path.endsWith(sep) ? path.slice(0, -1) : path
  const idx = trimmed.lastIndexOf(sep)
  if (idx <= 0) return null
  const parent = trimmed.slice(0, idx)
  // Racine de lecteur Windows : « C:\file » → parent « C: » est malformé
  // (joinPath mé-détecterait le séparateur) → renvoyer la racine « C:\ ».
  if (/^[A-Za-z]:$/.test(parent)) return parent + sep
  return parent
}

export function joinPath(dir: string, name: string): string {
  const sep = sepOf(dir)
  return dir.endsWith(sep) ? dir + name : dir + sep + name
}

export function baseName(path: string): string {
  const sep = sepOf(path)
  const trimmed = path.endsWith(sep) ? path.slice(0, -1) : path
  return trimmed.slice(trimmed.lastIndexOf(sep) + 1)
}
