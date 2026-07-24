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
import { readFolderTexts, readRagIndex, removeRagIndexDir, sweepRagTmp, writeRagIndex } from './tauri'

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
  ragState.files = idx?.files.size ?? 0
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
    const scan = await readFolderTexts(dir)
    // Seuls les fichiers écartés par le PLAFOND comptent ici : les illisibles (binaire,
    // UTF-8 invalide) sont omis comme dans l'index de recherche — les confondre
    // afficherait un « au-delà du plafond » faux.
    ragState.skipped = scan.capped
    const hashed: { path: string; name: string; content: string; hash: string }[] = []
    for (const f of scan.files) hashed.push({ ...f, hash: await hashText(f.content) })
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
      const { chunks, truncated } = chunkText(f.content)
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

// Recherche sémantique top-k (consommée par 15.3 ; testable dès 15.2). Rafraîchit
// d'abord si nécessaire (index absent/dirty), puis embed de la requête (BRUTE — pas de
// préfixe : protocole granite mesuré au spike) et cosinus brute-force.
export async function searchRag(port: number, model: string, dir: string, query: string, k = RAG_TOP_K): Promise<RagHit[]> {
  await refreshRagIndex(port, model, dir)
  const idx = index
  if (!idx || idx.dir !== dir || idx.rows.length === 0) return []
  const [qv] = await embed(port, model, [query])
  if (!qv) return []
  normalizeVec(qv)
  return topK(qv, idx.matrix, idx.dims, k).map(({ row, score }) => ({ ...idx.rows[row], score }))
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
