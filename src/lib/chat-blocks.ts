// Habillage des blocs d'une réponse du copilote (Kube CodeBlock, Prose) — post-traitement
// APRÈS DOMPurify, comme les puces de citation : l'allowlist du sanitizer reste stricte,
// seul notre propre markup est injecté.
//  - chaque <pre> reçoit un en-tête (langage + bouton Copier, clic délégué au panneau) ;
//  - chaque <table> défile dans son propre conteneur horizontal.
// Remplacement par balise ouvrante/fermante (et non par paire) : l'HTML assaini reste
// équilibré même si une table ou un pre en contient un autre. Une regex ne vise jamais
// une valeur d'attribut : `sanitizeChatHtml` retire celles qui contiennent `<`, `>` ou `[`.
import { marked, type Tokens } from 'marked'

// Le sanitizer retire `class` (donc `language-x`) : le langage se relit dans le source.
// Charset fermé : le libellé vient du modèle et entre tel quel dans le markup.
const LANG = /^[A-Za-z0-9_+#.-]{1,24}$/

export function codeLanguages(md: string): string[] {
  const langs: string[] = []
  marked.walkTokens(marked.lexer(md, { gfm: true }), (token) => {
    if (token.type !== 'code') return
    const lang = ((token as Tokens.Code).lang ?? '').trim().split(/\s/)[0].toLowerCase()
    langs.push(LANG.test(lang) ? lang : '')
  })
  return langs
}

function codeHead(lang: string): string {
  return (
    `<div class="cop-code"><div class="cop-code-head"><span class="cop-code-lang">${lang || 'code'}</span>` +
    '<button type="button" class="cop-code-copy" aria-label="Copier le code">' +
    '<svg class="icon" aria-hidden="true"><use href="#i-copy" /></svg>' +
    '<svg class="icon" aria-hidden="true"><use href="#i-check" /></svg></button></div>' +
    // Focusable : un bloc plus large que la colonne défile aussi au clavier.
    '<pre tabindex="0">'
  )
}

// `langs` : langages des blocs dans l'ordre du source. Un <pre> venu d'HTML brut décale
// l'appariement : on renonce alors aux libellés plutôt que d'en afficher de faux.
export function decorateChatBlocks(html: string, langs: string[]): string {
  const preCount = html.match(/<pre>/g)?.length ?? 0
  const named = preCount === langs.length
  let i = 0
  return html
    .replace(/<pre>/g, () => codeHead(named ? langs[i++] : ''))
    .replace(/<\/pre>/g, '</pre></div>')
    .replace(/<table>/g, '<div class="cop-table-scroll"><table>')
    .replace(/<\/table>/g, '</table></div>')
}
