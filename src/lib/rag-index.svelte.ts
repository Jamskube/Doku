// Service de l'index d'embeddings du dossier (15.2, ADR-0015). Orchestration seule :
// la logique est pure (rag.ts), l'I/O vit dans tauri.ts, l'embed dans ollama.ts.
// AUCUN import de stores/copilot (pas de cycle) : l'appelant fournit port, modèle et
// dossier. Un seul refresh à la fois (chaîne de promesses, pattern enqueueSnapshot) ;
// le rescan complet n'a lieu QUE si nécessaire (index absent, dossier/modèle changé,
// flag dirty posé par une sauvegarde) — jamais systématiquement à chaque question.
import { embed } from './ollama'
import {
  bytesToMatrix,
  checksumBytes,
  chunkText,
  diffFiles,
  embedInput,
  flattenVectors,
  hashText,
  isWithinDir,
  matrixToBytes,
  noteTitle,
  parseRagMeta,
  ragDirKey,
  topK,
  normalizeVec,
  RAG_META_VERSION,
  RAG_CHUNK_TARGET,
  RAG_TOP_K,
  type RagFileEntry,
  type RagMeta,
} from './rag'
import { readFolderForRag, readRagIndex, readRagMetaText, removeRagIndexDir, sweepRagTmp, writeRagIndex } from './tauri'

// Lot d'embed (débit mesuré au spike) et cadence de checkpoint : persister toutes les
// ~10 s borne la perte à quelques secondes d'embed si l'app ferme en plein index
// initial (92 s / 1000 notes). Cadence TEMPORELLE, pas par fichier : la persistance
// réécrit tout le couple bin+meta — un pas fixe en fichiers deviendrait O(n²) d'E/S
// sur un très gros dossier.
const EMBED_BATCH = 16
const CHECKPOINT_MS = 10_000

export interface RagHit {
  path: string
  name: string
  text: string
  score: number
}

// État réactif consommé par la vue Modèles (progression, caps VISIBLES, erreurs).
export const ragState = $state({
  phase: 'idle' as 'idle' | 'indexing' | 'ready' | 'error',
  dir: null as string | null,
  // Progression du run courant (fichiers à ré-embedder).
  done: 0,
  total: 0,
  // Taille de l'index en mémoire.
  files: 0,
  chunks: 0,
  // Caps signalés (jamais silencieux) : fichiers au-delà du cap de scan / fichiers
  // dont les chunks ont été plafonnés.
  skipped: 0,
  truncated: 0,
  error: '',
  // Modèle manquant (HTTP 404 du sidecar) : l'UI propose le téléchargement.
  needsModel: '',
  canceled: false,
})

interface FileVectors {
  entry: RagFileEntry
  vecs: Float32Array[]
}

interface LoadedIndex {
  dir: string
  key: string
  model: string
  dims: number
  matrix: Float32Array
  rows: { path: string; name: string; text: string }[]
  files: Map<string, FileVectors>
}

let index: LoadedIndex | null = null
// Posé par une sauvegarde dans le dossier indexé ; effacé en DÉBUT de refresh (un save
// qui atterrit pendant un run n'est jamais perdu — il re-salira le flag).
let dirty = false
let chain: Promise<unknown> = Promise.resolve()
let abortCtl: AbortController | null = null

// Reconstruit l'index en mémoire depuis la map par-fichier (ordre déterministe : tri
// par chemin — le même que celui du bin persisté).
function rebuild(dir: string, key: string, model: string, dims: number, files: Map<string, FileVectors>): LoadedIndex {
  const sorted = [...files.values()].sort((a, b) => (a.entry.path < b.entry.path ? -1 : a.entry.path > b.entry.path ? 1 : 0))
  const rows: LoadedIndex['rows'] = []
  const vecs: Float32Array[] = []
  for (const f of sorted) {
    f.entry.chunks.forEach((text, i) => {
      rows.push({ path: f.entry.path, name: f.entry.name, text })
      vecs.push(f.vecs[i])
    })
  }
  return { dir, key, model, dims, matrix: flattenVectors(vecs, dims), rows, files }
}

async function persist(idx: LoadedIndex): Promise<void> {
  const sorted = [...idx.files.values()].sort((a, b) => (a.entry.path < b.entry.path ? -1 : a.entry.path > b.entry.path ? 1 : 0))
  const bin = matrixToBytes(idx.matrix)
  const meta: RagMeta = {
    version: RAG_META_VERSION,
    dir: idx.dir,
    model: idx.model,
    dims: idx.dims,
    chunkTarget: RAG_CHUNK_TARGET,
    checksum: await checksumBytes(bin),
    files: sorted.map((f) => f.entry),
  }
  await writeRagIndex(idx.key, bin, JSON.stringify(meta))
}

