// Sprite Lucide réduit aux icônes utilisées (set du kit Kube, paquet `lucide-static`).
//
// Le sprite complet pèse ~520 Ko pour 1 866 icônes ; Doku en utilise environ 150.
// Usage : npm run subset:icons   (hors ligne — puis committer src/assets/icons.svg)
// Le test src/lib/icons.test.ts échoue si une icône apparaît dans les sources sans
// figurer dans le sprite. Extraction : règles partagées dans scripts/icon-names.mjs.
// Les symboles sont préfixés `i-` : un id `link` ou `search` collisionnerait avec les
// ancres des documents affichés dans la même page.

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { collectIconNames, lucideIds } from './icon-names.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SPRITE = join(ROOT, 'node_modules', 'lucide-static', 'sprite.svg')

const full = readFileSync(SPRITE, 'utf8')
const names = collectIconNames(join(ROOT, 'src'), lucideIds(SPRITE))
const symbols = names.map((name) => {
  const m = full.match(new RegExp(`<symbol id="${name}"[^>]*>([\\s\\S]*?)</symbol>`))
  if (!m) throw new Error(`symbole introuvable : ${name}`)
  const body = m[1].replace(/\s*\n\s*/g, '')
  return `<symbol id="i-${name}" viewBox="0 0 24 24">${body}</symbol>`
})
const version = JSON.parse(readFileSync(join(ROOT, 'node_modules', 'lucide-static', 'package.json'), 'utf8')).version
const out = `<!-- Lucide v${version} (ISC) — généré par scripts/subset-icons.mjs, ne pas éditer -->\n` +
  `<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" style="position:absolute" aria-hidden="true">\n${symbols.join('\n')}\n</svg>\n`
writeFileSync(join(ROOT, 'src', 'assets', 'icons.svg'), out)
console.log(`${names.length} icônes, ${(out.length / 1024).toFixed(1)} Ko`)
