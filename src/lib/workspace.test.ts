import { describe, expect, it } from 'vitest'
import {
  activateWorkspacePane,
  assignWorkspaceTab,
  clampWorkspaceRatio,
  clampWorkspaceRatioForSize,
  closeWorkspaceTab,
  createWorkspaceState,
  openWorkspaceSplit,
  reuniteWorkspace,
  selectWorkspaceTab,
  setWorkspaceRatio,
  swapWorkspacePanes,
  workspaceHasUniqueTabs,
} from './workspace'

describe('workspace documentaire', () => {
  it('démarre avec un volet principal et un secondaire vide', () => {
    expect(createWorkspaceState(3)).toEqual({
      split: false,
      activePaneId: 'primary',
      primary: { tabId: 3, sourceMode: false },
      secondary: { tabId: null, sourceMode: false },
      ratio: 50,
    })
  })

  it('interdit le même onglet dans les deux volets', () => {
    const state = openWorkspaceSplit(createWorkspaceState(3))
    const result = assignWorkspaceTab(state, 'secondary', 3)
    expect(result).toEqual({ ok: false, reason: 'already-visible', state })
    expect(workspaceHasUniqueTabs(result.state)).toBe(true)
  })

  it('sélectionne un onglet déjà visible en activant son volet', () => {
    const split = assignWorkspaceTab(openWorkspaceSplit(createWorkspaceState(1)), 'secondary', 2)
    if (!split.ok) throw new Error('setup')
    const primary = activateWorkspacePane(split.state, 'primary')
    expect(selectWorkspaceTab(primary, 2).activePaneId).toBe('secondary')
    expect(selectWorkspaceTab(primary, 2).primary.tabId).toBe(1)
  })

  it('affecte un nouvel onglet au volet actif', () => {
    const split = assignWorkspaceTab(openWorkspaceSplit(createWorkspaceState(1)), 'secondary', 2)
    if (!split.ok) throw new Error('setup')
    const next = selectWorkspaceTab(split.state, 4)
    expect(next.secondary.tabId).toBe(4)
    expect(next.primary.tabId).toBe(1)
  })

  it('réunit en conservant le document du volet actif dans primary', () => {
    const split = assignWorkspaceTab(openWorkspaceSplit(createWorkspaceState(1)), 'secondary', 2)
    if (!split.ok) throw new Error('setup')
    const reunited = reuniteWorkspace(split.state)
    expect(reunited.split).toBe(false)
    expect(reunited.activePaneId).toBe('primary')
    expect(reunited.primary.tabId).toBe(2)
    expect(reunited.secondary.tabId).toBe(1)
  })

  it('peut sélectionner en vue unique le document mémorisé dans le volet masqué', () => {
    const split = assignWorkspaceTab(openWorkspaceSplit(createWorkspaceState(1)), 'secondary', 2)
    if (!split.ok) throw new Error('setup')
    const reunited = reuniteWorkspace(split.state)
    const selected = selectWorkspaceTab(reunited, 1)
    expect(selected.primary.tabId).toBe(1)
    expect(selected.secondary.tabId).toBeNull()
    expect(workspaceHasUniqueTabs(selected)).toBe(true)
  })

  it('permute les documents tout en gardant le même document actif', () => {
    const split = assignWorkspaceTab(openWorkspaceSplit(createWorkspaceState(1)), 'secondary', 2)
    if (!split.ok) throw new Error('setup')
    const swapped = swapWorkspacePanes(split.state)
    expect(swapped.primary.tabId).toBe(2)
    expect(swapped.secondary.tabId).toBe(1)
    expect(swapped.activePaneId).toBe('primary')
  })

  it('ferme un onglet et active l’autre volet disponible', () => {
    const split = assignWorkspaceTab(openWorkspaceSplit(createWorkspaceState(1)), 'secondary', 2)
    if (!split.ok) throw new Error('setup')
    const closed = closeWorkspaceTab(split.state, 2)
    expect(closed.secondary.tabId).toBeNull()
    expect(closed.activePaneId).toBe('primary')
    expect(closed.primary.tabId).toBe(1)
  })

  it('borne le ratio et neutralise les nombres invalides', () => {
    expect(clampWorkspaceRatio(3)).toBe(25)
    expect(clampWorkspaceRatio(91)).toBe(75)
    expect(clampWorkspaceRatio(Number.NaN)).toBe(50)
    expect(setWorkspaceRatio(createWorkspaceState(), 63.7).ratio).toBe(64)
  })

  it('respecte la taille minimale réelle de chaque volet', () => {
    expect(clampWorkspaceRatioForSize(25, 700, 280)).toBe(40)
    expect(clampWorkspaceRatioForSize(75, 700, 280)).toBe(60)
    expect(clampWorkspaceRatioForSize(25, 1200, 280)).toBe(25)
    expect(clampWorkspaceRatioForSize(60, 400, 240)).toBe(50)
  })
})
