import { joinPath, type FsEntry } from './explorer'

// Garde Tauri : toutes les APIs natives passent ici, avec repli silencieux en
// mode navigateur (dev UI). ADR-0004 : plugins officiels uniquement, écriture
// atomique composée côté TS (tmp + rename).
export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

// Écoute les demandes d'ouverture de fichier venues de l'hôte Rust (double-clic,
// association, 2e instance). Émet `doku://ready` pour déclencher l'ouverture du
// fichier de lancement une fois le listener en place. Renvoie un unlisten.
export async function onOpenFile(handler: (path: string) => void): Promise<() => void> {
  if (!isTauri) return () => {}
  const { listen, emit } = await import('@tauri-apps/api/event')
  const unlisten = await listen<string>('doku://open', (event) => handler(event.payload))
  await emit('doku://ready')
  return unlisten
}

// Liste un dossier (natif). [] en mode navigateur.
export async function readDirectory(path: string): Promise<FsEntry[]> {
  if (!isTauri) return []
  const { readDir } = await import('@tauri-apps/plugin-fs')
  const entries = await readDir(path)
  return entries.map((e) => ({ name: e.name, isDir: e.isDirectory }))
}

// Scanne récursivement un dossier et renvoie tous les fichiers (chemin + nom).
// Profondeur bornée ; [] en mode navigateur. Sert au résolveur de wikilinks.
export async function scanFiles(dir: string, maxDepth = 4): Promise<{ path: string; name: string }[]> {
  if (!isTauri) return []
  const { readDir } = await import('@tauri-apps/plugin-fs')
  const out: { path: string; name: string }[] = []
  const walk = async (d: string, depth: number) => {
    if (depth > maxDepth) return
    let entries
    try {
      entries = await readDir(d)
    } catch {
      return
    }
    for (const e of entries) {
      const full = joinPath(d, e.name)
      if (e.isDirectory) await walk(full, depth + 1)
      else out.push({ path: full, name: e.name })
    }
  }
  await walk(dir, 0)
  return out
}

// Lit le contenu texte d'un fichier (natif). null en mode navigateur.
export async function readTextFileAt(path: string): Promise<string | null> {
  if (!isTauri) return null
  const { readTextFile } = await import('@tauri-apps/plugin-fs')
  return readTextFile(path)
}

export async function minimizeWindow() {
  if (!isTauri) return
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  await getCurrentWindow().minimize()
}

export async function toggleMaximizeWindow() {
  if (!isTauri) return
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  await getCurrentWindow().toggleMaximize()
}

export async function closeWindow() {
  if (!isTauri) return
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  await getCurrentWindow().close()
}

export async function setAlwaysOnTop(value: boolean) {
  if (!isTauri) return
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  await getCurrentWindow().setAlwaysOnTop(value)
}

export async function openFileDialog(): Promise<{ path: string; name: string; content: string } | null> {
  if (!isTauri) return null
  const { open } = await import('@tauri-apps/plugin-dialog')
  const path = await open({
    multiple: false,
    filters: [{ name: 'Documents', extensions: ['md', 'markdown', 'txt', 'html', 'htm'] }],
  })
  if (typeof path !== 'string') return null
  const { readTextFile } = await import('@tauri-apps/plugin-fs')
  const content = await readTextFile(path)
  const name = path.split(/[\\/]/).pop() ?? path
  return { path, name, content }
}

// Intercepte la fermeture de la fenêtre : `handler` renvoie true si la fermeture
// est autorisée (rien à sauver, ou choix Sauver/Ignorer honoré). Réutilise close()
// (déjà autorisé) via un drapeau, sans permission `destroy`.
export async function onWindowCloseRequested(handler: () => Promise<boolean>): Promise<() => void> {
  if (!isTauri) return () => {}
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  const win = getCurrentWindow()
  const unlisten = await win.onCloseRequested(async (event) => {
    // On empêche toujours la fermeture native, on décide, puis on détruit la
    // fenêtre. destroy() ne repasse PAS par onCloseRequested (pas de ré-entrance,
    // contrairement à un close() rappelé qui peut ne pas se propager en release).
    event.preventDefault()
    let ok = false
    try {
      ok = await handler()
    } catch (err) {
      // Ne jamais piéger la fenêtre : en cas d'erreur, on autorise la fermeture.
      console.error('Garde de fermeture: erreur, fermeture autorisée', err)
      ok = true
    }
    if (ok) await win.destroy()
  })
  return unlisten
}

// Notifie quand la fenêtre (re)prend le focus (retour depuis un autre programme).
// Sert à détecter les modifications externes des fichiers ouverts (FR-3, 3.5).
// No-op en navigateur. Renvoie un unlisten.
export async function onWindowFocus(handler: () => void): Promise<() => void> {
  if (!isTauri) return () => {}
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  return getCurrentWindow().onFocusChanged(({ payload: focused }) => {
    if (focused) handler()
  })
}

// Glisser-déposer de fichiers sur la fenêtre (FR-4, 2.4). Le webview Tauri
// intercepte le drop OS (dragDrop activé par défaut) et émet l'événement ;
// `onDrop` reçoit les chemins lâchés, `onHover` pilote l'overlay. No-op navigateur.
export async function onFileDrop(
  onDrop: (paths: string[]) => void,
  onHover: (active: boolean) => void,
): Promise<() => void> {
  if (!isTauri) return () => {}
  const { getCurrentWebview } = await import('@tauri-apps/api/webview')
  return getCurrentWebview().onDragDropEvent(({ payload }) => {
    if (payload.type === 'drop') {
      onHover(false)
      onDrop(payload.paths)
    } else if (payload.type === 'enter' || payload.type === 'over') {
      onHover(true)
    } else if (payload.type === 'leave') {
      onHover(false)
    }
  })
}

// Compteur pour un nom de tmp unique : deux sauvegardes concurrentes du même
// fichier (Ctrl+S rapide, ou save-all à la fermeture) ne se courent pas dessus.
let tmpSeq = 0

export async function writeTextFileAtomic(path: string, content: string) {
  if (!isTauri) return
  const { writeTextFile, rename } = await import('@tauri-apps/plugin-fs')
  const tmp = `${path}.${Date.now()}-${tmpSeq++}.doku-tmp`
  await writeTextFile(tmp, content)
  await rename(tmp, path)
}
