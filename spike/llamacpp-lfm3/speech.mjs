// Parole LFM3-Omni sur llama-server : TTS (/v1/audio/speech), ASR (/v1/audio/transcriptions
// puis repli chat + input_audio) et sonde du WebSocket /v1/realtime.
// Usage : node speech.mjs <url> <model> → results/audio/*.wav + results/speech.json
import { writeFileSync, readFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'

const [url, model] = process.argv.slice(2)
const PHRASES = [
  { id: 'fr-court', text: 'Bonjour, je suis Doku-San, votre assistant de lecture.' },
  { id: 'fr-reponse', text: "Le document décrit le choix de Tauri pour Doku. Electron a été écarté parce qu'il embarque Chromium et consomme trop de mémoire. La décision privilégie la légèreté et la réutilisation des briques existantes." },
  { id: 'fr-nombres', text: 'Le rendez-vous est fixé au mardi 14 octobre 2026 à 9 h 30, salle 212. Le budget total s’élève à 14 320 euros, soit 4,5 % de plus qu’en 2025.' },
]
const wavSeconds = (buf) => {
  // En-tête RIFF : débit d'octets au décalage 28, taille du bloc « data » cherchée.
  const byteRate = buf.readUInt32LE(28)
  const i = buf.indexOf('data')
  // En flux, la taille déclarée est un bouche-trou : on compte les octets réellement reçus.
  return (buf.length - (i + 8)) / byteRate
}
const out = { tts: [], asr: [], realtime: null }

for (const p of PHRASES) {
  const t0 = performance.now()
  const res = await fetch(`${url}/v1/audio/speech`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, input: p.text, voice: 'female', response_format: 'wav', stream_format: 'audio', lang: 'fr' }),
  })
  if (!res.ok) { out.tts.push({ id: p.id, error: `${res.status} ${await res.text()}` }); console.log(out.tts.at(-1)); continue }
  const reader = res.body.getReader()
  const chunks = []
  let tFirst = null
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    tFirst ??= performance.now()
    chunks.push(value)
  }
  const total = performance.now() - t0
  const buf = Buffer.concat(chunks)
  const file = `results/audio/${p.id}.wav`
  writeFileSync(file, buf)
  const secs = wavSeconds(buf)
  const r = { id: p.id, file, text: p.text, firstByteMs: Math.round(tFirst - t0), totalMs: Math.round(total), audioSec: +secs.toFixed(2), rtf: +(total / 1000 / secs).toFixed(2), sampleRate: buf.readUInt32LE(24), contentType: res.headers.get('content-type') }
  out.tts.push(r)
  console.log(r)
}

for (const id of ['fr-reponse', 'fr-nombres']) {
  const wav = readFileSync(`results/audio/${id}.wav`)
  const ref = PHRASES.find((p) => p.id === id).text
  const fd = new FormData()
  fd.append('file', new Blob([wav], { type: 'audio/wav' }), `${id}.wav`)
  fd.append('model', model)
  fd.append('language', 'fr')
  let t0 = performance.now()
  let res = await fetch(`${url}/v1/audio/transcriptions`, { method: 'POST', body: fd })
  let via = 'transcriptions'
  let text
  if (res.ok) text = (await res.json()).text
  else {
    const err = `${res.status} ${await res.text()}`
    via = `chat+input_audio (transcriptions: ${err.slice(0, 120)})`
    t0 = performance.now()
    res = await fetch(`${url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, temperature: 0, messages: [
        { role: 'system', content: 'Perform ASR in French.' },
        { role: 'user', content: [{ type: 'input_audio', input_audio: { data: wav.toString('base64'), format: 'wav' } }] },
      ] }),
    })
    text = res.ok ? (await res.json()).choices[0].message.content : `ERREUR ${res.status} ${await res.text()}`
  }
  const r = { id, via, ms: Math.round(performance.now() - t0), audioSec: +wavSeconds(wav).toFixed(2), reference: ref, transcript: text }
  out.asr.push(r)
  console.log(r)
}

// Sonde /v1/realtime : session texte→voix, temps jusqu'au 1er delta audio, types d'événements vus.
out.realtime = await new Promise((resolve) => {
  const seen = {}
  let t0, tAudio = null, tText = null, audioBytes = 0, transcript = ''
  const ws = new WebSocket(`${url.replace('http', 'ws')}/v1/realtime?model=${encodeURIComponent(model)}`)
  const done = (extra) => { try { ws.close() } catch {} ; resolve({ events: seen, firstAudioMs: tAudio && Math.round(tAudio - t0), firstTextMs: tText && Math.round(tText - t0), audioBytes, transcript, ...extra }) }
  const timer = setTimeout(() => done({ error: 'timeout 120 s' }), 120000)
  ws.onerror = (e) => { clearTimeout(timer); done({ error: `ws error ${e.message ?? ''}` }) }
  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'session.update', session: { instructions: 'Tu es Doku-San. Réponds en français, en une phrase.', output_modalities: ['text', 'audio'] } }))
    ws.send(JSON.stringify({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Dis bonjour et présente-toi en une phrase.' }] } }))
    t0 = performance.now()
    ws.send(JSON.stringify({ type: 'response.create' }))
  }
  ws.onmessage = (m) => {
    const ev = JSON.parse(typeof m.data === 'string' ? m.data : Buffer.from(m.data).toString())
    seen[ev.type] = (seen[ev.type] ?? 0) + 1
    if (/audio\.delta$/.test(ev.type)) { tAudio ??= performance.now(); audioBytes += Buffer.from(ev.delta ?? '', 'base64').length }
    if (/(transcript|text)\.delta$/.test(ev.type)) { tText ??= performance.now(); transcript += ev.delta ?? '' }
    if (ev.type === 'error') { clearTimeout(timer); done({ error: JSON.stringify(ev.error ?? ev) }) }
    if (ev.type === 'response.done') { clearTimeout(timer); done({}) }
  }
})
console.log('realtime', out.realtime)
writeFileSync('results/speech.json', JSON.stringify(out, null, 2))
