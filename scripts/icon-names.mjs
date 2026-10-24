// Extraction des noms d'icônes Lucide utilisés par les sources Doku.
// Partagé entre scripts/subset-icons.mjs (génération du sprite) et src/lib/icons.test.ts
// (garde-fou : une icône ajoutée sans régénérer le sprite rendrait un vide à l'écran).
//
// Règles (volontairement larges — un faux positif ne coûte qu'un symbole dans le sprite,
// un manqué coûterait une icône absente) :
//   (a) `#i-nom` littéral (href d'un <use>, balisage ou createElementNS)
//   (b) littéraux entre quotes dans une expression `#i-{…}` (ternaires)
//   (c) propriétés `icon:` / `icone:` / `icône:` (tableaux de conf)
//   (d) tout littéral à tiret qui est un nom Lucide (fonctions qui RENVOIENT un nom)
// Tout est filtré par la liste des noms Lucide connus.

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

export function lucideIds(spritePath) {
  return new Set([...readFileSync(spritePath, 'utf8').matchAll(/<symbol id="([^"]+)"/g)].map((m) => m[1]))
}

export function collectIconNames(srcDir, known) {
  const names = new Set()
  const files = []
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (/\.(svelte|ts)$/.test(e.name) && !e.name.endsWith('.test.ts')) files.push(p)
    }
  }
  walk(srcDir)
  const QUOTED = /'([a-z0-9-]{1,48})'|"([a-z0-9-]{1,48})"/g
  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    for (const m of text.matchAll(/#i-([a-z0-9-]+)/g)) names.add(m[1])
    for (const m of text.matchAll(/#i-\{([^}]*)\}/g)) for (const q of m[1].matchAll(QUOTED)) names.add(q[1] ?? q[2])
    for (const m of text.matchAll(/\bic[oô]ne?:\s*'([a-z0-9-]{1,48})'/gi)) names.add(m[1])
    for (const q of text.matchAll(QUOTED)) { const n = q[1] ?? q[2]; if (n.includes('-')) names.add(n) }
  }
  return [...names].filter((n) => known.has(n)).sort()
}
