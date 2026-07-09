// Helpers purs de l'explorateur de dossier (FR-6). Aucune dépendance Tauri ici
// pour rester testables en Node.

export type FsEntry = { name: string; isDir: boolean }

const SUPPORTED = ['md', 'markdown', 'txt', 'html', 'htm']

export function isSupportedFile(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  return SUPPORTED.includes(ext)
}

// Dossiers d'abord, puis fichiers, alphabétique (insensible à la casse/accents).
export function sortEntries(entries: FsEntry[]): FsEntry[] {
  return [...entries].sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
    return a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' })
  })
}

// Entrées à afficher : dossiers + fichiers supportés (les autres masqués — 4.1).
export function visibleEntries(entries: FsEntry[]): FsEntry[] {
  return sortEntries(entries.filter((e) => e.isDir || isSupportedFile(e.name)))
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
  return trimmed.slice(0, idx)
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
