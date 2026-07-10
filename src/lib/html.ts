// Prépare un document HTML pour l'aperçu sandboxé (FR-8) : on assainit le HTML
// (sanitizeHtml) puis on injecte une CSP stricte (aucun script, aucun réseau) + une
// feuille de base pour que le rendu habite la même colonne « papier » que le reste
// de Doku (au lieu du défaut navigateur Times/collé-à-gauche). Rendu dans un
// `<iframe sandbox="">`.
import { sanitizeHtml } from './sanitize'

const CSP =
  `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:">`

type Theme = 'light' | 'dark'

// Palette AIR restituée en valeurs littérales : l'iframe est une origine opaque
// isolée, sans accès aux variables CSS ni aux polices du parent (font-src data:
// seul), d'où le repli serif système (Georgia) qui garde l'esprit papier.
const PALETTE: Record<Theme, Record<string, string>> = {
  light: { bg: '#FDFBF5', panel: '#F4EFE2', ink: '#1C1A16', ink2: 'rgba(28,26,22,0.90)', ink3: 'rgba(28,26,22,0.75)', line2: 'rgba(28,26,22,0.18)', line3: 'rgba(28,26,22,0.28)' },
  dark: { bg: '#2E2E34', panel: '#36363D', ink: '#EBEDF1', ink2: 'rgba(235,237,241,0.94)', ink3: 'rgba(235,237,241,0.78)', line2: 'rgba(235,237,241,0.22)', line3: 'rgba(235,237,241,0.32)' },
}

// Feuille de base : le document HTML garde la priorité (ses propres <style>
// viennent après dans la cascade), on ne fait que fournir des défauts sains.
// `maxWidth` reprend la largeur de colonne courante (--doc-width) pour que le
// rendu s'aligne exactement sur la caption et obéisse au bouton de largeur.
function baseStyle(theme: Theme, maxWidth: string): string {
  const p = PALETTE[theme]
  return `<style>
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
  hr { border: none; border-top: 1px solid ${p.line2}; margin: 28px 0; }
</style>`
}

export function sandboxDoc(html: string, theme: Theme = 'light', maxWidth = '680px'): string {
  // Assainir AVANT d'injecter (sinon DOMPurify retirerait notre <meta>/<style>) :
  // retire script/meta-refresh/base/form et neutralise les ancres externes.
  const clean = sanitizeHtml(html)
  const inject = CSP + baseStyle(theme, maxWidth)
  if (/<head[^>]*>/i.test(clean)) return clean.replace(/<head[^>]*>/i, (m) => m + inject)
  if (/<html[^>]*>/i.test(clean)) return clean.replace(/<html[^>]*>/i, (m) => `${m}<head>${inject}</head>`)
  return inject + clean
}
