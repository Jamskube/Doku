// Banc de mesure du spike 17.1 — backend NPU (Foundry Local) vs CPU (Ollama).
//
// Mesure, pour chaque (backend, taille d'entrée) :
//   - TTFT (time-to-first-token) = proxy du PREFILL, la douleur des 45 s
//   - decode tok/s = médiane des deltas inter-tokens (les 8 premiers jetés)
//   - bout-à-bout (wall-clock d'une réponse de ~genTokens) = le BILAN réel (H1)
//   - vrais compteurs de tokens relus de l'API (jamais estimés — M3)
//   - cold-start = TTFT du run de chauffe JETÉ (load + compile QNN — H2)
// Puis la formule de croisement L* = gain_prefill / pénalité_decode par paire.
//
// Usage :  node bench.mjs bench.config.json
// Aucune dépendance à l'app. Ne tape que du localhost (les deux sidecars).
//
// Discipline (voir README) : secteur + perfs max, warm-up jeté, interleave A/B,
// cooldown entre runs (Surface Pro 11 fanless → throttling thermique).

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { performance } from 'node:perf_hooks'

const cfgPath = process.argv[2]
if (!cfgPath) {
  console.error('Usage: node bench.mjs <config.json>')
  process.exit(1)
}
const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'))
const { buildPrompt } = await import('./longdoc.mjs')

const GEN = cfg.genTokens ?? 400
const RUNS = cfg.runs ?? 10
const COOLDOWN = cfg.cooldownMs ?? 60000
const NUM_CTX = cfg.numCtx ?? 12288
const SIZES = cfg.inputSizesChars ?? [1800, 3600, 7200, 14400, 28800]
const OUT_DIR = cfg.outDir ?? 'results'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const median = (a) => {
  if (!a.length) return null
  const s = [...a].sort((x, y) => x - y)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const iqr = (a) => {
  if (a.length < 4) return null
  const s = [...a].sort((x, y) => x - y)
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))]
  return +(q(0.75) - q(0.25)).toFixed(1)
}

// Lit un flux (NDJSON Ollama ou SSE OpenAI) ligne par ligne.
async function* streamLines(res) {
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      let nl
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (line) yield line
      }
    }
    if (buf.trim()) yield buf.trim()
  } finally {
    reader.cancel().catch(() => {})
  }
}

