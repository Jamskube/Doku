// Formatage Markdown de la sélection (story 20.4) — couche PURE : calculs sur chaînes,
// aucun import CM6. La détection d'activation (« la sélection est-elle déjà en gras ? »)
// ne vit PAS ici : elle appartient à l'arbre syntaxique, côté glue
// (src/lib/editor/format-commands.ts) — leçon 20.3 : jamais d'heuristique de chaîne là
// où le parseur fait foi. Ici : la mécanique d'enveloppe et les gabarits, testables à nu.

export type InlineMark = 'bold' | 'italic' | 'strike' | 'code'

export const MARKERS: Record<InlineMark, string> = {
  bold: '**',
  italic: '*',
  strike: '~~',
  code: '`',
}

export interface WrapEdit {
  /** Texte remplaçant la sélection. */
  insert: string
  /** Nouvelle sélection, relative au début du remplacement. */
  selFrom: number
  selTo: number
}

// Enveloppe une sélection dans un marqueur inline. Les espaces de bord restent HORS
// marqueurs (`** x**` n'est pas de l'emphase GFM valide). Sélection traversant une
// ligne vide (frontière de paragraphe) → null : on ne produit jamais de markdown
// invalide. Sélection vide → paire vide, caret centré (le texte tapé ensuite est formaté ;
// une paire laissée vide n'est pas parsée, donc reste VISIBLE et se supprime à la main).
export function wrapSelection(sel: string, marker: string): WrapEdit | null {
  if (/\n[ \t]*\n/.test(sel)) return null
  if (marker === '`' && sel.includes('`')) return null // backtick dans la sélection : span cassé
  const lead = /^\s*/.exec(sel)![0]
  const trail = lead.length === sel.length ? '' : /\s*$/.exec(sel)![0]
  const core = sel.slice(lead.length, sel.length - trail.length)
  return {
    insert: lead + marker + core + marker + trail,
    selFrom: lead.length + marker.length,
    selTo: lead.length + marker.length + core.length,
  }
}

// Enveloppe la sélection en lien `[texte](url)`, en sélectionnant le placeholder `url`
// pour que la frappe le remplace. Multiligne → null (un lien tient sur une ligne).
export function makeLink(sel: string): WrapEdit | null {
  if (sel.includes('\n')) return null
  const lead = /^\s*/.exec(sel)![0]
  const trail = lead.length === sel.length ? '' : /\s*$/.exec(sel)![0]
  const core = sel.slice(lead.length, sel.length - trail.length) || 'texte'
  const insert = `${lead}[${core}](url)${trail}`
  const urlFrom = lead.length + 1 + core.length + 2
  return { insert, selFrom: urlFrom, selTo: urlFrom + 3 }
}

// Texte affiché d'un lien `[texte](url)` — pour le dé-envelopper.
export function linkText(link: string): string | null {
  const m = /^\[(.*?)\]\(.*\)$/.exec(link)
  return m ? m[1] : null
}

// --- Opérations de LIGNE (titres, liste, citation) ---------------------------------
// Toggle collectif : si TOUTES les lignes non vides portent déjà la forme cible, on la
// retire ; sinon on l'applique partout. Jamais d'empilement.

export function toggleHeadingLines(lines: string[], level: number): string[] {
  // « Au niveau » = exactement `level` dièses suivis d'une espace (un 4e dièse ou un
  // dièse manquant fait échouer la correspondance, le compte est donc exact).
  const atLevel = new RegExp(`^\\s*${'#'.repeat(level)} `)
  const target = lines.filter((l) => l.trim().length > 0)
  const all = target.length > 0 && target.every((l) => atLevel.test(l))
  return lines.map((l) => {
    if (l.trim().length === 0) return l
    const indent = /^\s*/.exec(l)![0]
    const rest = l.slice(indent.length).replace(/^#{1,6}\s+/, '')
    return all ? indent + rest : indent + '#'.repeat(level) + ' ' + rest
  })
}

const PREFIX_RE: Record<string, RegExp> = {
  '- ': /^(\s*)- /,
  '> ': /^(\s*)> ?/,
}

// Une ligne déjà en liste, quelle que soit sa syntaxe (`- `, `* `, `+ `, `1. `, `1) `) :
// on REMPLACE son marqueur plutôt que d'empiler (`- * item` serait une liste imbriquée).
const ANY_LIST_RE = /^(\s*)(?:[-*+]|\d+[.)]) /

export function toggleLinePrefix(lines: string[], prefix: '- ' | '> '): string[] {
  const re = PREFIX_RE[prefix]
  const target = lines.filter((l) => l.trim().length > 0)
  const all = target.length > 0 && target.every((l) => re.test(l))
  return lines.map((l) => {
    if (l.trim().length === 0) return l
    if (all) return l.replace(re, '$1')
    if (re.test(l)) return l // deja prefixee : completer les autres, jamais empiler
    if (prefix === '- ' && ANY_LIST_RE.test(l)) return l.replace(ANY_LIST_RE, '$1' + prefix)
    const indent = /^\s*/.exec(l)![0]
    return indent + prefix + l.slice(indent.length)
  })
}

// --- Gabarits de bloc ---------------------------------------------------------------
// ⚠ Toujours insérés entre lignes vides par la glue : un `---` collé sous un paragraphe
// est un titre setext H2 (le paragraphe deviendrait un titre), et un tableau GFM ne peut
// pas interrompre un paragraphe.

export const HR_TEMPLATE = '---'

export const TABLE_TEMPLATE = ['| Colonne 1 | Colonne 2 |', '| --- | --- |', '|  |  |'].join('\n')
