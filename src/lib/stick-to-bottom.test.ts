import { describe, expect, it } from 'vitest'
import { createStickToBottom, NEAR_BOTTOM_PX, SMOOTH_SETTLE_MS, type ScrollBox } from './stick-to-bottom'

// Boîte de défilement factice : scrollTop borné comme un vrai scroller.
function makeBox(scrollHeight = 2000, clientHeight = 500) {
  let top = scrollHeight - clientHeight
  const box = {
    scrollHeight,
    clientHeight,
    get scrollTop() { return top },
    set scrollTop(v: number) { top = Math.max(0, Math.min(v, box.scrollHeight - box.clientHeight)) },
    smoothCalls: 0,
    scrollTo() { box.smoothCalls++ },
  }
  return box satisfies ScrollBox
}

function setup() {
  const box = makeBox()
  let clock = 0
  const changes: boolean[] = []
  const stick = createStickToBottom(box, (v) => changes.push(v), () => clock)
  const scrollTo = (top: number) => { box.scrollTop = top; stick.onScroll() }
  return { box, stick, changes, scrollTo, advance: (ms: number) => (clock += ms) }
}

describe('createStickToBottom', () => {
  it('décroche dès que l’utilisateur remonte, même de quelques pixels', () => {
    const { stick, changes, scrollTo } = setup()
    scrollTo(1500 - 10)
    expect(stick.following).toBe(false)
    expect(changes).toEqual([false])
  })

  it('reprend le suivi en redescendant à moins de 96 px du bas, pas au-delà', () => {
    const { stick, scrollTo } = setup()
    scrollTo(800)
    scrollTo(1500 - NEAR_BOTTOM_PX - 1)
    expect(stick.following).toBe(false)
    scrollTo(1500 - NEAR_BOTTOM_PX)
    expect(stick.following).toBe(true)
  })

  it('pin ne ramène en bas que si l’on suit', () => {
    const { box, stick, scrollTo } = setup()
    box.scrollHeight = 2400
    stick.pin()
    expect(box.scrollTop).toBe(1900)
    scrollTo(1000)
    box.scrollHeight = 2800
    stick.pin()
    expect(box.scrollTop).toBe(1000)
  })

  it('un contenu qui rétrécit rabat scrollTop sans faire décrocher', () => {
    const { box, stick } = setup()
    box.scrollHeight = 1800
    box.scrollTop = box.scrollTop // rabattu par le navigateur
    stick.onScroll()
    expect(stick.following).toBe(true)
  })

  it('ignore les positions intermédiaires de son propre défilement doux pendant 700 ms', () => {
    const { box, stick, scrollTo, advance } = setup()
    scrollTo(200)
    stick.scrollToBottom(true)
    expect(box.smoothCalls).toBe(1)
    expect(stick.following).toBe(true)
    scrollTo(600)
    expect(stick.following).toBe(true)
    advance(SMOOTH_SETTLE_MS)
    scrollTo(300)
    expect(stick.following).toBe(false)
  })

  it('scrollToBottom instantané épingle et suit', () => {
    const { box, stick, changes, scrollTo } = setup()
    scrollTo(100)
    stick.scrollToBottom(false)
    expect(box.scrollTop).toBe(1500)
    expect(stick.following).toBe(true)
    expect(changes).toEqual([false, true])
  })
})
