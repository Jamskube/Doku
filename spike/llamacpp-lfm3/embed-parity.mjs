// Parité d'embeddings : le MÊME fichier GGUF granite-embedding:278m (blob Ollama) servi par
// Ollama /api/embed et par llama-server /v1/embeddings. Compare dims, cosinus vecteur-à-vecteur
// et la matrice de similarités entre paires (ce que le RAG consomme réellement).
// Usage : node embed-parity.mjs <ollamaUrl> <llamaUrl>
import { writeFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'

const [ollamaUrl, llamaUrl] = process.argv.slice(2)
// Même forme d'entrée que rag.ts (titre préfixé « «titre» — … »), requêtes BRUTES.
const TEXTS = [
  '«sauvegarde» — La sauvegarde est atomique : écriture d\'un fichier temporaire puis renommage, afin qu\'une coupure ne laisse jamais un document à moitié écrit.',
  'Comment éviter de corrompre un fichier lors d\'une panne de courant ?',
  '«wikilinks» — Le liage entre notes s\'effectue par des wikilinks résolus vers le fichier cible du dossier courant.',
  'Comment relier deux notes entre elles ?',
  '«recette» — Faire revenir les oignons dans le beurre, ajouter la crème et laisser mijoter vingt minutes.',
  'The copilot runs fully offline: no request leaves the machine during generation.',
]
const norm = (v) => { const n = Math.hypot(...v); return v.map((x) => x / n) }
const cos = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0)

let t0 = performance.now()
const o = await (await fetch(`${ollamaUrl}/api/embed`, { method: 'POST', body: JSON.stringify({ model: 'granite-embedding:278m', input: TEXTS }) })).json()
const ollamaMs = performance.now() - t0
t0 = performance.now()
const l = await (await fetch(`${llamaUrl}/v1/embeddings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'granite', input: TEXTS }) })).json()
const llamaMs = performance.now() - t0
const A = o.embeddings.map(norm)
const B = l.data.sort((x, y) => x.index - y.index).map((d) => norm(d.embedding))

const selfCos = A.map((a, i) => +cos(a, B[i]).toFixed(6))
const pairs = [[0, 1], [2, 3], [0, 3], [1, 4], [0, 5], [2, 4]]
const pairRows = pairs.map(([i, j]) => ({ pair: `${i}-${j}`, ollama: +cos(A[i], A[j]).toFixed(4), llama: +cos(B[i], B[j]).toFixed(4), delta: +Math.abs(cos(A[i], A[j]) - cos(B[i], B[j])).toFixed(5) }))
const out = { dims: { ollama: A[0].length, llama: B[0].length }, ollamaMs: Math.round(ollamaMs), llamaMs: Math.round(llamaMs), vectorCosine: selfCos, pairs: pairRows, texts: TEXTS }
console.log(JSON.stringify(out, null, 1))
writeFileSync('results/embed-parity.json', JSON.stringify(out, null, 2))
