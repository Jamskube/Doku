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
import { escapeHtml } from '../html-escape'
import { parentPath } from '../paths'
import { sanitizeHtml } from '../sanitize'
import { renderMarkdown } from './render-md'
import { reportExportProgress, trackExport } from './progress'

export interface Printable {
  kind: 'md' | 'html' | 'txt'
  name: string
  content: string
  // Dossier du fichier (résolution des images relatives au rendu Markdown).
  dir?: string
}

// Colonne papier un peu plus large qu'à l'écran (l'A4 imprimé a de la place).
const PRINT_WIDTH = '760px'

// CSP du document d'impression : aucun réseau, styles inline autorisés (feuille papier),
// images en data: + asset: (fichiers locaux résolus par convertFileSrc au rendu Markdown).
const PRINT_CSP =
  `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: asset: http://asset.localhost">`

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

// Ré-exporté pour les appelants historiques (standalone, CopilotDiagram).
export { escapeHtml }

// Construit le document HTML « papier » prêt à imprimer pour un onglet.
// - `.html` : contenu assaini (DOMPurify) — chemin fidèle, identique à l'aperçu existant.
// - `.md`   : rendu Markdown → HTML (marked + sanitize, GFM), images locales résolues.
// - `.txt`  : source échappée dans <pre>.
export function buildPrintHtml(tab: Printable): string {
  const body =
    tab.kind === 'html'
      ? sanitizeHtml(tab.content)
      : tab.kind === 'md'
        ? renderMarkdown(tab.content, { dir: tab.dir })
        : `<pre>${escapeHtml(tab.content)}</pre>`
  const inject = `${PRINT_CSP}<style>${paperCss('light', PRINT_WIDTH)}\n${PRINT_CSS}\n</style>`
  return injectHead(body, inject)
}

type PrintTab = { kind: string; name: string; content: string; path: string | null }

// Imprime n'importe quel onglet (menu « Imprimer… », Ctrl+P). Un échec s'affiche en bandeau.
export async function printDocument(tab: PrintTab): Promise<void> {
  try {
    await printTab(tab)
  } catch (error) {
    console.error('Impression échouée', error)
    const { app } = await import('../stores.svelte')
    app.banner = {
      tone: 'error',
      title: 'Impression impossible',
      message: error instanceof Error && error.message ? error.message : 'Doku n’a pas pu préparer ce document.',
    }
  }
}

async function printTab(tab: PrintTab): Promise<void> {
  if (tab.kind === 'md' || tab.kind === 'html' || tab.kind === 'txt') {
    exportViaPrint({ kind: tab.kind, name: tab.name, content: tab.content, dir: parentPath(tab.path) ?? '' })
  } else if (tab.kind === 'pdf') {
    if (!tab.path) throw new Error('Ce PDF n’a pas de fichier à imprimer.')
    await printPdfFile(tab.path)
  } else if (tab.kind === 'docx') {
    const { docxActions } = await import('../stores.svelte')
    if (!docxActions.print) throw new Error('Le document Word n’est pas encore chargé.')
    await docxActions.print()
  }
}

// PDF sur disque, annotations actives gravées (ce que l'utilisateur voit à l'écran). Un carnet
// périmé ou illisible ne correspond plus aux pages : on imprime alors le PDF seul.
async function printPdfFile(path: string): Promise<void> {
  const [{ readFileBytes, readPdfAnnotationManifest }, { pdfAnnotationIdentity, parsePdfAnnotationManifest }] =
    await Promise.all([import('../tauri'), import('../pdf-annotations')])
  const bytes = await readFileBytes(path)
  if (!bytes) throw new Error('Le fichier PDF est introuvable.')
  const identity = await pdfAnnotationIdentity(path, bytes)
  const parsed = parsePdfAnnotationManifest(await readPdfAnnotationManifest(identity.key), identity)
  const drawings = parsed.stale || parsed.unreadable ? [] : parsed.manifest.drawings.filter((d) => d.status === 'active')
  const printable = drawings.length
    ? (await (await import('../pdf-write')).burnPdfAnnotations(bytes, drawings)).bytes
    : bytes
  await printPdfBytes(printable)
}

// ponytail: rendu image à 144 ppp (échelle 2), pages en JPEG gardées en mémoire jusqu'à
// l'impression ; passer par le PrintToPdf natif de WebView2 si des PDF de centaines de pages
// ou une qualité d'impression vectorielle deviennent un besoin.
const PDF_PRINT_SCALE = 2

// Une image par page, une page par feuille. Les images passent par le DOM, pas par `srcdoc` :
// des dizaines de Mo de data: dans un attribut ne tiennent pas.
export async function printPdfBytes(bytes: Uint8Array): Promise<void> {
  const { loadPdf, renderPage } = await import('../pdf')
  const pages = await trackExport('Préparation de l’impression', async () => {
    const loaded = await loadPdf(bytes)
    const rendered: string[] = []
    try {
      for (let n = 1; n <= loaded.doc.numPages; n++) {
        reportExportProgress(n - 1, loaded.doc.numPages)
        const canvas = document.createElement('canvas')
        await renderPage(loaded.doc, n, canvas, PDF_PRINT_SCALE)
        rendered.push(canvas.toDataURL('image/jpeg', 0.92))
        canvas.width = canvas.height = 0
      }
    } finally {
      await loaded.destroy()
    }
    return rendered
  })
  const css = `@page { margin: 0 } html, body { margin: 0; background: #fff }
    img { display: block; max-width: 100%; max-height: 100vh; margin: 0 auto; break-after: page }
    img:last-child { break-after: auto }`
  printHtml(`<!doctype html><html><head>${PRINT_CSP}<style>${css}</style></head><body></body></html>`, async (doc) => {
    const imgs = pages.map((src) => {
      const img = doc.createElement('img')
      img.src = src
      doc.body.appendChild(img)
      return img
    })
    await Promise.all(imgs.map((img) => img.decode()))
  })
}

// Ouvre le dialogue d'impression sur le document rendu, via un iframe isolé et caché.
// Aucun effet en environnement sans DOM (no-op défensif pour les tests unitaires).
export function exportViaPrint(tab: Printable): void {
  printHtml(buildPrintHtml(tab))
}

function printHtml(html: string, prepare?: (doc: Document) => Promise<void>): void {
  if (typeof document === 'undefined') return
  const frame = document.createElement('iframe')
  frame.setAttribute('sandbox', 'allow-modals allow-same-origin')
  frame.setAttribute('aria-hidden', 'true')
  // Hors écran mais dimensionné (certains moteurs impriment mal un iframe 0×0).
  frame.style.cssText =
    'position:fixed; left:-10000px; top:0; width:794px; height:1123px; border:0; visibility:hidden'
  frame.srcdoc = html

  let torn = false
  // Teardown DIFFÉRÉ (#5199) : jamais synchrone pendant l'impression/écriture async.
  const teardown = () => {
    if (torn) return
    torn = true
    setTimeout(() => frame.remove(), 30_000)
  }

  frame.addEventListener(
    'load',
    async () => {
      const win = frame.contentWindow
      if (!win) {
        frame.remove()
        return
      }
      if (prepare) {
        try {
          await prepare(win.document)
        } catch (error) {
          frame.remove()
          console.error('Préparation de l’impression échouée', error)
          return
        }
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
