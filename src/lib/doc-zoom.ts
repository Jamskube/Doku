// Zoom du texte des documents (Ctrl+molette, Ctrl+0/=/-) : un facteur global, mémorisé,
// porté par la variable CSS --doc-zoom que lit la typographie de l'éditeur (editor.ts).
export const DOC_ZOOM_MIN = 0.7
export const DOC_ZOOM_MAX = 2

// `step` : +1 grossit de 10 %, -1 réduit, 0 revient à 100 %. Arrondi au dixième : sans lui,
// 1.1 + 0.1 donne 1.2000000000000002 et le badge afficherait des pourcentages faux.
export function nextDocZoom(current: number, step: 1 | -1 | 0): number {
  if (step === 0) return 1
  const next = Math.round((current + step / 10) * 10) / 10
  return Math.min(DOC_ZOOM_MAX, Math.max(DOC_ZOOM_MIN, next))
}

// Valeur relue des réglages : tout ce qui n'est pas un nombre fini retombe à 100 %.
export function parseDocZoom(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 1
  return Math.min(DOC_ZOOM_MAX, Math.max(DOC_ZOOM_MIN, Math.round(value * 10) / 10))
}
