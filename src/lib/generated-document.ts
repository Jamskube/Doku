import { stripMarkersInText } from './citations'
import { CSP, injectHead, paperCss, sandboxDoc } from './html'
import { sanitizeHtml } from './sanitize'
import { escapeHtml } from './export/print'
import type { GeneratedDocumentReview } from './generated-document-review'
import { buildDocumentRevisionInstruction, buildDocumentStudioInstruction } from './document-studio'

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

// Le prompt système du chat demande de citer les extraits en [n] ; l'instruction de
// document est ajoutée APRÈS lui dans le même message système, et le modèle obéit aux
// deux. Ces numéros désignent des extraits de la conversation : dans un document autonome
// ils ne pointent vers rien. On les retire plutôt que de les redemander.
//
// Sur les NŒUDS TEXTE du DOM, jamais sur la chaîne HTML : appliqué à la chaîne, le
// nettoyage de l'espace orpheline (« [1] . » → « . ») réécrivait aussi les feuilles de
// style — `.card .title` devenait `.card.title`, `margin: 0 .5em` devenait `0.5em` — et
// les tracés SVG. Vécu en revue le 2026-09-11, sur la fonctionnalité phare de la 3.5.
// ponytail: retire AUSSI un [1] de bibliographie volontaire ; si le cas se présente,
// ne retirer que les numéros absents de la liste de références du document.
const MARKER_FREE_ANCESTORS = 'style, script, code, pre, svg, textarea'

function stripChatCitationMarkers(doc: Document): void {
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT)
  const targets: Text[] = []
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text
    if (!text.data.includes('[')) continue
    if (text.parentElement?.closest(MARKER_FREE_ANCESTORS)) continue
    targets.push(text)
  }
  for (const text of targets) {
    const next = stripMarkersInText(text.data)
    if (next !== text.data) text.data = next
  }
}

