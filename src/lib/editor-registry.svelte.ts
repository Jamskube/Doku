import type { EditorView } from '@codemirror/view'
import type { EditorState } from '@codemirror/state'
import type { PaneId } from './workspace'

export interface EditorSelectionSnapshot {
  from: number
  to: number
  text: string
}

interface EditorSlot {
  tabId: number | null
  view: EditorView | null
  selection: EditorSelectionSnapshot
}

export interface EditorRuntimeSnapshot {
  state: EditorState
  rev: number
  scrollTop: number
}

const runtimeByTab = new Map<number, EditorRuntimeSnapshot>()

function emptySlot(): EditorSlot {
  return { tabId: null, view: null, selection: { from: 0, to: 0, text: '' } }
}

export const editorRegistry = $state<Record<PaneId, EditorSlot>>({
  primary: emptySlot(),
  secondary: emptySlot(),
})

export function registerEditor(paneId: PaneId, tabId: number, view: EditorView) {
  const slot = editorRegistry[paneId]
  slot.tabId = tabId
  slot.view = view
  slot.selection.from = 0
  slot.selection.to = 0
  slot.selection.text = ''
}

export function unregisterEditor(paneId: PaneId, tabId: number, view: EditorView): boolean {
  const slot = editorRegistry[paneId]
  if (slot.tabId !== tabId || slot.view !== view) return false
  slot.tabId = null
  slot.view = null
  slot.selection.from = 0
  slot.selection.to = 0
  slot.selection.text = ''
  return true
}

export function updateEditorRegistration(paneId: PaneId, tabId: number, view: EditorView) {
  const slot = editorRegistry[paneId]
  if (slot.view !== view) return false
  slot.tabId = tabId
  return true
}

export function publishEditorSelection(
  paneId: PaneId,
  tabId: number,
  view: EditorView,
  selection: EditorSelectionSnapshot,
): boolean {
  const slot = editorRegistry[paneId]
  if (slot.tabId !== tabId || slot.view !== view) return false
  slot.selection.from = selection.from
  slot.selection.to = selection.to
  slot.selection.text = selection.text
  return true
}

export function editorForPane(paneId: PaneId): EditorView | null {
  return editorRegistry[paneId].view
}

export function selectionForPane(paneId: PaneId): EditorSelectionSnapshot {
  return editorRegistry[paneId].selection
}

export function registeredTabForPane(paneId: PaneId): number | null {
  return editorRegistry[paneId].tabId
}

export function cacheEditorRuntime(tabId: number, state: EditorState, rev: number, scrollTop: number) {
  runtimeByTab.set(tabId, { state, rev, scrollTop })
}

export function editorRuntimeForTab(tabId: number, rev: number): EditorRuntimeSnapshot | undefined {
  const cached = runtimeByTab.get(tabId)
  return cached?.rev === rev ? cached : undefined
}

export function dropEditorRuntime(tabId: number) {
  runtimeByTab.delete(tabId)
}
