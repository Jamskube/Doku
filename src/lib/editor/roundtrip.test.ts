import { describe, it, expect } from 'vitest'
import { detectLineEnding, serializeDoc, EditorState } from './editor'

// Reproduit le chemin réel de l'app : ouverture d'un contenu, édition neutre
// (insertion puis suppression), puis sérialisation avec la fin de ligne du fichier
// — exactement ce que fait DocumentView (updateListener → serializeDoc).
function editRoundTrip(content: string): string {
  const eol = detectLineEnding(content)
  const state = EditorState.create({ doc: content })
  const inserted = state.update({ changes: { from: 0, insert: 'X' } }).state
  const removed = inserted.update({ changes: { from: 0, to: 1 } }).state
  return serializeDoc(removed.doc.toString(), eol)
}

// Corpus à fins de ligne cohérentes → round-trip attendu octet pour octet.
const FIXTURES: Record<string, string> = {
  'titre + paragraphe': '# Titre\n\nUn paragraphe avec *emphase* et **gras**.\n',
  'sans saut de ligne final': '# Titre\n\nPas de saut final.',
  'CRLF': '# Titre\r\n\r\nParagraphe.\r\n- item 1\r\n- item 2\r\n',
  'tableau GFM': '| A | B |\n|---|---|\n| 1 | 2 |\n',
  'liste de tâches': '- [ ] à faire\n- [x] fait\n',
  'bloc de code': '```js\nconst x = 42\n```\n',
  'espaces en fin de ligne': 'ligne avec espaces   \nautre\tligne\t\n',
  'lignes vides consécutives': 'a\n\n\n\nb\n',
  'unicode + emoji': '# Héllo 🌍\n\nçà et là — «guillemets» • 你好\n',
  'wikilink + lien': 'Voir [[autre-note]] et [lien](https://ex.com).\n',
}

describe('round-trip après édition (fins de ligne cohérentes)', () => {
  for (const [name, content] of Object.entries(FIXTURES)) {
    it(`préserve « ${name} » octet pour octet`, () => {
      expect(editRoundTrip(content)).toBe(content)
    })
  }
})

describe('fins de ligne', () => {
  it('un fichier CRLF reste en CRLF après édition', () => {
    expect(editRoundTrip('a\r\nb\r\nc\r\n')).toBe('a\r\nb\r\nc\r\n')
  })

  it('un fichier LF reste en LF après édition', () => {
    expect(editRoundTrip('a\nb\nc\n')).toBe('a\nb\nc\n')
  })

  it('fins de ligne mixtes → normalisées vers la dominante (documenté)', () => {
    // 2×CRLF, 1×LF → tout devient CRLF
    expect(editRoundTrip('a\r\nb\nc\r\n')).toBe('a\r\nb\r\nc\r\n')
  })
})

describe('detectLineEnding', () => {
  it('détecte LF', () => expect(detectLineEnding('a\nb\n')).toBe('\n'))
  it('détecte CRLF', () => expect(detectLineEnding('a\r\nb\r\n')).toBe('\r\n'))
  it('document vide → LF', () => expect(detectLineEnding('')).toBe('\n'))
  it('dominante l’emporte', () => expect(detectLineEnding('a\r\nb\r\nc\n')).toBe('\r\n'))
  it('compte les LF des lignes vides (3 CRLF < 4 LF autour de vides → LF)', () =>
    // Régression : l'ancien regex sous-comptait les \n consécutifs et basculait à tort en CRLF.
    expect(detectLineEnding('a\r\nb\r\nc\r\nd\n\n\n\ne')).toBe('\n'))
})

describe('serializeDoc', () => {
  it('LF : renvoie le texte tel quel', () => expect(serializeDoc('a\nb\n', '\n')).toBe('a\nb\n'))
  it('CRLF : convertit chaque \\n en \\r\\n', () => expect(serializeDoc('a\nb\n', '\r\n')).toBe('a\r\nb\r\n'))
})
