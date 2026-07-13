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
