import { describe, expect, it } from 'vitest'
import { buildSession, buildWorkspacePathSnapshot, parseSession, restoreWorkspace } from './session'
import { createWorkspaceState } from './workspace'

describe('session workspace v2', () => {
  it('migre une session v1 en vue unique', () => {
    const session = parseSession(JSON.stringify({
      tabs: ['C:\\Docs\\a.md', 'C:\\Docs\\b.md'],
      activePath: 'C:\\Docs\\b.md',
    }))
    expect(session).toMatchObject({
      version: 2,
      activePath: 'C:\\Docs\\b.md',
      workspace: { split: false, activePaneId: 'primary', primaryPath: 'C:\\Docs\\b.md', primaryUnsaved: false, ratio: 50 },
    })
  })

  it('rejette un JSON invalide et déduplique les chemins sans tenir compte de la casse', () => {
    expect(parseSession('{')).toBeNull()
    const session = parseSession(JSON.stringify({ tabs: ['C:/Docs/A.md', 'c:\\docs\\a.md'] }))
    expect(session?.tabs).toEqual(['C:/Docs/A.md'])
  })

  it('borne le ratio et neutralise un doublon de volet', () => {
    const session = parseSession(JSON.stringify({
      version: 2,
      tabs: ['C:\\Docs\\a.md'],
      activePath: 'C:\\Docs\\a.md',
      workspace: {
        split: true,
        activePaneId: 'secondary',
        primaryPath: 'C:\\Docs\\a.md',
        secondaryPath: 'c:/docs/A.md',
        ratio: 99,
        orientation: 'vertical',
      },
    }))
    expect(session?.workspace).toEqual({
      split: false,
      activePaneId: 'primary',
      primaryPath: 'C:\\Docs\\a.md',
      secondaryPath: null,
      primaryUnsaved: false,
      secondaryUnsaved: false,
      ratio: 75,
    })
  })

  it('partage le même snapshot borné avec les discussions', () => {
    const workspace = createWorkspaceState(1)
    workspace.split = true
    workspace.secondary.tabId = 2
    workspace.activePaneId = 'secondary'
    workspace.ratio = 99
    expect(buildWorkspacePathSnapshot(workspace, (id) => id === 1 ? 'C:\\Docs\\a.md' : 'C:\\Docs\\b.md')).toEqual({
      split: true,
      activePaneId: 'secondary',
      primaryPath: 'C:\\Docs\\a.md',
      secondaryPath: 'C:\\Docs\\b.md',
      primaryUnsaved: false,
      secondaryUnsaved: false,
      ratio: 75,
    })
  })

  it('ne sérialise pas une note sans chemin', () => {
    const workspace = createWorkspaceState(1)
    workspace.split = true
    workspace.secondary.tabId = 2
    workspace.activePaneId = 'secondary'
    const session = buildSession(
      ['C:\\Docs\\source.md', null],
      workspace,
      (id) => id === 1 ? 'C:\\Docs\\source.md' : null,
    )
    expect(session.tabs).toEqual(['C:\\Docs\\source.md'])
    expect(session.activePath).toBeNull()
    expect(session.workspace.secondaryPath).toBeNull()
    expect(session.workspace.secondaryUnsaved).toBe(true)
  })

  it('restaure un chemin manquant comme volet vide explicite', () => {
    const session = parseSession(JSON.stringify({
      version: 2,
      tabs: ['C:\\Docs\\source.md', 'C:\\Docs\\missing.md'],
      activePath: 'C:\\Docs\\missing.md',
      workspace: {
        split: true,
        activePaneId: 'secondary',
        primaryPath: 'C:\\Docs\\source.md',
        secondaryPath: 'C:\\Docs\\missing.md',
        ratio: 60,
      },
    }))
    const restored = restoreWorkspace(session, (path) => path.endsWith('source.md') ? 4 : null)
    expect(restored.primary.tabId).toBe(4)
    expect(restored.secondary.tabId).toBeNull()
    expect(restored.activePaneId).toBe('primary')
    expect(restored.ratio).toBe(60)
  })
})
