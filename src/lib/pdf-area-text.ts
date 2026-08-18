// Sélection de ZONE dans un PDF (inspirée d'Okular) — cœur pur.
//
// Pourquoi ça existe : sélectionner du texte en filant un curseur entre les mots demande
// de la dextérité, parce que le navigateur calcule ses positions de caret avec SA mise en
// page, pas celle du PDF. Encadrer une région supprime le problème au lieu de le
// compenser : on ne vise plus des caractères, on délimite une surface.
//
// Ce module ne connaît ni le DOM ni pdf.js. Il reçoit des boîtes NORMALISÉES (0..1 dans
// le repère de la page) et rend le texte, dans l'ordre de lecture. Le découpage
// horizontal fin d'un span reste à l'appelant, qui seul a la géométrie des caractères.

export interface AreaBox {
  left: number
  top: number
  width: number
  height: number
}

export interface AreaSpan extends AreaBox {
  text: string
}

/**
 * Part d'un span RECOUVERTE verticalement par la zone, entre 0 et 1.
 * Verticalement seulement : un span à cheval sur le bord droit doit être retenu et
 * découpé, pas rejeté — c'est le cas courant d'une zone qui coupe une ligne en deux.
 */
export function verticalOverlap(span: AreaBox, area: AreaBox): number {
  const spanBottom = span.top + span.height
  const areaBottom = area.top + area.height
  const covered = Math.min(spanBottom, areaBottom) - Math.max(span.top, area.top)
  if (covered <= 0) return 0
  return Math.min(1, covered / Math.max(span.height, 1e-9))
}

/** Le span croise-t-il la zone horizontalement, ne serait-ce que d'un cheveu ? */
function overlapsHorizontally(span: AreaBox, area: AreaBox): boolean {
  return span.left < area.left + area.width && span.left + span.width > area.left
}

/**
 * Seuil de recouvrement vertical. Sous ce seuil, la ligne n'est qu'effleurée par le bord
 * de la zone : la retenir ferait apparaître dans la sélection une ligne que l'utilisateur
 * n'a visiblement pas voulue. C'est le réglage qui décide si l'outil paraît précis.
 */
export const AREA_LINE_THRESHOLD = 0.45

export interface AreaHit {
  /** Index du span dans le tableau d'entrée — l'appelant s'en sert pour le découper. */
  index: number
  span: AreaSpan
}

/**
 * Spans retenus par la zone, groupés par LIGNE et ordonnés en lecture.
 *
 * Les lignes sont reconstituées par proximité verticale des centres, pas par égalité
 * exacte : dans un PDF, deux fragments d'une même ligne ont rarement le même `top` au
 * pixel près (exposants, changements de police, césures).
 */
export function areaHits(spans: readonly AreaSpan[], area: AreaBox): AreaHit[][] {
  if (area.width <= 0 || area.height <= 0) return []

  const retenus: AreaHit[] = []
  for (const [index, span] of spans.entries()) {
    if (!span.text) continue
    if (!overlapsHorizontally(span, area)) continue
    if (verticalOverlap(span, area) < AREA_LINE_THRESHOLD) continue
    retenus.push({ index, span })
  }
  if (retenus.length === 0) return []

  const centre = (h: AreaHit) => h.span.top + h.span.height / 2
  retenus.sort((a, b) => centre(a) - centre(b) || a.span.left - b.span.left)

  const lignes: AreaHit[][] = []
  let courante: AreaHit[] = []
  // Bande verticale de la ligne en cours, élargie à chaque fragment absorbé.
  let bandeHaut = 0
  let bandeBas = 0

  // Deux fragments sont sur la même ligne si le CENTRE de l'un tombe dans la BANDE
  // verticale de l'autre. Une première version comparait la distance des centres à la
  // moitié de la plus petite hauteur — règle à l'envers : plus un exposant est petit,
  // plus elle resserrait la tolérance, précisément là où les centres s'écartent le plus.
  // Le recouvrement de bandes est insensible à cette asymétrie, et reste strict entre
  // deux lignes voisines, dont les bandes ne se chevauchent pas.
  for (const hit of retenus) {
    const haut = hit.span.top
    const bas = hit.span.top + hit.span.height
    const memeLigne = courante.length > 0
      && (centre(hit) >= bandeHaut && centre(hit) <= bandeBas
        || (bandeHaut + bandeBas) / 2 >= haut && (bandeHaut + bandeBas) / 2 <= bas)
    if (memeLigne) {
      courante.push(hit)
      bandeHaut = Math.min(bandeHaut, haut)
      bandeBas = Math.max(bandeBas, bas)
      continue
    }
    if (courante.length > 0) lignes.push(courante)
    courante = [hit]
    bandeHaut = haut
    bandeBas = bas
  }
  if (courante.length > 0) lignes.push(courante)

  for (const ligne of lignes) ligne.sort((a, b) => a.span.left - b.span.left)
  return lignes
}

/**
 * Assemble les fragments en texte. Un espace entre deux fragments d'une même ligne
 * SEULEMENT s'il en manque un : un PDF découpe volontiers un mot en plusieurs spans, et
 * en insérer un systématiquement casserait les mots.
 */
export function joinAreaText(lignes: readonly (readonly string[])[]): string {
  return lignes
    .map((fragments) =>
      fragments.reduce((acc, part) => {
        if (!acc) return part
        const colle = /\s$/.test(acc) || /^\s/.test(part)
        return colle ? acc + part : `${acc} ${part}`
      }, ''),
    )
    .map((ligne) => ligne.replace(/\s+/g, ' ').trim())
    .filter((ligne) => ligne.length > 0)
    .join('\n')
}
