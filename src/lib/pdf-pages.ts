// Recomposition des pages d'un PDF (ADR-0022, palier 2) : pivoter, supprimer,
// réordonner, insérer un autre document.
//
// Le principe : on ne touche à rien tant que l'utilisateur n'a pas validé. Toutes les
// manipulations construisent un PLAN — la liste des pages du document de sortie, chacune
// désignant sa page d'origine — et le plan ne s'applique qu'à l'export. Annuler revient
// donc à jeter le plan, et le document source n'est jamais en jeu.
export interface PdfPagePlanEntry {
  // Index du document d'origine : 0 = le document ouvert, 1+ = un PDF inséré.
  from: number
  // Index de la page dans CE document, à partir de 1.
  source: number
  // Quart(s) de tour ajoutés par l'utilisateur, EN PLUS du `/Rotate` déjà porté par la
  // page. On n'écrase pas la rotation d'origine : on compose avec elle.
  turn: number
}

export type PdfPagePlan = PdfPagePlanEntry[]

export const MAX_PDF_PLAN_PAGES = 5_000

export function identityPdfPagePlan(count: number): PdfPagePlan {
  return Array.from({ length: Math.max(0, Math.floor(count)) }, (_, index) => ({ from: 0, source: index + 1, turn: 0 }))
}

export function normalizePdfTurn(turn: number): number {
  return ((Math.round(turn) % 4) + 4) % 4
}

export function turnPdfPagePlan(plan: PdfPagePlan, index: number, delta: number): PdfPagePlan {
  if (index < 0 || index >= plan.length) return plan
  return plan.map((entry, at) => (at === index ? { ...entry, turn: normalizePdfTurn(entry.turn + delta) } : entry))
}

export function turnAllPdfPagePlan(plan: PdfPagePlan, delta: number): PdfPagePlan {
  return plan.map((entry) => ({ ...entry, turn: normalizePdfTurn(entry.turn + delta) }))
}

// Un PDF sans page n'est pas un document : la dernière page ne se supprime pas.
export function dropPdfPagePlan(plan: PdfPagePlan, index: number): PdfPagePlan {
  if (plan.length <= 1 || index < 0 || index >= plan.length) return plan
  return plan.filter((_, at) => at !== index)
}

export function movePdfPagePlan(plan: PdfPagePlan, from: number, to: number): PdfPagePlan {
  if (from < 0 || from >= plan.length) return plan
  const target = Math.min(Math.max(to, 0), plan.length - 1)
  if (target === from) return plan
  const next = plan.slice()
  const [moved] = next.splice(from, 1)
  next.splice(target, 0, moved)
  return next
}

export function insertPdfPagePlan(plan: PdfPagePlan, at: number, from: number, count: number): PdfPagePlan {
  const added: PdfPagePlan = Array.from({ length: Math.max(0, Math.floor(count)) }, (_, index) => ({
    from,
    source: index + 1,
    turn: 0,
  }))
  if (!added.length) return plan
  const target = Math.min(Math.max(at, 0), plan.length)
  const next = [...plan.slice(0, target), ...added, ...plan.slice(target)]
  return next.slice(0, MAX_PDF_PLAN_PAGES)
}

// Rien à écrire tant que le plan décrit exactement le document d'origine — évite de
// proposer un export qui ne changerait rien, et de réécrire un fichier pour rien.
export function isPdfPagePlanUnchanged(plan: PdfPagePlan, sourceCount: number): boolean {
  if (plan.length !== sourceCount) return false
  return plan.every((entry, index) => entry.from === 0 && entry.source === index + 1 && normalizePdfTurn(entry.turn) === 0)
}

export interface PdfPagePlanSummary {
  pages: number
  removed: number
  turned: number
  inserted: number
  reordered: boolean
}

// De quoi dire à l'utilisateur ce qu'il s'apprête à écrire, avant qu'il ne l'écrive.
export function summarizePdfPagePlan(plan: PdfPagePlan, sourceCount: number): PdfPagePlanSummary {
  const kept = new Set(plan.filter((entry) => entry.from === 0).map((entry) => entry.source))
  let removed = 0
  for (let page = 1; page <= sourceCount; page++) if (!kept.has(page)) removed++
  const own = plan.filter((entry) => entry.from === 0)
  return {
    pages: plan.length,
    removed,
    turned: plan.filter((entry) => normalizePdfTurn(entry.turn) !== 0).length,
    inserted: plan.filter((entry) => entry.from !== 0).length,
    // « Réordonné » ne se déduit pas du nombre de pages : c'est l'ordre relatif des
    // pages d'origine conservées qui doit avoir changé.
    reordered: own.some((entry, index) => index > 0 && entry.source < own[index - 1].source),
  }
}
