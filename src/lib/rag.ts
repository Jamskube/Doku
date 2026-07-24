// Cœur pur de l'index d'embeddings (15.2, ADR-0015) : chunking, hachage, diff
// incrémental, encodage vectors.bin/meta.json, cosinus top-k. Aucune dépendance
// Tauri/Ollama ici — tout est testable en Node ; l'I/O vit dans tauri.ts et
// l'orchestration dans rag-index.svelte.ts.

// Modèle d'embedding par défaut + repli désigné (mesurés au spike 15.1, ADR-0015).
// Pas de tag -q4_0 : les modèles d'embedding n'en publient pas (servis F16).
export const DEFAULT_EMBED_MODEL = 'granite-embedding:278m'
export const FALLBACK_EMBED_MODEL = 'bge-m3'

// ~900 caractères : taille de chunk mesurée équivalente à 500/1500 sur le corpus du
// spike ; à re-mesurer sur longs documents en 15.3 (ADR-0015 « non couvert » n°2).
export const RAG_CHUNK_TARGET = 900

// Plafond de chunks PAR FICHIER (≈ 270 Ko de texte) : borne le coût d'un fichier
// géant (~50 s d'embed sinon). Jamais silencieux : `truncated` remonte à l'UI.
export const RAG_MAX_CHUNKS_PER_FILE = 300

// k≥3 obligatoire : c'est ce qui rattrape les pièges lexicaux à rang 2-3 (ADR-0015).
export const RAG_TOP_K = 5

export const RAG_META_VERSION = 1

// Un titre ne coupe un chunk que si le tampon a déjà de la matière : coupe
// « préférentielle » (ADR-0015), pas absolue — évite les miettes d'un doc à sections courtes.
const HEADING_CUT_MIN = 200

export interface RagFileEntry {
  path: string
  name: string
  hash: string
  chunks: string[]
  truncated?: boolean
}

// meta.json : autonome (textes des chunks inclus — 15.3 fournit ces passages au LLM
// sans relire les sources, qui auraient pu dériver depuis l'embed). `checksum` du bin :
// garantit l'appariement bin/meta — un crash entre les deux renames atomiques laisse
// sinon un couple dépareillé INDÉTECTABLE (même nombre de lignes ≠ mêmes lignes).
export interface RagMeta {
  version: number
  dir: string
  model: string
  dims: number
  chunkTarget: number
  checksum: string
  files: RagFileEntry[]
}

async function sha1Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-1', data as BufferSource)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// Hash de CONTENU (détection de changement par fichier — même rôle que le hash de
// chemin des snapshots, autre objet).
export function hashText(content: string): Promise<string> {
  return sha1Hex(new TextEncoder().encode(content))
}

export function checksumBytes(bytes: Uint8Array): Promise<string> {
  return sha1Hex(bytes)
}

// Clé du dossier indexé = SHA-1 du chemin normalisé (même normalisation que snapshotKey,
// + séparateurs finaux retirés : `C:\notes` et `C:\notes\` partagent le même index).
export function ragDirKey(dir: string): Promise<string> {
  const norm = dir.normalize('NFC').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  return sha1Hex(new TextEncoder().encode(norm))
}

// Un chemin appartient-il à l'arbre du dossier ? MÊME normalisation que ragDirKey
// (casse, séparateurs, séparateur final) : sous Windows, `c:\notes` et `C:/Notes/`
// désignent le même dossier — une comparaison brute perdrait le flag dirty.
export function isWithinDir(path: string, dir: string): boolean {
  const norm = (p: string) => p.normalize('NFC').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  return norm(path).startsWith(norm(dir) + '/')
}

// Titre de note pour le préfixe d'embed : nom de fichier sans extension.
export function noteTitle(name: string): string {
  return name.replace(/\.[^.]+$/, '')
}

// Protocole de préfixe document du modèle retenu (spike 15.1) : «titre» — texte.
// La requête part BRUTE (aucun protocole officiel granite documenté).
export function embedInput(title: string, chunk: string): string {
  return `«${title}» — ${chunk}`
}

// Découpe un paragraphe anormalement long (texte sans blancs de paragraphe) en tranches
// ~target, coupées à une espace quand c'en trouve une assez loin dans la tranche.
function splitLongParagraph(p: string, target: number): string[] {
  if (p.length <= target * 1.5) return [p]
  const out: string[] = []
  let rest = p
  while (rest.length > target * 1.5) {
    let cut = rest.lastIndexOf(' ', target)
    if (cut < target * 0.5) cut = target
    out.push(rest.slice(0, cut).trim())
    rest = rest.slice(cut).trim()
  }
  if (rest) out.push(rest)
  return out
}

