// Pipeline d'export PDF (spike 10.1, ADR-0008). Approche retenue : `window.print()`
// sur un iframe d'impression isolé + `@media print` — le moteur d'impression Chromium
// de WebView2 produit le PDF via la destination « Enregistrer au format PDF » du
// dialogue. Zéro dépendance, zéro Rust (aligné ADR-0004). L'alternative silencieuse
// `ICoreWebView2_7::PrintToPdf` (COM) est documentée en repli dans l'ADR (non retenue :
// exige du Rust/COM et ne sert qu'un besoin batch inexistant ici).
//
// SÉCURITÉ : l'iframe est `sandbox="allow-modals allow-same-origin"` SANS allow-scripts.
// `allow-same-origin` permet au parent d'appeler `contentWindow.print()`, `allow-modals`
// autorise le dialogue ; l'absence de allow-scripts neutralise tout script injecté même
// si DOMPurify est contourné sur un `.html` non fiable (défense en profondeur, cf. critic).
// On injecte AUSSI une CSP `default-src 'none'` dans le doc (ne pas dépendre de l'absence
// de style-src dans la CSP applicative — qui pourrait être durcie plus tard).
//
// PIÈGE WebView2 #5199 : le PDF « Save as PDF » peut être supprimé si la webview est
// disposée avant la fin de l'écriture async. Mitigation : ne JAMAIS fermer la fenêtre
// pendant l'impression, et ne retirer l'iframe qu'en différé (jamais synchroniquement
// pendant l'impression). Le timing exact du teardown est ce que l'essai NATIF valide.
import { paperCss, injectHead } from '../html'
import { sanitizeHtml } from '../sanitize'

export interface Printable {
  kind: 'md' | 'html' | 'txt'
  name: string
  content: string
}

// Colonne papier un peu plus large qu'à l'écran (l'A4 imprimé a de la place).
const PRINT_WIDTH = '760px'

// CSP du document d'impression : aucun réseau, styles inline autorisés (feuille papier),
// images en data: uniquement (mêmes limites que l'aperçu .html sandboxé).
const PRINT_CSP =
  `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">`

// Surcouche d'impression : marges de page, anti-coupure des blocs, et bascule dark→light
// forcée (fond ET couleur du texte — imprimer clair même si l'app est en thème sombre).
const PRINT_CSS = `
  @page { margin: 18mm 16mm; }
  @media print {
    html, body { background: #fff !important; color: #1C1A16 !important; }
  }
  h1, h2, h3, h4, h5, h6 { break-after: avoid; }
  pre, blockquote, table, img, ul, ol, li, tr { break-inside: avoid; }
  pre { white-space: pre-wrap; word-break: break-word; }`

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

// Construit le document HTML « papier » prêt à imprimer pour un onglet.
// - `.html` : contenu assaini (DOMPurify) — chemin fidèle, identique à l'aperçu existant.
// - `.txt` / `.md` : source échappée dans <pre> (le rendu MD→HTML fidèle = story 10.2).
export function buildPrintHtml(tab: Printable): string {
  const body =
    tab.kind === 'html' ? sanitizeHtml(tab.content) : `<pre>${escapeHtml(tab.content)}</pre>`
  const inject = `${PRINT_CSP}<style>${paperCss('light', PRINT_WIDTH)}\n${PRINT_CSS}\n</style>`
  return injectHead(body, inject)
}

// Ouvre le dialogue d'impression sur le document rendu, via un iframe isolé et caché.
// Aucun effet en environnement sans DOM (no-op défensif pour les tests unitaires).
export function exportViaPrint(tab: Printable): void {
  if (typeof document === 'undefined') return
  const frame = document.createElement('iframe')
  frame.setAttribute('sandbox', 'allow-modals allow-same-origin')
  frame.setAttribute('aria-hidden', 'true')
  // Hors écran mais dimensionné (certains moteurs impriment mal un iframe 0×0).
  frame.style.cssText =
    'position:fixed; left:-10000px; top:0; width:794px; height:1123px; border:0; visibility:hidden'
  frame.srcdoc = buildPrintHtml(tab)

  let torn = false
  // Teardown DIFFÉRÉ (#5199) : jamais synchrone pendant l'impression/écriture async.
  const teardown = () => {
    if (torn) return
    torn = true
    setTimeout(() => frame.remove(), 30_000)
  }

  frame.addEventListener(
    'load',
    () => {
      const win = frame.contentWindow
      if (!win) {
        frame.remove()
        return
      }
      // afterprint = fermeture du dialogue (pas fin d'écriture PDF) → on programme un
      // teardown paresseux, jamais un retrait immédiat.
      win.addEventListener('afterprint', teardown, { once: true })
      // Repli AVANT print() : si afterprint ne tombe pas (destination « PDF » virtuelle)
      // OU si print() lève synchroniquement, l'iframe est quand même nettoyé (le guard
      // `torn` rend l'ordre sûr).
      setTimeout(teardown, 120_000)
      win.focus()
      win.print()
    },
    { once: true },
  )

  document.body.appendChild(frame)
}
