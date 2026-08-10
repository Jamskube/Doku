// Sous-ensemble de Material Symbols Rounded — ne garde que les icônes utilisées.
//
// Pourquoi : la police complète du paquet `material-symbols` pèse ~5,1 Mo et est lue,
// décompressée et parsée AVANT le premier rendu des icônes (font-display: block).
// Doku utilise ~90 glyphes : le sous-ensemble pèse quelques dizaines de Ko.
//
// Usage : node scripts/subset-icons.mjs   (RÉSEAU requis — puis committer les 2 fichiers)
// Sorties :
//   src/assets/material-symbols-rounded.subset.woff2  — la police servie par l'app
//   src/assets/material-symbols-manifest.json         — noms retenus (garde-fou de test)
//
// Le test src/lib/icons.test.ts échoue si une icône apparaît dans les sources sans
// être dans le manifeste : dans ce cas, relancer ce script et committer.
//
// Extraction : règles partagées avec le test dans scripts/icon-names.mjs.
//
// Pourquoi Google Fonts (css2?icon_names=) et pas un subset local hb-subset : les
// ligatures de certains noms (search, keep, check, send, push_pin…) passent par des
// substitutions en chaîne avec glyphes intermédiaires ; hb-subset sans fermeture GSUB
// élague ces règles (icône rendue en toutes lettres), et avec fermeture il garde les
// 3 600 glyphes (~356 Ko). Le subsetter de Google est fait exactement pour ce cas —
// mêmes axes que .msr dans app.css : opsz 24, wght 400, GRAD 0, FILL variable 0..1.

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { collectIconNames } from './icon-names.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
// UA navigateur : sans lui l'API renvoie du TTF, avec lui du woff2.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

const names = collectIconNames(join(ROOT, 'src'))

// Table nom -> codepoint (dépôt google/material-design-icons, committée) : sert à
// écarter les faux positifs de l'extraction ('asc', 'dark'…) avant l'appel API,
// qui rejetterait la requête entière sur un nom inconnu.
const codepoints = new Set(
  readFileSync(join(ROOT, 'scripts', 'material-symbols-rounded.codepoints'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => l.split(' ')[0]),
)

const unknown = names.filter((n) => !codepoints.has(n))
if (unknown.length) {
  console.warn(`ignorés (pas des noms d'icônes Material Symbols) : ${unknown.join(', ')}`)
}
const icons = names.filter((n) => codepoints.has(n)).sort()

const cssUrl =
  'https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@24,400,0..1,0' +
  `&icon_names=${icons.join(',')}&display=block`
const css = await (await fetch(cssUrl, { headers: { 'User-Agent': UA } })).text()
const fontUrl = css.match(/url\((https:[^)]+)\)\s*format\(['"]woff2['"]\)/)?.[1]
if (!fontUrl) throw new Error(`pas d'URL woff2 dans la réponse CSS :\n${css.slice(0, 400)}`)
const subset = Buffer.from(await (await fetch(fontUrl)).arrayBuffer())

writeFileSync(join(ROOT, 'src', 'assets', 'material-symbols-rounded.subset.woff2'), subset)
writeFileSync(
  join(ROOT, 'src', 'assets', 'material-symbols-manifest.json'),
  JSON.stringify(names, null, 2) + '\n',
)

console.log(`${icons.length} icônes retenues (${names.length} noms extraits)`)
console.log(`police : ${(subset.length / 1024).toFixed(1)} Ko`)
