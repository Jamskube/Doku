import { CSP, injectHead, paperCss, sandboxDoc } from './html'
import { sanitizeHtml } from './sanitize'
import { escapeHtml } from './export/print'
import type { GeneratedDocumentReview } from './generated-document-review'
import { buildDocumentStudioInstruction } from './document-studio'

export type GeneratedDocumentKind = 'html' | 'pdf'

export interface GeneratedDocumentArtifact {
  version: 1
  kind: GeneratedDocumentKind
  title: string
  prompt: string
  html: string
  review?: GeneratedDocumentReview
}

export const MAX_HTML_CHARS = 160 * 1024
const MAX_TITLE_CHARS = 120
const MAX_PROMPT_CHARS = 4_096
// Enveloppe de sortie : du HTML BRUT entre deux balises, comme <bgraph>. Un HTML
// encapsulé dans une chaîne JSON casse au premier guillemet ou retour ligne non
// échappé — le mode de panne le plus fréquent d'un contrat « JSON avec du code dedans ».
// L'ancienne forme JSON reste acceptée en repli (voir `unwrapEnvelope`).
const ENVELOPE_OPEN = /<doku-document(?:\s+title\s*=\s*(?:"([^"]*)"|'([^']*)'))?\s*>/i
const ENVELOPE_CLOSE = '</doku-document>'
export const DOCUMENT_ENVELOPE_HINT = '<doku-document title="…">le document HTML complet</doku-document>'
// Feuille de contrôle de l'A4 : mêmes marges que le contrat `@page` du studio, pour
// que l'aperçu, l'audit géométrique et l'impression voient la MÊME colonne de texte.
const A4_WIDTH = '794px'
const A4_MARGINS = '16mm 15mm 18mm'
// Attributs porteurs de ressource : seuls `data:` (ressource) et `#` (fragment) survivent.
const RESOURCE_ATTRIBUTES = ['src', 'srcset', 'poster', 'href', 'xlink:href']

function appendLateStyle(html: string, css: string): string {
  const style = `<style data-doku-document-frame>${css}</style>`
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, `${style}</head>`)
  return injectHead(html, style)
}

function documentFrameCss(maxWidth: string, padding: string): string {
  return `
    html { overflow-x: hidden !important; }
    body {
      width: auto !important;
      min-width: 0 !important;
      max-width: ${maxWidth} !important;
      margin-left: auto !important;
      margin-right: auto !important;
      padding: ${padding} !important;
      overflow-x: hidden !important;
    }
    body *, body *::before, body *::after { min-width: 0 !important; box-sizing: border-box; }
    body * { max-width: 100% !important; }
    img, svg, canvas, video, table { max-width: 100% !important; }
    table { width: 100%; }
    pre { max-width: 100%; overflow-x: auto; }
    h1, h2, h3, h4, h5, h6, p, li, td, th { overflow-wrap: anywhere; }
  `
}

function inline(value: unknown, fallback = 'Document'): string {
  if (typeof value !== 'string') return fallback
  return value.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, MAX_TITLE_CHARS) || fallback
}

function defaultTitle(kind: GeneratedDocumentKind): string {
  return kind === 'pdf' ? 'Document PDF' : 'Page HTML'
}