// Chunking (ADR-0015) : paragraphes fusionnés jusqu'à ~target caractères, frontières de
// titres Markdown en coupes préférentielles, split dur des paragraphes géants, plafond
// par fichier signalé (`truncated`).
export function chunkText(
  text: string,
  target = RAG_CHUNK_TARGET,
  maxChunks = RAG_MAX_CHUNKS_PER_FILE,
): { chunks: string[]; truncated: boolean } {
  // Un titre en milieu de bloc devient sa propre frontière de paragraphe.
  const prepared = text.replace(/\n(#{1,6} )/g, '\n\n$1')
  const paras = prepared
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .flatMap((p) => splitLongParagraph(p, target))
  const chunks: string[] = []
  let buf = ''
  for (const p of paras) {
    const heading = /^#{1,6} /.test(p)
    const cut = heading ? buf.length >= HEADING_CUT_MIN : buf.length + p.length + 2 > target
    if (buf && cut) {
      chunks.push(buf)
      buf = p
    } else {
      buf = buf ? `${buf}\n\n${p}` : p
    }
  }
  if (buf) chunks.push(buf)
  if (chunks.length > maxChunks) return { chunks: chunks.slice(0, maxChunks), truncated: true }
  return { chunks, truncated: false }
}

// Normalise un vecteur en place (norme L2 = 1) : le cosinus devient un simple produit scalaire.
export function normalizeVec(v: Float32Array): Float32Array {
  let s = 0
  for (let i = 0; i < v.length; i++) s += v[i] * v[i]
  const n = Math.sqrt(s) || 1
  for (let i = 0; i < v.length; i++) v[i] /= n
  return v
}

// Aplati des vecteurs (déjà normalisés) en une matrice contiguë ligne-par-ligne.
export function flattenVectors(vecs: Float32Array[], dims: number): Float32Array {
  const flat = new Float32Array(vecs.length * dims)
  vecs.forEach((v, i) => flat.set(v, i * dims))
  return flat
}

// vectors.bin = la matrice brute (Float32 little-endian — format natif de la plateforme,
// l'index est local à la machine et jetable : jamais transporté).
export function matrixToBytes(matrix: Float32Array): Uint8Array {
  return new Uint8Array(matrix.buffer, matrix.byteOffset, matrix.byteLength)
}

// null si la taille ne correspond pas EXACTEMENT à rows×dims (bin/meta dépareillés →
// l'appelant jette et ré-indexe). Copie : garantit un buffer aligné à l'offset 0.
export function bytesToMatrix(bytes: Uint8Array, dims: number, rows: number): Float32Array | null {
  if (bytes.byteLength !== rows * dims * 4) return null
  return new Float32Array(new Uint8Array(bytes).buffer)
}

// Recherche brute-force : produit scalaire requête×ligne, top-k. 2,25 ms / 1000 chunks
// mesurés au spike — aucune lib d'index (ADR-0015, option G rejetée).
export function topK(query: Float32Array, matrix: Float32Array, dims: number, k: number): { row: number; score: number }[] {
  if (dims <= 0 || matrix.length === 0 || k <= 0) return []
  const rows = Math.floor(matrix.length / dims)
  const hits: { row: number; score: number }[] = []
  for (let r = 0; r < rows; r++) {
    let s = 0
    const off = r * dims
    for (let i = 0; i < dims; i++) s += query[i] * matrix[off + i]
    if (hits.length < k) {
      hits.push({ row: r, score: s })
      hits.sort((a, b) => b.score - a.score)
    } else if (s > hits[hits.length - 1].score) {
      hits[hits.length - 1] = { row: r, score: s }
      hits.sort((a, b) => b.score - a.score)
    }
  }
  return hits
}

// Diff incrémental par hash de contenu : seuls added/changed seront ré-embeddés.
export function diffFiles(
  prev: { path: string; hash: string }[],
  next: { path: string; hash: string }[],
): { added: string[]; changed: string[]; removed: string[] } {
  const prevMap = new Map(prev.map((f) => [f.path, f.hash]))
  const nextSet = new Set(next.map((f) => f.path))
  const added: string[] = []
  const changed: string[] = []
  for (const f of next) {
    const h = prevMap.get(f.path)
    if (h === undefined) added.push(f.path)
    else if (h !== f.hash) changed.push(f.path)
  }
  const removed = prev.filter((f) => !nextSet.has(f.path)).map((f) => f.path)
  return { added, changed, removed }
}

// Parse + valide meta.json. null au moindre doute → l'appelant ré-indexe (un index
// est un cache : jeter est toujours sûr, réparer jamais).
export function parseRagMeta(json: string): RagMeta | null {
  let m: unknown
  try {
    m = JSON.parse(json)
  } catch {
    return null
  }
  if (typeof m !== 'object' || m === null) return null
  const meta = m as Record<string, unknown>
  if (meta.version !== RAG_META_VERSION) return null
  if (typeof meta.dir !== 'string' || typeof meta.model !== 'string' || typeof meta.checksum !== 'string') return null
  if (typeof meta.dims !== 'number' || !Number.isInteger(meta.dims) || meta.dims < 0) return null
  if (typeof meta.chunkTarget !== 'number' || !Array.isArray(meta.files)) return null
  for (const f of meta.files as unknown[]) {
    if (typeof f !== 'object' || f === null) return null
    const e = f as Record<string, unknown>
    if (typeof e.path !== 'string' || typeof e.name !== 'string' || typeof e.hash !== 'string') return null
    if (!Array.isArray(e.chunks) || (e.chunks as unknown[]).some((c) => typeof c !== 'string')) return null
  }
  return m as unknown as RagMeta
}
