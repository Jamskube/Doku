import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { collectIconNames, lucideIds } from '../../scripts/icon-names.mjs'
import { fileIcon } from './file-icon'

describe('fileIcon', () => {
  it('donne un glyphe par type de document ouvrable', () => {
    expect(fileIcon('notes.md')).toBe('file-pen-line')
    expect(fileIcon('Notes.MARKDOWN')).toBe('file-pen-line')
    expect(fileIcon('rapport.PDF')).toBe('file-type')
    expect(fileIcon('contrat.docx')).toBe('file-text')
    expect(fileIcon('page.htm')).toBe('file-code')
    expect(fileIcon('page.html')).toBe('file-code')
    expect(fileIcon('journal.txt')).toBe('file')
  })

  it('ne prend pas un nom sans extension pour son type', () => {
    expect(fileIcon('pdf')).toBe('file')
    expect(fileIcon('docx')).toBe('file')
  })

  it('distingue dossier ouvert et fermé, quel que soit le nom', () => {
    expect(fileIcon('archive.pdf', true)).toBe('folder')
    expect(fileIcon('archive.pdf', true, true)).toBe('folder-open')
  })

  // Un glyphe que le collecteur ne voit pas serait absent du sprite : un carré vide
  // à l'écran, sans test rouge (icons.test.ts ne vérifie que les noms collectés).
  it('ne rend que des noms que le collecteur du sprite repère', () => {
    const root = fileURLToPath(new URL('../..', import.meta.url))
    const known = lucideIds(`${root}node_modules/lucide-static/sprite.svg`)
    const collected = new Set(collectIconNames(`${root}src/lib`, known))
    const names = ['a.md', 'a.html', 'a.txt', 'a.pdf', 'a.docx'].map((n) => fileIcon(n))
    names.push(fileIcon('d', true), fileIcon('d', true, true))
    expect(names.filter((n) => !collected.has(n))).toEqual([])
  })
})
