// Moteur de l'îlot (TitleIsland.svelte, accroché en haut de la feuille) : choix de ce qui
// l'occupe (file de priorité, mode partagé façon iOS) et courbes de morphose.

// Le plus prioritaire occupe l'îlot, le second bourgeonne à côté ; les autres attendent.
// À priorité égale, l'ordre d'arrivée dans la liste départage (tri stable).
export function pickLive<T extends { priority: number }>(items: readonly T[]): { main: T | null; bud: T | null } {
  const sorted = [...items].sort((a, b) => b.priority - a.priority)
  return { main: sorted[0] ?? null, bud: sorted[1] ?? null }
}

// Courbe de la grammaire glass-island : départ franc (sortie cubique, la forme réagit dès la
// première image — une entrée-sortie restait immobile ~150 ms), dépasse sa cible de `peak`
// (3 % en largeur, 2,5 % en hauteur) vers 78 % du trajet, puis s'y repose.
export function overshootEasing(peak: number, steps = 24): string {
  const out = (t: number) => 1 - (1 - t) ** 3
  const settle = (t: number) => (1 - Math.cos(Math.PI * t)) / 2
  const knee = 0.78
  const points: number[] = []
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const v = t <= knee ? (1 + peak) * out(t / knee) : 1 + peak - peak * settle((t - knee) / (1 - knee))
    points.push(Math.round(v * 1000) / 1000)
  }
  return `linear(${points.join(', ')})`
}
