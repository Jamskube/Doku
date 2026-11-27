// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { HOLD_MS, holdSpace, setHoldSpaceHandler } from './hold-space'

const calls: string[] = []
let enabled = true
let view: EditorView

const key = (type: 'keydown' | 'keyup', k: string, init: KeyboardEventInit = {}) =>
  view.contentDOM.dispatchEvent(new KeyboardEvent(type, { key: k, bubbles: true, cancelable: true, ...init }))

beforeEach(() => {
  vi.useFakeTimers()
  calls.length = 0
  enabled = true
  setHoldSpaceHandler({ enabled: () => enabled, start: () => calls.push('start'), stop: () => calls.push('stop') })
  view = new EditorView({ state: EditorState.create({ doc: 'ab', selection: { anchor: 2 }, extensions: holdSpace }), parent: document.body })
})

afterEach(() => {
  view.destroy()
  setHoldSpaceHandler(null)
  vi.useRealTimers()
})

describe('holdSpace', () => {
  it('frappe brève : une espace, pas de dictée', () => {
    key('keydown', ' ')
    vi.advanceTimersByTime(HOLD_MS - 50)
    key('keyup', ' ')
    expect(view.state.doc.toString()).toBe('ab ')
    expect(calls).toEqual([])
  })

  it('maintenue : dictée de l’appui au relâchement, aucune espace tapée (répétitions comprises)', () => {
    key('keydown', ' ')
    vi.advanceTimersByTime(HOLD_MS + 10)
    key('keydown', ' ', { repeat: true })
    key('keydown', ' ', { repeat: true })
    key('keyup', ' ')
    expect(calls).toEqual(['start', 'stop'])
    expect(view.state.doc.toString()).toBe('ab')
  })

  it('frappe rapide (« a b ») : l’espace part avant la touche suivante', () => {
    key('keydown', ' ')
    expect(key('keydown', 'c')).toBe(true) // non consommée : CM6 la tape ensuite
    expect(view.state.doc.toString()).toBe('ab ')
    vi.advanceTimersByTime(HOLD_MS * 2)
    expect(calls).toEqual([])
  })

  it('perte du focus en pleine dictée : la dictée s’arrête', () => {
    key('keydown', ' ')
    vi.advanceTimersByTime(HOLD_MS + 10)
    view.contentDOM.dispatchEvent(new FocusEvent('blur'))
    expect(calls).toEqual(['start', 'stop'])
  })

  it('mode inactif ou avec modificateur : Espace normale (laissée à l’éditeur)', () => {
    enabled = false
    expect(key('keydown', ' ')).toBe(true)
    enabled = true
    expect(key('keydown', ' ', { ctrlKey: true })).toBe(true)
    vi.advanceTimersByTime(HOLD_MS * 2)
    expect(calls).toEqual([])
  })
})
