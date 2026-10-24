// Garde-fou du sprite d'icônes (scripts/subset-icons.mjs) : toute icône référencée
// dans les sources doit figurer dans src/assets/icons.svg, sinon elle rend un vide.
// En cas d'échec : `npm run subset:icons` puis committer le sprite.
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { collectIconNames, lucideIds } from '../../scripts/icon-names.mjs'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const known = lucideIds(join(ROOT, 'node_modules', 'lucide-static', 'sprite.svg'))

describe('sprite Lucide', () => {
  it('couvre toutes les icônes utilisées par les sources', () => {
    const sprite = readFileSync(join(ROOT, 'src', 'assets', 'icons.svg'), 'utf8')
    const shipped = new Set([...sprite.matchAll(/<symbol id="i-([^"]+)"/g)].map((m) => m[1]))
    const used = collectIconNames(join(ROOT, 'src'), known)
    expect(used.filter((n) => !shipped.has(n)), 'icônes hors sprite — relancer npm run subset:icons').toEqual([])
  })

  // collectIconNames filtre par les noms connus : une faute de frappe dans un href
  // statique y disparaîtrait sans bruit. Ce témoin-ci ne filtre pas.
  it('ne référence en dur que des icônes Lucide existantes', () => {
    const unknown: string[] = []
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name)
        if (e.isDirectory()) walk(p)
        else if (/\.(svelte|ts)$/.test(e.name) && !e.name.endsWith('.test.ts')) {
          for (const m of readFileSync(p, 'utf8').matchAll(/#i-([a-z0-9-]+)/g)) {
            if (!known.has(m[1])) unknown.push(`${e.name}: ${m[1]}`)
          }
        }
      }
    }
    walk(join(ROOT, 'src'))
    expect(unknown).toEqual([])
  })
})
