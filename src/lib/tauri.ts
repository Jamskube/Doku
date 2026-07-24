import { detectUnsupported } from './encoding'
import { isSupportedFile, joinPath, type FsEntry } from './explorer'
import { bytesToDataUrl, mimeFromExt } from './export/img-data'
import { nextFreeName } from './paste-image'
import { makeSearchDoc, type SearchDoc } from './search'
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

// Plafond d'indexation de la recherche : au-delà, on tronque en le signalant
// (jamais de cap silencieux — règle AGENTS.md). ~5000 notes couvrent largement
// l'usage perso ciblé (~10²-10³ fichiers, PRD-v1.5).
const SEARCH_FILE_CAP = 5000

// Concurrence de lecture bornée : ~1000 lectures IPC simultanées saturent la file
// et le pic mémoire sur la cible ARM (tablette). On lit par lots.
const SEARCH_READ_BATCH = 64

export interface FolderTextFile {
  path: string
  name: string
  content: string
}

// Lit tous les fichiers texte d'un dossier : scan récursif borné, formats supportés
// seulement (.pdf exclu : binaire), lecture par lots, binaires/UTF-8 invalide ignorés.
// Partagé par l'index de recherche (9.2) et l'index d'embeddings (15.2). `total` = nb
// de candidats AVANT cap ; `capped` = nb ÉCARTÉS par le plafond (à distinguer des
// illisibles, omis en silence comme dans l'index de recherche) : l'appelant signale un
// éventuel index partiel (jamais de cap silencieux — règle AGENTS.md). Vide en navigateur.
export async function readFolderTexts(
  dir: string,
  maxDepth = 4,
): Promise<{ files: FolderTextFile[]; total: number; capped: number }> {
  if (!isTauri) return { files: [], total: 0, capped: 0 }
  const { readTextFile } = await import('@tauri-apps/plugin-fs')
  const all = (await scanFiles(dir, maxDepth)).filter((f) => isSupportedFile(f.name) && !/\.pdf$/i.test(f.name))
  const capped = all.slice(0, SEARCH_FILE_CAP)
  const readOne = async (f: { path: string; name: string }): Promise<FolderTextFile | null> => {
    try {
      const content = await readTextFile(f.path)
      if (detectUnsupported(content, f.name)) return null // binaire / non-UTF-8 permissif
      return { path: f.path, name: f.name, content }
    } catch {
      return null // readTextFile lève sur UTF-8 invalide / illisible : on ignore
    }
  }
  const out: FolderTextFile[] = []
  for (let i = 0; i < capped.length; i += SEARCH_READ_BATCH) {
    const batch = await Promise.all(capped.slice(i, i + SEARCH_READ_BATCH).map(readOne))
    for (const d of batch) if (d) out.push(d)
  }
  return { files: out, total: all.length, capped: Math.max(0, all.length - SEARCH_FILE_CAP) }
}

// Construit l'index de recherche d'un dossier (ADR-0007). Coût one-time, hors budget
// par-recherche. [] en mode navigateur.
export async function buildSearchIndex(dir: string, maxDepth = 4): Promise<SearchDoc[]> {
  const { files, total } = await readFolderTexts(dir, maxDepth)
  if (total > SEARCH_FILE_CAP) {
    console.warn(`Recherche : ${total} fichiers, indexation limitée aux ${SEARCH_FILE_CAP} premiers.`)
  }
  return files.map((f) => makeSearchDoc(f.path, f.name, f.content))
}

// Lit le contenu texte d'un fichier (natif). null en mode navigateur.
export async function readTextFileAt(path: string): Promise<string | null> {
  if (!isTauri) return null
  const { readTextFile } = await import('@tauri-apps/plugin-fs')
  return readTextFile(path)
}

// Lit les octets d'un fichier (natif) — lecture PDF (11.1). null en navigateur ou si illisible.
// Requiert fs:allow-read-file (déjà déclarée, 10.3).
export async function readFileBytes(path: string): Promise<Uint8Array | null> {
  if (!isTauri) return null
  try {
    const { readFile } = await import('@tauri-apps/plugin-fs')
    return await readFile(path)
  } catch {
    return null
  }
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
    filters: [{ name: 'Documents', extensions: ['md', 'markdown', 'txt', 'html', 'htm', 'pdf'] }],
  })
  if (typeof path !== 'string') return null
  const name = path.split(/[\\/]/).pop() ?? path
  // PDF : binaire lecture seule (11.1) — ne pas lire en texte ; content='' est ouvert en kind pdf.
  if (/\.pdf$/i.test(path)) return { path, name, content: '' }
  const { readTextFile } = await import('@tauri-apps/plugin-fs')
  const content = await readTextFile(path)
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

// Jumeau binaire de writeTextFileAtomic (tmp + rename) : écrire un .docx directement
// via writeFile corromprait un fichier existant en cas d'interruption.
export async function writeFileAtomic(path: string, bytes: Uint8Array) {
  if (!isTauri) return
  const { writeFile, rename } = await import('@tauri-apps/plugin-fs')
  const tmp = `${path}.${Date.now()}-${tmpSeq++}.doku-tmp`
  await writeFile(tmp, bytes)
  await rename(tmp, path)
}

// --- Index d'embeddings RAG (15.2, ADR-0015) ---
// %APPDATA%\<app>\rag\<clé>\ : vectors.bin (matrice Float32 brute) + meta.json.
// Chaque fichier est écrit atomiquement (tmp + rename) ; l'appariement du COUPLE est
// garanti par le checksum du bin stocké dans meta.json (vérifié au chargement).
// NB confidentialité : meta.json contient les textes des passages indexés — copie
// locale sous %APPDATA%, comme les snapshots (ADR-0003) ; « Supprimer l'index » purge tout.

