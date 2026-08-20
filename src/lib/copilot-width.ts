// Largeur du panneau copilote — cœur pur, partagé par le séparateur (glisser, clavier,
// double-clic) et par la relecture des préférences au démarrage.
//
// Le panneau est le dernier élément de la barre horizontale : son bord droit ne bouge
// jamais, donc sa largeur se déduit directement de la position du pointeur. Tout ce qui
// suit ne fait que la borner.

export const COPILOT_MIN_WIDTH = 300
export const COPILOT_DEFAULT_WIDTH = 400
/** Au-delà, le bouton « Agrandir le chat » est le bon geste, pas le séparateur. */
export const COPILOT_MAX_WIDTH = 1600
/** Ce qu'on garde à la zone document quand on tire le séparateur vers la gauche. */
export const COPILOT_MIN_DOCUMENT_WIDTH = 320

/**
 * Borne une largeur de panneau.
 *
 * `available` est la place partagée par le document et le panneau (sidebar exclue).
 * Sur une fenêtre trop étroite pour les deux, le minimum du PANNEAU l'emporte : mieux
 * vaut un document serré qu'un copilote illisible — la feuille de style borne de toute
 * façon l'ensemble à la fenêtre (`calc(100vw - 40px)`), et sans ce plancher les deux
 * bornes s'inverseraient.
 */
export function clampCopilotWidth(width: number, available = Number.POSITIVE_INFINITY): number {
  if (!Number.isFinite(width)) return COPILOT_DEFAULT_WIDTH
  const room = Number.isFinite(available) ? available - COPILOT_MIN_DOCUMENT_WIDTH : COPILOT_MAX_WIDTH
  const max = Math.max(COPILOT_MIN_WIDTH, Math.min(COPILOT_MAX_WIDTH, room))
  return Math.round(Math.min(Math.max(width, COPILOT_MIN_WIDTH), max))
}
