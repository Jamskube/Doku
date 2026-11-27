// Lentille de l'îlot (Liquid Glass) : le verre ne floute pas ce qui passe dessous, il le COURBE
// près de son bord, comme un verre d'eau. Carte de déplacement pour `feDisplacementMap` : rouge =
// décalage horizontal, vert = vertical, 128 = aucun. Au cœur, rien ne bouge ; dans la bande du
// bord, on va chercher le fond plus à l'intérieur, d'autant plus fort qu'on s'approche du contour.

/** Pixels RGBA (w × h) de la carte d'une pilule de rayon `radius`, bande de lentille `rim` px. */
export function lensMapPixels(w: number, h: number, radius: number, rim: number): Uint8ClampedArray<ArrayBuffer> {
  const px = new Uint8ClampedArray(new ArrayBuffer(w * h * 4))
  const r = Math.min(radius, w / 2, h / 2)
  const hx = w / 2 - r
  const hy = h / 2 - r
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Distance signée au contour d'un rectangle arrondi (négative dedans) et normale sortante.
      const px0 = x + 0.5 - w / 2
      const py0 = y + 0.5 - h / 2
      const qx = Math.abs(px0) - hx
      const qy = Math.abs(py0) - hy
      let nx: number
      let ny: number
      let d: number
      if (qx > 0 && qy > 0) {
        const len = Math.hypot(qx, qy)
        d = len - r
        nx = (qx / len) * Math.sign(px0)
        ny = (qy / len) * Math.sign(py0)
      } else if (qx > qy) {
        d = qx - r
        nx = Math.sign(px0)
        ny = 0
      } else {
        d = qy - r
        nx = 0
        ny = Math.sign(py0)
      }
      const depth = -d
      // Biseau convexe : nul au-delà de la bande, maximal au contour.
      const t = depth >= rim ? 0 : Math.pow(1 - Math.max(depth, 0) / rim, 2)
      const i = (y * w + x) * 4
      px[i] = 128 - 127 * nx * t
      px[i + 1] = 128 - 127 * ny * t
      px[i + 2] = 128
      px[i + 3] = 255
    }
  }
  return px
}

/** Carte en data URL (canvas). Chaîne vide hors navigateur ou pour une taille nulle. */
export function lensMapUrl(w: number, h: number, radius: number, rim: number): string {
  if (w < 1 || h < 1 || typeof document === 'undefined') return ''
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  ctx.putImageData(new ImageData(lensMapPixels(w, h, radius, rim), w, h), 0, 0)
  return canvas.toDataURL()
}
