// Le DOCX a été rejeté à l'ouverture — « le format n'est pas pris en charge » — alors
// que Doku savait l'éditer. La cause n'était pas le DOCX : c'était la connaissance
// « ce kind ne se lit pas en texte », recopiée en dur sur le PDF dans la couche
// plateforme. Ces tests verrouillent le fait qu'elle n'existe plus qu'à un endroit.
import { describe, expect, it } from 'vitest'
import {
  BINARY_KINDS,
  OPENABLE_EXTENSIONS,
  isBinaryDocumentName,
  isBinaryKind,
  kindFromName,
  type DocKind,
} from './doc-kind'
import { isSupportedFile } from './explorer'

describe('kindFromName', () => {
  const cas: [string, DocKind][] = [
    ['notes.md', 'md'],
    ['NOTES.MARKDOWN', 'md'],
    ['page.html', 'html'],
    ['page.HTM', 'html'],
    ['contrat.pdf', 'pdf'],
    ['contrat.PDF', 'pdf'],
    ['rapport.docx', 'docx'],
    ['rapport.DOCX', 'docx'],
    ['liste.txt', 'txt'],
    ['sans-extension', 'txt'],
  ]
  for (const [nom, attendu] of cas) {
    it(`reconnaît « ${nom} » comme ${attendu}`, () => {
      expect(kindFromName(nom)).toBe(attendu)
    })
  }

  it('lit l’extension du NOM, pas du chemin', () => {
    expect(kindFromName('C:\\Mes.docx.notes\\rapport.md')).toBe('md')
  })

  // `split('.').pop()` rendait le nom ENTIER quand il n'y a pas de point : un fichier
  // nommé exactement `pdf` était classé binaire et envoyé au lecteur PDF.
  it('un fichier SANS extension n’est jamais un binaire, même s’il s’appelle « pdf »', () => {
    expect(kindFromName('pdf')).toBe('txt')
    expect(kindFromName('docx')).toBe('txt')
    expect(isBinaryDocumentName('pdf')).toBe(false)
    expect(isBinaryDocumentName('docx')).toBe(false)
  })

  it('un nom caché n’est pas une extension', () => {
    expect(kindFromName('.md')).toBe('txt')
    expect(kindFromName('.gitignore')).toBe('txt')
  })
})

describe('isBinaryDocumentName', () => {
  it('reconnaît TOUS les kinds binaires, pas seulement le PDF', () => {
    // Le défaut d'origine, en une assertion : le test portait sur `/\.pdf$/i`, donc le
    // DOCX partait en lecture texte et ressortait en « format non pris en charge ».
    expect(isBinaryDocumentName('contrat.pdf')).toBe(true)
    expect(isBinaryDocumentName('rapport.docx')).toBe(true)
  })

  it('laisse passer les documents texte', () => {
    for (const nom of ['notes.md', 'page.html', 'liste.txt', 'sans-extension']) {
      expect(isBinaryDocumentName(nom)).toBe(false)
    }
  })

  it('couvre chaque kind binaire déclaré — un troisième format ne peut pas être oublié', () => {
    for (const kind of BINARY_KINDS) {
      expect(isBinaryDocumentName(`document.${kind}`)).toBe(true)
      expect(isBinaryKind(kind)).toBe(true)
    }
  })
})

describe('cohérence des points d’entrée', () => {
  it('tout ce que le dialogue propose, l’explorateur l’accepte', () => {
    for (const ext of OPENABLE_EXTENSIONS) {
      expect(isSupportedFile(`document.${ext}`)).toBe(true)
    }
  })

  it('tout ce que le dialogue propose a un kind qui n’est pas un repli txt par accident', () => {
    // `txt` est le repli de `kindFromName` : une extension proposée à l'ouverture mais
    // inconnue du modèle s'ouvrirait en texte brut sans que rien ne le signale.
    const attendus: Record<string, DocKind> = {
      md: 'md', markdown: 'md', txt: 'txt', html: 'html', htm: 'html', pdf: 'pdf', docx: 'docx',
    }
    for (const ext of OPENABLE_EXTENSIONS) {
      expect(kindFromName(`document.${ext}`)).toBe(attendus[ext])
    }
  })

  it('chaque kind binaire est ouvrable depuis le dialogue', () => {
    for (const kind of BINARY_KINDS) {
      expect(OPENABLE_EXTENSIONS).toContain(kind)
    }
  })
})
