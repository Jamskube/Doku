import { describe, expect, it } from 'vitest'
import { buildSession, buildWorkspacePathSnapshot, NOTE_MAX_CHARS, parseSession, restoreWorkspace } from './session'
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
      [
        { id: 1, name: 'source.md', path: 'C:\\Docs\\source.md', kind: 'md', content: '' },
        { id: 2, name: 'Notes', path: null, kind: 'md', content: '' },
      ],
      workspace,
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

describe('session notes sans chemin', () => {
  const tabs = [
    { id: 1, name: 'a.md', path: 'C:\\Docs\\a.md', kind: 'md' as const, content: '# a' },
    { id: 2, name: 'Notes — a', path: null, kind: 'md' as const, content: 'tokens du jour' },
    { id: 3, name: 'Rapport', path: null, kind: 'html' as const, content: '<p>x</p>' },
    { id: 4, name: 'scan.pdf', path: null, kind: 'pdf' as const, content: '' },
  ]

  it('embarque le texte des notes sans chemin et le volet qui les affiche', () => {
    const workspace = createWorkspaceState(2)
    workspace.split = true
    workspace.secondary.tabId = 3
    const session = buildSession(tabs, workspace)
    expect(session.tabs).toEqual(['C:\\Docs\\a.md'])
    expect(session.notes).toEqual([
      { name: 'Notes — a', content: 'tokens du jour', kind: 'md' },
      { name: 'Rapport', content: '<p>x</p>', kind: 'html' },
    ])
    expect(session.primaryNote).toBe(0)
    expect(session.secondaryNote).toBe(1)
    expect(session.workspace.primaryUnsaved).toBe(true)
  })

  it('survit à un aller-retour JSON et retrouve les volets', () => {
    const workspace = createWorkspaceState(2)
    const parsed = parseSession(JSON.stringify(buildSession(tabs, workspace)))
    expect(parsed?.notes.map((n) => n.name)).toEqual(['Notes — a', 'Rapport'])
    expect(parsed?.primaryNote).toBe(0)
    const restored = restoreWorkspace(parsed, () => null, (i) => 10 + i)
    expect(restored.primary.tabId).toBe(10)
  })

  it('écarte une note trop grosse et un index hors bornes', () => {
    const big = { id: 5, name: 'big', path: null, kind: 'md' as const, content: 'x'.repeat(NOTE_MAX_CHARS + 1) }
    const session = buildSession([big, tabs[1]], createWorkspaceState(5))
    expect(session.notes.map((n) => n.name)).toEqual(['Notes — a'])
    expect(session.primaryNote).toBeNull()
    const parsed = parseSession(JSON.stringify({ version: 2, tabs: [], workspace: {}, notes: [{ name: 'n', content: 'c' }], primaryNote: 4 }))
    expect(parsed?.notes).toEqual([{ name: 'n', content: 'c', kind: 'md' }])
    expect(parsed?.primaryNote).toBeNull()
  })
})