async function ragDirPath(key: string): Promise<string> {
  const { appDataDir, join } = await import('@tauri-apps/api/path')
  return join(await appDataDir(), 'rag', key)
}

// Lit le couple persisté. null si absent/illisible (l'appelant ré-indexe).
export async function readRagIndex(key: string): Promise<{ meta: string; bin: Uint8Array } | null> {
  if (!isTauri) return null
  try {
    const { readTextFile, readFile } = await import('@tauri-apps/plugin-fs')
    const { join } = await import('@tauri-apps/api/path')
    const dir = await ragDirPath(key)
    const meta = await readTextFile(await join(dir, 'meta.json'))
    const bin = await readFile(await join(dir, 'vectors.bin'))
    return { meta, bin }
  } catch {
    return null
  }
}

export async function writeRagIndex(key: string, bin: Uint8Array, metaJson: string): Promise<void> {
  if (!isTauri) return
  const { mkdir } = await import('@tauri-apps/plugin-fs')
  const { join } = await import('@tauri-apps/api/path')
  const dir = await ragDirPath(key)
  await mkdir(dir, { recursive: true })
  // bin d'abord, meta ensuite : meta décrit (checksum) un bin qui existe déjà. Un crash
  // entre les deux laisse l'ANCIEN meta + le nouveau bin → checksum ≠ → ré-index complet.
  await writeFileAtomic(await join(dir, 'vectors.bin'), bin)
  await writeTextFileAtomic(await join(dir, 'meta.json'), metaJson)
}

// Supprime l'index d'un dossier (bouton « Supprimer l'index »). Silencieux si absent.
export async function removeRagIndexDir(key: string): Promise<void> {
  if (!isTauri) return
  try {
    const { remove } = await import('@tauri-apps/plugin-fs')
    await remove(await ragDirPath(key), { recursive: true })
  } catch {
    // index absent ou verrouillé : rien à faire
  }
}

// Purge les .doku-tmp orphelins d'un crash (interruption entre write et rename).
export async function sweepRagTmp(key: string): Promise<void> {
  if (!isTauri) return
  try {
    const { readDir, remove } = await import('@tauri-apps/plugin-fs')
    const { join } = await import('@tauri-apps/api/path')
    const dir = await ragDirPath(key)
    for (const e of await readDir(dir)) {
      if (!e.isDirectory && e.name.endsWith('.doku-tmp')) await remove(await join(dir, e.name))
    }
  } catch {
    // dossier inexistant (premier index) : rien à balayer
  }
}

// Écrit une image collée à côté du document (12.1). Nom unique JAMAIS écrasant : le
// suffixe ~seq s'incrémente tant qu'un fichier existe. Toutes les écritures d'images
// sont SÉRIALISÉES (chaîne de promesses) : deux collages dans la même seconde ne peuvent
// pas voir le même nom libre puis se réécrire l'un sur l'autre (rename remplace la cible
// sur Windows) — le 2e voit le fichier du 1er et prend ~1. Renvoie le nom de fichier
// relatif à insérer, ou null (navigateur). Requiert fs:allow-exists + fs:allow-write-file.
let imageWriteChain: Promise<unknown> = Promise.resolve()

export function writePastedImage(dir: string, bytes: Uint8Array, stamp: string, ext: string): Promise<string | null> {
  if (!isTauri) return Promise.resolve(null)
  const run = async (): Promise<string | null> => {
    const { join } = await import('@tauri-apps/api/path')
    const { exists } = await import('@tauri-apps/plugin-fs')
    const name = await nextFreeName(stamp, ext, async (n) => exists(await join(dir, n)))
    await writeFileAtomic(await join(dir, name), bytes)
    return name
  }
  const p = imageWriteChain.then(run, run)
  imageWriteChain = p.catch(() => {})
  return p
}

// --- Export HTML autonome (FR-2, 10.3) ---

// Lit un fichier image (octets) et l'encode en data: URI. null en navigateur ou si
// illisible (l'appelant omet alors l'image). Requiert la permission fs:allow-read-file.
export async function readImageDataUrl(absPath: string): Promise<string | null> {
  if (!isTauri) return null
  try {
    const { readFile } = await import('@tauri-apps/plugin-fs')
    const bytes = await readFile(absPath)
    return bytesToDataUrl(bytes, mimeFromExt(absPath))
  } catch {
    return null
  }
}

// Dialogue « Enregistrer sous » puis écriture atomique. false si annulé ou en navigateur.
export async function saveHtmlDialog(defaultName: string, html: string): Promise<boolean> {
  if (!isTauri) return false
  const { save } = await import('@tauri-apps/plugin-dialog')
  const path = await save({ defaultPath: defaultName, filters: [{ name: 'HTML', extensions: ['html'] }] })
  if (typeof path !== 'string') return false
  await writeTextFileAtomic(path, html)
  return true
}

// Dialogue save + écriture BINAIRE d'un .docx. Requiert la permission fs:allow-write-file.
// false si annulé ou en navigateur.
export async function saveDocxDialog(defaultName: string, bytes: Uint8Array): Promise<boolean> {
  if (!isTauri) return false
  const { save } = await import('@tauri-apps/plugin-dialog')
  const path = await save({ defaultPath: defaultName, filters: [{ name: 'Word', extensions: ['docx'] }] })
  if (typeof path !== 'string') return false
  await writeFileAtomic(path, bytes)
  return true
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
