import { writeFileSync } from 'node:fs'
const text = "Le rendez-vous est fixé au mardi quatorze octobre deux mille vingt-six à neuf heures trente, salle deux cent douze. Le budget total s'élève à quatorze mille trois cent vingt euros, soit quatre virgule cinq pour cent de plus qu'en deux mille vingt-cinq."
const t0 = performance.now()
const r = await fetch('http://127.0.0.1:8090/v1/audio/speech', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'lfm3-q4_0', input: text, voice: 'female', response_format: 'wav', lang: 'fr' }) })
const buf = Buffer.from(await r.arrayBuffer())
const ms = performance.now() - t0
writeFileSync('results/audio/fr-nombres-en-lettres.wav', buf)
const fd = new FormData()
fd.append('file', new Blob([buf], { type: 'audio/wav' }), 'x.wav'); fd.append('model', 'lfm3-q4_0'); fd.append('language', 'fr')
const a = await (await fetch('http://127.0.0.1:8090/v1/audio/transcriptions', { method: 'POST', body: fd })).json()
const secs = (buf.length - 44) / 48000
console.log(JSON.stringify({ ttsMs: Math.round(ms), audioSec: +secs.toFixed(2), rtf: +(ms / 1000 / secs).toFixed(2), asr: a.text }, null, 1))
