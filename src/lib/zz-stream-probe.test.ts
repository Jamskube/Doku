// FICHIER TEMPORAIRE — PREUVE : éditer le texte DANS le flux de contenu, en passant
// par la table ToUnicode inversée. Rien n'est substitué : on remplace des identifiants
// de glyphes par d'autres identifiants de la MÊME police.
import { it } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'

const OUT = 'C:\\Users\\nicos\\AppData\\Local\\Temp\\claude\\G--Doku\\0844b9fe-d498-4978-97f5-d635f48e55c9\\scratchpad\\stream.txt'

// Une CMap ToUnicode associe un code de glyphe à un caractère. On lit les deux formes :
// `beginbfchar` (associations une à une) et `beginbfrange` (plages).
function lireToUnicode(cmap: string): Map<number, string> {
  const table = new Map<number, string>()
  const hex = (s: string) => Number.parseInt(s, 16)
  const texte = (s: string) => {
    let out = ''
    for (let i = 0; i + 3 < s.length + 1; i += 4) out += String.fromCharCode(hex(s.slice(i, i + 4)))
    return out
  }
  for (const bloc of cmap.match(/beginbfchar([\s\S]*?)endbfchar/g) ?? []) {
    for (const [, g, u] of bloc.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) table.set(hex(g), texte(u))
  }
  for (const bloc of cmap.match(/beginbfrange([\s\S]*?)endbfrange/g) ?? []) {
    for (const [, a, b, u] of bloc.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      const base = hex(u)
      for (let g = hex(a); g <= hex(b); g++) table.set(g, String.fromCharCode(base + g - hex(a)))
    }
  }
  return table
}

it('édite le texte dans le flux de contenu', async () => {
  const l: string[] = []
  const dire = (...p: unknown[]) => l.push(p.map((x) => typeof x === 'string' ? x : JSON.stringify(x)).join(' '))
  const mupdf = await import('mupdf')

  try {
    const bytes = readFileSync('C:\\Users\\nicos\\Downloads\\pdfmod\\lic-tech 3.pdf')
    const doc = mupdf.Document.openDocument(bytes, 'application/pdf') as InstanceType<typeof mupdf.PDFDocument>
    const page = doc.loadPage(3) as InstanceType<typeof mupdf.PDFPage>
    const obj = page.getObject()

    // --- Tables des polices de la page ------------------------------------------
    const versUnicode = new Map<string, Map<number, string>>()
    const versGlyphe = new Map<string, Map<string, number>>()
    obj.get('Resources', 'Font').forEach((valeur: InstanceType<typeof mupdf.PDFObject>, cle: string | number) => {
      const f = valeur.resolve()
      const tu = f.get('ToUnicode')
      // `readStream()` se lit sur la RÉFÉRENCE INDIRECTE : résoudre rend le
      // dictionnaire du flux, pas ses octets.
      if (!tu.isStream()) return
      const table = lireToUnicode(Buffer.from(tu.readStream().asUint8Array()).toString('latin1'))
      versUnicode.set(String(cle), table)
      const inverse = new Map<string, number>()
      for (const [g, u] of table) if (!inverse.has(u)) inverse.set(u, g)
      versGlyphe.set(String(cle), inverse)
      dire(`/${cle} : ${table.size} glyphes connus · alphabet inversé : ${inverse.size} caractères`)
    })

    const ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .,;:!?'()-–—«»\"/%€@àâäéèêëîïôöùûüçÀÂÄÉÈÊËÎÏÔÖÙÛÜÇ"
    for (const [cle, inverse] of versGlyphe) {
      const manquants = [...ALPHABET].filter((c) => !inverse.has(c))
      const pct = Math.round((ALPHABET.length - manquants.length) / ALPHABET.length * 100)
      dire(`/${cle} couvre ${pct} % de l'alphabet français · manquants (${manquants.length}) : ${manquants.slice(0, 30).join('')}`)
    }
    // Et l'union de toutes les polices de la page ?
    const union = new Set<string>()
    for (const inverse of versGlyphe.values()) for (const c of inverse.keys()) union.add(c)
    const manquantsUnion = [...ALPHABET].filter((c) => !union.has(c))
    dire(`UNION des polices : ${Math.round((ALPHABET.length - manquantsUnion.length) / ALPHABET.length * 100)} % · manquants : ${manquantsUnion.join('')}`)
  } catch (error) {
    dire('ERREUR:', String(error).slice(0, 500), (error as Error)?.stack?.slice(0, 400) ?? '')
  }
  writeFileSync(OUT, l.join('\n'))
})
