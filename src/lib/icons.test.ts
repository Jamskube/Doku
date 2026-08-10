// Garde-fou du subset d'icônes (scripts/subset-icons.mjs) : toute icône référencée
// dans les sources doit figurer dans le manifeste généré avec la police. Une icône
// ajoutée sans régénérer le subset rendrait un carré vide dans l'app.
// En cas d'échec : `node scripts/subset-icons.mjs` puis committer les fichiers générés.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { collectIconNames } from '../../scripts/icon-names.mjs'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))

describe('subset Material Symbols', () => {
  it('couvre toutes les icônes utilisées par les sources', () => {
    const manifest = new Set<string>(
      JSON.parse(readFileSync(join(ROOT, 'src', 'assets', 'material-symbols-manifest.json'), 'utf8')),
    )
    const used = collectIconNames(join(ROOT, 'src'))
    const missing = used.filter((n) => !manifest.has(n))
    expect(missing, 'icônes hors subset — relancer node scripts/subset-icons.mjs').toEqual([])
  })
})
