// Découpe de chemins de fichiers. Module PUR, sans aucune dépendance : c'est ce qui permet
// à `save-as.ts` (jusqu'ici sans le moindre import) et à `doc-kind.ts` de s'en servir sans
// tirer l'explorateur de dossiers — et ses deux `Intl.Collator` construits au chargement.
//
// Ces fonctions vivaient dans `explorer.ts` et reposaient sur un `sepOf` qui choisissait UN
// séparateur pour tout le chemin (`path.includes('\\') ? '\\' : '/'`). Sur un chemin MIXTE —
// `C:\Docs/note.md`, courant sous Tauri, qui rend parfois des slashs sur Windows — elles se
// trompaient toutes de la même façon : `baseName` rendait `Docs/note.md`, `parentPath`
// rendait `C:`.
//
// C'était la racine d'un doublon : neuf endroits du code avaient recopié un
// `path.split(/[\\/]/).pop()` maison, précisément pour éviter ce défaut. Corriger ici
// supprime la raison d'être de ces copies.
//
// Règle : on DÉCOUPE sur les deux séparateurs, on ÉCRIT avec celui qu'emploie le chemin.

const SEP = /[\\/]/

// Séparateur d'écriture par défaut (exporté : l'explorateur en a besoin pour préfixer
// une racine et découper un fil d'Ariane) : celui du chemin, antislash si ambigu (cible Windows).
export function sepOf(path: string): '\\' | '/' {
  return path.includes('\\') ? '\\' : '/'
}

// Retire un séparateur final, quel qu'il soit.
function withoutTrailingSep(path: string): string {
  return path.length > 1 && SEP.test(path.slice(-1)) ? path.slice(0, -1) : path
}

// Index du dernier séparateur, les deux confondus. -1 s'il n'y en a aucun.
function lastSepIndex(path: string): number {
  return Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'))
}

// Dossier parent d'un chemin, ou null à la racine.
export function parentPath(path: string | null): string | null {
  if (!path) return null
  const trimmed = withoutTrailingSep(path)
  const idx = lastSepIndex(trimmed)
  if (idx <= 0) return null
  const parent = trimmed.slice(0, idx)
  // Racine de lecteur Windows : « C:\file » → parent « C: » est malformé
  // (joinPath mé-détecterait le séparateur) → renvoyer la racine « C:\ ».
  if (/^[A-Za-z]:$/.test(parent)) return parent + sepOf(path)
  return parent
}

export function joinPath(dir: string, name: string): string {
  if (SEP.test(dir.slice(-1))) return dir + name
  // On prolonge le style LOCAL du dossier — le dernier séparateur qu'il emploie — plutôt
  // que d'imposer celui qui domine : sur `C:\Docs/sous`, recoller avec un antislash
  // casserait l'aller-retour `joinPath(parentPath(p), baseName(p)) === p`.
  const dernier = lastSepIndex(dir)
  const sep = dernier >= 0 ? (dir[dernier] as '\\' | '/') : sepOf(dir)
  return dir + sep + name
}

export function baseName(path: string): string {
  const trimmed = withoutTrailingSep(path)
  return trimmed.slice(lastSepIndex(trimmed) + 1)
}

// Extension en minuscules, sans le point. '' si le nom n'en a pas.
//
// `idx <= 0` et non `idx < 0` : un nom qui COMMENCE par un point (`.gitignore`) est un nom
// caché, pas une extension. Deux autres endroits du code faisaient `split('.').pop()`, qui
// rend le nom ENTIER quand il n'y a pas de point — un fichier nommé `pdf` était alors
// classé comme document PDF binaire.
export function extensionOf(name: string): string {
  const idx = name.lastIndexOf('.')
  return idx <= 0 ? '' : name.slice(idx + 1).toLowerCase()
}
