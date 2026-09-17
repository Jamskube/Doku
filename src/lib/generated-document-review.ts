import type { GeneratedDocumentArtifact, GeneratedDocumentKind } from './generated-document'
import { DOCUMENT_EDIT_CONTRACT, generatedDocumentPreview, numberedDocumentHtml } from './generated-document'

export type GeneratedDocumentReviewStatus = 'passed' | 'mechanical-only'

export interface GeneratedDocumentReview {
  version: 1
  status: GeneratedDocumentReviewStatus
  attempts: number
  visual: boolean
  summary: string
  warnings: string[]
}

export interface GeneratedDocumentLayoutIssue {
  code: 'horizontal-overflow' | 'clipped-content' | 'low-contrast' | 'tiny-text' | 'excessive-length'
  severity: 'blocking' | 'warning'
  message: string
}

export interface GeneratedDocumentLayoutEvidence {
  viewport: { width: number; height: number }
  document: { width: number; height: number; pages: number }
  issues: GeneratedDocumentLayoutIssue[]
  screenshot: string | null
}

export interface GeneratedDocumentVisualVerdict {
  passed: boolean
  blocking: string[]
  warnings: string[]
  summary: string
}

interface Viewport { width: number; height: number; label?: string }

const VERDICT = /<document-review>\s*([\s\S]*?)\s*<\/document-review>/i
const MAX_REPORTED_ISSUES = 12
// 826 = feuille A4 (794) + réserve de barre de défilement, même valeur que l'aperçu agrandi.
// Le HTML est contrôlé à deux largeurs : grand écran, et la plus petite que le contrat
// impose au modèle — c'est là que débordent tableaux et grilles.
const VIEWPORTS: Record<GeneratedDocumentKind, Viewport[]> = {
  pdf: [{ width: 826, height: 1123 }],
  html: [{ width: 1200, height: 900 }, { width: 390, height: 844, label: 'sur mobile (390 px)' }],
}
// Largeur de la planche envoyée au critique : au-delà, OpenAI la réduit lui-même.
const SHEET_WIDTH = 768
const MAX_SHEET_SCREENS = 4