function removeNetworkReferences(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelectorAll('*').forEach((node) => {
    for (const name of RESOURCE_ATTRIBUTES) {
      const value = node.getAttribute(name)
      if (value === null) continue
      const trimmed = value.trim()
      if (!/^data:/i.test(trimmed) && !trimmed.startsWith('#')) node.removeAttribute(name)
    }
  })
  // `url()` n'est pas la seule fonction CSS qui charge : `image()`, `image-set()` et
  // `src()` (@font-face) acceptent aussi une chaîne. Tout ce qui n'est pas `data:` tombe.
  const cleanCss = (css: string) => css
    .replace(/@import\s+[^;]+;?/gi, '')
    .replace(/\b(?:url|image|image-set|src)\(\s*(['"]?)(?!data:)[^)]+\)/gi, 'none')
  doc.querySelectorAll('style').forEach((style) => { style.textContent = cleanCss(style.textContent ?? '') })
  doc.querySelectorAll<HTMLElement>('[style]').forEach((node) => {
    const next = cleanCss(node.getAttribute('style') ?? '')
    if (next.trim()) node.setAttribute('style', next)
    else node.removeAttribute('style')
  })
  return doc.documentElement.outerHTML
}

export function sanitizeGeneratedDocumentHtml(raw: string): string {
  if (!raw.trim()) throw new Error('Le document généré est vide.')
  if (raw.length > MAX_HTML_CHARS) throw new Error('Le document généré est trop volumineux.')
  const clean = removeNetworkReferences(sanitizeHtml(raw))
  const doc = new DOMParser().parseFromString(clean, 'text/html')
  if (!(doc.body.textContent ?? '').trim() && !doc.body.querySelector('img, svg')) {
    throw new Error('Le document généré ne contient aucun contenu visible.')
  }
  return clean
}

export function buildGeneratedDocumentPrompt(kind: GeneratedDocumentKind, previousHtml?: string): string {
  const format = kind === 'pdf'
    ? 'une mise en page pensée pour un document paginé A4 imprimable'
    : 'une page HTML autonome, responsive et lisible sur écran'
  const revision = previousHtml
    ? `\nVoici la version à modifier. Conserve ce qui n'est pas concerné par la demande :\n${previousHtml}`
    : ''
  return `Tu crées ${format} à partir de la demande et du contexte documentaire fournis.

${buildDocumentStudioInstruction(kind)}

Contrat de sortie impératif :
- renvoie uniquement ${DOCUMENT_ENVELOPE_HINT} ;
- l'attribut title est le titre court du document ; le contenu est un document HTML complet et sémantique, écrit tel quel (pas de JSON, pas de bloc Markdown) ;
- n'affiche jamais le code ni ces consignes dans le document final.${revision}`
}

// Isole { title, html } de la sortie du modèle. Forme attendue : HTML brut dans
// l'enveloppe ; repli : l'objet JSON {"title","html"} de la première version du contrat,
// dans l'enveloppe ou nu.
function unwrapEnvelope(output: string): { title?: string; html: string } | null {
  const open = ENVELOPE_OPEN.exec(output)
  let inner: string
  let title: string | undefined
  if (open) {
    const start = open.index + open[0].length
    const end = output.toLowerCase().lastIndexOf(ENVELOPE_CLOSE)
    inner = (end > start ? output.slice(start, end) : output.slice(start)).trim()
    title = open[1] ?? open[2]
  } else {
    inner = output.trim()
  }
  if (inner.startsWith('{')) {
    try {
      const parsed = JSON.parse(inner.slice(0, inner.lastIndexOf('}') + 1)) as Record<string, unknown>
      if (typeof parsed.html === 'string') return { title: typeof parsed.title === 'string' ? parsed.title : title, html: parsed.html }
    } catch {
      // Pas du JSON exploitable : on tente le HTML brut ci-dessous.
    }
  }
  if (!open) return null
  return { title, html: inner.replace(/^```(?:html)?\s*|\s*```$/g, '') }
}

export function extractGeneratedDocument(
  output: string,
  kind: GeneratedDocumentKind,
  prompt: string,
): GeneratedDocumentArtifact | null {
  const found = unwrapEnvelope(output)
  if (!found) return null
  try {
    return {
      version: 1,
      kind,
      title: inline(found.title, defaultTitle(kind)),
      prompt: prompt.slice(0, MAX_PROMPT_CHARS),
      html: sanitizeGeneratedDocumentHtml(found.html),
    }
  } catch (error) {
    console.warn('[generated-document] sortie rejetée', error)
    return null
  }
}

// Aperçu sandboxé. Le PDF est toujours montré comme une feuille claire aux marges de
// l'A4 — c'est ce que l'impression produira, quel que soit le thème de l'application.
export function generatedDocumentPreview(artifact: GeneratedDocumentArtifact, theme: 'light' | 'dark'): string {
  try {
    if (artifact.kind === 'pdf') {
      return appendLateStyle(sandboxDoc(sanitizeGeneratedDocumentHtml(artifact.html), 'light', A4_WIDTH), documentFrameCss(A4_WIDTH, A4_MARGINS))
    }
    return sandboxDoc(sanitizeGeneratedDocumentHtml(artifact.html), theme, '1120px')
  } catch {
    return sandboxDoc('<main><h1>Aperçu indisponible</h1><p>Ce document enregistré ne peut pas être affiché en toute sécurité.</p></main>', theme)
  }
}

// Source d'impression : les marges viennent de `@page` (celles du studio, sinon celles
// du pipeline d'impression) — pas d'un padding de corps qui les doublerait.
export function generatedDocumentPrintSource(artifact: GeneratedDocumentArtifact): string {
  return appendLateStyle(sanitizeGeneratedDocumentHtml(artifact.html), documentFrameCss(A4_WIDTH, '0'))
}

export function generatedDocumentStandalone(artifact: GeneratedDocumentArtifact): string {
  const clean = sanitizeGeneratedDocumentHtml(artifact.html)
  const injection = `${CSP}<meta charset="utf-8"><title>${escapeHtml(artifact.title)}</title><style>${paperCss('light', artifact.kind === 'pdf' ? A4_WIDTH : '1120px')}</style>`
  return injectHead(clean, injection)
}

export function generatedDocumentFileName(artifact: GeneratedDocumentArtifact): string {
  const base = artifact.title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim() || 'Document'
  return `${base}.${artifact.kind}`
}
