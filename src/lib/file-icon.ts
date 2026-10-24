import { kindFromName, type DocKind } from './doc-kind'

// Glyphe Lucide d'une entrée de l'explorateur, d'après les types du kit Kube (FileIcon) :
// PDF → `file-type`, document → `file-text`, note éditable → `file-pen-line`. Seuls
// les kinds que Doku ouvre ou liste ; un nom inconnu tombe sur `txt` (kindFromName).
// Le collecteur du sprite (scripts/icon-names.mjs) ignore les littéraux sans tiret :
// les noms d'un seul mot sont cités ici pour lui — #i-file #i-folder.
const FILE_ICONS: Record<DocKind, string> = {
  md: 'file-pen-line',
  html: 'file-code',
  txt: 'file',
  pdf: 'file-type',
  docx: 'file-text',
}

export function fileIcon(name: string, isDir = false, expanded = false): string {
  if (isDir) return expanded ? 'folder-open' : 'folder'
  return FILE_ICONS[kindFromName(name)]
}
