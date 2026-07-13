// Export HTML autonome (story 10.3) : produit UN seul .html portable, ouvrable hors-ligne
// dans n'importe quel navigateur. Images inlinées en data: (pas d'asset:///chemins locaux
// qui ne résoudraient pas ailleurs), styles inline (paperCss), CSP portable, sanitize.
// Réutilise renderMarkdown (ADR-0009) et paperCss/injectHead (html.ts).
import { renderMarkdown, IMAGE } from './render-md'
import { escapeHtml, type Printable } from './print'
import { paperCss, injectHead } from '../html'
import { sanitizeHtml } from '../sanitize'
import { isBlockedImageUrl, resolveLocalImagePath } from '../images'

const STANDALONE_WIDTH = '760px'

// CSP même dans un fichier portable (défense en profondeur, aligné html.ts/print.ts) :
// aucun réseau, images data: seulement, styles inline. Fonctionne en file:// (Chrome/FF/Edge).
// Seul output de Doku hors sandbox → DOMPurify ne doit pas être l'unique garde.
const STANDALONE_CSP =
  `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">`

// URLs d'images LOCALES inlinables du document (exclut data: et bloquées réseau/UNC).
export function collectLocalImages(tab: Printable): string[] {
  const urls = new Set<string>()
  const add = (u: string) => {
    const t = u.trim()
    if (t && !/^data:/i.test(t) && !isBlockedImageUrl(t)) urls.add(t)
  }
  if (tab.kind === 'md') {
    for (const m of tab.content.matchAll(IMAGE)) add(m[2]) // même matcher que le rendu
  } else if (tab.kind === 'html') {
    const doc = new DOMParser().parseFromString(tab.content, 'text/html')
    doc.querySelectorAll('img[src]').forEach((img) => add(img.getAttribute('src') ?? ''))
  }
  return [...urls]
}

// Remplace les src d'un HTML par leurs data: (map url→data:) AVANT sanitize ; une image
// non inlinable (bloquée/illisible/absente de la map, hors data:) perd son src (pas de
// référence cassée ni de requête réseau à l'ouverture ailleurs).
function inlineHtmlImages(html: string, map: Map<string, string>): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelectorAll('img').forEach((img) => {
    const src = (img.getAttribute('src') ?? '').trim()
    if (/^data:/i.test(src)) return
    const data = map.get(src)
    if (data) img.setAttribute('src', data)
    else img.removeAttribute('src')
  })
  return doc.documentElement.outerHTML
}

// Document HTML autonome (sync) : les images sont déjà résolues en data: dans `map`.
export function buildStandaloneHtml(tab: Printable, map: Map<string, string>): string {
  let body: string
  if (tab.kind === 'md') {
    body = renderMarkdown(tab.content, {
      dir: tab.dir,
      resolveImage: (url) => {
        const u = url.trim()
        return /^data:/i.test(u) ? u : (map.get(u) ?? null)
      },
    })
  } else if (tab.kind === 'html') {
    body = sanitizeHtml(inlineHtmlImages(tab.content, map))
  } else {
    body = `<pre>${escapeHtml(tab.content)}</pre>`
  }
  const inject =
    `${STANDALONE_CSP}<meta charset="utf-8"><title>${escapeHtml(tab.name)}</title>` +
    `<style>${paperCss('light', STANDALONE_WIDTH)}</style>`
  return injectHead(body, inject)
}

// Nom de fichier proposé : même base, extension .html.
export function exportName(name: string): string {
  return name.replace(/\.[^.\\/]+$/, '') + '.html'
}

export interface StandaloneIO {
  readImageDataUrl: (absPath: string) => Promise<string | null>
  save: (defaultName: string, html: string) => Promise<boolean>
}

// ~40 Mo de data: cumulé : au-delà on avertit (jamais de cap silencieux — règle AGENTS).
const WARN_TOTAL_BYTES = 40 * 1024 * 1024

// Orchestration async (I/O injectée pour testabilité) : lit chaque image locale → data:,
// assemble le document, propose l'enregistrement. 'cancelled' si le dialogue est annulé.
export async function exportStandaloneHtml(tab: Printable, io: StandaloneIO): Promise<'saved' | 'cancelled'> {
  const map = new Map<string, string>()
  let total = 0
  let failed = 0
  for (const url of collectLocalImages(tab)) {
    const data = await io.readImageDataUrl(resolveLocalImagePath(url, tab.dir ?? ''))
    if (data) {
      map.set(url, data)
      total += data.length
    } else {
      failed++
    }
  }
  if (failed) console.warn(`Export HTML : ${failed} image(s) illisible(s), omise(s).`)
  if (total > WARN_TOTAL_BYTES) {
    console.warn(`Export HTML : ~${Math.round(total / 1e6)} Mo d'images inlinées (fichier volumineux).`)
  }
  const html = buildStandaloneHtml(tab, map)
  return (await io.save(exportName(tab.name), html)) ? 'saved' : 'cancelled'
}
