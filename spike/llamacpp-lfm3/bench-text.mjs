// Banc texte du spike llama.cpp / LFM3 — même corpus et même tâche que spike/npu-17.1
// (longdoc.mjs), pour que les chiffres se comparent à la baseline Ollama d'ADR-0016.
//
// Différence de méthode avec npu-17.1/bench.mjs : les backends passent en BLOCS successifs
// (un seul modèle résident à la fois) et non interleavés — la machine n'a qu'~1 Go de RAM
// disponible, deux modèles résidents feraient mesurer la pagination, pas le runtime.
//
// Usage : node bench-text.mjs <target.json> [runs] [sizes,csv]
//   target.json = { label, api: 'ollama'|'llamacpp', url, model, pid }
// Écrit results/text-<label>-<horodatage>.json. Ne tape que 127.0.0.1.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { performance } from 'node:perf_hooks'
import { buildPrompt } from '../npu-17.1/longdoc.mjs'

const t = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const RUNS = +(process.argv[3] ?? 3)
const SIZES = (process.argv[4] ?? '1800,3600,7200,14400').split(',').map(Number)
const GEN = 400
const NUM_CTX = 12288
const COOLDOWN = 8000
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const median = (a) => {
  const s = a.filter((x) => x != null).sort((x, y) => x - y)
  if (!s.length) return null
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

async function* lines(res) {
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let nl
    while ((nl = buf.indexOf('\n')) >= 0) {
      const l = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (l) yield l
    }
  }
  if (buf.trim()) yield buf.trim()
}

// Préfixe UNIQUE en tête de prompt : Ollama réutilise le KV d'un préfixe commun (prefill mesuré à 36 ms
// au 2e run sinon) et n'expose pas d'option pour l'empêcher. Le nonce casse le préfixe dès le 1er token.
let nonce = 0
async function measure(raw) {
  const prompt = `[Demande n° ${++nonce}-${Date.now() % 100000}]\n${raw}`
  const t0 = performance.now()
  let tFirst = null, tLast = null, n = 0, text = ''
  const r = { promptTokens: null, completionTokens: null, apiPrefillMs: null, apiDecodeTokS: null }
  if (t.api === 'ollama') {
    const res = await fetch(`${t.url}/api/generate`, {
      method: 'POST',
      body: JSON.stringify({ model: t.model, prompt, stream: true, options: { temperature: 0, seed: 42, num_predict: GEN, num_ctx: NUM_CTX } }),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text()}`)
    for await (const l of lines(res)) {
      const o = JSON.parse(l)
      if (o.response) { const now = performance.now(); tFirst ??= now; tLast = now; n++; text += o.response }
      if (o.done) {
        r.promptTokens = o.prompt_eval_count; r.completionTokens = o.eval_count
        r.apiPrefillMs = o.prompt_eval_duration / 1e6
        r.apiDecodeTokS = o.eval_count / (o.eval_duration / 1e9)
      }
    }
  } else {
    const res = await fetch(`${t.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // cache_prompt:false — sinon le 2e run d'une même taille réutilise le KV et le prefill tombe à ~0.
      body: JSON.stringify({ model: t.model, messages: [{ role: 'user', content: prompt }], stream: true, temperature: 0, seed: 42, max_tokens: GEN, cache_prompt: false }),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text()}`)
    for await (const l of lines(res)) {
      if (!l.startsWith('data:')) continue
      const p = l.slice(5).trim()
      if (p === '[DONE]') break
      const o = JSON.parse(p)
      const d = o.choices?.[0]?.delta?.content
      if (d) { const now = performance.now(); tFirst ??= now; tLast = now; n++; text += d }
      if (o.timings) {
        r.promptTokens = o.timings.prompt_n; r.completionTokens = o.timings.predicted_n
        r.apiPrefillMs = o.timings.prompt_ms; r.apiDecodeTokS = o.timings.predicted_per_second
      }
    }
  }
  if (tFirst == null) throw new Error('aucun token')
  return { ttftMs: +(tFirst - t0).toFixed(0), e2eMs: +(tLast - t0).toFixed(0), chunks: n, ...r, text }
}

// Working set crête du serveur + descendants (le runner d'Ollama est un petit-enfant).
function peakWsMB(pid) {
  if (!pid) return null
  const ps = `$m=0; $ids=@(${pid}); $all=Get-CimInstance Win32_Process; for($i=0;$i -lt 3;$i++){ $ids += ($all | ? { $ids -contains $_.ParentProcessId } | % ProcessId) }; $m=($ids | select -Unique | % { (Get-Process -Id $_ -EA SilentlyContinue).PeakWorkingSet64 } | measure -Max).Maximum; [int64]($m / 1MB)` // entier : sinon « 1973,4 » (locale FR) → NaN
  return Math.round(+execFileSync('powershell', ['-NoProfile', '-Command', ps]).toString().trim())
}

const out = { label: t.label, target: t, runs: RUNS, gen: GEN, at: new Date().toISOString(), coldStart: null, bySize: {}, samples: {} }
const cold = await measure(buildPrompt(SIZES[0]))
out.coldStart = { ttftMs: cold.ttftMs, promptTokens: cold.promptTokens }
console.log(`${t.label} chauffe (jetée) TTFT=${cold.ttftMs}ms`)
for (const size of SIZES) {
  const ms = []
  for (let i = 0; i < RUNS; i++) {
    await sleep(COOLDOWN)
    const m = await measure(buildPrompt(size))
    ms.push(m)
    console.log(`${t.label} ${size}c run${i + 1}: prompt=${m.promptTokens}tok TTFT=${m.ttftMs} prefillAPI=${m.apiPrefillMs?.toFixed(0)}ms decode=${m.apiDecodeTokS?.toFixed(1)}t/s e2e=${m.e2eMs} out=${m.completionTokens}`)
  }
  const pre = median(ms.map((m) => m.apiPrefillMs))
  const pt = median(ms.map((m) => m.promptTokens))
  out.bySize[size] = {
    promptTokens: pt,
    ttftMs: median(ms.map((m) => m.ttftMs)),
    apiPrefillMs: pre && +pre.toFixed(0),
    prefillTokS: pre && +((pt / pre) * 1000).toFixed(1),
    decodeTokS: +median(ms.map((m) => m.apiDecodeTokS)).toFixed(1),
    e2eMs: median(ms.map((m) => m.e2eMs)),
    completionTokens: median(ms.map((m) => m.completionTokens)),
  }
  out.samples[size] = ms[0].text
}
out.peakWorkingSetMB = peakWsMB(t.pid)
mkdirSync('results', { recursive: true })
const file = `results/text-${t.label}-${out.at.replace(/[:.]/g, '-')}.json`
writeFileSync(file, JSON.stringify(out, null, 2))
console.log(JSON.stringify(out.bySize, null, 1), `peakWS=${out.peakWorkingSetMB}MB → ${file}`)
