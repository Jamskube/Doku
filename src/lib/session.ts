import { canonicalPathKey } from './save-as'
import { clampWorkspaceRatio, createWorkspaceState, type PaneId, type WorkspaceState } from './workspace'

export interface SessionV2 {
  version: 2
  tabs: string[]
  activePath: string | null
  workspace: {
    split: boolean
    activePaneId: PaneId
    primaryPath: string | null
    secondaryPath: string | null
    primaryUnsaved: boolean
    secondaryUnsaved: boolean
    ratio: number
  }
}

interface LegacySession {
  tabs?: unknown
  activePath?: unknown
}

function pathOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function uniquePaths(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const paths: string[] = []
  for (const item of value) {
    const path = pathOrNull(item)
    if (!path) continue
    const key = canonicalPathKey(path)
    if (seen.has(key)) continue
    seen.add(key)
    paths.push(path)
  }
  return paths
}

export function parseSession(raw: string | null): SessionV2 | null {
  if (!raw) return null
  let value: LegacySession & { version?: unknown; workspace?: unknown }
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (!value || typeof value !== 'object') return null
  const tabs = uniquePaths(value.tabs)
  const activePath = pathOrNull(value.activePath)
  if (value.version !== 2 || !value.workspace || typeof value.workspace !== 'object') {
    return {
      version: 2,
      tabs,
      activePath,
      workspace: {
        split: false,
        activePaneId: 'primary',
        primaryPath: activePath,
        secondaryPath: null,
        primaryUnsaved: false,
        secondaryUnsaved: false,
        ratio: 50,
      },
    }
  }
  const workspace = value.workspace as Record<string, unknown>
  const primaryPath = pathOrNull(workspace.primaryPath)
  const secondaryCandidate = pathOrNull(workspace.secondaryPath)
  const secondaryPath =
    primaryPath && secondaryCandidate && canonicalPathKey(primaryPath) === canonicalPathKey(secondaryCandidate)
      ? null
      : secondaryCandidate
  const split = workspace.split === true
  const activePaneId: PaneId = split && workspace.activePaneId === 'secondary' ? 'secondary' : 'primary'
  return {
    version: 2,
    tabs,
    activePath,
    workspace: {
      split,
      activePaneId,
      primaryPath,
      secondaryPath,
      primaryUnsaved: workspace.primaryUnsaved === true,
      secondaryUnsaved: workspace.secondaryUnsaved === true,
      ratio: clampWorkspaceRatio(typeof workspace.ratio === 'number' ? workspace.ratio : 50),
    },
  }
}

export function buildSession(
  paths: Array<string | null>,
  workspace: WorkspaceState,
  pathForTab: (tabId: number | null) => string | null,
): SessionV2 {
  const tabs = uniquePaths(paths)
  const primaryPath = pathForTab(workspace.primary.tabId)
  const secondaryPath = pathForTab(workspace.secondary.tabId)
  const activePath = pathForTab(workspace[workspace.activePaneId].tabId)
  return {
    version: 2,
    tabs,
    activePath,
    workspace: {
      split: workspace.split,
      activePaneId: workspace.activePaneId,
      primaryPath,
      secondaryPath,
      primaryUnsaved: workspace.primary.tabId != null && primaryPath == null,
      secondaryUnsaved: workspace.secondary.tabId != null && secondaryPath == null,
      ratio: clampWorkspaceRatio(workspace.ratio),
    },
  }
}

export function restoreWorkspace(
  session: SessionV2 | null,
  tabIdForPath: (path: string) => number | null,
): WorkspaceState {
  if (!session) return createWorkspaceState()
  const primary = session.workspace.primaryPath ? tabIdForPath(session.workspace.primaryPath) : null
  const secondary = session.workspace.secondaryPath ? tabIdForPath(session.workspace.secondaryPath) : null
  const state = createWorkspaceState(primary)
  state.ratio = clampWorkspaceRatio(session.workspace.ratio)
  state.secondary.tabId = secondary !== primary ? secondary : null
  state.split = session.workspace.split
  state.activePaneId =
    state.split && session.workspace.activePaneId === 'secondary' && state.secondary.tabId != null
      ? 'secondary'
      : 'primary'
  return state
}
