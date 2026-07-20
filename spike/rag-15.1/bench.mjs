// Banc RAG (spike 15.1) — mesure qualité top-k / vitesse / empreinte d'un modèle
// d'embedding servi par le sidecar Ollama local, + baseline lexicale BM25.
// Usage : node bench.mjs <modele> [--scale N] [--chunk 900]
import { buildCorpus, buildScaledCorpus } from './corpus.mjs'
import { QUERIES } from './queries.mjs'
import { writeFileSync, mkdirSync } from 'node:fs'

const HOST = 'http://127.0.0.1:11499'
const MODEL = process.argv[2]
if (!MODEL) { console.error('usage: node bench.mjs <modele> [--scale N] [--chunk C]'); process.exit(1) }
const argN = (flag, dflt) => { const i = process.argv.indexOf(flag); return i > 0 ? Number(process.argv[i + 1]) : dflt }
const SCALE = argN('--scale', 0)
const CHUNK_TARGET = argN('--chunk', 900)
const BATCH = 16

// Protocoles de préfixe par modèle (doc vs requête) — certains modèles PERDENT beaucoup
// de qualité sans leur préfixe officiel (embeddinggemma), d'autres n'en ont pas (bge-m3).
const PROFILES = {
  'embeddinggemma': {
    doc: (text, title) => `title: ${title} | text: ${text}`,
    query: (q) => `task: search result | query: ${q}`,
  },
  'qwen3-embedding:0.6b': {
    doc: (text, title) => `«${title}» — ${text}`,
    query: (q) => `Instruct: Given a search query, retrieve relevant passages from the user's notes\nQuery: ${q}`,
  },
  default: {
    doc: (text, title) => `«${title}» — ${text}`,
    query: (q) => q,
  },
}
const profile = PROFILES[MODEL] ?? PROFILES.default

// --- Chunking : paragraphes fusionnés jusqu'à ~CHUNK_TARGET caractères ------------------
function chunkNote(note) {
  const paras = note.text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
  const chunks = []
  let buf = ''
  for (const p of paras) {
    if (buf && buf.length + p.length + 2 > CHUNK_TARGET) { chunks.push(buf); buf = p }
    else buf = buf ? `${buf}\n\n${p}` : p
  }
  if (buf) chunks.push(buf)
  return chunks.map((text, i) => ({ noteId: note.id, title: note.title, seq: i, text }))
}

// --- Client /api/embed ------------------------------------------------------------------
async function embedBatch(inputs) {
  const res = await fetch(`${HOST}/api/embed`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, input: inputs }),
  })
  if (!res.ok) throw new Error(`embed ${res.status}: ${await res.text()}`)
  const json = await res.json()
  return json.embeddings.map((e) => Float32Array.from(e))
}

function normalize(v) {
  let s = 0
  for (let i = 0; i < v.length; i++) s += v[i] * v[i]
  const n = Math.sqrt(s) || 1
  for (let i = 0; i < v.length; i++) v[i] /= n
  return v
}
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s }

// --- BM25 lexical (baseline) ------------------------------------------------------------
const tokenize = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').match(/[a-z0-9]{2,}/g) ?? []
function bm25Index(chunks) {
  const k1 = 1.2, b = 0.75
  const docs = chunks.map((c) => tokenize(`${c.title} ${c.text}`))
  const avgdl = docs.reduce((s, d) => s + d.length, 0) / docs.length
  const df = new Map()
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1)
  const N = docs.length
  return {
    score(query) {
      const qts = tokenize(query)
      return docs.map((d, di) => {
        const tf = new Map()
        for (const t of d) tf.set(t, (tf.get(t) ?? 0) + 1)
        let s = 0
        for (const t of qts) {
          const f = tf.get(t)
          if (!f) continue
          const idf = Math.log(1 + (N - (df.get(t) ?? 0) + 0.5) / ((df.get(t) ?? 0) + 0.5))
          s += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * d.length / avgdl))
        }
        return s
      })
    },
  }
}

// --- Métriques note-level : score(note) = max sur ses chunks ----------------------------
function evaluate(chunks, scoresPerQuery) {
  const per = { direct: [], paraphrase: [], trap: [], all: [] }
  QUERIES.forEach((query, qi) => {
    const scores = scoresPerQuery[qi]
    const byNote = new Map()
    scores.forEach((s, ci) => {
      const id = chunks[ci].noteId
      if (!byNote.has(id) || s > byNote.get(id)) byNote.set(id, s)
    })
    const ranked = [...byNote.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id)
    const rank = ranked.indexOf(query.target) + 1
    const m = { rank, r1: rank === 1 ? 1 : 0, r3: rank >= 1 && rank <= 3 ? 1 : 0, r5: rank >= 1 && rank <= 5 ? 1 : 0, rr: rank >= 1 && rank <= 10 ? 1 / rank : 0 }
    per[query.kind].push(m)
    per.all.push(m)
  })
  const agg = (arr) => arr.length ? {
    n: arr.length,
    'recall@1': +(arr.reduce((s, m) => s + m.r1, 0) / arr.length).toFixed(3),
    'recall@3': +(arr.reduce((s, m) => s + m.r3, 0) / arr.length).toFixed(3),
    'recall@5': +(arr.reduce((s, m) => s + m.r5, 0) / arr.length).toFixed(3),
    mrr10: +(arr.reduce((s, m) => s + m.rr, 0) / arr.length).toFixed(3),
  } : null
  return { all: agg(per.all), direct: agg(per.direct), paraphrase: agg(per.paraphrase), trap: agg(per.trap), ranks: per.all.map((m) => m.rank) }
}

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] }

