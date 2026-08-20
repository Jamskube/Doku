import { OPENABLE_EXTENSIONS, isBinaryDocumentName } from './doc-kind'
import { detectUnsupported } from './encoding'
import { isSupportedFile, type FsEntry } from './explorer'
import { baseName, joinPath } from './paths'
import { canonicalPathKey } from './save-as'
import { bytesToDataUrl, mimeFromExt } from './export/img-data'
import { nextFreeName } from './paste-image'
import { makeSearchDoc, type SearchDoc } from './search'
import { parseStamp, selectPurgeable, snapshotPreview, snapshotStamp, type SnapshotEntry, type SnapshotInfo } from './snapshot'

// Garde Tauri : toutes les APIs natives passent ici, avec repli silencieux en
// mode navigateur (dev UI). ADR-0004 : plugins officiels uniquement, écriture
// atomique composée côté TS (tmp + rename).
export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

let systemBackdropTheme: 'light' | 'dark' | null = null
let systemBackdropPromise: Promise<boolean> | null = null
let systemBackdropRevision = 0

// Active le vrai matériau Mica Windows 11 uniquement en thème sombre. En clair,
// l'effet natif est retiré et le chrome CSS historique redevient opaque.
export function syncSystemBackdrop(theme: 'light' | 'dark'): Promise<boolean> {
  if (!isTauri) return Promise.resolve(false)
  if (systemBackdropTheme === theme && systemBackdropPromise) return systemBackdropPromise

  const revision = ++systemBackdropRevision
  systemBackdropTheme = theme
  systemBackdropPromise = import('@tauri-apps/api/core')
    .then(({ invoke }) => invoke<boolean>('set_system_backdrop', {
      enabled: theme === 'dark',
      dark: theme === 'dark',
    }))
    .then((enabled) => {
      if (revision === systemBackdropRevision) {
        document.documentElement.dataset.windowBackdrop = enabled ? 'mica' : 'fallback'
      }
      return enabled
    })
    .catch((error) => {
      if (revision === systemBackdropRevision) {
        document.documentElement.dataset.windowBackdrop = 'fallback'
        systemBackdropTheme = null
        systemBackdropPromise = null
      }
      throw error
    })
  return systemBackdropPromise
}

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
// `withTimes` déclenche un stat par entrée : réservé au tri « Modifié le », car sur un
// gros dossier c'est N appels IPC (batché ci-dessous pour ne pas saturer le pont ARM).
export async function readDirectory(path: string, withTimes = false): Promise<FsEntry[]> {
  if (!isTauri) return []
  const { readDir, stat } = await import('@tauri-apps/plugin-fs')
  const entries = await readDir(path)
  const base = entries.map((e) => ({ name: e.name, isDir: e.isDirectory }))
  if (!withTimes) return base
  const out: FsEntry[] = []
  for (let i = 0; i < base.length; i += SEARCH_READ_BATCH) {
    const batch = await Promise.all(
      base.slice(i, i + SEARCH_READ_BATCH).map(async (e) => {
        try {
          const info = await stat(joinPath(path, e.name))
          return { ...e, mtime: info.mtime?.getTime() }
        } catch {
          return e // illisible : pas de date, sortEntries la reléguera en fin de liste
        }
      }),
    )
    out.push(...batch)
  }
  return out
}

// Crée un fichier vide. Renvoie false si le chemin est déjà pris — on ne rappelle
// JAMAIS writeTextFile sur un chemin existant : ça écraserait le fichier sans un mot.
export async function createFileAt(path: string): Promise<boolean> {
  if (!isTauri) return false
  const { writeTextFile, exists } = await import('@tauri-apps/plugin-fs')
  if (await exists(path)) return false
  await writeTextFile(path, '')
  return true
}

// Variante avec contenu (note générée par Doku-San) : `createNew` fait échouer l'écriture
// si le nom est pris — garde ATOMIQUE côté OS (pas de fenêtre exists→write), false et
// l'appelant réessaie avec un suffixe. Jamais d'écrasement silencieux.
export async function createFileWithContent(path: string, content: string): Promise<boolean> {
  if (!isTauri) return false
  const { writeTextFile } = await import('@tauri-apps/plugin-fs')
  try {
    await writeTextFile(path, content, { createNew: true })
    return true
  } catch {
    return false
  }
}

