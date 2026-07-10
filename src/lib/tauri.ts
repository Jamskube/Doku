import { joinPath, type FsEntry } from './explorer'
import { parseStamp, selectPurgeable, snapshotPreview, snapshotStamp, type SnapshotEntry, type SnapshotInfo } from './snapshot'

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

// --- SnapshotService (FR-12, ADR-0003) ---
// Historique local dans %APPDATA%\<app>\snapshots\<key>\ : un fichier daté par
// version + meta.json (index avec aperçus). Toute la logique de sélection/datation
// est pure et testée (snapshot.ts) ; ici uniquement l'I/O plugin-fs.

interface SnapshotMeta {
  path: string
  entries: { name: string; preview: string; size: number }[]
}

// Sérialise les opérations d'une même clé : évite la course meta.json (lost update)
// et purge-pendant-écriture entre deux saves rapprochés du même fichier.
const snapshotQueues = new Map<string, Promise<unknown>>()
function enqueueSnapshot<T>(key: string, op: () => Promise<T>): Promise<T> {
  const prev = snapshotQueues.get(key) ?? Promise.resolve()
  const next = prev.then(op, op) // op s'exécute quel que soit le sort du précédent
  snapshotQueues.set(key, next.catch(() => {}))
  return next
}

// Réconcilie l'index avec le disque puis purge (garde 20 / 30 j + le plus récent,
// et jamais `protect`). Source de vérité = les fichiers datables réellement présents
// (readDir) : un orphelin (crash entre l'écriture du snapshot et celle de l'index)
// finit toujours par être purgé et meta.json se resynchronise. Suppression confinée
// au dossier — seuls des noms validés par parseStamp (jamais meta.json ni un .tmp).
async function reconcilePurge(
  dir: string,
  origPath: string,
  now: number,
  prevEntries: SnapshotMeta['entries'],
  protect?: string,
): Promise<SnapshotMeta> {
  const { join } = await import('@tauri-apps/api/path')
  const { readDir, remove } = await import('@tauri-apps/plugin-fs')
  let names: string[] = []
  try {
    names = (await readDir(dir)).filter((e) => e.isFile).map((e) => e.name)
  } catch {
    // dossier absent : rien à réconcilier
  }
  const dated: SnapshotEntry[] = names
    .map((name) => ({ name, time: parseStamp(name)?.getTime() ?? NaN }))
    .filter((e) => !Number.isNaN(e.time))
  const doomed = new Set(selectPurgeable(dated, now))
  if (protect) doomed.delete(protect) // la version qu'on vient d'écrire survit toujours
  for (const dead of doomed) {
    try {
      await remove(await join(dir, dead))
    } catch {
      // déjà absent : on continue
    }
  }
  const kept = new Map(prevEntries.map((e) => [e.name, e]))
  const entries = dated
    .filter((e) => !doomed.has(e.name))
    .map((e) => kept.get(e.name) ?? { name: e.name, preview: '', size: 0 }) // orphelin : sans aperçu
  return { path: origPath, entries }
}

// Enregistre une version (contenu venant d'être sauvé) puis purge (20 / 30 j, le
// plus récent intouchable). Copie confinée à snapshots/<key>/ ; ne touche jamais le
// fichier utilisateur. No-op navigateur.
export async function recordSnapshot(key: string, content: string, origPath: string, now: number): Promise<void> {
  if (!isTauri) return
  await enqueueSnapshot(key, async () => {
    const { appDataDir, join } = await import('@tauri-apps/api/path')
    const { mkdir, exists, readTextFile, writeTextFile } = await import('@tauri-apps/plugin-fs')
    const dir = await join(await appDataDir(), 'snapshots', key)
    await mkdir(dir, { recursive: true })
    const metaPath = await join(dir, 'meta.json')

    let prev: SnapshotMeta['entries'] = []
    try {
      const parsed = JSON.parse(await readTextFile(metaPath))
      if (parsed && Array.isArray(parsed.entries)) prev = parsed.entries
    } catch {
      // pas d'index encore : la réconciliation le reconstruira depuis le disque
    }

    const ext = /\.[^.\\/]+$/.exec(origPath)?.[0] ?? '.txt'
    const stamp = snapshotStamp(new Date(now))
    let name = `${stamp}${ext}`
    let seq = 1
    // Unicité même à la milliseconde (saves concurrents) — cf. tmpSeq atomique.
    while (prev.some((e) => e.name === name) || (await exists(await join(dir, name)))) {
      name = `${stamp}~${seq++}${ext}`
    }
    await writeTextFile(await join(dir, name), content)
    prev = [...prev, { name, preview: snapshotPreview(content), size: content.length }]

    // Réconcilie + purge (protège la version qu'on vient d'écrire), puis index atomique.
    const meta = await reconcilePurge(dir, origPath, now, prev, name)
    await writeTextFileAtomic(metaPath, JSON.stringify(meta))
  })
}

