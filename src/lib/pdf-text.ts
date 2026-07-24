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

export interface PdfExtraction {
  text: string
  pageCount: number
  // Caractères NON blancs (mesure la matière réelle — sert au seuil « scanné »).
  charCount: number
  // Aucune couche texte utilisable (PDF image/scanné) : l'appelant affiche un message
  // honnête et ne fabrique PAS de faux texte.
  scanned: boolean
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
  // sauts de ligne triplés entre pages.
  const pageTexts = pages.map((p) => assemblePageText(p).trim()).filter(Boolean)
  const text = pageTexts.join('\n\n')
  const charCount = nonWhitespaceCount(text)
  const scanned = detectScanned(charCount, pages.length)
  return { text: scanned ? '' : text, pageCount: pages.length, charCount, scanned }
}