// Crée un dossier. Même garde : mkdir sur un dossier existant lève, on préfère
// répondre false et laisser l'appelant afficher « ce nom existe déjà ».
export async function createDirAt(path: string): Promise<boolean> {
  if (!isTauri) return false
  const { mkdir, exists } = await import('@tauri-apps/plugin-fs')
  if (await exists(path)) return false
  await mkdir(path)
  return true
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
  // `.pdf` et `.docx` sont binaires : les lire en texte rendrait du bruit (ou lèverait),
  // et surtout ferait charger tout le fichier pour rien.
  const all = (await scanFiles(dir, maxDepth)).filter((f) => isSupportedFile(f.name) && !/\.(pdf|docx)$/i.test(f.name))
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

export interface FolderPdfFile {
  path: string
  name: string
  // Signature de changement bon marché (taille:mtime via stat, PAS d'extraction) : le diff
  // incrémental de l'index (15.2) saute un PDF inchangé SANS le ré-extraire. Limite assumée :
  // une réédition qui préserve taille ET mtime (restore backup, git checkout) est ratée —
  // stat reste le compromis coût/justesse voulu (hacher les octets lirait tout le fichier).
  sig: string
}

// Scan UNIQUE d'un dossier pour l'index d'embeddings (15.2 + 18.3) : partitionne en fichiers
// texte (lus) et PDF (stat seul, extraction déléguée à l'appelant, à la demande dans sa boucle
// à progression). Un seul balayage récursif (≠ deux passes). Budget de fichiers PARTAGÉ
// (SEARCH_FILE_CAP sur l'ensemble texte+PDF). Vide en mode navigateur.
export async function readFolderForRag(
  dir: string,
  maxDepth = 4,
): Promise<{ textFiles: FolderTextFile[]; pdfFiles: FolderPdfFile[]; capped: number }> {
  if (!isTauri) return { textFiles: [], pdfFiles: [], capped: 0 }
  const { readTextFile, stat } = await import('@tauri-apps/plugin-fs')
  const all = (await scanFiles(dir, maxDepth)).filter((f) => isSupportedFile(f.name))
  const kept = all.slice(0, SEARCH_FILE_CAP)
  const isPdf = (name: string) => /\.pdf$/i.test(name)
  const pdfCandidates = kept.filter((f) => isPdf(f.name))
  const textCandidates = kept.filter((f) => !isPdf(f.name))
  const readOne = async (f: { path: string; name: string }): Promise<FolderTextFile | null> => {
    try {
      const content = await readTextFile(f.path)
      if (detectUnsupported(content, f.name)) return null
      return { path: f.path, name: f.name, content }
    } catch {
      return null
    }
  }
  const textFiles: FolderTextFile[] = []
  for (let i = 0; i < textCandidates.length; i += SEARCH_READ_BATCH) {
    const batch = await Promise.all(textCandidates.slice(i, i + SEARCH_READ_BATCH).map(readOne))
    for (const d of batch) if (d) textFiles.push(d)
  }
  const statOne = async (f: { path: string; name: string }): Promise<FolderPdfFile | null> => {
    try {
      const info = await stat(f.path)
      return { path: f.path, name: f.name, sig: `${info.size}:${info.mtime?.getTime() ?? 0}` }
    } catch {
      return null // illisible : ignoré (comme un fichier texte illisible)
    }
  }
  const pdfFiles: FolderPdfFile[] = []
  for (let i = 0; i < pdfCandidates.length; i += SEARCH_READ_BATCH) {
    const batch = await Promise.all(pdfCandidates.slice(i, i + SEARCH_READ_BATCH).map(statOne))
    for (const d of batch) if (d) pdfFiles.push(d)
  }
  return { textFiles, pdfFiles, capped: Math.max(0, all.length - SEARCH_FILE_CAP) }
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
    filters: [{ name: 'Documents', extensions: OPENABLE_EXTENSIONS }],
  })
  if (typeof path !== 'string') return null
  const name = baseName(path)
  // Document BINAIRE (PDF, DOCX) : ne jamais le lire en texte — `readTextFile` rendrait
  // du charabia que `detectUnsupported` rejetterait ensuite en « format non pris en
  // charge ». Le test portait sur le seul `.pdf` : le DOCX, arrivé plus tard, tombait
  // donc dans la lecture texte. La question est posée UNE fois, dans `doc-kind.ts`.
  if (isBinaryDocumentName(name)) return { path, name, content: '' }
  const { readTextFile } = await import('@tauri-apps/plugin-fs')
  const content = await readTextFile(path)
  return { path, name, content }
}

