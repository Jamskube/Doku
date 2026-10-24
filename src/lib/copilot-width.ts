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
/** Plancher absolu du panneau ouvert, quand la fenêtre ne loge plus document ET panneau. */
export const COPILOT_FLOOR_WIDTH = 240
/** Largeur de la barre latérale ouverte — miroir de `.sidebar.open` (Sidebar.svelte). */
export const SIDEBAR_OPEN_WIDTH = 296

/**
 * Borne une largeur de panneau.
 *
 * `available` est la place partagée par le document et le panneau (sidebar exclue).
 * Sur une fenêtre trop étroite pour les deux, le minimum du PANNEAU l'emporte : mieux
 * vaut un document serré qu'un copilote illisible — la feuille de style borne de toute
 * façon l'ensemble à la fenêtre (`copilotMaxWidthCss`), et sans ce plancher les deux
 * bornes s'inverseraient.
 */
export function clampCopilotWidth(width: number, available = Number.POSITIVE_INFINITY): number {
  if (!Number.isFinite(width)) return COPILOT_DEFAULT_WIDTH
  const room = Number.isFinite(available) ? available - COPILOT_MIN_DOCUMENT_WIDTH : COPILOT_MAX_WIDTH
  const max = Math.max(COPILOT_MIN_WIDTH, Math.min(COPILOT_MAX_WIDTH, room))
  return Math.round(Math.min(Math.max(width, COPILOT_MIN_WIDTH), max))
}

/**
 * Largeur CSS du panneau : des pixels seuls, car elle porte la `flex-basis` ANIMÉE du
 * rideau. Un `vw` y serait recalculé à chaque image d'un redimensionnement de fenêtre et
 * relancerait la transition à chaque fois (panneau en retard sur le bord).
 */
export function copilotWidthCss(width: number): string {
  return `${Math.round(width)}px`
}

/**
 * Borne liée à la fenêtre, posée sur une propriété NON animée (`max-width`). La préférence
 * a pu être réglée sur une fenêtre plus large : on laisse au document
 * COPILOT_MIN_DOCUMENT_WIDTH (plus la barre latérale ouverte) — sinon, entre 560 et 900 px,
 * le copilote mangeait tout le document. Sous ce seuil, le plancher garde un panneau utilisable.
 *
 * Fenêtre étroite : au plus 38 % de la fenêtre jusqu'à 1000 px (un panneau à la moitié de la
 * fenêtre laissait au document une colonne d'une quarantaine de caractères). Le terme
 * `200vw - 1620px` vaut 38vw à 1000 px et rejoint la réserve sans barre latérale à 1300 px :
 * la borne reste continue et les grandes fenêtres gardent la règle d'avant.
 */
export function copilotMaxWidthCss(sidebarOpen: boolean): string {
  const reserve = COPILOT_MIN_DOCUMENT_WIDTH + (sidebarOpen ? SIDEBAR_OPEN_WIDTH : 0)
  return `max(${COPILOT_FLOOR_WIDTH}px, min(calc(100vw - ${reserve}px), max(38vw, calc(200vw - 1620px))))`
}