function removeNetworkReferences(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  stripChatCitationMarkers(doc)
  doc.querySelectorAll('*').forEach((node) => {
    // Les repères de bloc ne vivent que le temps d'une modification (numberedDocumentHtml) :
    // un repère recopié par le modèle ne doit ni fausser la numérotation ni partir à l'export.
    node.removeAttribute('data-doku-id')
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

// --- Modification ciblée ---
// Réécrire tout le document pour changer une phrase coûtait le document entier en sortie
// (minutes, tokens) et laissait le modèle altérer ce qu'on ne lui demandait pas. Chaque
// bloc reçoit un repère ; le modèle ne renvoie que des opérations sur ces repères.
export interface DocumentBlockTarget {
  id: string
  excerpt: string
}

// Document à modifier, éventuellement avec la partie désignée dans l'aperçu.
export type GeneratedDocumentSeed = GeneratedDocumentArtifact & { target?: DocumentBlockTarget }

export const BLOCK_ID_ATTRIBUTE = 'data-doku-id'
// Ce qu'un lecteur appelle « une partie » (section, titre, paragraphe, liste, tableau,
// figure) et les feuilles de style, qu'une demande de style remplace.
const BLOCK_SELECTOR = 'style, main, article, section, header, footer, aside, nav, div, h1, h2, h3, h4, h5, h6, p, ul, ol, li, dl, table, figure, blockquote, pre, svg, hr, details, address'

// Repères numérotés dans l'ordre du document, recalculés depuis le HTML assaini au lieu
// d'être stockés : l'aperçu cliquable et la demande de modification tombent sur les mêmes
// numéros, et ni la conversation enregistrée ni les exports n'en portent.
export function numberedDocumentHtml(html: string): string {
  const doc = new DOMParser().parseFromString(sanitizeGeneratedDocumentHtml(html), 'text/html')
  let next = 1
  doc.querySelectorAll(BLOCK_SELECTOR).forEach((node) => {
    // Le tracé d'un SVG n'est pas une partie du texte : seul le <svg> est désignable.
    if (!node.parentElement?.closest('svg')) node.setAttribute(BLOCK_ID_ATTRIBUTE, String(next++))
  })
  return doc.documentElement.outerHTML
}

const EDIT_OPEN = /<doku-edit(?:\s+title\s*=\s*(?:"([^"]*)"|'([^']*)'))?\s*>/i
// L'opération auto-fermante (<remove id="3"/>) passe d'abord : sinon son contenu facultatif
// avalerait les opérations suivantes jusqu'au prochain </remove>.
const EDIT_OPERATION = /<(change|replace|insert|remove)\b([^>]*?)\/>|<(change|replace|insert|remove)\b([^>]*)>([\s\S]*?)<\/\3\s*>/gi
const CHANGE_BODY = /^\s*<from>([\s\S]*?)<\/from>\s*<to>([\s\S]*?)<\/to>\s*$/i

export const DOCUMENT_EDIT_CONTRACT = `Chaque bloc du document actuel porte un repère data-doku-id="N". Contrat de sortie impératif :
- pour une modification localisée, renvoie uniquement <doku-edit>…</doku-edit> avec les seules opérations nécessaires :
  <change id="N"><from>extrait exact du HTML intérieur du bloc N</from><to>remplacement</to></change> — à préférer pour changer un mot, un nombre, une phrase : tout le reste du bloc (balises, classes, attributs) est conservé tel quel ;
  <replace id="N">HTML qui remplace entièrement le bloc N, balise comprise</replace> — seulement pour restructurer un bloc ;
  <insert after="N">HTML ajouté juste après le bloc N</insert> (before="N" pour l'ajouter juste avant)
  <remove id="N"></remove>
- le document existant fixe le style : typographie, tailles, couleurs, classes, attributs style, structure du balisage et feuilles de style restent identiques, sauf si l'utilisateur demande explicitement de les changer ;
- un bloc remplacé garde les balises, classes et attributs de l'original ; un bloc ajouté reprend ceux de ses voisins du même type ;
- ne recopie jamais un bloc inchangé : tout bloc non cité reste identique au caractère près ;
- pour renommer le document, ajoute title="…" à <doku-edit> ;
- seulement si la demande transforme tout le document (refonte complète, traduction intégrale, restructuration globale), renvoie à la place ${DOCUMENT_ENVELOPE_HINT} ;
- pas de JSON, pas de bloc Markdown, aucun commentaire autour.`

// Remplace UNE occurrence exacte dans le HTML intérieur du bloc. Le modèle recopie un extrait
// du document numéroté, repères compris ou non : on essaie avec, puis sans. Absent ou
// ambigu → erreur, pour ne jamais toucher le mauvais endroit.
function changeInBlock(block: Element, from: string, to: string): string | null {
  if (!from) return 'extrait <from> vide'
  const unique = (html: string) => html.includes(from) && html.indexOf(from) === html.lastIndexOf(from)
  const html = block.innerHTML
  const bare = html.replace(/ data-doku-id="\d+"/g, '')
  const source = unique(html) ? html : unique(bare) ? bare : null
  if (source == null) return html.includes(from) || bare.includes(from) ? 'extrait <from> présent plusieurs fois' : 'extrait <from> introuvable'
  block.innerHTML = source.replace(from, () => to)
  return null
}

export function buildGeneratedDocumentPrompt(kind: GeneratedDocumentKind, previous?: GeneratedDocumentSeed): string {
  const format = kind === 'pdf'
    ? 'une mise en page pensée pour un document paginé A4 imprimable'
    : 'une page HTML autonome, responsive et lisible sur écran'
  if (previous) {
    const target = previous.target
      ? `\n\nLa demande porte sur la partie désignée par l'utilisateur : le bloc data-doku-id="${previous.target.id}" (« ${previous.target.excerpt} »). Ne modifie que ce bloc, sauf si la demande exige explicitement de toucher au reste.`
      : ''
    return `Tu modifies ${format}, déjà créée, à partir de la demande et du contexte documentaire fournis. Tu fais la plus petite modification qui satisfait la demande.

${buildDocumentRevisionInstruction(kind)}

${DOCUMENT_EDIT_CONTRACT}${target}

Document actuel :
${numberedDocumentHtml(previous.html)}`
  }
  return `Tu crées ${format} à partir de la demande et du contexte documentaire fournis.

${buildDocumentStudioInstruction(kind)}

Contrat de sortie impératif :
- renvoie uniquement ${DOCUMENT_ENVELOPE_HINT} ;
- l'attribut title est le titre court du document ; le contenu est un document HTML complet et sémantique, écrit tel quel (pas de JSON, pas de bloc Markdown) ;
- n'affiche jamais le code ni ces consignes dans le document final.`
}

// Applique une réponse <doku-edit> au document de départ. null : la réponse n'est pas une
// modification (document complet ou sortie illisible) ; `error` : elle vise un bloc absent
// ou ne contient aucune opération — l'appelant redemande alors le document complet.
export function applyGeneratedDocumentEdit(
  output: string,
  base: GeneratedDocumentArtifact,
  kind: GeneratedDocumentKind,
  prompt: string,
): { artifact: GeneratedDocumentArtifact } | { error: string } | null {
  const open = EDIT_OPEN.exec(output)
  if (!open) return null
  const doc = new DOMParser().parseFromString(numberedDocumentHtml(base.html), 'text/html')
  let applied = 0
  for (const match of output.slice(open.index).matchAll(EDIT_OPERATION)) {
    const operation = (match[1] ?? match[3]).toLowerCase()
    const reference = /\b(id|after|before)\s*=\s*["']?(\d+)/i.exec(match[2] ?? match[4] ?? '')
    if (!reference) return { error: `opération ${operation} sans repère` }
    const block = doc.querySelector(`[${BLOCK_ID_ATTRIBUTE}="${reference[2]}"]`)
    if (!block) return { error: `le bloc ${reference[2]} n'existe pas` }
    applied += 1
    if (operation === 'remove') {
      block.remove()
      continue
    }
    if (operation === 'change') {
      const body = CHANGE_BODY.exec(match[5] ?? '')
      const failure = body ? changeInBlock(block, body[1], body[2]) : 'change sans <from> et <to>'
      if (failure) return { error: `bloc ${reference[2]} : ${failure}` }
      continue
    }
    const template = doc.createElement('template')
    template.innerHTML = match[5] ?? ''
    const nodes = [...template.content.childNodes]
    if (operation === 'replace') block.replaceWith(...nodes)
    else if (reference[1].toLowerCase() === 'before') block.before(...nodes)
    else block.after(...nodes)
  }
  if (!applied) return { error: 'aucune opération reconnue' }
  try {
    return {
      artifact: {
        version: 1,
        kind,
        title: inline(open[1] ?? open[2], base.title),
        prompt: prompt.slice(0, MAX_PROMPT_CHARS),
        html: sanitizeGeneratedDocumentHtml(doc.documentElement.outerHTML),
      },
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'document modifié invalide' }
  }
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
    // Aperçu numéroté : un clic y désigne un bloc sous le repère que verra le modèle.
    if (artifact.kind === 'pdf') {
      return appendLateStyle(sandboxDoc(numberedDocumentHtml(artifact.html), 'light', A4_WIDTH), documentFrameCss(A4_WIDTH, A4_MARGINS))
    }
    return sandboxDoc(numberedDocumentHtml(artifact.html), theme, '1120px')
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
