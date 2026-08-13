export type PaneId = 'primary' | 'secondary'

export interface PaneState {
  tabId: number | null
  sourceMode: boolean
}

export interface WorkspaceState {
  split: boolean
  activePaneId: PaneId
  primary: PaneState
  secondary: PaneState
  ratio: number
}

export type AssignResult =
  | { ok: true; state: WorkspaceState }
  | { ok: false; reason: 'already-visible'; state: WorkspaceState }

export function createWorkspaceState(primaryTabId: number | null = null): WorkspaceState {
  return {
    split: false,
    activePaneId: 'primary',
    primary: { tabId: primaryTabId, sourceMode: false },
    secondary: { tabId: null, sourceMode: false },
    ratio: 50,
  }
}

export function otherPane(id: PaneId): PaneId {
  return id === 'primary' ? 'secondary' : 'primary'
}

export function clampWorkspaceRatio(value: number): number {
  if (!Number.isFinite(value)) return 50
  return Math.min(75, Math.max(25, Math.round(value)))
}

export function clampWorkspaceRatioForSize(value: number, size: number, minimumPaneSize: number): number {
  if (!Number.isFinite(size) || size <= minimumPaneSize * 2) return 50
  const edge = Math.max(25, (minimumPaneSize / size) * 100)
  return Math.round(Math.min(100 - edge, Math.max(edge, value)))
}

function clone(state: WorkspaceState): WorkspaceState {
  return {
    ...state,
    primary: { ...state.primary },
    secondary: { ...state.secondary },
  }
}

export function activateWorkspacePane(state: WorkspaceState, paneId: PaneId): WorkspaceState {
  if (paneId === 'secondary' && !state.split) return state
  if (state.activePaneId === paneId) return state
  return { ...clone(state), activePaneId: paneId }
}

export function assignWorkspaceTab(state: WorkspaceState, paneId: PaneId, tabId: number | null): AssignResult {
  if (tabId != null && state[otherPane(paneId)].tabId === tabId) {
    if (state.split) return { ok: false, reason: 'already-visible', state }
    const next = clone(state)
    next[otherPane(paneId)].tabId = null
    next[paneId].tabId = tabId
    next.activePaneId = paneId
    return { ok: true, state: next }
  }
  const next = clone(state)
  next[paneId].tabId = tabId
  next.activePaneId = paneId
  return { ok: true, state: next }
}

export function selectWorkspaceTab(state: WorkspaceState, tabId: number): WorkspaceState {
  if (state.primary.tabId === tabId) return activateWorkspacePane(state, 'primary')
  if (state.split && state.secondary.tabId === tabId) return activateWorkspacePane(state, 'secondary')
  const assigned = assignWorkspaceTab(state, state.activePaneId, tabId)
  return assigned.ok ? assigned.state : state
}

export function openWorkspaceSplit(state: WorkspaceState): WorkspaceState {
  if (state.split) return state
  return { ...clone(state), split: true }
}

export function reuniteWorkspace(state: WorkspaceState): WorkspaceState {
  if (!state.split) return state
  const next = clone(state)
  if (state.activePaneId === 'secondary') {
    const preserved = next.secondary
    next.secondary = next.primary
    next.primary = preserved
  }
  next.split = false
  next.activePaneId = 'primary'
  return next
}

export function swapWorkspacePanes(state: WorkspaceState): WorkspaceState {
  if (!state.split) return state
  const next = clone(state)
  const primary = next.primary
  next.primary = next.secondary
  next.secondary = primary
  next.activePaneId = otherPane(state.activePaneId)
  return next
}

export function closeWorkspaceTab(state: WorkspaceState, tabId: number): WorkspaceState {
  const next = clone(state)
  const closedPane: PaneId | null =
    next.primary.tabId === tabId ? 'primary' : next.secondary.tabId === tabId ? 'secondary' : null
  if (!closedPane) return state
  next[closedPane].tabId = null
  next[closedPane].sourceMode = false
  if (next.activePaneId === closedPane) {
    const fallback = otherPane(closedPane)
    if (next.split && next[fallback].tabId != null) next.activePaneId = fallback
  }
  return next
}

export function setWorkspaceRatio(state: WorkspaceState, ratio: number): WorkspaceState {
  const value = clampWorkspaceRatio(ratio)
  if (state.ratio === value) return state
  return { ...clone(state), ratio: value }
}

export function workspaceHasUniqueTabs(state: WorkspaceState): boolean {
  return state.primary.tabId == null || state.secondary.tabId == null || state.primary.tabId !== state.secondary.tabId
}
