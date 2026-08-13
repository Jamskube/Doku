import { describe, expect, it, vi } from 'vitest'
import {
  canonicalPathKey,
  defaultTextFileName,
  ensureTextExtension,
  runSaveAs,
  type SaveAsDependencies,
  type TextSaveSnapshot,
} from './save-as'

const snapshot: TextSaveSnapshot = {
  tabId: 7,
  name: 'Notes — rapport',
  kind: 'md',
  content: '# Notes\r\n',
  savedContent: '',
}

function dependencies(overrides: Partial<SaveAsDependencies> = {}): SaveAsDependencies {
  return {
    choosePath: vi.fn(async () => 'C:\\Notes\\rapport.md'),
    pathExists: vi.fn(async () => false),
    confirmReplace: vi.fn(async () => true),
    isPathOwnedByOtherTab: vi.fn(() => false),
    isTabOpen: vi.fn(() => true),
    write: vi.fn(async () => {}),
    commit: vi.fn(() => true),
    afterCommit: vi.fn(async () => {}),
    ...overrides,
  }
}

describe('Save As textuel', () => {
  it('normalise les extensions et les clés de chemins Windows', () => {
    expect(ensureTextExtension('C:\\Notes\\rapport', 'md')).toBe('C:\\Notes\\rapport.md')
    expect(ensureTextExtension('C:\\Notes\\rapport.markdown', 'md')).toBe('C:\\Notes\\rapport.markdown')
    expect(ensureTextExtension('C:\\Notes\\rapport.pdf', 'md')).toBe('C:\\Notes\\rapport.md')
    expect(ensureTextExtension('C:\\Notes\\rapport.docx', 'md')).toBe('C:\\Notes\\rapport.md')
    expect(ensureTextExtension('C:\\Notes\\rapport.exe', 'txt')).toBe('C:\\Notes\\rapport.txt')
    expect(defaultTextFileName('Sans:titre', 'txt')).toBe('Sans-titre.txt')
    expect(defaultTextFileName('Notes — Rapport final.pdf', 'md')).toBe('notes-rapport-final.md')
    expect(canonicalPathKey(' C:/Notes/RAPPORT.md ')).toBe('c:\\notes\\rapport.md')
  })

  it('annule sans écrire ni muter', async () => {
    const deps = dependencies({ choosePath: vi.fn(async () => null) })
    expect(await runSaveAs(snapshot, deps)).toEqual({ status: 'cancelled' })
    expect(deps.write).not.toHaveBeenCalled()
    expect(deps.commit).not.toHaveBeenCalled()
  })

  it('confirme le vrai fichier final quand le dialogue retourne un chemin sans extension', async () => {
    const order: string[] = []
    const deps = dependencies({
      choosePath: vi.fn(async () => 'C:\\Notes\\rapport'),
      pathExists: vi.fn(async () => true),
      confirmReplace: vi.fn(async () => {
        order.push('confirm')
        return true
      }),
      write: vi.fn(async (path) => {
        order.push(`write:${path}`)
      }),
    })
    expect(await runSaveAs(snapshot, deps)).toMatchObject({ status: 'saved', path: 'C:\\Notes\\rapport.md' })
    expect(order).toEqual(['confirm', 'write:C:\\Notes\\rapport.md'])
  })

  it('n’écrit pas si le remplacement du chemin final est refusé', async () => {
    const deps = dependencies({
      choosePath: vi.fn(async () => 'C:\\Notes\\rapport'),
      pathExists: vi.fn(async () => true),
      confirmReplace: vi.fn(async () => false),
    })
    expect(await runSaveAs(snapshot, deps)).toEqual({ status: 'cancelled' })
    expect(deps.write).not.toHaveBeenCalled()
  })

  it('refuse un chemin canonique déjà ouvert dans un autre onglet', async () => {
    const deps = dependencies({ isPathOwnedByOtherTab: vi.fn(() => true) })
    expect(await runSaveAs(snapshot, deps)).toEqual({ status: 'duplicate' })
    expect(deps.write).not.toHaveBeenCalled()
  })

  it('abandonne si l’onglet disparaît pendant le dialogue', async () => {
    const deps = dependencies({ isTabOpen: vi.fn(() => false) })
    expect(await runSaveAs(snapshot, deps)).toEqual({ status: 'stale' })
    expect(deps.write).not.toHaveBeenCalled()
  })

  it('écrit avant la transaction finale et ses effets', async () => {
    const order: string[] = []
    const deps = dependencies({
      write: vi.fn(async () => { order.push('write') }),
      commit: vi.fn(() => { order.push('commit'); return true }),
      afterCommit: vi.fn(async () => { order.push('after') }),
    })
    expect(await runSaveAs(snapshot, deps)).toMatchObject({ status: 'saved', attached: true })
    expect(order).toEqual(['write', 'commit', 'after'])
  })

  it('ne mute rien après une erreur d’écriture', async () => {
    const failure = new Error('disk full')
    const deps = dependencies({ write: vi.fn(async () => { throw failure }) })
    expect(await runSaveAs(snapshot, deps)).toEqual({ status: 'error', error: failure })
    expect(deps.commit).not.toHaveBeenCalled()
    expect(deps.afterCommit).not.toHaveBeenCalled()
  })
})
