// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { REVEAL_CLASS, plainMarkdown, revealBudget, revealDelta, streamReveal } from './copilot-stream-reveal'

describe('revealDelta', () => {
  it('rend la suite quand le texte se prolonge', () => {
    expect(revealDelta('Bon', 'Bonjour')).toBe('jour')
    expect(revealDelta('Bon', 'Bon')).toBe('')
  })
  it('rend null quand le texte est réécrit', () => {
    expect(revealDelta('Bonjour', 'Salut')).toBeNull()
  })
})

describe('revealBudget', () => {
  it('écrit au moins 60 caractères/s, en gardant le reliquat', () => {
    const a = revealBudget(10, 16)
    expect(a.count).toBe(0)
    const b = revealBudget(10, 16, a.carry)
    expect(b.count).toBe(1)
  })
  it('accélère sur un long paquet, retard ≤ 700 ms', () => {
    const { count } = revealBudget(700, 100)
    expect(count).toBe(100)
  })
  it('ne dépasse jamais ce qui attend', () => {
    expect(revealBudget(3, 1000)).toEqual({ count: 3, carry: 0 })
    expect(revealBudget(0, 16)).toEqual({ count: 0, carry: 0 })
  })
})

describe('streamReveal', () => {
  const spans = (node: HTMLElement) => node.querySelectorAll(`.${REVEAL_CLASS}`)
  let frames: FrameRequestCallback[] = []
  let now = 0
  const runFrames = (n: number) => {
    for (let i = 0; i < n && frames.length; i++) {
      const batch = frames
      frames = []
      now += 16
      batch.forEach((cb) => cb(now))
    }
  }

  beforeEach(() => {
    frames = []
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb))
    vi.stubGlobal('cancelAnimationFrame', () => (frames = []))
  })
  afterEach(() => vi.unstubAllGlobals())

  it("n'anime pas le contenu présent au montage", () => {
    const node = document.createElement('div')
    streamReveal(node, 'Déjà là')
    expect(node.textContent).toBe('Déjà là')
    expect(spans(node)).toHaveLength(0)
  })

  it('écrit le texte nouveau peu à peu, jamais d’un bloc, puis le rend au texte nu', () => {
    const node = document.createElement('div')
    const action = streamReveal(node, 'Bonjour')
    action.update('Bonjour le monde entier')
    expect(node.textContent).toBe('Bonjour')
    runFrames(1)
    const partial = node.textContent!
    expect(partial.length).toBeGreaterThan('Bonjour'.length)
    expect(partial.length).toBeLessThan('Bonjour le monde entier'.length)
    runFrames(200)
    expect(node.textContent).toBe('Bonjour le monde entier')

    for (const span of [...spans(node)]) span.dispatchEvent(new Event('animationend', { bubbles: true }))
    expect(spans(node)).toHaveLength(0)
    expect(node.childNodes).toHaveLength(1)
  })

  it('réécrit sans animation un texte qui ne prolonge plus le précédent', () => {
    const node = document.createElement('div')
    const action = streamReveal(node, 'Ancien texte')
    action.update('Ancien texte suite')
    action.update('Autre')
    expect(node.textContent).toBe('Autre')
    expect(spans(node)).toHaveLength(0)
    runFrames(10)
    expect(node.textContent).toBe('Autre')
  })
})

describe('plainMarkdown', () => {
  it('retire gras, titres, citations et code, garde les puces', () => {
    expect(plainMarkdown('## Titre\n**Gras** et `code`\n> cité\n- un\n* deux')).toBe('Titre\nGras et code\ncité\n• un\n• deux')
  })
  it('masque clôtures de code et filets', () => {
    expect(plainMarkdown('```js\nx = 1\n```\n---')).toBe('\nx = 1\n\n')
  })
  it('garde snake_case et les listes numérotées', () => {
    expect(plainMarkdown('1. a_b_c')).toBe('1. a_b_c')
  })
  it("reste un prolongement d'un préfixe à l'autre", () => {
    const md = 'Voici :\n* **un** point\n## Suite\n- `x` et *y*\n> fin'
    let shown = ''
    for (let i = 0; i <= md.length; i++) {
      const next = plainMarkdown(md.slice(0, i))
      expect(next.startsWith(shown), `préfixe ${i} : ${JSON.stringify(md.slice(0, i))}`).toBe(true)
      shown = next
    }
  })
})
