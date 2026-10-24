// Prépare un document HTML pour l'aperçu sandboxé (FR-8) : on assainit le HTML
// (sanitizeHtml) puis on injecte une CSP stricte (aucun script, aucun réseau) + une
// feuille de base pour que le rendu habite la même colonne « papier » que le reste
// de Doku (au lieu du défaut navigateur Times/collé-à-gauche). Rendu dans un
// `<iframe sandbox="allow-same-origin">` : aucun script, mais le parent peut y révéler une citation.
import { locateTextSpan } from './citations'
import { sanitizeHtml } from './sanitize'

export const CSP =
  `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:">`

type Theme = 'light' | 'dark'

// Palette AIR restituée en valeurs littérales : l'iframe est une origine opaque
// isolée, sans accès aux variables CSS ni aux polices du parent (font-src data:
// seul), d'où le repli serif système (Georgia) qui garde l'esprit papier.
const PALETTE: Record<Theme, Record<string, string>> = {
  light: { bg: '#FDFBF5', panel: '#F4EFE2', ink: '#1C1A16', ink2: 'rgba(28,26,22,0.90)', ink3: 'rgba(28,26,22,0.75)', line2: 'rgba(28,26,22,0.18)', line3: 'rgba(28,26,22,0.28)' },
  dark: { bg: '#2E2E34', panel: '#36363D', ink: '#EBEDF1', ink2: 'rgba(235,237,241,0.94)', ink3: 'rgba(235,237,241,0.78)', line2: 'rgba(235,237,241,0.22)', line3: 'rgba(235,237,241,0.32)' },
}

// Feuille papier « AIR » (sans balise <style>) : le document HTML garde la priorité
// (ses propres <style> viennent après dans la cascade), on ne fait que fournir des
// défauts sains. `maxWidth` reprend la largeur de colonne courante (--doc-width) pour
// que le rendu s'aligne exactement sur la caption. Exportée pour être réutilisée par
// le pipeline d'export/impression (src/lib/export/print.ts) sans dupliquer la palette.
export function paperCss(theme: Theme, maxWidth: string): string {
  const p = PALETTE[theme]
  return `
  :root { color-scheme: ${theme}; }
  *, *::before, *::after { box-sizing: border-box; }
  html { background: ${p.bg}; }
  body {
    margin: 0 auto; max-width: ${maxWidth}; padding: 40px 40px 120px;
    font-family: 'Source Serif 4', 'Iowan Old Style', Georgia, serif;
    font-size: 18.5px; line-height: 1.78; color: ${p.ink2}; background: ${p.bg};
    -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility;
  }
  h1, h2, h3, h4, h5, h6 { color: ${p.ink}; line-height: 1.25; font-weight: 600; }
  a { color: ${p.ink}; text-decoration: underline; text-decoration-color: ${p.line3}; text-underline-offset: 2px; }
  code, kbd, samp { font-family: 'Geist Mono', ui-monospace, monospace; font-size: 0.85em; }
  pre { background: ${p.panel}; padding: 14px 18px; border-radius: 8px; overflow-x: auto; }
  pre code { font-size: 0.82em; }
  img { max-width: 100%; height: auto; border-radius: 8px; }
  table { border-collapse: collapse; }
  th, td { border: 1px solid ${p.line2}; padding: 6px 12px; text-align: left; }
  blockquote { margin: 0; padding-left: 16px; border-left: 2px solid ${p.line3}; color: ${p.ink3}; }
  hr { border: none; border-top: 1px solid ${p.line2}; margin: 28px 0; }`
}

function baseStyle(theme: Theme, maxWidth: string): string {
  return `<style>${paperCss(theme, maxWidth)}
</style>`
}

// Injecte `injection` (CSP + <style>) au bon endroit d'un document HTML déjà assaini :
// dans un <head> existant, sinon juste après <html>, sinon en tête. Partagé par
// sandboxDoc (aperçu) et le pipeline d'impression.
export function injectHead(html: string, injection: string): string {
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => m + injection)
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (m) => `${m}<head>${injection}</head>`)
  return injection + html
}