function parseColor(value: string): [number, number, number, number] | null {
  const match = /^rgba?\(\s*([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/i.exec(value)
  if (!match) return null
  return [Number(match[1]), Number(match[2]), Number(match[3]), match[4] === undefined ? 1 : Number(match[4])]
}

function opaqueBackground(element: Element): [number, number, number] {
  let current: Element | null = element
  while (current) {
    const parsed = parseColor(getComputedStyle(current).backgroundColor)
    if (parsed && parsed[3] >= 0.98) return [parsed[0], parsed[1], parsed[2]]
    current = current.parentElement
  }
  return [255, 255, 255]
}

function luminance([r, g, b]: [number, number, number]): number {
  const channel = (value: number) => {
    const normalized = value / 255
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

function contrast(foreground: [number, number, number], background: [number, number, number]): number {
  const lighter = Math.max(luminance(foreground), luminance(background))
  const darker = Math.min(luminance(foreground), luminance(background))
  return (lighter + 0.05) / (darker + 0.05)
}

function ownText(element: Element): string {
  return Array.from(element.childNodes)
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.textContent ?? '')
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function pushUnique(issues: GeneratedDocumentLayoutIssue[], issue: GeneratedDocumentLayoutIssue): void {
  if (issues.some((candidate) => candidate.code === issue.code && candidate.message === issue.message)) return
  if (issues.length < MAX_REPORTED_ISSUES) issues.push(issue)
}

function auditDocument(doc: Document, width: number, height: number): Omit<GeneratedDocumentLayoutEvidence, 'screenshot'> {
  const root = doc.documentElement
  const body = doc.body
  const documentWidth = Math.max(root.scrollWidth, body.scrollWidth)
  const documentHeight = Math.max(root.scrollHeight, body.scrollHeight)
  const issues: GeneratedDocumentLayoutIssue[] = []

  if (documentWidth > width + 3) {
    pushUnique(issues, {
      code: 'horizontal-overflow',
      severity: 'blocking',
      message: `Le contenu déborde horizontalement de ${Math.ceil(documentWidth - width)} px.`,
    })
  }

  const elements = Array.from(body.querySelectorAll<HTMLElement>('*'))
  for (const element of elements) {
    const style = getComputedStyle(element)
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) continue
    const rect = element.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) continue
    if (rect.left < -2 || rect.right > width + 2) {
      pushUnique(issues, {
        code: 'horizontal-overflow',
        severity: 'blocking',
        message: `Un élément ${element.tagName.toLowerCase()} sort du cadre imprimable.`,
      })
    }
    const clipsX = /(hidden|clip)/.test(style.overflowX) && element.scrollWidth > element.clientWidth + 3
    const clipsY = /(hidden|clip)/.test(style.overflowY) && element.scrollHeight > element.clientHeight + 3
    if (clipsX || clipsY) {
      pushUnique(issues, {
        code: 'clipped-content',
        severity: 'blocking',
        message: `Du contenu est tronqué dans un élément ${element.tagName.toLowerCase()}.`,
      })
    }
    const text = ownText(element)
    if (!text) continue
    const fontSize = Number.parseFloat(style.fontSize)
    if (fontSize > 0 && fontSize < 9) {
      pushUnique(issues, {
        code: 'tiny-text',
        severity: 'warning',
        message: `Un texte est rendu à ${fontSize.toFixed(1)} px, trop petit pour une lecture confortable.`,
      })
    }
    const color = parseColor(style.color)
    if (color && color[3] >= 0.85) {
      const ratio = contrast([color[0], color[1], color[2]], opaqueBackground(element))
      const large = fontSize >= 24 || (fontSize >= 18.5 && Number.parseInt(style.fontWeight, 10) >= 700)
      if (ratio < (large ? 3 : 4.5)) {
        pushUnique(issues, {
          code: 'low-contrast',
          severity: ratio < 2.2 ? 'blocking' : 'warning',
          message: `Contraste insuffisant (${ratio.toFixed(1)}:1) sur « ${text.slice(0, 48)} ».`,
        })
      }
    }
  }

  const pages = Math.max(1, Math.ceil(documentHeight / height))
  if (pages > 12) {
    pushUnique(issues, {
      code: 'excessive-length',
      severity: 'warning',
      message: `Le document occupe environ ${pages} pages ; vérifiez que cette longueur est intentionnelle.`,
    })
  }
  return { viewport: { width, height }, document: { width: documentWidth, height: documentHeight, pages }, issues }
}

// Capture NATIVE : le document sérialisé en XHTML dans un <foreignObject> SVG, dessiné
// sur un canvas par le moteur de rendu lui-même. Une image SVG n'exécute aucun script
// et ne charge aucune ressource externe — la sandbox tient. Fidélité Chromium, sans
// bibliothèque qui réimplémente le CSS (et se trompe sur ce qu'on veut précisément juger).
async function captureSheet(doc: Document, width: number, height: number): Promise<string | null> {
  try {
    const fullHeight = Math.min(Math.max(doc.documentElement.scrollHeight, doc.body.scrollHeight, height), height * MAX_SHEET_SCREENS)
    const xhtml = new XMLSerializer().serializeToString(doc.documentElement)
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${fullHeight}"><foreignObject width="100%" height="100%">${xhtml}</foreignObject></svg>`
    const image = new Image()
    const loaded = new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('image SVG refusée'))
    })
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
    await loaded
    const sheet = document.createElement('canvas')
    sheet.width = SHEET_WIDTH
    sheet.height = Math.round(fullHeight * SHEET_WIDTH / width)
    const context = sheet.getContext('2d')
    if (!context) return null
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, sheet.width, sheet.height)
    context.drawImage(image, 0, 0, sheet.width, sheet.height)
    return sheet.toDataURL('image/jpeg', 0.82)
  } catch (error) {
    console.warn('[generated-document] capture visuelle indisponible', error)
    return null
  }
}

