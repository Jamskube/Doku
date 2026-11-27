import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  const identity = <T>(value: T) => value
  Object.defineProperty(globalThis, '$state', {
    configurable: true,
    value: Object.assign(identity, { raw: identity }),
  })
})

const h = vi.hoisted(() => {
  type Msg = { role: 'user' | 'assistant'; content: string; streaming?: boolean; failed?: boolean; config?: string }
  const state = {
    copilot: { generating: false, messages: [] as Msg[] },
    conversations: { activeId: null as string | null },
    finish: null as null | (() => void),
    newChatOk: true,
    newChatCalls: 0,
    stopCalls: 0,
    opened: [] as (string | null)[],
  }
  return state
})

vi.mock('./copilot.svelte', () => ({
  copilot: h.copilot,
  newChat: async () => {
    h.newChatCalls++
    if (h.newChatOk) {
      h.copilot.messages = []
      h.conversations.activeId = null
    }
    return h.newChatOk
  },
  // Imite sendChat : pousse question + réponse en synchrone, puis rend une promesse
  // que le test résout quand il veut (fin de génération).
  sendChat: (question: string) => {
    h.conversations.activeId ??= 'conv-1'
    h.copilot.messages.push({ role: 'user', content: question })
    h.copilot.messages.push({ role: 'assistant', content: '', streaming: true })
    h.copilot.generating = true
    return new Promise<void>((resolve) => {
      h.finish = () => {
        h.copilot.generating = false
        const reply = h.copilot.messages.at(-1)!
        reply.streaming = false
        resolve()
      }
    })
  },
  stopChat: () => {
    h.stopCalls++
    h.finish?.()
  },
}))
vi.mock('./copilot-conversations.svelte', () => ({ conversations: h.conversations }))
vi.mock('./stores.svelte', () => ({
  activeTab: () => ({ name: 'note.md', content: '# Note', kind: 'md', path: 'C:/note.md' }),
  openCopilot: (view: string | null) => { h.opened.push(view) },
}))

import { closeQuickAsk, continueInCopilot, openQuickAsk, quickAsk, submitQuickAsk } from './quick-ask.svelte'

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
const reply = () => h.copilot.messages.at(-1)!

describe('quick ask state machine', () => {
  beforeEach(() => {
    closeQuickAsk()
    h.copilot.generating = false
    h.copilot.messages = []
    h.conversations.activeId = null
    h.finish = null
    h.newChatOk = true
    h.newChatCalls = 0
    h.stopCalls = 0
    h.opened = []
  })

  it('listening → thinking → answering → done, the answer streams from the copilot turn', async () => {
    openQuickAsk()
    expect(quickAsk).toMatchObject({ open: true, phase: 'listening', answer: '' })
    const pending = submitQuickAsk('  Résume ce document  ')
    expect(quickAsk.phase).toBe('thinking')
    expect(quickAsk.question).toBe('Résume ce document')
    await tick()
    expect(quickAsk.phase).toBe('thinking')
    reply().content = 'Il parle'
    expect(quickAsk.phase).toBe('answering')
    reply().content = 'Il parle de Doku.'
    expect(quickAsk.answer).toBe('Il parle de Doku.')
    h.finish!()
    await pending
    expect(quickAsk.phase).toBe('done')
    expect(h.copilot.messages.map((m) => m.role)).toEqual(['user', 'assistant'])
  })

  it('no active model → error with a French hint, Continuer opens the Models view', async () => {
    openQuickAsk()
    const pending = submitQuickAsk('Bonjour')
    await tick()
    reply().content = 'Choisissez ou téléchargez un modèle local…'
    reply().config = 'model'
    h.finish!()
    await pending
    expect(quickAsk.phase).toBe('error')
    expect(quickAsk.error).toMatch(/^Aucun modèle actif/)
    expect(quickAsk.answer).toBe('')
    continueInCopilot()
    expect(h.opened).toEqual(['models'])
    expect(quickAsk.open).toBe(false)
  })

  it('a generation failure keeps its cause', async () => {
    const pending = submitQuickAsk('Q')
    await tick()
    reply().content = 'OpenAI : quota dépassé.'
    reply().failed = true
    h.finish!()
    await pending
    expect(quickAsk).toMatchObject({ phase: 'error', error: 'OpenAI : quota dépassé.' })
  })

  it('refuses while the panel is already generating, without touching its conversation', async () => {
    h.copilot.generating = true
    await submitQuickAsk('Q')
    expect(quickAsk.phase).toBe('error')
    expect(quickAsk.error).toMatch(/répond déjà/)
    expect(h.newChatCalls).toBe(0)
  })

  it('closing aborts the in-flight answer and ignores its late end', async () => {
    openQuickAsk()
    const pending = submitQuickAsk('Q')
    await tick()
    reply().content = 'partiel'
    closeQuickAsk()
    await pending
    expect(h.stopCalls).toBe(1)
    expect(quickAsk).toMatchObject({ open: false, phase: 'idle', answer: '', error: '' })
  })

  it('closing during conversation setup never starts the request', async () => {
    openQuickAsk()
    const pending = submitQuickAsk('Q')
    closeQuickAsk()
    await pending
    expect(h.copilot.messages).toEqual([])
  })

  it('a follow-up continues the same conversation; a new island session starts a fresh one', async () => {
    openQuickAsk()
    let pending = submitQuickAsk('Q1')
    await tick()
    reply().content = 'R1'
    h.finish!()
    await pending
    pending = submitQuickAsk('Q2')
    await tick()
    reply().content = 'R2'
    h.finish!()
    await pending
    expect(h.newChatCalls).toBe(1)
    expect(h.copilot.messages).toHaveLength(4)

    closeQuickAsk()
    openQuickAsk()
    pending = submitQuickAsk('Q3')
    await tick()
    expect(h.newChatCalls).toBe(2)
    h.finish!()
    await pending
  })

  it('continueInCopilot hands a streaming answer to the panel without stopping it', async () => {
    openQuickAsk()
    const pending = submitQuickAsk('Q')
    await tick()
    reply().content = 'en cours'
    continueInCopilot()
    expect(h.opened).toEqual(['chat'])
    expect(h.stopCalls).toBe(0)
    expect(quickAsk.open).toBe(false)
    h.finish!()
    await pending
    expect(quickAsk.phase).toBe('idle')
  })

  it('a failed save of the current conversation is reported, not swallowed', async () => {
    h.newChatOk = false
    await submitQuickAsk('Q')
    expect(quickAsk).toMatchObject({ phase: 'error', error: 'La discussion en cours n’a pas pu être enregistrée.' })
  })
})
