export interface FittedPdfPage {
  cssWidth: number
  cssHeight: number
  renderScale: number
}

// Le zoom 100 % est la vue par défaut : la page occupe la largeur utile du lecteur.
// Zoomer multiplie cette largeur — la « taille normale » reste donc ce que l'on voit
// en ouvrant le document, et non une taille physique abstraite.
export const PDF_ZOOM_LEVELS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4] as const
export const PDF_MIN_ZOOM = PDF_ZOOM_LEVELS[0]
export const PDF_MAX_ZOOM = PDF_ZOOM_LEVELS[PDF_ZOOM_LEVELS.length - 1]
// Plafond du backing store d'une page, en pixels (~64 Mo en RGBA). Sans lui, un zoom
// 4 sur un écran à DPR 2 demanderait 64 fois plus de pixels qu'à l'ouverture — de quoi
// saturer la mémoire d'une tablette ARM sur un document A3. Le seuil est choisi pour
// qu'un A4 à 200 % reste rendu à pleine finesse : on ne dégrade qu'au-delà.
const MAX_CANVAS_PIXELS = 16_000_000

export function clampPdfZoom(zoom: number): number {
  return Math.min(Math.max(Number.isFinite(zoom) ? zoom : 1, PDF_MIN_ZOOM), PDF_MAX_ZOOM)
}

// Palier suivant ou précédent : des crans francs valent mieux qu'un pas continu pour
// retrouver un repère (et notamment retomber pile sur 100 %).
export function stepPdfZoom(zoom: number, direction: 1 | -1): number {
  const current = clampPdfZoom(zoom)
  const levels = direction > 0 ? PDF_ZOOM_LEVELS : [...PDF_ZOOM_LEVELS].reverse()
  return clampPdfZoom(levels.find((level) => (direction > 0 ? level > current + 0.001 : level < current - 0.001)) ?? current)
}

export function fitPdfPage(
  containerWidth: number,
  horizontalPadding: number,
  pageWidth: number,
  pageHeight: number,
  devicePixelRatio: number,
  zoom = 1,
): FittedPdfPage {
  const safePageWidth = Math.max(1, pageWidth)
  const safePageHeight = Math.max(1, pageHeight)
  const cssWidth = Math.max(1, (containerWidth - horizontalPadding) * clampPdfZoom(zoom))
  const cssScale = cssWidth / safePageWidth
  const dpr = Math.min(Math.max(devicePixelRatio || 1, 1), 3)
  const wanted = cssScale * dpr
  // Au-delà du plafond, la page est rendue moins finement et l'affichage l'agrandit :
  // un léger flou en zoom extrême plutôt qu'un canvas ingérable.
  const budget = Math.sqrt(MAX_CANVAS_PIXELS / (safePageWidth * safePageHeight))

  return {
    cssWidth,
    cssHeight: safePageHeight * cssScale,
    renderScale: Math.min(wanted, budget),
  }
}
