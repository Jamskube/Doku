// Parse un tableau GFM (texte brut du bloc) pour le rendu en widget (3.7).
// Logique pure et testable ; le rendu DOM et les décorations vivent dans live-preview.

export type CellAlign = 'left' | 'center' | 'right' | null

export interface ParsedTable {
  headers: string[]
  aligns: CellAlign[]
  rows: string[][]
}

function splitRow(line: string): string[] {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1) // pipe de bord, pas un `\|`
  // Découpe sur les `|` non échappés, puis dé-échappe `\|` en `|`.
  return s.split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, '|').trim())
}

// Une ligne de délimiteurs GFM : cellules `---`, `:--`, `--:`, `:--:` séparées par `|`.
const DELIM = /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?$/

// Renvoie le tableau parsé, ou null si le bloc n'est pas un tableau GFM valide
// (moins de 2 lignes, ou 2e ligne qui n'est pas une ligne de délimiteurs).
export function parseTable(md: string): ParsedTable | null {
  const lines = md.split('\n').map((l) => l.trim()).filter((l) => l.length > 0)
  if (lines.length < 2 || !DELIM.test(lines[1])) return null
  const headers = splitRow(lines[0])
  const aligns: CellAlign[] = splitRow(lines[1]).map((c) => {
    const left = c.startsWith(':')
    const right = c.endsWith(':')
    if (left && right) return 'center'
    if (right) return 'right'
    if (left) return 'left'
    return null
  })
  const rows = lines.slice(2).map(splitRow)
  return { headers, aligns, rows }
}

// --- Édition en place des cellules (story 20.2) ----------------------------------
//
// Le rendu (TableWidget) travaille sur des cellules DÉCOUPÉES, mais écrire dans le
// document demande l'inverse : savoir où vit EXACTEMENT chaque cellule dans la source.
// D'où ces spans — des offsets relatifs au début du bloc tableau.
//
// Principe directeur (ADR-0002, warning critique n°1) : on ne REGÉNÈRE jamais le bloc.
// Écrire dans une cellule = remplacer un intervalle de quelques caractères. Tout le
// reste du tableau — pipes, padding, alignements, cellules voisines — n'est pas touché.

export interface CellSpan {
  /** Index de ligne DANS LE BLOC (0 = en-tête, 1 = délimiteurs, 2+ = corps). */
  line: number
  /** Index de colonne. */
  col: number
  /** Offsets absolus dans le bloc, bornant le CONTENU (hors espaces de padding). */
  from: number
  to: number
}

// Découpe une ligne en régions inter-pipes, en offsets absolus dans la ligne.
// Les `\|` échappés n'ouvrent pas une nouvelle cellule.
function rowRegions(line: string, lineStart: number): Array<{ from: number; to: number }> {
  const bars: number[] = []
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '|' && line[i - 1] !== '\\') bars.push(i)
  }
  if (bars.length === 0) return [{ from: lineStart, to: lineStart + line.length }]

  const regions: Array<{ from: number; to: number }> = []
  // Avant le 1er pipe : cellule réelle seulement si ce n'est pas un pipe de bord.
  if (line.slice(0, bars[0]).trim().length > 0) {
    regions.push({ from: lineStart, to: lineStart + bars[0] })
  }
  for (let b = 0; b < bars.length - 1; b++) {
    regions.push({ from: lineStart + bars[b] + 1, to: lineStart + bars[b + 1] })
  }
  // Après le dernier pipe : idem (pipe de bord → pas de cellule).
  if (line.slice(bars[bars.length - 1] + 1).trim().length > 0) {
    regions.push({ from: lineStart + bars[bars.length - 1] + 1, to: lineStart + line.length })
  }
  return regions
}

// Resserre une région sur son contenu (sans le padding). Une cellule vide donne un span
// de longueur nulle placé APRÈS le premier espace — `|  |` → insertion en `| x |`.
function trimRegion(md: string, from: number, to: number): { from: number; to: number } {
  let a = from
  let b = to
  while (a < b && /\s/.test(md[a])) a++
  while (b > a && /\s/.test(md[b - 1])) b--
  if (a === b) {
    const pos = to > from ? from + 1 : from
    return { from: pos, to: pos }
  }
  return { from: a, to: b }
}

// Spans de toutes les cellules d'un bloc tableau. La ligne de délimiteurs (index 1) est
// incluse pour que les actions de structure (20.3) puissent s'y appuyer ; l'édition en
// place, elle, ne cible que l'en-tête et le corps.
export function tableCellSpans(md: string): CellSpan[] {
  const spans: CellSpan[] = []
  let offset = 0
  const lines = md.split('\n')
  lines.forEach((line, line_i) => {
    if (line.trim().length > 0) {
      rowRegions(line, offset).forEach((r, col) => {
        const t = trimRegion(md, r.from, r.to)
        spans.push({ line: line_i, col, from: t.from, to: t.to })
      })
    }
    offset += line.length + 1 // +1 pour le \n
  })
  return spans
}

// Texte d'une cellule prêt à être ÉCRIT dans la source : un `|` saisi par l'utilisateur
// doit être échappé (sinon il créerait une colonne fantôme), et les retours à la ligne
// sont aplatis (une cellule GFM tient sur une ligne).
export function escapeCellText(text: string): string {
  return text.replace(/\r?\n/g, ' ').replace(/(?<!\\)\|/g, '\\|').trim()
}