async function main() {
  const corpus = SCALE ? buildScaledCorpus(SCALE) : buildCorpus()
  const chunks = corpus.flatMap(chunkNote)
  console.error(`[${MODEL}] notes=${corpus.length} chunks=${chunks.length} chunkTarget=${CHUNK_TARGET}`)

  // Chauffe (charge le modèle en RAM — exclue des mesures)
  await embedBatch([profile.doc('chauffe', 'chauffe')])

  // Indexation : embed de tous les chunks, batchés
  const t0 = performance.now()
  const vecs = []
  for (let i = 0; i < chunks.length; i += BATCH) {
    const batch = chunks.slice(i, i + BATCH).map((c) => profile.doc(c.text, c.title))
    const embs = await embedBatch(batch)
    for (const e of embs) vecs.push(normalize(e))
  }
  const indexMs = performance.now() - t0
  const dims = vecs[0].length

  // Empreinte du modèle chargé (RAM, size côté serveur)
  const ps = await (await fetch(`${HOST}/api/ps`)).json()
  const loaded = ps.models?.find((m) => m.name.startsWith(MODEL.split(':')[0]))

  // Requêtes : latence d'embed unitaire (le coût ajouté à CHAQUE question du copilote)
  const qVecs = []
  const qLat = []
  for (const query of QUERIES) {
    const tq = performance.now()
    const [v] = await embedBatch([profile.query(query.q)])
    qLat.push(performance.now() - tq)
    qVecs.push(normalize(v))
  }

  // Recherche brute-force cosinus (latence mesurée sur l'ensemble des requêtes)
  const ts = performance.now()
  const semScores = qVecs.map((qv) => vecs.map((v) => dot(qv, v)))
  const searchMs = (performance.now() - ts) / QUERIES.length

  const sem = evaluate(chunks, semScores)
  const bm = bm25Index(chunks)
  const lexScores = QUERIES.map((q) => bm.score(q.q))
  const lex = evaluate(chunks, lexScores)

  // Fusion hybride RRF (reciprocal rank fusion, k=60) : combine les rangs sémantique et
  // BM25 par chunk — l'app possède DÉJÀ un index lexical (9.2), la fusion est ~gratuite.
  const rrf = (scores) => {
    const order = scores.map((s, i) => [s, i]).sort((a, b) => b[0] - a[0])
    const rank = new Array(scores.length)
    order.forEach(([, i], r) => { rank[i] = r + 1 })
    return rank
  }
  const hybScores = semScores.map((ss, qi) => {
    const sr = rrf(ss)
    const lr = rrf(lexScores[qi])
    return ss.map((_, ci) => 1 / (60 + sr[ci]) + 1 / (60 + lr[ci]))
  })
  const hyb = evaluate(chunks, hybScores)

  const result = {
    model: MODEL, dims, notes: corpus.length, chunks: chunks.length, chunkTarget: CHUNK_TARGET,
    index: { totalMs: Math.round(indexMs), chunksPerSec: +(chunks.length / (indexMs / 1000)).toFixed(1) },
    query: { medianMs: Math.round(median(qLat)), searchMsPerQuery: +searchMs.toFixed(2) },
    footprint: { loadedBytes: loaded?.size ?? null, loadedMB: loaded ? Math.round(loaded.size / 1e6) : null },
    storagePerChunkBytes: dims * 4,
    semantic: { all: sem.all, direct: sem.direct, paraphrase: sem.paraphrase, trap: sem.trap },
    bm25: { all: lex.all, direct: lex.direct, paraphrase: lex.paraphrase, trap: lex.trap },
    hybridRRF: { all: hyb.all, direct: hyb.direct, paraphrase: hyb.paraphrase, trap: hyb.trap },
    ranks: sem.ranks,
    hybridRanks: hyb.ranks,
  }
  mkdirSync(new URL('./results/', import.meta.url), { recursive: true })
  const safe = MODEL.replace(/[:/]/g, '_')
  const suffix = SCALE ? `_scale${SCALE}` : (CHUNK_TARGET !== 900 ? `_chunk${CHUNK_TARGET}` : '')
  writeFileSync(new URL(`./results/${safe}${suffix}.json`, import.meta.url), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result, null, 2))
}

main().catch((e) => { console.error(e); process.exit(1) })
