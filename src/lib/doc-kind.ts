// Ce qu'est un document pour Doku, et lesquels sont BINAIRES. Module pur, sans état :
// il est importé aussi bien par les stores que par la couche plateforme (`tauri.ts`),
// qui ne peut pas dépendre des stores.
//
// Cette séparation n'est pas cosmétique. La règle « ce kind ne se lit pas en texte »
// vivait dans les stores, hors de portée de `tauri.ts` — qui avait donc sa propre
// version, écrite en dur sur le PDF (`/\.pdf$/i`). Le jour où le DOCX est arrivé, la
// moitié de l'application le connaissait et l'autre non : le dialogue d'ouverture lisait
// l'archive ZIP comme du texte et la déclarait « format non pris en charge ». Un seul
// endroit décide désormais.

import { extensionOf } from './paths'

export type DocKind = 'md' | 'html' | 'txt' | 'pdf' | 'docx'

// Documents BINAIRES : leur onglet ne porte aucun contenu texte (`content` reste vide),
// ils s'affichent par un composant dédié et ne passent jamais par l'écriture texte.
// Le prédicat existe pour que ces règles ne se répètent pas en `kind === 'pdf'`
// disséminés — un oubli signifierait un Ctrl+S écrivant `''` par-dessus le fichier.
export type BinaryKind = 'pdf' | 'docx'
export const BINARY_KINDS: BinaryKind[] = ['pdf', 'docx']

// Garde de TYPE, pas simple booléen : c'est ce qui permet au compilateur d'exclure les
// kinds binaires du chemin d'écriture texte. Un booléen laisserait passer un `docx`
// jusqu'à `runSaveAs` — et donc jusqu'à écrire `''` dans le fichier.
export function isBinaryKind(kind: DocKind): kind is BinaryKind {
  return BINARY_KINDS.includes(kind as BinaryKind)
}

export function kindFromName(name: string): DocKind {
  // `extensionOf` et non `split('.').pop()` : celui-ci rend le nom ENTIER quand il n'y a
  // pas de point, donc un fichier nommé exactement `pdf` était classé `kind: 'pdf'` —
  // traité comme un binaire et envoyé au lecteur PDF, alors que c'est probablement du
  // texte. Même piège pour un fichier nommé `docx`.
  const ext = extensionOf(name)
  if (ext === 'html' || ext === 'htm') return 'html'
  if (ext === 'md' || ext === 'markdown') return 'md'
  if (ext === 'pdf') return 'pdf'
  if (ext === 'docx') return 'docx'
  return 'txt'
}

// Extensions que le dialogue d'ouverture propose. Dérivées des kinds plutôt que
// recopiées : un format ajouté au modèle apparaît dans le dialogue sans autre geste.
export const OPENABLE_EXTENSIONS = ['md', 'markdown', 'txt', 'html', 'htm', 'pdf', 'docx']

// Un fichier de ce nom doit-il être lu comme des OCTETS plutôt que comme du texte ?
export function isBinaryDocumentName(name: string): boolean {
  return isBinaryKind(kindFromName(name))
}
