import { canonicalPathKey, type SaveableTextKind } from './save-as'
import { isBinaryKind, type DocKind } from './doc-kind'
import { clampWorkspaceRatio, createWorkspaceState, type PaneId, type WorkspaceState } from './workspace'

export interface WorkspacePathSnapshot {
  split: boolean
  activePaneId: PaneId
  primaryPath: string | null
  secondaryPath: string | null
  primaryUnsaved: boolean
  secondaryUnsaved: boolean
  ratio: number
}

// Note sans chemin (ardoise, document généré) : son contenu voyage dans la session
// puisqu'aucun fichier ne le porte. Au-delà de NOTE_MAX_CHARS elle n'est pas conservée.
export interface SessionNote {
  name: string
  label: string | null
  content: string
  kind: SaveableTextKind
  // Position dans la barre d'onglets (les fichiers et les notes s'y mêlent).
  at: number
  // content === savedContent au moment de la sauvegarde (document généré intact, note vide).
  pristine: boolean
}
export const NOTE_MAX_CHARS = 500_000

export interface SessionV2 {
  version: 2
  tabs: string[]
  activePath: string | null
  workspace: WorkspacePathSnapshot
  // Un trou (null) garde les index stables quand une note est écartée (trop grosse).
  notes: Array<SessionNote | null>
  // Étiquettes d'onglet choisies pour des fichiers, par clé canonique de chemin.
  labels: Record<string, string>
  // Index dans `notes` de la note affichée par chaque volet (null = volet sur un fichier ou vide).
  primaryNote: number | null
  secondaryNote: number | null
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

function parseNotes(value: unknown): Array<SessionNote | null> {
  if (!Array.isArray(value)) return []
  return value.map((item): SessionNote | null => {
    const note = item && typeof item === 'object' ? item as Record<string, unknown> : null
    if (!note || typeof note.name !== 'string' || typeof note.content !== 'string') return null
    if (note.content.length > NOTE_MAX_CHARS) return null
    const kind = note.kind === 'html' || note.kind === 'txt' ? note.kind : 'md'
    const at = typeof note.at === 'number' && Number.isInteger(note.at) && note.at >= 0 ? note.at : Number.MAX_SAFE_INTEGER
    return {
      name: note.name,
      label: typeof note.label === 'string' && note.label.trim() ? note.label : null,
      content: note.content,
      kind,
      at,
      pristine: note.pristine === true,
    }
  })
}

function parseLabels(value: unknown): Record<string, string> {
  const labels: Record<string, string> = {}
  if (!value || typeof value !== 'object') return labels
  for (const [path, label] of Object.entries(value as Record<string, unknown>)) {
    if (typeof label === 'string' && label.trim() && path.trim()) labels[canonicalPathKey(path)] = label
  }
  return labels
}

function noteIndex(value: unknown, count: number): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < count ? value : null
}

function isTextTab(tab: SessionTab): tab is SessionTab & { kind: SaveableTextKind } {
  return !isBinaryKind(tab.kind)
}

// Le volet secondaire compte comme occupé s'il porte un fichier OU une note conservée :
// sans cela, scinder sur une note se perdait au redémarrage.
function withNoteInSecondary(workspace: WorkspacePathSnapshot, split: boolean, activeSecondary: boolean): WorkspacePathSnapshot {
  if (workspace.secondaryPath !== null || !split) return workspace
  return { ...workspace, split: true, activePaneId: activeSecondary ? 'secondary' : 'primary' }
}

export function parseWorkspacePathSnapshot(value: unknown): WorkspacePathSnapshot {
  const workspace = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const primaryPath = pathOrNull(workspace.primaryPath)
  const secondaryCandidate = pathOrNull(workspace.secondaryPath)
  const secondaryPath = primaryPath && secondaryCandidate && canonicalPathKey(primaryPath) === canonicalPathKey(secondaryCandidate)
    ? null
    : secondaryCandidate
  const split = workspace.split === true && secondaryPath !== null
  return {
    split,
    activePaneId: split && workspace.activePaneId === 'secondary' ? 'secondary' : 'primary',
    primaryPath,
    secondaryPath,
    primaryUnsaved: workspace.primaryUnsaved === true,
    secondaryUnsaved: workspace.secondaryUnsaved === true,
    ratio: clampWorkspaceRatio(typeof workspace.ratio === 'number' ? workspace.ratio : 50),
  }
}