// Une mesure : renvoie {ttftMs, endToEndMs, decodeTokS, promptTokens, completionTokens, apiPrefillMs, apiDecodeTokS}
async function measure(target, prompt) {
  const tStart = performance.now()
  let tFirst = null
  let tLast = null
  const tokenTimes = []
  let promptTokens = null
  let completionTokens = null
  let apiPrefillMs = null
  let apiDecodeTokS = null

  if (target.api === 'ollama') {
    const res = await fetch(`${target.url}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: target.model,
        prompt,
        stream: true,
        options: { temperature: 0, seed: 42, num_predict: GEN, num_ctx: NUM_CTX },
      }),
    })
    if (!res.ok) throw new Error(`ollama HTTP ${res.status}: ${await res.text()}`)
    for await (const line of streamLines(res)) {
      let obj
      try { obj = JSON.parse(line) } catch { continue }
      if (obj.response) {
        const now = performance.now()
        if (tFirst === null) tFirst = now
        tLast = now
        tokenTimes.push(now)
      }
      if (obj.done) {
        promptTokens = obj.prompt_eval_count ?? null
        completionTokens = obj.eval_count ?? null
        if (obj.prompt_eval_duration) apiPrefillMs = obj.prompt_eval_duration / 1e6
        if (obj.eval_count && obj.eval_duration) apiDecodeTokS = obj.eval_count / (obj.eval_duration / 1e9)
      }
    }
  } else if (target.api === 'openai') {
    const res = await fetch(`${target.url}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: target.model,
        messages: [{ role: 'user', content: prompt }],
        stream: true,
        temperature: 0,
        seed: 42,
        max_tokens: GEN,
        stream_options: { include_usage: true },
      }),
    })
    if (!res.ok) throw new Error(`openai HTTP ${res.status}: ${await res.text()}`)
    for await (const line of streamLines(res)) {
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (payload === '[DONE]') break
      let obj
      try { obj = JSON.parse(payload) } catch { continue }
      const delta = obj.choices?.[0]?.delta?.content
      if (delta) {
        const now = performance.now()
        if (tFirst === null) tFirst = now
        tLast = now
        tokenTimes.push(now)
      }
      if (obj.usage) {
        promptTokens = obj.usage.prompt_tokens ?? null
        completionTokens = obj.usage.completion_tokens ?? null
      }
    }
  } else {
    throw new Error(`api inconnue: ${target.api}`)
  }

  if (tFirst === null) throw new Error('aucun token reçu')
  // Avertit si le prompt approche num_ctx : Ollama tronque en silence (comparaison
  // inéquitable) ; Foundry a un contexte fixé au chargement, potentiellement différent.
  if (promptTokens != null && promptTokens > NUM_CTX * 0.9) {
    console.warn(`  ⚠ ${target.label}: prompt=${promptTokens} tok approche numCtx=${NUM_CTX} → risque de troncature / contexte inégal`)
  }
  // decode tok/s : deltas inter-tokens, les 8 premiers jetés (démarrage — M1)
  const deltas = []
  for (let i = 1; i < tokenTimes.length; i++) deltas.push(tokenTimes[i] - tokenTimes[i - 1])
  const stable = deltas.slice(8)
  const medDelta = median(stable.length ? stable : deltas)
  const decodeTokS = medDelta ? +(1000 / medDelta).toFixed(2) : null

  return {
    ttftMs: +(tFirst - tStart).toFixed(1),
    endToEndMs: +(tLast - tStart).toFixed(1),
    decodeTokS,
    tokens: tokenTimes.length,
    promptTokens,
    completionTokens,
    apiPrefillMs: apiPrefillMs ? +apiPrefillMs.toFixed(1) : null,
    apiDecodeTokS: apiDecodeTokS ? +apiDecodeTokS.toFixed(2) : null,
  }
}