async function renderOffscreen(artifact: GeneratedDocumentArtifact, viewport: Viewport, withSheet: boolean): Promise<GeneratedDocumentLayoutEvidence> {
  const iframe = document.createElement('iframe')
  iframe.setAttribute('sandbox', 'allow-same-origin')
  iframe.setAttribute('aria-hidden', 'true')
  Object.assign(iframe.style, {
    position: 'fixed',
    left: '-20000px',
    top: '0',
    width: `${viewport.width}px`,
    height: `${viewport.height}px`,
    border: '0',
    visibility: 'hidden',
    pointerEvents: 'none',
  })
  const loaded = new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error('Le rendu de contrôle a expiré.')), 4_000)
    iframe.addEventListener('load', () => {
      window.clearTimeout(timeout)
      resolve()
    }, { once: true })
  })
  iframe.srcdoc = generatedDocumentPreview(artifact, 'light')
  document.body.appendChild(iframe)
  try {
    await loaded
    const frameDocument = iframe.contentDocument
    if (!frameDocument) throw new Error('Le document de contrôle est inaccessible.')
    await frameDocument.fonts?.ready
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    const audit = auditDocument(frameDocument, viewport.width, viewport.height)
    if (viewport.label) audit.issues.forEach((issue) => { issue.message = `${viewport.label} : ${issue.message}` })
    const screenshot = withSheet ? await captureSheet(frameDocument, viewport.width, viewport.height) : null
    return { ...audit, screenshot }
  } finally {
    iframe.remove()
  }
}

export async function inspectGeneratedDocument(artifact: GeneratedDocumentArtifact): Promise<GeneratedDocumentLayoutEvidence> {
  if (typeof document === 'undefined') throw new Error('Le contrôle visuel exige une fenêtre active.')
  const [primary, ...others] = VIEWPORTS[artifact.kind]
  const evidence = await renderOffscreen(artifact, primary, true)
  for (const viewport of others) {
    const extra = await renderOffscreen(artifact, viewport, false)
    extra.issues.forEach((issue) => pushUnique(evidence.issues, issue))
  }
  return evidence
}

export function parseGeneratedDocumentVisualVerdict(output: string): GeneratedDocumentVisualVerdict | null {
  const match = VERDICT.exec(output)
  if (!match) return null
  try {
    const record = JSON.parse(match[1]) as Record<string, unknown>
    const list = (value: unknown) => Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean).slice(0, 8)
      : []
    return {
      passed: record.passed === true,
      blocking: list(record.blocking),
      warnings: list(record.warnings),
      summary: typeof record.summary === 'string' ? record.summary.replace(/\s+/g, ' ').trim().slice(0, 240) : '',
    }
  } catch {
    return null
  }
}

export function buildGeneratedDocumentVisualReviewPrompt(evidence: GeneratedDocumentLayoutEvidence): string {
  return `Tu es le contrôleur visuel final d'un document généré. Examine la capture telle qu'elle sera présentée à l'utilisateur.

Vérifie uniquement : contenu coupé ou hors cadre, contraste réellement illisible, texte qui se chevauche, densité ou hiérarchie manifestement défaillante, cadrage incohérent et ruptures de page problématiques. Ne demande pas de changements purement subjectifs si le document est net et utilisable.

Mesures du rendu : ${JSON.stringify({ viewport: evidence.viewport, document: evidence.document, issues: evidence.issues })}

Réponds uniquement avec <document-review>{"passed":true|false,"blocking":["…"],"warnings":["…"],"summary":"…"}</document-review>. passed doit être false seulement si au moins un défaut bloque réellement la livraison.`
}

export function buildGeneratedDocumentCorrectionPrompt(
  artifact: GeneratedDocumentArtifact,
  evidence: GeneratedDocumentLayoutEvidence,
  visual: GeneratedDocumentVisualVerdict | null,
): string {
  const issues = [
    ...evidence.issues.map((issue) => `${issue.severity}: ${issue.message}`),
    ...(visual?.blocking ?? []).map((issue) => `blocking: ${issue}`),
    ...(visual?.warnings ?? []).map((issue) => `warning: ${issue}`),
  ]
  return `Corrige la version ci-dessous avant livraison.

Défauts observés dans son rendu réel :
${issues.map((issue) => `- ${issue}`).join('\n') || '- Aucun défaut mécanique ; améliore uniquement les problèmes décrits par le contrôle visuel.'}

Contraintes : préserve les faits et le contenu utile, supprime les largeurs fixes qui débordent, renforce les contrastes trop faibles et évite tout contenu tronqué. Ne touche qu'aux blocs fautifs.

${DOCUMENT_EDIT_CONTRACT}

Version actuelle :
${numberedDocumentHtml(artifact.html)}`
}