// Recharge l'index persisté. null au moindre doute (meta invalide, modèle différent,
// taille bin ≠ meta, checksum ≠) → ré-index complet : un index est un cache, jeter est sûr.
async function loadPersisted(dir: string, key: string, model: string): Promise<LoadedIndex | null> {
  const disk = await readRagIndex(key)
  if (!disk) return null
  const meta = parseRagMeta(disk.meta)
  if (!meta || meta.model !== model) return null
  const rowCount = meta.files.reduce((s, f) => s + f.chunks.length, 0)
  const matrix = bytesToMatrix(disk.bin, meta.dims, rowCount)
  if (!matrix) return null
  if ((await checksumBytes(disk.bin)) !== meta.checksum) return null
  const files = new Map<string, FileVectors>()
  const rows: LoadedIndex['rows'] = []
  let r = 0
  for (const f of meta.files) {
    const vecs = f.chunks.map((text, i) => {
      rows.push({ path: f.path, name: f.name, text })
      return matrix.subarray((r + i) * meta.dims, (r + i + 1) * meta.dims)
    })
    r += f.chunks.length
    files.set(f.path, { entry: f, vecs })
  }
  return { dir, key, model, dims: meta.dims, matrix, rows, files }
}

function publishStats(idx: LoadedIndex | null): void {
  // Ne compte que les fichiers PORTEURS de passages : les entrées à `chunks: []` (marqueurs
  // de PDF scanné/illisible, mais AUSSI notes vides) existent pour l'incrémental sans ajouter
  // de matière → les exclure du compte « N notes indexées » qui serait sinon trompeur.
  ragState.files = idx ? [...idx.files.values()].filter((f) => f.entry.chunks.length > 0).length : 0
  ragState.chunks = idx?.rows.length ?? 0
  ragState.truncated = idx ? [...idx.files.values()].filter((f) => f.entry.truncated).length : 0
}