// --- Actions de structure (story 20.3) --------------------------------------------
//
// Ajouter/supprimer une ligne ou une colonne. Contrairement à l'édition d'une cellule
// (20.2, remplacement chirurgical), ces opérations changent la FORME du tableau : elles
// réécrivent donc le bloc — mais elles ne touchent QUE ce bloc, et le reste du document
// est intact. L'invariant non négociable : la sortie est toujours un tableau GFM valide
// (même nombre de colonnes partout, ligne de délimiteurs cohérente, alignements conservés).

// Découpe le bloc en lignes utiles, en mémorisant l'indentation d'origine pour la restituer.
function blockLines(md: string): { indent: string; rows: string[][]; delim: string[] } | null {
  const raw = md.split('\n').filter((l) => l.trim().length > 0)
  if (raw.length < 2 || !DELIM.test(raw[1].trim())) return null
  const indent = /^\s*/.exec(raw[0])![0]
  const delim = splitRow(raw[1])
  const rows = raw.filter((_, i) => i !== 1).map(splitRow)
  return { indent, rows, delim }
}

// Un délimiteur qui PRÉSERVE l'alignement d'une colonne (`:--`, `--:`, `:--:`, `---`).
function delimFor(align: CellAlign): string {
  if (align === 'center') return ':---:'
  if (align === 'right') return '---:'
  if (align === 'left') return ':---'
  return '---'
}

function alignOf(delimCell: string): CellAlign {
  const c = delimCell.trim()
  const left = c.startsWith(':')
  const right = c.endsWith(':')
  if (left && right) return 'center'
  if (right) return 'right'
  if (left) return 'left'
  return null
}

// Réassemble un tableau à partir de ses lignes logiques. Toutes les lignes sont
// normalisées au même nombre de colonnes : c'est ce qui garantit la validité GFM.
function render(indent: string, rows: string[][], aligns: CellAlign[]): string {
  const cols = aligns.length
  // `splitRow` DÉ-échappe (`\|` → `|`) : réécrire tel quel scinderait la cellule en deux
  // colonnes au prochain parse. On ré-échappe donc systématiquement à l'assemblage.
  const pad = (r: string[]) => Array.from({ length: cols }, (_, i) => escapeCellText(r[i] ?? ''))
  const line = (cells: string[]) => `${indent}| ${cells.join(' | ')} |`
  const out: string[] = []
  out.push(line(pad(rows[0] ?? [])))
  out.push(`${indent}| ${aligns.map(delimFor).join(' | ')} |`)
  for (let i = 1; i < rows.length; i++) out.push(line(pad(rows[i])))
  return out.join('\n')
}

export type TableOp =
  | { kind: 'addRowBelow'; row: number }
  | { kind: 'addRowAbove'; row: number }
  | { kind: 'deleteRow'; row: number }
  | { kind: 'addColRight'; col: number }
  | { kind: 'addColLeft'; col: number }
  | { kind: 'deleteCol'; col: number }

// Applique une action de structure. `row` est l'index de ligne DANS LE BLOC source
// (0 = en-tête, 1 = délimiteurs, 2+ = corps), cohérent avec `tableCellSpans`.
// Renvoie null si l'opération est impossible ou produirait un tableau invalide —
// l'appelant n'écrit alors rien (jamais de tableau cassé dans le document).
export function applyTableOp(md: string, op: TableOp): string | null {
  const parsed = blockLines(md)
  if (!parsed) return null
  const { indent, delim } = parsed
  const rows = parsed.rows.map((r) => [...r])
  const aligns = delim.map(alignOf)
  const cols = aligns.length

  // Index source (avec la ligne de délimiteurs) → index dans `rows` (sans elle).
  const toLogical = (srcRow: number) => (srcRow === 0 ? 0 : srcRow - 1)

  switch (op.kind) {
    case 'addRowBelow':
    case 'addRowAbove': {
      const empty = Array.from({ length: cols }, () => '')
      // Au-dessus de l'en-tête n'a pas de sens (ce serait un nouvel en-tête) : on insère
      // alors en première ligne de CORPS, ce qui est l'intention réelle.
      const li = toLogical(op.row)
      const at = op.kind === 'addRowBelow' ? li + 1 : Math.max(1, li)
      rows.splice(at, 0, empty)
      return render(indent, rows, aligns)
    }
    case 'deleteRow': {
      const li = toLogical(op.row)
      if (li === 0) return null // supprimer l'en-tête détruirait le tableau
      if (rows.length <= 2) return null // garder au moins une ligne de corps
      rows.splice(li, 1)
      return render(indent, rows, aligns)
    }
    case 'addColRight':
    case 'addColLeft': {
      const at = op.kind === 'addColRight' ? op.col + 1 : op.col
      if (at < 0 || at > cols) return null
      const nextAligns = [...aligns]
      nextAligns.splice(at, 0, null)
      const nextRows = rows.map((r) => {
        const c = Array.from({ length: cols }, (_, i) => r[i] ?? '')
        c.splice(at, 0, '')
        return c
      })
      return render(indent, nextRows, nextAligns)
    }
    case 'deleteCol': {
      if (cols <= 1) return null // un tableau sans colonne n'existe pas
      if (op.col < 0 || op.col >= cols) return null
      const nextAligns = aligns.filter((_, i) => i !== op.col)
      const nextRows = rows.map((r) => {
        const c = Array.from({ length: cols }, (_, i) => r[i] ?? '')
        return c.filter((_, i) => i !== op.col)
      })
      return render(indent, nextRows, nextAligns)
    }
  }
}