export async function saveTextDialog(defaultName: string, kind: 'md' | 'txt' | 'html'): Promise<string | null> {
  if (!isTauri) return null
  const { save } = await import('@tauri-apps/plugin-dialog')
  const filters =
    kind === 'md'
      ? [{ name: 'Markdown', extensions: ['md', 'markdown'] }]
      : kind === 'txt'
        ? [{ name: 'Texte', extensions: ['txt'] }]
        : [{ name: 'HTML', extensions: ['html', 'htm'] }]
  return save({
    title: 'Enregistrer le document',
    defaultPath: defaultName,
    filters,
  })
}

export async function pathExistsAt(path: string): Promise<boolean> {
  if (!isTauri) return false
  const { exists } = await import('@tauri-apps/plugin-fs')
  return exists(path)
}

export async function confirmReplacePath(path: string): Promise<boolean> {
  if (!isTauri) return false
  const { confirm } = await import('@tauri-apps/plugin-dialog')
  const name = baseName(path)
  return confirm(`« ${name} » existe déjà. Voulez-vous le remplacer ?`, {
    title: 'Remplacer le fichier ?',
    kind: 'warning',
    okLabel: 'Remplacer',
    cancelLabel: 'Annuler',
  })
}

export async function openContextFilesDialog(): Promise<string[]> {
  if (!isTauri) return []
  const { open } = await import('@tauri-apps/plugin-dialog')
  const paths = await open({
    multiple: true,
    filters: [{ name: 'Documents', extensions: ['md', 'markdown', 'txt', 'html', 'htm', 'pdf', 'docx'] }],
  })
  if (!paths) return []
  return Array.isArray(paths) ? paths : [paths]
}

export async function fileSizeAt(path: string): Promise<number | null> {
  if (!isTauri) return null
  try {
    const { stat } = await import('@tauri-apps/plugin-fs')
    return (await stat(path)).size
  } catch {
    return null
  }
}

