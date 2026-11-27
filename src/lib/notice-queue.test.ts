import { describe, expect, it } from 'vitest'
import { enqueueNotice, NOTICE_QUEUE_CAP, removeNotice, type QueuedNotice } from './notice-queue'

type N = { tone: string; title: string; message: string }
const n = (title: string, message = 'm'): N => ({ tone: 'warning', title, message })

describe('enqueueNotice', () => {
  it('met en file au lieu de remplacer', () => {
    const q: QueuedNotice<N>[] = []
    enqueueNotice(q, n('a'), 1)
    enqueueNotice(q, n('b'), 2)
    expect(q.map((e) => e.notice.title)).toEqual(['a', 'b'])
  })

  it('fusionne un doublon consécutif en gardant son id, mais rafraîchit l’objet', () => {
    const q: QueuedNotice<N>[] = []
    enqueueNotice(q, n('a'), 1)
    const again = n('a')
    enqueueNotice(q, again, 2)
    expect(q).toHaveLength(1)
    expect(q[0].id).toBe(1)
    expect(q[0].notice).toBe(again)
  })

  it('ne fusionne pas deux notifications au message différent', () => {
    const q: QueuedNotice<N>[] = []
    enqueueNotice(q, n('a', 'x'), 1)
    enqueueNotice(q, n('a', 'y'), 2)
    expect(q).toHaveLength(2)
  })

  it('plafonne en jetant la plus ancienne en attente, jamais l’affichée', () => {
    const q: QueuedNotice<N>[] = []
    for (let i = 0; i < NOTICE_QUEUE_CAP + 2; i++) enqueueNotice(q, n(`t${i}`), i)
    expect(q).toHaveLength(NOTICE_QUEUE_CAP)
    expect(q[0].notice.title).toBe('t0')
    expect(q.at(-1)!.notice.title).toBe(`t${NOTICE_QUEUE_CAP + 1}`)
  })
})

describe('removeNotice', () => {
  it('retire par id, laisse la file intacte pour un id inconnu', () => {
    const q: QueuedNotice<N>[] = []
    enqueueNotice(q, n('a'), 1)
    enqueueNotice(q, n('b'), 2)
    removeNotice(q, 9)
    expect(q).toHaveLength(2)
    removeNotice(q, 1)
    expect(q.map((e) => e.id)).toEqual([2])
  })
})