export function sandboxDoc(html: string, theme: Theme = 'light', maxWidth = '680px'): string {
  // Assainir AVANT d'injecter (sinon DOMPurify retirerait notre <meta>/<style>) :
  // retire script/meta-refresh/base/form et neutralise les ancres externes.
  const clean = sanitizeHtml(html)
  return injectHead(clean, CSP + baseStyle(theme, maxWidth))
}

// Révèle un passage cité dans l'aperçu HTML (iframe `allow-same-origin`, sans script) :
// défile jusqu'à lui et pose des repères qui s'effacent, comme le surlignage PDF. `passage`
// est un extrait du SOURCE (balises comprises) : on compare son texte au texte rendu.
// 'pending' tant que srcdoc n'est pas chargé (l'appelant réessaie au `load`).
export function revealHtmlPassage(frame: HTMLIFrameElement, passage: string, dark: boolean): 'pending' | 'missing' | 'shown' {
  const doc = frame.contentDocument
  const win = frame.contentWindow
  if (!doc?.body || !win || doc.URL !== 'about:srcdoc' || doc.readyState !== 'complete') return 'pending'
  // Extrait coupé au milieu d'une balise (`ss="x">Texte`) : on retire ce reste avant d'en lire le texte.
  const wanted = new DOMParser().parseFromString(passage.replace(/^[^<]*?>/, ''), 'text/html').body.textContent ?? ''
  const nodes: Text[] = []
  const owner: number[] = []
  const offset: number[] = []
  let text = ''
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.parentElement?.closest('style, script, noscript, template') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  })
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const value = node.nodeValue ?? ''
    for (let i = 0; i < value.length; i++) {
      const space = /\s/.test(value[i])
      if (space && (text === '' || text.endsWith(' '))) continue
      text += space ? ' ' : value[i]
      owner.push(nodes.length)
      offset.push(i)
    }
    nodes.push(node as Text)
  }
  const span = locateTextSpan(text, wanted)
  if (!span) return 'missing'
  // Un Range sur toute l'étendue rendrait aussi la boîte des blocs qu'il contient (cartes
  // entières surlignées) : rectangles pris nœud texte par nœud texte.
  const rects: DOMRect[] = []
  const last = owner[span.end - 1]
  for (let n = owner[span.start]; n <= last && rects.length < 300; n++) {
    const range = doc.createRange()
    range.setStart(nodes[n], n === owner[span.start] ? offset[span.start] : 0)
    range.setEnd(nodes[n], n === last ? offset[span.end - 1] + 1 : nodes[n].length)
    rects.push(...[...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0))
  }
  if (!rects.length) return 'missing'
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
  win.scrollTo({ top: rects[0].top + win.scrollY - win.innerHeight / 3, behavior: reduced ? 'auto' : 'smooth' })
  // Une citation remplace la précédente : empilées en multiply, les marques fonçaient.
  doc.querySelectorAll('[data-doku-cite]').forEach((m) => m.remove())
  for (const r of rects) {
    const mark = doc.createElement('div')
    mark.dataset.dokuCite = ''
    // Coordonnées du document (et non de la fenêtre) : le défilement ne décale pas les repères.
    mark.style.cssText =
      `position:absolute;left:${r.left + win.scrollX}px;top:${r.top + win.scrollY}px;width:${r.width}px;height:${r.height}px;` +
      `border-radius:2px;pointer-events:none;z-index:2147483647;` +
      (dark ? 'background:rgba(255,205,84,.28)' : 'background:rgba(255,205,84,.42);mix-blend-mode:multiply')
    doc.documentElement.appendChild(mark)
    // Même courbe que le repère PDF (`ease`), portée par l'image clé : en option, elle
    // s'appliquerait à toute l'animation. Durée gardée en mouvement réduit : c'est un fondu.
    mark.animate(
      [{ opacity: 1 }, { opacity: 1, offset: 0.65, easing: 'ease' }, { opacity: 0 }],
      { duration: 4200, fill: 'forwards' },
    ).onfinish = () => mark.remove()
  }
  return 'shown'
}
