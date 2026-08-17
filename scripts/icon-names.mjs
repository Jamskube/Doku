// Extraction des noms d'icônes Material Symbols utilisés par les sources Doku.
// Partagé entre scripts/subset-icons.mjs (génération) et src/lib/icons.test.ts
// (garde-fou : une icône ajoutée sans régénérer le subset ferait un carré vide).
//
// Règles (volontairement larges — un faux positif ne coûte qu'une entrée de manifeste,
// un manqué coûterait un glyphe absent à l'écran) :
//   (a) texte statique d'un élément portant la classe `msr`
//   (b) littéraux entre quotes dans l'expression d'un tel élément (ternaires)
//   (c) propriétés `icon:` / `icone:` / `icône:` (tableaux de conf, ex. SettingsDialog)
//
// La variante française de (c) n'est pas une coquetterie : le code du projet nomme ses
// identifiants en anglais, mais la règle ne regardait QUE `icon:`. Une barre d'outils
// dont les noms d'icônes vivaient dans un tableau `{ icone: '…' }` est passée entre les
// mailles — six glyphes absents à l'écran, et le garde-fou muet. Le filtre par la table
// officielle des codepoints rend une règle large sans danger.

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

export function collectIconNames(srcDir) {
  const names = new Set()
  const NAME = /^[a-z][a-z0-9_]{1,40}$/
  const files = []
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (/\.(svelte|ts)$/.test(e.name) && !e.name.endsWith('.test.ts')) files.push(p)
    }
  }
  walk(srcDir)
  const SPAN = /class=(?:"[^"]*\bmsr\b[^"]*"|'[^']*\bmsr\b[^']*')[^>]*>([\s\S]*?)</g
  const QUOTED = /'([a-z][a-z0-9_]{1,40})'|"([a-z][a-z0-9_]{1,40})"/g
  const ICON_PROP = /\bic[oô]ne?:\s*'([a-z][a-z0-9_]{1,40})'/gi
  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    for (const m of text.matchAll(SPAN)) {
      const inner = m[1].trim()
      if (NAME.test(inner)) names.add(inner)
      else if (inner.includes('{')) for (const q of inner.matchAll(QUOTED)) names.add(q[1] ?? q[2])
    }
    for (const m of text.matchAll(ICON_PROP)) names.add(m[1])
  }
  return [...names].sort()
}
