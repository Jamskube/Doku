// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { exportPortableMarkdown, inlineMarkdownImages, isInsideDir, portableMarkdownName } from './portable-markdown'

describe('portable Markdown export', () => {
  it('inline les images locales sans toucher aux images déjà portables', async () => {
    const readImageDataUrl = vi.fn(async () => 'data:image/png;base64,AAAA')
    const save = vi.fn(async () => true)
    const result = await exportPortableMarkdown(
      {
        kind: 'md',
        name: 'note.md',
        content: '![locale](images/capture.png)\n![inline](data:image/png;base64,BBBB)',
        dir: 'G:\\Notes',
      },
      { readImageDataUrl, save },
    )

    expect(readImageDataUrl).toHaveBeenCalledWith('G:\\Notes\\images\\capture.png')
    expect(save).toHaveBeenCalledWith(
      'note-portable.md',
      '![locale](data:image/png;base64,AAAA)\n![inline](data:image/png;base64,BBBB)',
    )
    expect(result).toEqual({ status: 'saved', inlined: 1, missing: [] })
  })

  it('n’embarque jamais un fichier hors du dossier du document', async () => {
    // Un Markdown reçu peut viser n'importe quoi : la copie portable ne doit pas
    // devenir un moyen d'exfiltrer une clé privée ou un fichier absolu du disque.
    const readImageDataUrl = vi.fn(async () => 'data:application/octet-stream;base64,SECRET')
    const save = vi.fn(async () => true)
    const result = await exportPortableMarkdown(
      { kind: 'md', name: 'note.md', content: '![a](../../.ssh/id_rsa)\n![b](C:/Users/x/secret.png)\n![c](sub/ok.png)', dir: 'G:\\Notes\\projet' },
      { readImageDataUrl, save },
    )
    expect(readImageDataUrl).toHaveBeenCalledTimes(1)
    expect(readImageDataUrl).toHaveBeenCalledWith('G:\\Notes\\projet\\sub\\ok.png')
    expect(result.missing).toEqual(['../../.ssh/id_rsa', 'C:/Users/x/secret.png'])
    expect(isInsideDir('G:\\Notes\\projet\\a\\..\\..\\x.png', 'G:\\Notes\\projet')).toBe(false)
    expect(isInsideDir('G:\\Notes\\projet\\a\\..\\x.png', 'G:\\Notes\\projet')).toBe(true)
    expect(isInsideDir('G:\\Notes\\projet-bis\\x.png', 'G:\\Notes\\projet')).toBe(false)
    // Même dossier écrit en barres obliques : dedans.
    expect(isInsideDir('G:/Notes/projet/sub/x.png', 'G:\\Notes\\projet')).toBe(true)
  })

  it('ne réexporte pas une copie portable en « -portable-portable »', () => {
    expect(portableMarkdownName('note-portable.md')).toBe('note-portable.md')
  })

  it('conserve une référence illisible et la signale', async () => {
    const save = vi.fn(async () => true)
    const result = await exportPortableMarkdown(
      { kind: 'md', name: 'note.md', content: '![x](missing.png)', dir: 'G:\\Notes' },
      { readImageDataUrl: async () => null, save },
    )

    expect(save).toHaveBeenCalledWith('note-portable.md', '![x](missing.png)')
    expect(result.missing).toEqual(['missing.png'])
  })

  it('garde les titres Markdown lors du remplacement', () => {
    expect(inlineMarkdownImages('![x](a.png "titre")', new Map([['a.png', 'data:image/png;base64,AA']]))).toBe(
      '![x](data:image/png;base64,AA "titre")',
    )
    expect(portableMarkdownName('sans-extension')).toBe('sans-extension-portable.md')
  })
})