async function doRefresh(port: number, model: string, dir: string, force: boolean): Promise<void> {
  const fresh = index !== null && index.dir === dir && index.model === model && !dirty
  if (fresh && !force) return
  dirty = false
  ragState.phase = 'indexing'
  ragState.dir = dir
  ragState.done = 0
  ragState.total = 0
  ragState.error = ''
  ragState.needsModel = ''
  ragState.canceled = false
  abortCtl = new AbortController()
  const signal = abortCtl.signal
  try {
    const key = await ragDirKey(dir)
    await sweepRagTmp(key)
    if (!index || index.dir !== dir || index.model !== model) {
      index = await loadPersisted(dir, key, model)
    }
    const scan = await readFolderForRag(dir)
    // Seuls les fichiers écartés par le PLAFOND comptent ici : les illisibles (binaire,
    // UTF-8 invalide) sont omis comme dans l'index de recherche — les confondre
    // afficherait un « au-delà du plafond » faux.
    ragState.skipped = scan.capped
    // Liste fusionnée texte + PDF. Le hash d'un PDF = sa signature stat (`pdf:${sig}`),
    // BON MARCHÉ : le diff saute un PDF inchangé sans l'extraire. Le texte du PDF n'est
    // résolu (extraction pdf.js) que pour les ajoutés/modifiés, dans la boucle ci-dessous.
    type ScanEntry = { path: string; name: string; hash: string; content?: string; isPdf: boolean }
    const hashed: ScanEntry[] = []
    for (const f of scan.textFiles) hashed.push({ path: f.path, name: f.name, content: f.content, hash: await hashText(f.content), isPdf: false })
    for (const f of scan.pdfFiles) hashed.push({ path: f.path, name: f.name, hash: `pdf:${f.sig}`, isPdf: true })
    const prev = index ? [...index.files.values()].map((f) => ({ path: f.entry.path, hash: f.entry.hash })) : []
    const { added, changed, removed } = diffFiles(prev, hashed)
    const todo = [...added, ...changed]
    if (todo.length === 0 && removed.length === 0) {
      publishStats(index)
      ragState.phase = 'ready'
      return
    }
    ragState.total = todo.length
    const files = new Map(index?.files ?? [])
    for (const p of [...removed, ...changed]) files.delete(p)
    const byPath = new Map(hashed.map((f) => [f.path, f]))
    let dims = index?.dims ?? 0
    let lastPersist = Date.now()
    for (const path of todo) {
      if (signal.aborted) break
      const f = byPath.get(path)
      if (!f) continue
      // Résolution du contenu : texte en main ; PDF extrait À LA DEMANDE ici (getPdfText,
      // import dynamique → chunk pdfjs séparé). Un PDF scanné/vide/illisible reçoit une
      // ENTRÉE MARQUEUR (chunks: []) : le diff le verra INCHANGÉ au prochain refresh au lieu
      // de le ré-extraire en boucle (sinon `added` ne se vide jamais).
      let content: string
      if (f.isPdf) {
        let ex
        try {
          const { getPdfText } = await import('./pdf')
          ex = await getPdfText(path, signal)
        } catch (e) {
          if (signal.aborted) break // Stop pendant l'extraction → annulation propre (pas « échoué »)
          console.error('[rag] pdf extract', path, e)
          ex = null // PDF illisible/corrompu → marqueur (n'échoue pas tout l'index)
        }
        if (!ex || ex.scanned || !ex.text.trim()) {
          files.set(path, { entry: { path, name: f.name, hash: f.hash, chunks: [] }, vecs: [] })
          ragState.done++
          continue
        }
        content = ex.text
      } else {
        content = f.content ?? ''
      }
      const { chunks, truncated } = chunkText(content)
      const title = noteTitle(f.name)
      const vecs: Float32Array[] = []
      try {
        for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
          const inputs = chunks.slice(i, i + EMBED_BATCH).map((c) => embedInput(title, c))
          for (const v of await embed(port, model, inputs, signal)) vecs.push(normalizeVec(v))
        }
      } catch (e) {
        // Annulé en plein fichier : on sort sans l'ajouter (fichier partiel = jamais).
        if (signal.aborted) break
        throw e
      }
      if (vecs.length !== chunks.length) throw new Error(`embed incomplet (${vecs.length}/${chunks.length})`)
      if (!dims && vecs.length) dims = vecs[0].length
      files.set(path, {
        entry: { path, name: f.name, hash: f.hash, chunks, ...(truncated ? { truncated: true } : {}) },
        vecs,
      })
      ragState.done++
      if (Date.now() - lastPersist >= CHECKPOINT_MS) {
        await persist(rebuild(dir, key, model, dims, files))
        lastPersist = Date.now()
      }
    }
    // Persiste l'état atteint (fichiers COMPLETS uniquement) — après annulation aussi :
    // le travail d'embed déjà payé est conservé, le diff du prochain run reprend le reste.
    index = rebuild(dir, key, model, dims, files)
    await persist(index)
    if (signal.aborted) {
      ragState.canceled = true
      dirty = true // il reste des fichiers non indexés : le prochain refresh rescanne
    }
    publishStats(index)
    ragState.phase = 'ready'
  } catch (e) {
    console.error('[rag] refresh', e)
    const msg = e instanceof Error ? e.message : String(e)
    if (/\b404\b|not found/i.test(msg)) {
      ragState.needsModel = model
      ragState.error = `Modèle « ${model} » non installé.`
    } else {
      ragState.error = "L'indexation a échoué."
    }
    ragState.phase = 'error'
    dirty = true // re-tenter au prochain déclenchement
  } finally {
    abortCtl = null
  }
}

// (Re)met l'index à jour — sérialisé : deux appels concurrents (bouton + question) ne
// s'entrelacent jamais, le second voit l'index frais et sort tôt. `force` = bouton
// « Indexer » (rescan même si le flag dirty est vide).
export function refreshRagIndex(port: number, model: string, dir: string, force = false): Promise<void> {
  const run = () => doRefresh(port, model, dir, force)
  const p = chain.then(run, run)
  chain = p.catch(() => {})
  return p
}