async function main() {
  console.log(`# Banc NPU 17.1 — ${cfg.targets.length} backend(s), ${SIZES.length} tailles, ${RUNS} runs, gen=${GEN}`)
  const coldStart = {}
  // Warm-up JETÉ par (backend) — sort le load + compile QNN du TTFT mesuré (H2).
  for (const t of cfg.targets) {
    process.stdout.write(`chauffe ${t.label} … `)
    try {
      const m = await measure(t, buildPrompt(SIZES[0]))
      coldStart[t.label] = m.ttftMs
      console.log(`cold-start TTFT=${m.ttftMs} ms (JETÉ), prompt=${m.promptTokens} tok`)
    } catch (e) {
      console.log(`ÉCHEC: ${e.message}`)
      coldStart[t.label] = null
    }
    await sleep(COOLDOWN)
  }

  // records[label][size] = [measure, ...]
  const records = {}
  for (const t of cfg.targets) records[t.label] = Object.fromEntries(SIZES.map((s) => [s, []]))

  for (let r = 0; r < RUNS; r++) {
    for (const size of SIZES) {
      // Interleave A/B : alterne l'ordre des backends par run (décorrèle le throttle — M4).
      const order = r % 2 === 0 ? cfg.targets : [...cfg.targets].reverse()
      const prompt = buildPrompt(size)
      for (const t of order) {
        try {
          const m = await measure(t, prompt)
          records[t.label][size].push(m)
          console.log(`run ${r + 1}/${RUNS} size=${size}c ${t.label}: TTFT=${m.ttftMs}ms e2e=${m.endToEndMs}ms decode=${m.decodeTokS}t/s prompt=${m.promptTokens}tok`)
        } catch (e) {
          console.log(`run ${r + 1}/${RUNS} size=${size}c ${t.label}: ÉCHEC ${e.message}`)
        }
        await sleep(COOLDOWN)
      }
    }
  }

  // Agrégats
  const agg = {}
  for (const t of cfg.targets) {
    agg[t.label] = { quant: t.quant ?? null, model: t.model, api: t.api, coldStartTtftMs: coldStart[t.label], bySize: {} }
    for (const size of SIZES) {
      const ms = records[t.label][size]
      if (!ms.length) { agg[t.label].bySize[size] = null; continue }
      const ttft = ms.map((m) => m.ttftMs)
      const e2e = ms.map((m) => m.endToEndMs)
      const decCli = ms.map((m) => m.decodeTokS).filter((x) => x != null)
      const apiPre = ms.map((m) => m.apiPrefillMs).filter((x) => x != null)
      const apiDec = ms.map((m) => m.apiDecodeTokS).filter((x) => x != null)
      const compl = ms.map((m) => m.completionTokens).filter((x) => x != null)
      const ttftMed = median(ttft)
      const e2eMed = median(e2e)
      const complMed = median(compl)
      // decodeMsPerTok ROBUSTE (pente du croisement) : temps de decode total / tokens,
      // immunisé à la coalescence réseau — contrairement à la médiane des deltas, le
      // total wall-clock (e2e − ttft) est exact quel que soit le regroupement des chunks.
      const decodeMsPerTok = complMed && complMed > 1 ? +((e2eMed - ttftMed) / (complMed - 1)).toFixed(2) : null
      agg[t.label].bySize[size] = {
        n: ms.length,
        promptTokens: median(ms.map((m) => m.promptTokens).filter((x) => x != null)),
        completionTokens: complMed,
        ttftMs: { median: ttftMed, min: Math.min(...ttft), max: Math.max(...ttft), iqr: iqr(ttft) },
        endToEndMs: { median: e2eMed, min: Math.min(...e2e), max: Math.max(...e2e) },
        decodeTokS_client: median(decCli),   // diagnostic (biaisé par la coalescence)
        apiPrefillMs: apiPre.length ? median(apiPre) : null,     // vérité-terrain prefill (Ollama)
        apiDecodeTokS: apiDec.length ? median(apiDec) : null,    // vérité-terrain decode (Ollama)
        decodeMsPerTok,
      }
    }
  }

  // Croisement L* par taille (si exactement 2 backends).
  let crossover = null
  if (cfg.targets.length === 2) {
    const [A, B] = cfg.targets
    crossover = {}
    for (const size of SIZES) {
      const a = agg[A.label].bySize[size]
      const b = agg[B.label].bySize[size]
      if (!a || !b || a.decodeMsPerTok == null || b.decodeMsPerTok == null) { crossover[size] = null; continue }
      // e2e ≈ ttft + L * decodeMsPerTok ; égalité → L* = (ttftB - ttftA)/(decA - decB)
      const dDec = a.decodeMsPerTok - b.decodeMsPerTok
      const Lstar = dDec !== 0 ? (b.ttftMs.median - a.ttftMs.median) / dDec : null
      const faster = a.ttftMs.median < b.ttftMs.median ? A.label : B.label
      let crossTokens = Lstar != null ? Math.round(Lstar) : null
      let note = 'Au-delà de crossoverOutputTokens, le backend au prefill plus lent gagne le bout-à-bout.'
      if (Lstar != null && Lstar < 0) {
        crossTokens = null
        note = 'Un backend domine sur les deux axes (prefill ET decode) : pas de croisement.'
      }
      crossover[size] = {
        prefillFaster: faster,
        ttftGainMs: Math.abs(a.ttftMs.median - b.ttftMs.median),
        decodePenaltyMsPerTok: +Math.abs(dDec).toFixed(2),
        crossoverOutputTokens: crossTokens,
        note,
      }
    }
  }

  mkdirSync(OUT_DIR, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const out = { generatedAt: new Date().toISOString(), config: { GEN, RUNS, COOLDOWN, NUM_CTX, SIZES }, targets: cfg.targets, agg, crossover }
  const file = `${OUT_DIR}/bench-${stamp}.json`
  writeFileSync(file, JSON.stringify(out, null, 2))
  console.log(`\n✓ Résultats → ${file}`)
  console.log(`\nRappels : (1) reporter la RAM crête à part (Gestionnaire des tâches). (2) lancer le gate qualité FR en aveugle. (3) prouver le 0-réseau (pktmon).`)
}

main().catch((e) => { console.error(e); process.exit(1) })