export async function openFolderDialog(defaultPath?: string | null): Promise<string | null> {
  if (!isTauri) return null
  const { open } = await import('@tauri-apps/plugin-dialog')
  const path = await open({
    directory: true,
    multiple: false,
    recursive: true,
    defaultPath: defaultPath ?? undefined,
  })
  return typeof path === 'string' ? path : null
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

function validPdfAnnotationKey(key: string): boolean {
  return /^[a-f0-9]{64}$/.test(key)
}

export async function readPdfAnnotationManifest(key: string): Promise<string | null> {
  if (!validPdfAnnotationKey(key)) return null
  if (!isTauri) return globalThis.localStorage?.getItem(`doku:pdf-annotations:${key}`) ?? null
  try {
    const { appDataDir, join } = await import('@tauri-apps/api/path')
    const { readTextFile } = await import('@tauri-apps/plugin-fs')
    return await readTextFile(await join(await appDataDir(), 'annotations', key, 'manifest.json'))
  } catch {
    return null
  }
}

// Met de côté un carnet illisible (JSON cassé, ou écrit par une version postérieure)
// AVANT que Doku n'écrive par-dessus. Rien n'est jamais détruit : le fichier est
// simplement renommé, l'utilisateur peut le récupérer.
export async function keepPdfAnnotationManifestAside(key: string, stamp: string): Promise<string | null> {
  if (!validPdfAnnotationKey(key)) return null
  if (!isTauri) {
    const from = `doku:pdf-annotations:${key}`
    const kept = globalThis.localStorage?.getItem(from)
    if (kept === null || kept === undefined) return null
    globalThis.localStorage?.setItem(`${from}:illisible:${stamp}`, kept)
    return `${from}:illisible:${stamp}`
  }
  try {
    const { appDataDir, join } = await import('@tauri-apps/api/path')
    const { rename } = await import('@tauri-apps/plugin-fs')
    const dir = await join(await appDataDir(), 'annotations', key)
    const kept = await join(dir, `manifest.illisible-${stamp}.json`)
    await rename(await join(dir, 'manifest.json'), kept)
    return kept
  } catch {
    return null
  }
}

export async function writePdfAnnotationManifest(key: string, content: string): Promise<void> {
  if (!validPdfAnnotationKey(key)) throw new Error('Identifiant d’annotations PDF invalide.')
  if (!isTauri) {
    globalThis.localStorage?.setItem(`doku:pdf-annotations:${key}`, content)
    return
  }
  const { appDataDir, join } = await import('@tauri-apps/api/path')
  const { mkdir } = await import('@tauri-apps/plugin-fs')
  const dir = await join(await appDataDir(), 'annotations', key)
  await mkdir(dir, { recursive: true })
  await writeTextFileAtomic(await join(dir, 'manifest.json'), content)
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

// --- Discussions durables Doku-San -----------------------------------------------
// Le fichier <uuid>.json est canonique ; index.json est une projection reconstruite.
// Aucun titre ni chemin utilisateur ne devient un segment de chemin.

const CONVERSATION_STORAGE_PREFIX = 'doku:conversation:'

function validConversationId(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
}

async function conversationDir(): Promise<string> {
  const { appDataDir, join } = await import('@tauri-apps/api/path')
  return join(await appDataDir(), 'conversations')
}

export async function listConversationFiles(): Promise<{ id: string; content: string }[]> {
  if (!isTauri) {
    const out: { id: string; content: string }[] = []
    for (let i = 0; i < (globalThis.localStorage?.length ?? 0); i++) {
      const key = globalThis.localStorage?.key(i)
      if (!key?.startsWith(CONVERSATION_STORAGE_PREFIX)) continue
      const id = key.slice(CONVERSATION_STORAGE_PREFIX.length)
      if (!validConversationId(id)) continue
      const content = globalThis.localStorage?.getItem(key)
      if (content != null) out.push({ id, content })
    }
    return out
  }
  try {
    const { readDir, readTextFile, remove } = await import('@tauri-apps/plugin-fs')
    const { join } = await import('@tauri-apps/api/path')
    const dir = await conversationDir()
    const out: { id: string; content: string }[] = []
    for (const entry of await readDir(dir)) {
      if (entry.isDirectory) continue
      if (entry.name.endsWith('.doku-tmp')) {
        try { await remove(await join(dir, entry.name)) } catch { /* nettoyé au prochain boot */ }
        continue
      }
      const match = /^([0-9a-f-]{36})\.json$/i.exec(entry.name)
      if (!match || !validConversationId(match[1])) continue
      try { out.push({ id: match[1], content: await readTextFile(await join(dir, entry.name)) }) } catch { /* isolé */ }
    }
    return out
  } catch {
    return []
  }
}

export async function readConversationFile(id: string): Promise<string | null> {
  if (!validConversationId(id)) return null
  if (!isTauri) return globalThis.localStorage?.getItem(`${CONVERSATION_STORAGE_PREFIX}${id}`) ?? null
  try {
    const { readTextFile } = await import('@tauri-apps/plugin-fs')
    const { join } = await import('@tauri-apps/api/path')
    return await readTextFile(await join(await conversationDir(), `${id}.json`))
  } catch {
    return null
  }
}

export async function writeConversationFile(id: string, content: string): Promise<void> {
  if (!validConversationId(id)) throw new Error('Identifiant de discussion invalide.')
  if (!isTauri) {
    globalThis.localStorage?.setItem(`${CONVERSATION_STORAGE_PREFIX}${id}`, content)
    return
  }
  const { mkdir } = await import('@tauri-apps/plugin-fs')
  const { join } = await import('@tauri-apps/api/path')
  const dir = await conversationDir()
  await mkdir(dir, { recursive: true })
  await writeTextFileAtomic(await join(dir, `${id}.json`), content)
}

export async function readConversationIndex(): Promise<string | null> {
  if (!isTauri) return globalThis.localStorage?.getItem('doku:conversation-index') ?? null
  try {
    const { readTextFile } = await import('@tauri-apps/plugin-fs')
    const { join } = await import('@tauri-apps/api/path')
    return await readTextFile(await join(await conversationDir(), 'index.json'))
  } catch {
    return null
  }
}

export async function writeConversationIndex(content: string): Promise<void> {
  if (!isTauri) {
    globalThis.localStorage?.setItem('doku:conversation-index', content)
    return
  }
  const { mkdir } = await import('@tauri-apps/plugin-fs')
  const { join } = await import('@tauri-apps/api/path')
  const dir = await conversationDir()
  await mkdir(dir, { recursive: true })
  await writeTextFileAtomic(await join(dir, 'index.json'), content)
}

export async function keepConversationFileAside(id: string, stamp: string): Promise<void> {
  if (!validConversationId(id)) return
  if (!isTauri) {
    const key = `${CONVERSATION_STORAGE_PREFIX}${id}`
    const content = globalThis.localStorage?.getItem(key)
    if (content != null) globalThis.localStorage?.setItem(`${key}:illisible:${stamp}`, content)
    globalThis.localStorage?.removeItem(key)
    return
  }
  try {
    const { rename } = await import('@tauri-apps/plugin-fs')
    const { join } = await import('@tauri-apps/api/path')
    const dir = await conversationDir()
    await rename(await join(dir, `${id}.json`), await join(dir, `${id}.illisible-${stamp}.json`))
  } catch { /* un fichier déjà absent est déjà isolé */ }
}

export async function removeConversationFile(id: string): Promise<void> {
  if (!validConversationId(id)) return
  if (!isTauri) {
    const prefix = `${CONVERSATION_STORAGE_PREFIX}${id}`
    for (const key of Object.keys(globalThis.localStorage ?? {})) if (key.startsWith(prefix)) globalThis.localStorage?.removeItem(key)
    return
  }
  try {
    const { readDir, remove } = await import('@tauri-apps/plugin-fs')
    const { join } = await import('@tauri-apps/api/path')
    const dir = await conversationDir()
    for (const entry of await readDir(dir)) {
      if (!entry.isDirectory && (entry.name === `${id}.json` || entry.name.startsWith(`${id}.illisible-`) || entry.name.startsWith(`${id}.json.`))) {
        try { await remove(await join(dir, entry.name)) } catch { /* poursuivre les artefacts */ }
      }
    }
  } catch { /* dossier absent */ }
}

export async function purgeConversationFiles(): Promise<void> {
  if (!isTauri) {
    const keys: string[] = []
    for (let i = 0; i < (globalThis.localStorage?.length ?? 0); i++) {
      const key = globalThis.localStorage?.key(i)
      if (key?.startsWith(CONVERSATION_STORAGE_PREFIX) || key === 'doku:conversation-index') keys.push(key)
    }
    for (const key of keys) globalThis.localStorage?.removeItem(key)
    return
  }
  const { readDir, remove } = await import('@tauri-apps/plugin-fs')
  const { join } = await import('@tauri-apps/api/path')
  const dir = await conversationDir()
  let entries
  try { entries = await readDir(dir) } catch { return }
  const isConversationArtifact = (name: string) => name === 'index.json'
    || /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?:\.json|\.illisible-[A-Za-z0-9-]+\.json|\.json\..+\.doku-tmp)$/i.test(name)
  const failures: string[] = []
  for (const entry of entries) {
    if (entry.isDirectory || !isConversationArtifact(entry.name)) continue
    try { await remove(await join(dir, entry.name)) } catch { failures.push(entry.name) }
  }
  if (failures.length) throw new Error(`Suppression incomplète : ${failures.length} fichier(s) verrouillé(s).`)
  const remaining = (await readDir(dir)).filter((entry) => !entry.isDirectory && isConversationArtifact(entry.name))
  if (remaining.length) throw new Error('Suppression incomplète : des discussions sont encore présentes sur le disque.')
}

export async function confirmAction(title: string, message: string): Promise<boolean> {
  if (!isTauri) return globalThis.confirm?.(`${title}\n\n${message}`) ?? false
  const { confirm } = await import('@tauri-apps/plugin-dialog')
  return confirm(message, { title, kind: 'warning', okLabel: 'Confirmer', cancelLabel: 'Annuler' })
}

// --- Mémoire durable du copilote cloud -----------------------------------------------
// %APPDATA%\<app>\memory\<sha1-dossier>\ : un fichier Markdown par souvenir,
// MEMORY.md comme index lisible, undo.json comme unique point de retour. Les clés et noms
// sont validés ici : aucun texte produit par un modèle ne devient un segment de chemin libre.

function validMemoryKey(key: string): boolean {
  return /^[a-f0-9]{40}$/.test(key)
}

function validMemoryFile(name: string): boolean {
  return /^(?:MEMORY|[a-z0-9][a-z0-9-]{0,79})\.md$/.test(name)
}

async function memoryWorkspaceDir(key: string): Promise<string> {
  if (!validMemoryKey(key)) throw new Error('Identifiant de mémoire invalide.')
  const { appDataDir, join } = await import('@tauri-apps/api/path')
  return join(await appDataDir(), 'memory', key)
}

export async function readMemoryMarkdownFiles(key: string): Promise<{ name: string; content: string }[]> {
  if (!isTauri || !validMemoryKey(key)) return []
  try {
    const { readDir, readTextFile } = await import('@tauri-apps/plugin-fs')
    const { join } = await import('@tauri-apps/api/path')
    const dir = await memoryWorkspaceDir(key)
    const memoriesDir = await join(dir, 'memories')
    const out: { name: string; content: string }[] = []
    for (const entry of await readDir(memoriesDir)) {
      if (entry.isDirectory || !validMemoryFile(entry.name) || entry.name === 'MEMORY.md') continue
      try {
        out.push({ name: entry.name, content: await readTextFile(await join(memoriesDir, entry.name)) })
      } catch {
        // Un souvenir illisible n'empêche pas les autres de se charger.
      }
    }
    return out
  } catch {
    return []
  }
}

export async function writeMemoryMarkdownFile(key: string, name: string, content: string): Promise<void> {
  if (!isTauri) return
  if (!validMemoryKey(key) || !validMemoryFile(name)) throw new Error('Chemin de mémoire invalide.')
  const { mkdir } = await import('@tauri-apps/plugin-fs')
  const { join } = await import('@tauri-apps/api/path')
  const root = await memoryWorkspaceDir(key)
  const dir = name === 'MEMORY.md' ? root : await join(root, 'memories')
  await mkdir(dir, { recursive: true })
  await writeTextFileAtomic(await join(dir, name), content)
}

export async function removeMemoryMarkdownFile(key: string, name: string): Promise<void> {
  if (!isTauri || !validMemoryKey(key) || !validMemoryFile(name) || name === 'MEMORY.md') return
  try {
    const { remove } = await import('@tauri-apps/plugin-fs')
    const { join } = await import('@tauri-apps/api/path')
    await remove(await join(await memoryWorkspaceDir(key), 'memories', name))
  } catch {
    // Absent : l'état désiré est déjà atteint.
  }
}

export async function readMemoryUndo(key: string): Promise<string | null> {
  if (!isTauri || !validMemoryKey(key)) return null
  try {
    const { readTextFile } = await import('@tauri-apps/plugin-fs')
    const { join } = await import('@tauri-apps/api/path')
    return await readTextFile(await join(await memoryWorkspaceDir(key), 'undo.json'))
  } catch {
    return null
  }
}

export async function writeMemoryUndo(key: string, content: string): Promise<void> {
  if (!isTauri || !validMemoryKey(key)) return
  const { mkdir } = await import('@tauri-apps/plugin-fs')
  const { join } = await import('@tauri-apps/api/path')
  const dir = await memoryWorkspaceDir(key)
  await mkdir(dir, { recursive: true })
  await writeTextFileAtomic(await join(dir, 'undo.json'), content)
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

// Lit meta.json seul (sans le bin) : garde légère du chat, qui REFUSE de déclencher un
// index complet (minutes) depuis une question — l'existence du fichier ne suffit pas,
// l'appelant valide aussi version + modèle (un meta d'un autre modèle d'embedding
// déclencherait exactement le ré-embed intégral qu'on interdit ici). null si absent.
export async function readRagMetaText(key: string): Promise<string | null> {
  if (!isTauri) return null
  try {
    const { readTextFile } = await import('@tauri-apps/plugin-fs')
    const { join } = await import('@tauri-apps/api/path')
    return await readTextFile(await join(await ragDirPath(key), 'meta.json'))
  } catch {
    return null
  }
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
// Purge MANUELLE et totale de l'historique : supprime tous les instantanés de tous
// les fichiers. À ne pas confondre avec purgeAllSnapshots(), qui applique seulement la
// rétention d'ADR-0003 (garde le plus récent de chaque fichier). Renvoie le nombre de
// dossiers supprimés pour que l'UI puisse dire ce qui a réellement disparu.
export async function purgeSnapshotsHard(): Promise<number> {
  if (!isTauri) return 0
  const { appDataDir, join } = await import('@tauri-apps/api/path')
  const { exists, readDir, remove } = await import('@tauri-apps/plugin-fs')
  const root = await join(await appDataDir(), 'snapshots')
  if (!(await exists(root))) return 0
  let removed = 0
  let raw
  try {
    raw = await readDir(root)
  } catch {
    return 0
  }
  // On supprime chaque dossier-clé, pas la racine « snapshots » elle-même : elle est
  // recréée à la première sauvegarde, et la capability ne couvre que son contenu.
  for (const e of raw) {
    if (!e.isDirectory) continue
    try {
      await remove(await join(root, e.name), { recursive: true })
      removed++
    } catch {
      // dossier verrouillé (fichier ouvert ailleurs) : ignoré, le compte reste honnête
    }
  }
  return removed
}

// Purge totale des index sémantiques (tous dossiers confondus). L'état mémoire est
// remis à zéro par deleteAllRagIndexes() côté rag-index — ne pas appeler ceci seul.
export async function removeRagRoot(): Promise<void> {
  if (!isTauri) return
  try {
    const { appDataDir, join } = await import('@tauri-apps/api/path')
    const { remove } = await import('@tauri-apps/plugin-fs')
    await remove(await join(await appDataDir(), 'rag'), { recursive: true })
  } catch {
    // absent ou verrouillé : rien à faire
  }
}

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
  return (await saveDocxDialogPath(defaultName, bytes)) !== null
}

// Même chose, mais rend le CHEMIN écrit : la conversion d'un PDF enchaîne dessus pour
// rouvrir le document dans Doku, ce qui referme la boucle au lieu de laisser
// l'utilisateur retrouver le fichier lui-même.
export async function saveDocxDialogPath(defaultName: string, bytes: Uint8Array): Promise<string | null> {
  if (!isTauri) return null
  const { save } = await import('@tauri-apps/plugin-dialog')
  const path = await save({ defaultPath: defaultName, filters: [{ name: 'Word', extensions: ['docx'] }] })
  if (typeof path !== 'string') return null
  await writeFileAtomic(path, bytes)
  return path
}

// Dialogue d'ouverture restreint aux PDF (insertion de pages, ADR-0022).
export async function openPdfDialog(): Promise<string | null> {
  if (!isTauri) return null
  const { open } = await import('@tauri-apps/plugin-dialog')
  const path = await open({ multiple: false, filters: [{ name: 'PDF', extensions: ['pdf'] }] })
  return typeof path === 'string' ? path : null
}

// Dialogue save + écriture BINAIRE d'un .pdf (ADR-0022 : gravure des annotations).
// TOUJOURS par dialogue, jamais d'écrasement implicite du document source — un PDF
// écrasé n'est pas récupérable, et le carnet reste la seule version éditable.
/** L'utilisateur a désigné le document d'origine comme destination de la copie. */
export class SourceOverwriteError extends Error {
  constructor() {
    super('Doku n’écrase pas le PDF d’origine. Choisissez un autre nom de fichier.')
  }
}

/**
 * Enregistre des octets PDF via le dialogue système.
 *
 * `protect` : chemin du document d'origine. L'interface promet « le document d'origine
 * n'est jamais modifié » — jusqu'ici cette promesse ne tenait qu'à ce que l'utilisateur ne
 * choisisse pas le même fichier dans le dialogue. Une promesse affichée doit être tenue par
 * le code, pas par la retenue de celui qui clique.
 */
export async function savePdfDialog(defaultName: string, bytes: Uint8Array, protect?: string): Promise<boolean> {
  if (!isTauri) return false
  const { save } = await import('@tauri-apps/plugin-dialog')
  const path = await save({ defaultPath: defaultName, filters: [{ name: 'PDF', extensions: ['pdf'] }] })
  if (typeof path !== 'string') return false
  if (protect && canonicalPathKey(path) === canonicalPathKey(protect)) {
    // Jetée plutôt que rendue : `false` signifie déjà « l'utilisateur a annulé », et
    // confondre les deux ferait disparaître la copie sans un mot. La couche plateforme ne
    // peut pas poser de bandeau elle-même (les stores dépendent d'elle, pas l'inverse).
    throw new SourceOverwriteError()
  }
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