// Recherche sémantique top-k (15.3). Rafraîchit d'abord si nécessaire (dirty/chargé),
// puis embed de la requête (BRUTE — pas de préfixe : protocole granite mesuré au spike)
// et cosinus brute-force. `buildIfMissing: false` → null si AUCUN index n'existe pour ce
// dossier (ni en mémoire ni sur disque) : le premier index complet (minutes) n'a pas sa
// place derrière une question de chat — il se lance depuis la vue Modèles. Le refresh
// inline restant est un diff incrémental (secondes). `signal` ne couvre que l'embed de
// la requête : un refresh en cours s'annule via cancelRagIndexing (travail conservé).
export async function searchRag(
  port: number,
  model: string,
  dir: string,
  query: string,
  k = RAG_TOP_K,
  opts: { signal?: AbortSignal; buildIfMissing?: boolean } = {},
): Promise<RagHit[] | null> {
  if (opts.buildIfMissing === false) {
    // Index PARTIEL (indexation annulée) : même chargé, le compléter inline pourrait
    // coûter des minutes — retour à la vue Modèles pour finir l'indexation.
    if (ragState.canceled && ragState.dir === dir) return null
    const loaded = index !== null && index.dir === dir && index.model === model
    if (!loaded) {
      // L'EXISTENCE du meta ne suffit pas : un meta d'un autre modèle (chip de repli
      // cliquée) ou d'une autre version passerait la garde puis déclencherait le
      // ré-embed INTÉGRAL du dossier derrière la question — précisément l'interdit.
      const metaText = await readRagMetaText(await ragDirKey(dir))
      const meta = metaText ? parseRagMeta(metaText) : null
      if (!meta || meta.model !== model) return null
    }
  }
  await refreshRagIndex(port, model, dir)
  const idx = index
  if (!idx || idx.dir !== dir || idx.rows.length === 0) return []
  const [qv] = await embed(port, model, [query], opts.signal)
  if (!qv) return []
  normalizeVec(qv)
  return topK(qv, idx.matrix, idx.dims, k).map(({ row, score }) => ({ ...idx.rows[row], score }))
}

// --- Index ÉPHÉMÈRE du document courant (15.3) ----------------------------------------
// Un doc > fenêtre de contexte est interrogé en entier : chunk + embed + top-k, en
// mémoire seulement (cache mono-emplacement invalidé par hash de contenu — un gros doc
// ne se ré-embedde pas à chaque question). Même protocole que le spike : préfixe
// «titre» — pour les chunks, requête brute. `truncated` = plafond de chunks atteint
// (doc géant) — remonté à l'appelant, jamais silencieux.
let docCache: {
  key: string
  hash: string
  model: string
  dims: number
  matrix: Float32Array
  chunks: string[]
  truncated: boolean
} | null = null

export async function searchDocEphemeral(
  port: number,
  model: string,
  key: string,
  title: string,
  text: string,
  query: string,
  k = RAG_TOP_K,
  signal?: AbortSignal,
): Promise<{ hits: { text: string; score: number }[]; truncated: boolean }> {
  const hash = await hashText(text)
  if (!docCache || docCache.key !== key || docCache.hash !== hash || docCache.model !== model) {
    const { chunks, truncated } = chunkText(text)
    const vecs: Float32Array[] = []
    for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
      const inputs = chunks.slice(i, i + EMBED_BATCH).map((c) => embedInput(title, c))
      for (const v of await embed(port, model, inputs, signal)) vecs.push(normalizeVec(v))
    }
    // Réponse d'embed courte → JAMAIS de cache partiel (le prompt affirme « indexé en
    // entier ») : on lève, l'appelant affiche une carte d'échec.
    if (vecs.length !== chunks.length) throw new Error(`embed incomplet (${vecs.length}/${chunks.length})`)
    const dims = vecs[0]?.length ?? 0
    docCache = { key, hash, model, dims, matrix: flattenVectors(vecs, dims), chunks, truncated }
  }
  const cache = docCache
  const [qv] = await embed(port, model, [query], signal)
  if (!qv) return { hits: [], truncated: cache.truncated }
  normalizeVec(qv)
  return {
    hits: topK(qv, cache.matrix, cache.dims, k).map(({ row, score }) => ({ text: cache.chunks[row], score })),
    truncated: cache.truncated,
  }
}

export function cancelRagIndexing(): void {
  abortCtl?.abort()
}

// Une note du dossier indexé a changé (save, restauration, reload externe) : marque
// l'index périmé — le prochain refresh (question 15.3 ou bouton) ré-embeddera le diff.
// Pas d'embed immédiat : pas de port/modèle ici, et pas de travail CPU à chaque Ctrl+S.
export function ragFileChanged(path: string): void {
  const dir = index?.dir ?? ragState.dir
  if (dir && isWithinDir(path, dir)) dirty = true
}

// Supprime l'index du dossier (disque + mémoire). Annule un run en cours ; l'opération
// est mise dans la même chaîne que les refreshs (jamais concurrente d'une persistance).
export function deleteRagIndex(dir: string): Promise<void> {
  abortCtl?.abort()
  const run = async () => {
    await removeRagIndexDir(await ragDirKey(dir))
    if (index?.dir === dir) index = null
    ragState.phase = 'idle'
    ragState.dir = null
    ragState.done = 0
    ragState.total = 0
    ragState.skipped = 0
    ragState.error = ''
    ragState.needsModel = ''
    ragState.canceled = false
    publishStats(null)
  }
  const p = chain.then(run, run)
  chain = p.catch(() => {})
  return p
}
