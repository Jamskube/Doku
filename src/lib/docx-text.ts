// Texte d'un DOCX pour le copilote (portée « Document »).
//
// Jusqu'ici, poser une question sur un `.docx` ouvert envoyait au modèle un document
// nommé mais VIDE : `tab.content` vaut `''` pour tout kind binaire — c'est ce qui empêche
// un Ctrl+S d'écraser le fichier — et le copilote n'avait de branche que pour le PDF.
// Le modèle ne recevait rien, et rien ne le disait ; il répondait donc à côté ou brodait.
//
// L'extraction ne réinvente rien : `parseDocxDocument` lit déjà `word/document.xml` pour
// l'export DOCX → PDF. On réutilise le même modèle de paragraphes.
import { parseDocxDocument } from './docx-structure'

export interface DocxExtraction {
  text: string
  paragraphs: number
  // Aucun texte exploitable : document vide, ou fait uniquement d'images et de tableaux.
  // L'appelant DOIT le dire à l'utilisateur plutôt que d'envoyer du vide au modèle.
  empty: boolean
}

// Les titres sont préfixés en Markdown. Le modèle reçoit déjà les notes Markdown de Doku
// dans cette forme : lui donner la même structure pour un DOCX évite de lui livrer un mur
// de paragraphes indifférenciés, et lui permet de citer « sous la section X ».
const MARQUEUR: Record<string, string> = {
  heading1: '# ',
  heading2: '## ',
  heading3: '### ',
  paragraph: '',
}

export function docxTextFromXml(xml: string, parse: (source: string) => Document): DocxExtraction {
  const structure = parseDocxDocument(xml, parse)
  const lignes: string[] = []
  for (const paragraphe of structure.paragraphs) {
    const contenu = paragraphe.runs.map((run) => run.text).join('').trim()
    if (!contenu) continue
    lignes.push((MARQUEUR[paragraphe.kind] ?? '') + contenu)
  }
  const text = lignes.join('\n\n')
  return { text, paragraphs: lignes.length, empty: !text.trim() }
}

export class DocxTextError extends Error {}

export async function extractDocxText(
  bytes: Uint8Array,
  parse: (source: string) => Document,
): Promise<DocxExtraction> {
  // JSZip est chargé à la demande, comme dans `docx-to-pdf` : rien de tout ceci n'a sa
  // place dans le bundle de démarrage d'un éditeur Markdown.
  const { default: JSZip } = await import('jszip')
  let xml: string
  try {
    const zip = await JSZip.loadAsync(bytes)
    const entry = zip.file('word/document.xml')
    if (!entry) throw new Error('document.xml absent')
    xml = await entry.async('string')
  } catch {
    throw new DocxTextError('Ce document Word n’a pas pu être ouvert (archive illisible).')
  }
  return docxTextFromXml(xml, parse)
}
