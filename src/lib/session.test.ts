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

  it('ne met pas une note sans chemin dans les chemins, mais garde son volet', () => {
    const workspace = createWorkspaceState(1)
    workspace.split = true
    workspace.secondary.tabId = 2
    workspace.activePaneId = 'secondary'
    const session = buildSession(
      [
        { id: 1, name: 'source.md', path: 'C:\\Docs\\source.md', kind: 'md', content: '', savedContent: '' },
        { id: 2, name: 'Notes', path: null, kind: 'md', content: '', savedContent: '' },
      ],
      workspace,
    )
    expect(session.tabs).toEqual(['C:\\Docs\\source.md'])
    expect(session.activePath).toBeNull()
    expect(session.workspace.secondaryPath).toBeNull()
    expect(session.workspace.secondaryUnsaved).toBe(true)
    // La note vide est conservée : le scindage et le volet actif survivent.
    expect(session.workspace.split).toBe(true)
    expect(session.workspace.activePaneId).toBe('secondary')
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
    { id: 2, name: 'Notes — a', path: null, kind: 'md' as const, content: 'tokens du jour', savedContent: '' },
    { id: 1, name: 'a.md', path: 'C:\\Docs\\a.md', kind: 'md' as const, content: '# a', savedContent: '# a' },
    { id: 3, name: 'Rapport', path: null, kind: 'html' as const, content: '<p>x</p>', savedContent: '<p>x</p>' },
    { id: 4, name: 'scan.pdf', path: null, kind: 'pdf' as const, content: '', savedContent: '' },
  ]

  it('embarque le texte des notes sans chemin, leur place et le volet qui les affiche', () => {
    const workspace = createWorkspaceState(2)
    workspace.split = true
    workspace.secondary.tabId = 3
    const session = buildSession(tabs, workspace)
    expect(session.tabs).toEqual(['C:\\Docs\\a.md'])
    expect(session.notes).toEqual([
      { name: 'Notes — a', content: 'tokens du jour', kind: 'md', at: 0, pristine: false },
      { name: 'Rapport', content: '<p>x</p>', kind: 'html', at: 2, pristine: true },
    ])
    expect(session.primaryNote).toBe(0)
    expect(session.secondaryNote).toBe(1)
    expect(session.workspace.primaryUnsaved).toBe(true)
    expect(session.workspace.split).toBe(true)
  })

  it('survit à un aller-retour JSON et retrouve les volets scindés', () => {
    const workspace = createWorkspaceState(2)
    workspace.split = true
    workspace.secondary.tabId = 3
    workspace.activePaneId = 'secondary'
    const parsed = parseSession(JSON.stringify(buildSession(tabs, workspace)))
    expect(parsed?.notes.map((n) => n?.name)).toEqual(['Notes — a', 'Rapport'])
    expect(parsed?.primaryNote).toBe(0)
    expect(parsed?.workspace.split).toBe(true)
    expect(parsed?.workspace.activePaneId).toBe('secondary')
    const restored = restoreWorkspace(parsed, () => null, (i) => 10 + i)
    expect(restored.primary.tabId).toBe(10)
    expect(restored.secondary.tabId).toBe(11)
    expect(restored.split).toBe(true)
    expect(restored.activePaneId).toBe('secondary')
  })

  it('écarte une note trop grosse et un index hors bornes', () => {
    const big = { id: 5, name: 'big', path: null, kind: 'md' as const, content: 'x'.repeat(NOTE_MAX_CHARS + 1), savedContent: '' }
    const session = buildSession([big, tabs[0]], createWorkspaceState(5))
    expect(session.notes.map((n) => n?.name)).toEqual(['Notes — a'])
    expect(session.primaryNote).toBeNull()
    const parsed = parseSession(JSON.stringify({ version: 2, tabs: [], workspace: {}, notes: [{ name: 'n', content: 'c' }], primaryNote: 4 }))
    expect(parsed?.notes).toEqual([{ name: 'n', content: 'c', kind: 'md', at: Number.MAX_SAFE_INTEGER, pristine: false }])
    expect(parsed?.primaryNote).toBeNull()
  })

  it('garde les index stables quand une note lue est écartée', () => {
    // Session écrite avec un plafond plus haut : la note 0 dépasse, la note 1 reste à l'index 1.
    const parsed = parseSession(JSON.stringify({
      version: 2, tabs: [], workspace: { split: true, secondaryPath: null }, primaryNote: 0, secondaryNote: 1,
      notes: [{ name: 'trop', content: 'x'.repeat(NOTE_MAX_CHARS + 1) }, { name: 'ok', content: 'c', pristine: true }],
    }))
    expect(parsed?.notes[0]).toBeNull()
    expect(parsed?.notes[1]?.name).toBe('ok')
    expect(parsed?.primaryNote).toBe(0)
    expect(parsed?.secondaryNote).toBe(1)
    expect(parsed?.workspace.split).toBe(true)
    const restored = restoreWorkspace(parsed, () => null, (i) => (i === 1 ? 11 : null))
    expect(restored.primary.tabId).toBeNull()
    expect(restored.secondary.tabId).toBe(11)
  })
})
