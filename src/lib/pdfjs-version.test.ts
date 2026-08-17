// Garde-fou de version pdf.js. Le pré-bundling de dev de Vite ne produit QU'UN chunk
// par dépendance : si `spike/` (qui a ses propres node_modules) déclare une autre
// version de `pdfjs-dist`, c'est elle que le serveur de dev peut servir à l'application,
// face au worker de la racine. pdf.js refuse alors de rendre — « The API version "x"
// does not match the Worker version "y" » — sur un build de production pourtant sain.
// Vécu au passage en 6.2.108 : le spike était resté en 6.1.200, et l'écart n'était
// visible qu'au navigateur, jamais en test ni au build.
// En cas d'échec : aligner la version dans le package.json fautif, puis `npm install`
// dans son dossier.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const MANIFESTES = ['package.json', join('spike', 'package.json')]

function versionDeclaree(manifeste: string): string | null {
  const json = JSON.parse(readFileSync(join(ROOT, manifeste), 'utf8'))
  const brut = json.dependencies?.['pdfjs-dist'] ?? json.devDependencies?.['pdfjs-dist']
  // Les plages (`^6.2.108`) et les versions figées (`6.2.108`) doivent se comparer.
  return typeof brut === 'string' ? brut.replace(/^[\^~]/, '') : null
}

describe('version de pdfjs-dist', () => {
  it('est la même dans tous les manifestes du dépôt', () => {
    const declarees = MANIFESTES.map((m) => [m, versionDeclaree(m)] as const).filter(([, v]) => v !== null)
    expect(declarees.length).toBeGreaterThan(1)
    const [[, reference]] = declarees
    for (const [manifeste, version] of declarees) {
      expect(`${manifeste} → ${version}`).toBe(`${manifeste} → ${reference}`)
    }
  })

  it('correspond à ce qui est réellement installé à la racine', () => {
    const installee = JSON.parse(
      readFileSync(join(ROOT, 'node_modules', 'pdfjs-dist', 'package.json'), 'utf8'),
    ).version
    expect(installee).toBe(versionDeclaree('package.json'))
  })
})
