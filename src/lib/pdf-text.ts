// Assemblage du texte d'un PDF + détection « scanné » (18.1, Epic 18). Couche PURE,
// SANS import pdfjs (pdf.ts initialise son worker au niveau module → browser-only) :
// testable sous Node. pdf.ts fournit les items bruts par page ; ici on reconstruit le
// texte et on décide si le PDF a une couche texte utilisable.
//
// Ce que cette couche NE couvre PAS (leçon S10/S11, limites documentées) :
// - Ordre de lecture MULTI-COLONNES / tableaux : l'ordre des items suit le flux du
//   contenu du PDF, pas la lecture visuelle → colonnes entrelacées possibles.
// - CJK sans CMap (limite pdf.ts, ADR-0011) : `str` revient vide/mojibake.
// - PAS d'OCR : un PDF scanné est SIGNALÉ (`scanned`), jamais deviné (règle FR-4).

// Un item de texte pdf.js réduit aux deux champs utiles (cf. TextItem : `str` = contenu
// normalisé, `hasEOL` = suivi d'un saut de ligne — le signal AUTORITAIRE des retours).
export interface PdfTextItem {
  str: string
  hasEOL: boolean
}

// Position [start, end) de chaque item dans le texte assemblé de SA page — permet de
// retrouver les items couverts par un passage cité (surlignage dans le viewer).
export interface PdfItemRange {
  start: number
  end: number
}

// Comme assemblePageText, en notant la plage de chaque item (le `\n` d'un hasEOL est
// compté dans la plage de l'item qui le porte — sans incidence sur le recouvrement).
export function assemblePageItems(items: PdfTextItem[]): { text: string; ranges: PdfItemRange[] } {
  let text = ''
  const ranges: PdfItemRange[] = []
  for (const it of items) {
    const start = text.length
    if (typeof it.str === 'string') {
      text += it.str
      if (it.hasEOL) text += '\n'
    }
    ranges.push({ start, end: text.length })
  }
  return { text, ranges }
}

// Plage [start, end) d'un passage cité dans le texte d'une page : ancre par la première
// ligne du passage (mêmes sondes que locateOffset) puis étend caractère par caractère
// tant que la page suit le passage — s'arrête à la première divergence (chunk à cheval
// sur deux pages, blancs normalisés différemment…). Toujours au moins la sonde.
export function matchPassageRange(
  pageText: string,
  passage: string,
  anchor: { index: number; length: number },
): PdfItemRange {
  // Aligne le passage sur son propre début utile (première ligne non vide).
  let p = 0
  while (p < passage.length && (passage[p] === '\n' || passage[p] === ' ' || passage[p] === '\t')) p++
  let k = 0
  while (
    anchor.index + k < pageText.length &&
    p + k < passage.length &&
    pageText[anchor.index + k] === passage[p + k]
  ) {
    k++
  }
  return { start: anchor.index, end: anchor.index + Math.max(k, anchor.length) }
}

export interface PdfExtraction {
  text: string
  pageCount: number
  // Caractères NON blancs (mesure la matière réelle — sert au seuil « scanné »).
  charCount: number
  // Aucune couche texte utilisable (PDF image/scanné) : l'appelant affiche un message
  // honnête et ne fabrique PAS de faux texte.
  scanned: boolean
  // Offset de départ du texte de chaque page NON VIDE dans `text` (ordre croissant).
  // Les pages sans matière (images d'un PDF mixte) n'y figurent pas — `page` garde leur
  // numéro RÉEL. Sert aux citations ancrées : passage cité → offset → page du viewer.
  pageStarts: { page: number; start: number }[]
}

// Seuils du « scanné » : biais assumé vers « NON scanné ». Un faux « scanné » masquerait
// un vrai PDF texte (perte de fonction) ; un texte quasi-vide déclaré « non scanné »
// laisse au copilote un « je ne trouve pas » honnête (dégradation douce). On ne signale
// donc « scanné » que sur un document QUASI VIDE.
const SCANNED_MIN_TOTAL = 4

// Concatène les items d'UNE page dans l'ordre, insérant un saut de ligne après chaque
// item marqué `hasEOL`. Les items sans `str` (marked-content, jamais demandé mais garde
// défensive) sont ignorés. Le texte pdf.js est déjà normalisé (blancs → 0x20).
export function assemblePageText(items: PdfTextItem[]): string {
  let out = ''
  for (const it of items) {
    if (typeof it.str !== 'string') continue
    out += it.str
    if (it.hasEOL) out += '\n'
  }
  return out
}

// Compte les caractères non blancs (matière réelle, indépendante des espaces de mise en page).
function nonWhitespaceCount(s: string): number {
  return s.replace(/\s/g, '').length
}

// Aucune couche texte utilisable ? Vrai seulement si le document entier est quasi vide.
export function detectScanned(charCount: number, pageCount: number): boolean {
  return charCount < Math.max(SCANNED_MIN_TOTAL, pageCount)
}

// Assemble le document complet à partir des items par page. Pages jointes par une ligne
// vide (séparateur de page lisible pour le LLM). `scanned` décidé sur le total non blanc.
export function buildPdfExtraction(pages: PdfTextItem[][]): PdfExtraction {
  // Trim par page (le dernier item porte souvent un `hasEOL` → `\n` final) puis écarte
  // les pages sans matière (page image d'un PDF mixte) avant la jointure : évite les
  // sauts de ligne triplés entre pages. On note l'offset de départ de chaque page gardée
  // (numéro RÉEL conservé) pour retrouver la page d'un passage cité.
  const pageStarts: { page: number; start: number }[] = []
  let text = ''
  for (let i = 0; i < pages.length; i++) {
    const t = assemblePageText(pages[i]).trim()
    if (!t) continue
    if (text) text += '\n\n'
    pageStarts.push({ page: i + 1, start: text.length })
    text += t
  }
  const charCount = nonWhitespaceCount(text)
  const scanned = detectScanned(charCount, pages.length)
  return { text: scanned ? '' : text, pageCount: pages.length, charCount, scanned, pageStarts: scanned ? [] : pageStarts }
}

// Page contenant l'offset donné dans `text` : dernière page dont le départ est ≤ offset.
export function pageForOffset(pageStarts: { page: number; start: number }[], offset: number): number | null {
  let found: number | null = null
  for (const p of pageStarts) {
    if (p.start > offset) break
    found = p.page
  }
  return found
}
