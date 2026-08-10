import { describe, expect, it } from 'vitest'
import { annotateCitations, citedNumbers, locatePassage } from './citations'

describe('annotateCitations', () => {
  it('remplace un marqueur valide par une puce', () => {
    const out = annotateCitations('<p>Le seuil est 42 Ko [1].</p>', 3)
    expect(out).toContain('data-cite="1"')
    expect(out).toContain('class="cop-cite"')
    expect(out).not.toContain('[1]')
  })

  it('gère les groupes [1, 3] et les enchaînements [1][2]', () => {
    const grouped = annotateCitations('<p>Deux sources [1, 3].</p>', 3)
    expect(grouped).toContain('data-cite="1"')
    expect(grouped).toContain('data-cite="3"')
    const chained = annotateCitations('<p>Encore [1][2].</p>', 2)
    expect(chained).toContain('data-cite="1"')
    expect(chained).toContain('data-cite="2"')
  })

  it('retire un numéro halluciné (hors 1..count) sans laisser d’espace orpheline', () => {
    const out = annotateCitations('<p>Faux [7].</p>', 3)
    expect(out).toBe('<p>Faux.</p>')
  })

  it('dédoublonne un groupe répétitif [2, 2]', () => {
    const out = annotateCitations('<p>Insistant [2, 2].</p>', 3)
    expect(out.match(/data-cite="2"/g)).toHaveLength(1)
  })

  it("ne touche pas aux crochets dans le code (inline et bloc)", () => {
    const inline = annotateCitations('<p>Voir <code>tab[1]</code> et [1].</p>', 2)
    expect(inline).toContain('<code>tab[1]</code>')
    expect(inline).toContain('data-cite="1"')
    const block = annotateCitations('<pre><code>a[2]\nb[1]</code></pre>', 2)
    expect(block).toBe('<pre><code>a[2]\nb[1]</code></pre>')
  })

  it('count=0 : tous les marqueurs sont retirés', () => {
    expect(annotateCitations('<p>Rien [1] à citer [2].</p>', 0)).toBe('<p>Rien  à citer.</p>')
  })

  it('ignore ce qui ne ressemble pas à une citation', () => {
    const s = '<p>Un [lien](x) et [abc] restent intacts.</p>'
    expect(annotateCitations(s, 5)).toBe(s)
  })
})

describe('citedNumbers', () => {
  it('extrait les numéros cités, uniques et triés, bornés à max', () => {
    expect(citedNumbers('Un fait [3]. Un autre [1, 3] et [9].', 4)).toEqual([1, 3])
  })

  it('réponse sans citation → vide', () => {
    expect(citedNumbers('Rien à signaler.', 4)).toEqual([])
  })
})

describe('locatePassage', () => {
  const doc = '# Titre\n\nPremier paragraphe utile.\nSuite du texte.\n\nDeuxième paragraphe avec le seuil de 42 Ko dedans.\n'

  it('retrouve un passage par sa première ligne (ligne/col exactes)', () => {
    const loc = locatePassage(doc, 'Deuxième paragraphe avec le seuil de 42 Ko dedans.')
    expect(loc).not.toBeNull()
    expect(loc!.line).toBe(6)
    expect(loc!.col).toBe(0)
  })

  it('saute les lignes vides en tête de passage', () => {
    const loc = locatePassage(doc, '\n\nPremier paragraphe utile.\nSuite du texte.')
    expect(loc?.line).toBe(3)
  })

  it('retombe sur un préfixe quand la ligne entière a été éditée', () => {
    const longLine = 'x'.repeat(100)
    const edited = `intro\n${longLine}fin modifiée\n`
    const loc = locatePassage(edited, `${longLine}ancienne fin`)
    expect(loc).not.toBeNull()
    expect(loc!.line).toBe(2)
    expect(loc!.length).toBeLessThanOrEqual(80)
  })

  it('null quand le passage a disparu du document', () => {
    expect(locatePassage(doc, 'Texte totalement absent du fichier.')).toBeNull()
  })

  it('null sur un passage vide', () => {
    expect(locatePassage(doc, '\n  \n')).toBeNull()
  })
})
