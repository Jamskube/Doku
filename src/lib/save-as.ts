export type SaveableTextKind = 'md' | 'txt' | 'html'

export interface TextSaveSnapshot {
  tabId: number
  name: string
  kind: SaveableTextKind
  content: string
  savedContent: string
}

export type SaveAsResult =
  | { status: 'saved'; path: string; attached: boolean }
  | { status: 'cancelled' | 'duplicate' | 'stale' }
  | { status: 'error'; error: unknown }

export interface SaveAsDependencies {
  choosePath(defaultName: string, kind: SaveableTextKind): Promise<string | null>
  pathExists(path: string): Promise<boolean>
  confirmReplace(path: string): Promise<boolean>
  isPathOwnedByOtherTab(path: string, tabId: number): boolean
  isTabOpen(tabId: number): boolean
  write(path: string, content: string): Promise<void>
  commit(snapshot: TextSaveSnapshot, path: string, name: string): boolean | Promise<boolean>
  afterCommit(snapshot: TextSaveSnapshot, path: string): void | Promise<void>
}

const EXTENSION: Record<SaveableTextKind, string> = {
  md: '.md',
  txt: '.txt',
  html: '.html',
}

const COMPATIBLE_EXTENSIONS: Record<SaveableTextKind, ReadonlySet<string>> = {
  md: new Set(['.md', '.markdown']),
  txt: new Set(['.txt']),
  html: new Set(['.html', '.htm']),
}

export function canonicalPathKey(path: string): string {
  return path
    .trim()
    .replace(/\//g, '\\')
    .replace(/\\+/g, '\\')
    .replace(/\\$/, '')
    .toLocaleLowerCase('en-US')
}

export function ensureTextExtension(path: string, kind: SaveableTextKind): string {
  const name = path.split(/[\\/]/).pop() ?? path
  const match = /\.[^.\\/]+$/.exec(name)
  if (!match) return `${path}${EXTENSION[kind]}`
  if (COMPATIBLE_EXTENSIONS[kind].has(match[0].toLocaleLowerCase('en-US'))) return path
  return `${path.slice(0, -match[0].length)}${EXTENSION[kind]}`
}

export function defaultTextFileName(name: string, kind: SaveableTextKind): string {
  const linked = /^Notes\s+[—-]\s+(.+)$/i.exec(name.trim())
  const candidate = linked ? `notes-${linked[1].replace(/\.[^.]+$/, '').trim().replace(/\s+/g, '-').toLocaleLowerCase('fr')}` : name
  const clean = candidate.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-').trim() || 'Sans titre'
  return ensureTextExtension(clean, kind)
}

export function fileNameFromPath(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

export async function runSaveAs(
  snapshot: TextSaveSnapshot,
  deps: SaveAsDependencies,
): Promise<SaveAsResult> {
  const chosenPath = await deps.choosePath(defaultTextFileName(snapshot.name, snapshot.kind), snapshot.kind)
  if (!chosenPath) return { status: 'cancelled' }

  const finalPath = ensureTextExtension(chosenPath, snapshot.kind)
  if (deps.isPathOwnedByOtherTab(finalPath, snapshot.tabId)) return { status: 'duplicate' }

  // Si Doku ajoute l'extension après le dialogue, Windows n'a confirmé que le chemin
  // sans extension. On reconfirme donc explicitement un éventuel fichier final existant.
  if (canonicalPathKey(finalPath) !== canonicalPathKey(chosenPath) && (await deps.pathExists(finalPath))) {
    if (!(await deps.confirmReplace(finalPath))) return { status: 'cancelled' }
  }

  // Une fermeture pendant le dialogue ne doit jamais écrire un snapshot orphelin.
  if (!deps.isTabOpen(snapshot.tabId)) return { status: 'stale' }

  try {
    await deps.write(finalPath, snapshot.content)
    const attached = await deps.commit(snapshot, finalPath, fileNameFromPath(finalPath))
    if (attached) await deps.afterCommit(snapshot, finalPath)
    return { status: 'saved', path: finalPath, attached }
  } catch (error) {
    return { status: 'error', error }
  }
}