export function buildWorkspacePathSnapshot(
  workspace: WorkspaceState,
  pathForTab: (tabId: number | null) => string | null,
): WorkspacePathSnapshot {
  const primaryPath = pathForTab(workspace.primary.tabId)
  const secondaryPath = pathForTab(workspace.secondary.tabId)
  return {
    split: workspace.split && secondaryPath !== null,
    activePaneId: workspace.split && workspace.activePaneId === 'secondary' && secondaryPath !== null ? 'secondary' : 'primary',
    primaryPath,
    secondaryPath,
    primaryUnsaved: workspace.primary.tabId != null && primaryPath == null,
    secondaryUnsaved: workspace.secondary.tabId != null && secondaryPath == null,
    ratio: clampWorkspaceRatio(workspace.ratio),
  }
}

export function parseSession(raw: string | null): SessionV2 | null {
  if (!raw) return null
  let value: LegacySession & { version?: unknown; workspace?: unknown; notes?: unknown; labels?: unknown; primaryNote?: unknown; secondaryNote?: unknown }
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
      notes: [],
      labels: {},
      primaryNote: null,
      secondaryNote: null,
    }
  }
  const notes = parseNotes(value.notes)
  const primaryNote = noteIndex(value.primaryNote, notes.length)
  const secondaryCandidate = noteIndex(value.secondaryNote, notes.length)
  const secondaryNote = secondaryCandidate !== primaryNote ? secondaryCandidate : null
  const ws = value.workspace as Record<string, unknown>
  const workspace = parseWorkspacePathSnapshot(ws)
  return {
    version: 2,
    tabs,
    activePath,
    workspace: secondaryNote != null && notes[secondaryNote]
      ? withNoteInSecondary(workspace, ws.split === true, ws.activePaneId === 'secondary')
      : workspace,
    notes,
    labels: parseLabels(value.labels),
    primaryNote,
    secondaryNote,
  }
}

export interface SessionTab {
  id: number
  name: string
  label: string | null
  path: string | null
  kind: DocKind
  content: string
  savedContent: string
}

export function buildSession(
  openTabs: SessionTab[],
  workspace: WorkspaceState,
): SessionV2 {
  const pathForTab = (tabId: number | null) => openTabs.find((tab) => tab.id === tabId)?.path ?? null
  const tabs = uniquePaths(openTabs.map((tab) => tab.path))
  const activePath = pathForTab(workspace[workspace.activePaneId].tabId)
  const kept = openTabs.filter(isTextTab).filter((tab) => tab.path == null && tab.content.length <= NOTE_MAX_CHARS)
  const noteForTab = (tabId: number | null) => {
    const i = kept.findIndex((tab) => tab.id === tabId)
    return i >= 0 ? i : null
  }
  const primaryNote = noteForTab(workspace.primary.tabId)
  const secondaryNote = noteForTab(workspace.secondary.tabId)
  const snapshot = buildWorkspacePathSnapshot(workspace, pathForTab)
  return {
    version: 2,
    tabs,
    activePath,
    workspace: secondaryNote != null
      ? withNoteInSecondary(snapshot, workspace.split, workspace.activePaneId === 'secondary')
      : snapshot,
    labels: Object.fromEntries(
      openTabs.filter((tab) => tab.path && tab.label).map((tab) => [canonicalPathKey(tab.path as string), tab.label as string]),
    ),
    notes: kept.map((tab) => ({
      name: tab.name,
      label: tab.label,
      content: tab.content,
      kind: tab.kind,
      at: openTabs.indexOf(tab),
      pristine: tab.content === tab.savedContent,
    })),
    primaryNote,
    secondaryNote,
  }
}

export function restoreWorkspace(
  session: SessionV2 | null,
  tabIdForPath: (path: string) => number | null,
  tabIdForNote: (index: number) => number | null = () => null,
): WorkspaceState {
  if (!session) return createWorkspaceState()
  const primary = session.workspace.primaryPath
    ? tabIdForPath(session.workspace.primaryPath)
    : session.primaryNote != null ? tabIdForNote(session.primaryNote) : null
  const secondary = session.workspace.secondaryPath
    ? tabIdForPath(session.workspace.secondaryPath)
    : session.secondaryNote != null ? tabIdForNote(session.secondaryNote) : null
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
