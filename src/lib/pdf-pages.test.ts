import { describe, expect, it } from 'vitest'
import {
  dropPdfPagePlan,
  identityPdfPagePlan,
  insertPdfPagePlan,
  isPdfPagePlanUnchanged,
  movePdfPagePlan,
  normalizePdfTurn,
  summarizePdfPagePlan,
  turnAllPdfPagePlan,
  turnPdfPagePlan,
} from './pdf-pages'

const order = (plan: { source: number }[]) => plan.map((entry) => entry.source)

describe('identityPdfPagePlan', () => {
  it('décrit le document tel quel', () => {
    expect(identityPdfPagePlan(3)).toEqual([
      { from: 0, source: 1, turn: 0 },
      { from: 0, source: 2, turn: 0 },
      { from: 0, source: 3, turn: 0 },
    ])
  })

  it('tolère un compte absurde', () => {
    expect(identityPdfPagePlan(0)).toEqual([])
    expect(identityPdfPagePlan(-4)).toEqual([])
  })
})

describe('normalizePdfTurn', () => {
  it('ramène à un quart de tour', () => {
    expect(normalizePdfTurn(4)).toBe(0)
    expect(normalizePdfTurn(-1)).toBe(3)
    expect(normalizePdfTurn(7)).toBe(3)
  })
})

describe('turnPdfPagePlan', () => {
  it('pivote une seule page', () => {
    const plan = turnPdfPagePlan(identityPdfPagePlan(3), 1, 1)
    expect(plan.map((entry) => entry.turn)).toEqual([0, 1, 0])
  })

  it('revient au point de départ après quatre quarts de tour', () => {
    let plan = identityPdfPagePlan(1)
    for (let i = 0; i < 4; i++) plan = turnPdfPagePlan(plan, 0, 1)
    expect(plan[0].turn).toBe(0)
    expect(isPdfPagePlanUnchanged(plan, 1)).toBe(true)
  })

  it('ignore un index hors du plan', () => {
    const plan = identityPdfPagePlan(2)
    expect(turnPdfPagePlan(plan, 9, 1)).toBe(plan)
  })

  it('pivote tout le document d’un coup', () => {
    expect(turnAllPdfPagePlan(identityPdfPagePlan(3), -1).map((entry) => entry.turn)).toEqual([3, 3, 3])
  })
})

describe('dropPdfPagePlan', () => {
  it('supprime une page', () => {
    expect(order(dropPdfPagePlan(identityPdfPagePlan(4), 1))).toEqual([1, 3, 4])
  })

  it('refuse de vider le document', () => {
    const plan = identityPdfPagePlan(1)
    expect(dropPdfPagePlan(plan, 0)).toBe(plan)
  })
})

describe('movePdfPagePlan', () => {
  it('déplace une page vers la fin', () => {
    expect(order(movePdfPagePlan(identityPdfPagePlan(4), 0, 3))).toEqual([2, 3, 4, 1])
  })

  it('déplace une page vers le début', () => {
    expect(order(movePdfPagePlan(identityPdfPagePlan(4), 3, 0))).toEqual([4, 1, 2, 3])
  })

  it('borne la cible au lieu de perdre la page', () => {
    expect(order(movePdfPagePlan(identityPdfPagePlan(3), 0, 99))).toEqual([2, 3, 1])
    expect(order(movePdfPagePlan(identityPdfPagePlan(3), 2, -5))).toEqual([3, 1, 2])
  })

  it('ne fait rien quand la page ne bouge pas', () => {
    const plan = identityPdfPagePlan(3)
    expect(movePdfPagePlan(plan, 1, 1)).toBe(plan)
  })
})

describe('insertPdfPagePlan', () => {
  it('insère les pages d’un autre document', () => {
    const plan = insertPdfPagePlan(identityPdfPagePlan(2), 1, 1, 2)
    expect(plan.map((entry) => `${entry.from}:${entry.source}`)).toEqual(['0:1', '1:1', '1:2', '0:2'])
  })

  it('accepte une insertion en fin de document', () => {
    expect(insertPdfPagePlan(identityPdfPagePlan(2), 2, 1, 1)).toHaveLength(3)
    expect(insertPdfPagePlan(identityPdfPagePlan(2), 99, 1, 1)).toHaveLength(3)
  })

  it('ignore un document vide', () => {
    const plan = identityPdfPagePlan(2)
    expect(insertPdfPagePlan(plan, 0, 1, 0)).toBe(plan)
  })
})

describe('isPdfPagePlanUnchanged', () => {
  it('reconnaît un document intact', () => {
    expect(isPdfPagePlanUnchanged(identityPdfPagePlan(3), 3)).toBe(true)
  })

  it('détecte chaque type de modification', () => {
    expect(isPdfPagePlanUnchanged(dropPdfPagePlan(identityPdfPagePlan(3), 0), 3)).toBe(false)
    expect(isPdfPagePlanUnchanged(movePdfPagePlan(identityPdfPagePlan(3), 0, 2), 3)).toBe(false)
    expect(isPdfPagePlanUnchanged(turnPdfPagePlan(identityPdfPagePlan(3), 0, 1), 3)).toBe(false)
    expect(isPdfPagePlanUnchanged(insertPdfPagePlan(identityPdfPagePlan(3), 0, 1, 1), 3)).toBe(false)
  })
})

describe('summarizePdfPagePlan', () => {
  it('compte ce qui a été retiré', () => {
    expect(summarizePdfPagePlan(dropPdfPagePlan(identityPdfPagePlan(5), 2), 5))
      .toMatchObject({ pages: 4, removed: 1, turned: 0, inserted: 0, reordered: false })
  })

  it('voit un réordonnancement sans changement de nombre de pages', () => {
    expect(summarizePdfPagePlan(movePdfPagePlan(identityPdfPagePlan(4), 0, 3), 4))
      .toMatchObject({ pages: 4, removed: 0, reordered: true })
  })

  it('compte les pages insérées et pivotées', () => {
    const plan = turnPdfPagePlan(insertPdfPagePlan(identityPdfPagePlan(2), 2, 1, 3), 0, 1)
    expect(summarizePdfPagePlan(plan, 2)).toMatchObject({ pages: 5, removed: 0, turned: 1, inserted: 3 })
  })
})
