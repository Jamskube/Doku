export interface Box { left: number; top: number; width: number; height: number }
export interface HoverCardPlacement { left: number; top: number; side: 'top' | 'bottom'; originX: number }

/**
 * Place une carte de survol (Kube Popover / hover card) sous son déclencheur, alignée sur
 * son bord gauche ; elle passe au-dessus quand la place manque en bas ET qu'il y en a plus
 * en haut, puis glisse le long du bord pour rester à `pad` de la fenêtre. `originX` pointe
 * vers le centre du déclencheur : la carte grandit depuis lui.
 */
export function placeHoverCard(
  anchor: Box,
  card: { width: number; height: number },
  viewport: { width: number; height: number },
  gap = 6,
  pad = 8,
): HoverCardPlacement {
  const anchorBottom = anchor.top + anchor.height
  const roomBelow = viewport.height - anchorBottom - gap - pad
  const roomAbove = anchor.top - gap - pad
  const side = card.height <= roomBelow || roomBelow >= roomAbove ? 'bottom' : 'top'
  const top = side === 'bottom' ? anchorBottom + gap : anchor.top - gap - card.height
  const left = Math.max(pad, Math.min(anchor.left, viewport.width - pad - card.width))
  const originX = Math.max(0, Math.min(card.width, anchor.left + anchor.width / 2 - left))
  return { left, top, side, originX }
}
