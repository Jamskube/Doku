export interface FittedPdfPage {
  cssWidth: number
  cssHeight: number
  renderScale: number
}

export function fitPdfPage(
  containerWidth: number,
  horizontalPadding: number,
  pageWidth: number,
  pageHeight: number,
  devicePixelRatio: number,
): FittedPdfPage {
  const safePageWidth = Math.max(1, pageWidth)
  const safePageHeight = Math.max(1, pageHeight)
  const cssWidth = Math.max(1, containerWidth - horizontalPadding)
  const cssScale = cssWidth / safePageWidth
  const dpr = Math.min(Math.max(devicePixelRatio || 1, 1), 3)

  return {
    cssWidth,
    cssHeight: safePageHeight * cssScale,
    renderScale: cssScale * dpr,
  }
}
