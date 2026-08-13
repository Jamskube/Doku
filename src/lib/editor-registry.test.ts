import type { EditorView } from '@codemirror/view'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  Object.defineProperty(globalThis, '$state', {
    configurable: true,
    value: <T>(value: T) => value,
  })
})

import {
  cacheEditorRuntime,
  dropEditorRuntime,
  editorForPane,
  editorRegistry,
  editorRuntimeForTab,
  publishEditorSelection,
  registerEditor,
  registeredTabForPane,
  selectionForPane,
  unregisterEditor,
  updateEditorRegistration,
} from './editor-registry.svelte'

function fakeView(name: string): EditorView {
  return { name } as unknown as EditorView
}

describe('registre des éditeurs par volet', () => {
  beforeEach(() => {
    for (const paneId of ['primary', 'secondary'] as const) {
      editorRegistry[paneId].tabId = null
      editorRegistry[paneId].view = null
      editorRegistry[paneId].selection.from = 0
      editorRegistry[paneId].selection.to = 0
      editorRegistry[paneId].selection.text = ''
    }
  })

  it('conserve deux vues et sélections indépendantes', () => {
    const primary = fakeView('primary')
    const secondary = fakeView('secondary')
    registerEditor('primary', 1, primary)
    registerEditor('secondary', 2, secondary)
    publishEditorSelection('primary', 1, primary, { from: 2, to: 5, text: 'abc' })
    publishEditorSelection('secondary', 2, secondary, { from: 8, to: 11, text: 'xyz' })
    expect(editorForPane('primary')).toBe(primary)
    expect(editorForPane('secondary')).toBe(secondary)
    expect(selectionForPane('primary').text).toBe('abc')
    expect(selectionForPane('secondary').text).toBe('xyz')
  })

  it('empêche le cleanup périmé de supprimer la nouvelle vue', () => {
    const oldView = fakeView('old')
    const nextView = fakeView('next')
    registerEditor('primary', 1, oldView)
    registerEditor('primary', 2, nextView)
    expect(unregisterEditor('primary', 1, oldView)).toBe(false)
    expect(editorForPane('primary')).toBe(nextView)
    expect(registeredTabForPane('primary')).toBe(2)
  })

  it('ignore une sélection publiée par une ancienne identité', () => {
    const oldView = fakeView('old')
    const nextView = fakeView('next')
    registerEditor('primary', 1, oldView)
    registerEditor('primary', 2, nextView)
    expect(publishEditorSelection('primary', 1, oldView, { from: 1, to: 2, text: 'stale' })).toBe(false)
    expect(selectionForPane('primary').text).toBe('')
  })

  it('met à jour le tab rendu sans remplacer la vue', () => {
    const view = fakeView('stable')
    registerEditor('primary', 1, view)
    expect(updateEditorRegistration('primary', 2, view)).toBe(true)
    expect(registeredTabForPane('primary')).toBe(2)
  })
  it('conserve le runtime avec le document quand il change de volet', () => {
    const state = { doc: 'document' } as unknown as import('@codemirror/state').EditorState
    cacheEditorRuntime(4, state, 2, 180)
    expect(editorRuntimeForTab(4, 2)).toEqual({ state, rev: 2, scrollTop: 180 })
    expect(editorRuntimeForTab(4, 3)).toBeUndefined()
    dropEditorRuntime(4)
    expect(editorRuntimeForTab(4, 2)).toBeUndefined()
  })
})