// Liste les versions d'un fichier (depuis meta.json, aucune relecture des fichiers
// snapshot). Trié du plus récent au plus ancien. [] si aucun historique.
export async function listSnapshots(key: string): Promise<SnapshotInfo[]> {
  if (!isTauri) return []
  return enqueueSnapshot(key, async () => {
    const { appDataDir, join } = await import('@tauri-apps/api/path')
    const { readTextFile } = await import('@tauri-apps/plugin-fs')
    const metaPath = await join(await appDataDir(), 'snapshots', key, 'meta.json')
    let meta: SnapshotMeta
    try {
      meta = JSON.parse(await readTextFile(metaPath))
    } catch {
      return []
    }
    if (!meta || !Array.isArray(meta.entries)) return []
    return meta.entries
      .map((e) => ({ name: e.name, preview: e.preview ?? '', time: parseStamp(e.name)?.getTime() ?? NaN }))
      .filter((e) => !Number.isNaN(e.time))
      .sort((a, b) => b.time - a.time)
  })
}

// Lit le contenu d'une version (restauration, 7.3). Garde parseStamp : ne lit qu'un
// nom de snapshot datable (jamais meta.json ni un chemin détourné). null si absente.
export async function readSnapshot(key: string, name: string): Promise<string | null> {
  if (!isTauri) return null
  if (!parseStamp(name)) return null
  const { appDataDir, join } = await import('@tauri-apps/api/path')
  const { readTextFile } = await import('@tauri-apps/plugin-fs')
  try {
    return await readTextFile(await join(await appDataDir(), 'snapshots', key, name))
  } catch {
    return null
  }
}

// Purge un dossier snapshot (démarrage) : réconcilie l'index avec le disque et purge.
// Fonctionne même sans meta.json (le reconstruit depuis les fichiers présents).
// Suppression confinée à snapshots/<key>/.
async function purgeSnapshotKey(key: string, now: number): Promise<void> {
  await enqueueSnapshot(key, async () => {
    const { appDataDir, join } = await import('@tauri-apps/api/path')
    const { readTextFile } = await import('@tauri-apps/plugin-fs')
    const dir = await join(await appDataDir(), 'snapshots', key)
    const metaPath = await join(dir, 'meta.json')
    let prev: SnapshotMeta['entries'] = []
    let origPath = ''
    try {
      const parsed = JSON.parse(await readTextFile(metaPath))
      if (parsed && Array.isArray(parsed.entries)) prev = parsed.entries
      if (parsed && typeof parsed.path === 'string') origPath = parsed.path // informatif (rattachement futur)
    } catch {
      // pas d'index : on réconcilie quand même depuis le disque
    }
    const meta = await reconcilePurge(dir, origPath, now, prev)
    // N'écrire que si l'index a bougé (purge ou orphelin réintégré).
    const prevNames = new Set(prev.map((e) => e.name))
    const changed = meta.entries.length !== prev.length || meta.entries.some((e) => !prevNames.has(e.name))
    if (changed) await writeTextFileAtomic(metaPath, JSON.stringify(meta))
  })
}

// Purge tous les dossiers snapshots au démarrage (ADR-0003). No-op navigateur.
export async function purgeAllSnapshots(now: number): Promise<void> {
  if (!isTauri) return
  const { appDataDir, join } = await import('@tauri-apps/api/path')
  const { exists, readDir } = await import('@tauri-apps/plugin-fs')
  const root = await join(await appDataDir(), 'snapshots')
  if (!(await exists(root))) return
  let dirs: FsEntry[]
  try {
    const raw = await readDir(root)
    dirs = raw.map((e) => ({ name: e.name, isDir: e.isDirectory }))
  } catch {
    return
  }
  for (const d of dirs) {
    if (d.isDir) await purgeSnapshotKey(d.name, now)
  }
}
