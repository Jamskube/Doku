import { describe, expect, it } from 'vitest'
import { PdfEditError, applyTextEdits, readEditableText } from './pdf-edit-text'
import { readFileSync } from 'node:fs'

// Les documents RÉELS fournis par l'utilisateur. Un test qui ne tourne que sur des
// fixtures fabriquées ne prouve rien sur des PDF produits par de vrais outils : c'est
// exactement ce qui avait laissé passer quatre défauts dans la conversion DOCX.
const CORPUS = 'C:\\Users\\nicos\\Downloads\\pdfmod'
const DOCS = ['lic-tech 3.pdf', 'manual.pdf', 'plan-licence 5.pdf']

function charger(nom: string): Uint8Array | null {
  try {
    return new Uint8Array(readFileSync(`${CORPUS}\\${nom}`))
  } catch {
    return null
  }
}

async function texteDe(bytes: Uint8Array, page: number): Promise<string[]> {
  const mupdf = await import('mupdf')
  const doc = mupdf.Document.openDocument(bytes, 'application/pdf')
  const json = JSON.parse((doc.loadPage(page - 1) as never as { toStructuredText: (o: string) => { asJSON: () => string } })
    .toStructuredText('preserve-whitespace').asJSON())
  return (json.blocks ?? []).flatMap((b: { lines?: { text: string }[] }) => b.lines ?? []).map((x: { text: string }) => x.text)
}

describe('readEditableText', () => {
  it('refuse ce qui n’est pas un PDF, en le disant', async () => {
    await expect(readEditableText(new Uint8Array([1, 2, 3]))).rejects.toBeInstanceOf(PdfEditError)
  })

  for (const nom of DOCS) {
    it(`trouve du texte éditable dans « ${nom} »`, async () => {
      const bytes = charger(nom)
      if (!bytes) return // corpus absent sur une autre machine : on ne fait pas échouer
      const pages = await readEditableText(bytes)
      expect(pages.length).toBeGreaterThan(0)
      const total = pages.reduce((n, p) => n + p.runs.length, 0)
      expect(total).toBeGreaterThan(10)
      // Le texte lu doit ressembler à du texte, pas à des codes de glyphes bruts.
      const echantillon = pages.flatMap((p) => p.runs).map((r) => r.text).join(' ')
      expect(echantillon).toMatch(/[a-zà-ÿ]{4,}/i)
    })
  }
})

describe('applyTextEdits', () => {
  it('refuse une demande vide', async () => {
    await expect(applyTextEdits(new Uint8Array([1]), [])).rejects.toBeInstanceOf(PdfEditError)
  })

  it('remplace un passage et laisse tout le reste intact', async () => {
    const bytes = charger('lic-tech 3.pdf')
    if (!bytes) return
    const pages = await readEditableText(bytes)
    // Un passage assez long pour être identifiable, et en minuscules pour que la
    // transformation soit encodable avec les glyphes déjà présents.
    const page = pages.find((p) => p.runs.some((r) => /[a-z]{6,}/.test(r.text)))!
    const run = page.runs.find((r) => /[a-z]{6,}/.test(r.text))!
    const mot = /[a-z]{6,}/.exec(run.text)![0]
    const remplace = run.text.replace(mot, mot.split('').reverse().join(''))

    const avant = await texteDe(bytes, page.page)
    const rapport = await applyTextEdits(bytes, [{ page: page.page, from: run.text, to: remplace }])
    expect(rapport.applied).toBe(1)
    expect(rapport.refused).toEqual([])

    const apres = await texteDe(rapport.bytes, page.page)
    // Le nombre de lignes ne bouge pas : on n'a rien supprimé ni ajouté à la page.
    expect(apres.length).toBe(avant.length)
    // Toutes les lignes NON visées sont identiques, au caractère près.
    const inchangees = avant.filter((t) => t !== run.text)
    for (const ligne of inchangees) expect(apres).toContain(ligne)
  })

  it('ne touche pas aux octets du document source', async () => {
    const bytes = charger('lic-tech 3.pdf')
    if (!bytes) return
    const copie = bytes.slice()
    const pages = await readEditableText(bytes)
    const run = pages.flatMap((p) => p.runs.map((r) => ({ p: p.page, r }))).find((x) => /[a-z]{6,}/.test(x.r.text))!
    await applyTextEdits(bytes, [{ page: run.p, from: run.r.text, to: run.r.text.toUpperCase() }])
    expect(bytes).toEqual(copie)
  })

  it('SIGNALE les caractères que la police ne sait pas écrire', async () => {
    const bytes = charger('lic-tech 3.pdf')
    if (!bytes) return
    const pages = await readEditableText(bytes)
    const cible = pages.flatMap((p) => p.runs.map((r) => ({ p: p.page, r }))).find((x) => x.r.text.length > 5)!
    // Des idéogrammes ne peuvent être dans aucun sous-ensemble latin : la demande doit
    // être refusée en NOMMANT les caractères, jamais écrite à moitié.
    await expect(applyTextEdits(bytes, [{ page: cible.p, from: cible.r.text, to: '漢字テスト' }]))
      .rejects.toThrow(/police/i)
  })

  it('signale un passage introuvable au lieu d’écrire ailleurs', async () => {
    const bytes = charger('lic-tech 3.pdf')
    if (!bytes) return
    await expect(applyTextEdits(bytes, [{ page: 1, from: 'ce texte n’existe pas', to: 'x' }]))
      .rejects.toThrow(/introuvable/i)
  })

  it('applique plusieurs remplacements sur la même page', async () => {
    const bytes = charger('manual.pdf')
    if (!bytes) return
    const pages = await readEditableText(bytes)
    const page = pages.find((p) => p.runs.filter((r) => /[a-z]{6,}/.test(r.text)).length >= 2)
    if (!page) return
    const cibles = page.runs.filter((r) => /[a-z]{6,}/.test(r.text)).slice(0, 2)
    const rapport = await applyTextEdits(bytes, cibles.map((r) => ({
      page: page.page,
      from: r.text,
      to: r.text.replace(/[a-z]{6,}/, (m) => m.split('').reverse().join('')),
    })))
    expect(rapport.applied).toBe(2)
  })

  it('produit un PDF que MuPDF rouvre sans erreur', async () => {
    const bytes = charger('plan-licence 5.pdf')
    if (!bytes) return
    const pages = await readEditableText(bytes)
    const cible = pages.flatMap((p) => p.runs.map((r) => ({ p: p.page, r }))).find((x) => /[a-z]{6,}/.test(x.r.text))!
    const rapport = await applyTextEdits(bytes, [{ page: cible.p, from: cible.r.text, to: cible.r.text.replace(/[a-z]{6,}/, 'test') }])
    const mupdf = await import('mupdf')
    const relu = mupdf.Document.openDocument(rapport.bytes, 'application/pdf')
    expect(relu.countPages()).toBeGreaterThan(0)
    expect(String.fromCharCode(...rapport.bytes.slice(0, 5))).toBe('%PDF-')
  })
})
