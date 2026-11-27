// Vision LFM3-Omni (mmproj) : questions FR à vérité terrain connue sur les pages de make-pages.py.
// Usage : node vision.mjs <url> <model> → results/vision.json + results/vision.md
import { readFileSync, writeFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'

const [url, model] = process.argv.slice(2)
const Q = [
  { img: 'page-scan.png', q: 'Quel est le numéro du permis de construire, et quelles pièces manquent au dossier ?', truth: 'PC 045 287 26 B0031 ; plan de masse (PCMI2) et notice descriptive (PCMI4)' },
  { img: 'page-scan.png', q: 'Transcris le texte de ce courrier.', truth: '(transcription intégrale)' },
  { img: 'page-table.png', q: "Quel est le montant de l'achat de livres au T4, et le total annuel du budget ?", truth: '3 100 € ; 14 320 €' },
  { img: 'page-table.png', q: 'Convertis ce tableau en tableau Markdown.', truth: '(6 lignes × 6 colonnes)' },
  { img: 'page-form.png', q: 'Extrais les champs de ce formulaire en JSON (nom, prénom, date de naissance, adresse, téléphone, courriel, formule).', truth: 'MARTIN, Élodie, 03/11/1987, 7 impasse des Glycines 69007 Lyon, 06 12 34 56 78, e.martin@exemple.fr, Famille (25 €)' },
]
const out = []
for (const x of Q) {
  const b64 = readFileSync(`results/vision/${x.img}`).toString('base64')
  const t0 = performance.now()
  const res = await fetch(`${url}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, temperature: 0, max_tokens: 700, messages: [{ role: 'user', content: [
      { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } },
      { type: 'text', text: `${x.q} Réponds en français.` },
    ] }] }),
  })
  const j = res.ok ? await res.json() : { error: `${res.status} ${await res.text()}` }
  const r = { ...x, ms: Math.round(performance.now() - t0), answer: j.choices?.[0]?.message?.content ?? j.error, timings: j.timings }
  out.push(r)
  console.log(`${x.img} ${r.ms} ms prompt=${j.timings?.prompt_n} tok`)
}
writeFileSync('results/vision.json', JSON.stringify(out, null, 2))
writeFileSync('results/vision.md', `# Vision LFM3-Omni-2B — ${model}\n` + out.map((r) =>
  `\n## ${r.img} — ${r.q}\n\n*Vérité terrain* : ${r.truth} · **${r.ms} ms** (prompt ${r.timings?.prompt_n} tok, prefill ${Math.round(r.timings?.prompt_ms ?? 0)} ms)\n\n${r.answer.split('\n').map((l) => `> ${l}`).join('\n')}\n`).join(''))
