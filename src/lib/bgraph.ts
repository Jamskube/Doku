import type { DiagramStudioArtifact } from './diagram-studio'

export const MAX_BGRAPH_SOURCE_CHARS = 48 * 1024
export const MAX_BGRAPH_CORRECTIONS = 2

export interface BgraphDiagnostic {
  severity: 'error' | 'warning'
  line: number
  col: number
  message: string
}

export interface DiagramArtifact {
  title: string
  prompt: string
  source: string
  studio?: DiagramStudioArtifact
}

export interface BgraphRenderMetrics {
  width: number
  height: number
  aspectRatio: number
  textCount: number
}

export interface BgraphQualityIssue {
  code: 'implicit-horizontal-flow' | 'extreme-aspect-ratio' | 'overlong-labels' | 'citation-markers'
  message: string
}

interface BgraphExports extends WebAssembly.Exports {
  memory: WebAssembly.Memory
  bgraph_alloc(length: number): number
  bgraph_free(pointer: number, length: number): void
  bgraph_render(pointer: number, length: number): number
  bgraph_check(pointer: number, length: number): number
  bgraph_examples(): number
  bgraph_result_len(): number
}

let api: BgraphExports | null = null
let loading: Promise<BgraphExports> | null = null
let examples: Map<string, string> | null = null
const encoder = new TextEncoder()
const decoder = new TextDecoder()

async function loadBgraph(): Promise<BgraphExports> {
  if (api) return api
  if (!loading) {
    loading = (async () => {
      const url = new URL('/bgraph.wasm', document.baseURI)
      const response = await fetch(url)
      if (!response.ok) throw new Error(`Le moteur de diagrammes n’a pas pu être chargé (${response.status}).`)
      const { instance } = await WebAssembly.instantiate(await response.arrayBuffer(), {})
      api = instance.exports as BgraphExports
      return api
    })().catch((error) => {
      loading = null
      throw error
    })
  }
  return loading
}

function readResult(exports: BgraphExports, pointer: number): string {
  return decoder.decode(new Uint8Array(exports.memory.buffer, pointer, exports.bgraph_result_len()))
}

async function withSource(source: string, call: (exports: BgraphExports, pointer: number, length: number) => number): Promise<string> {
  if (source.length > MAX_BGRAPH_SOURCE_CHARS) throw new Error('Le diagramme produit est trop volumineux.')
  const exports = await loadBgraph()
  const bytes = encoder.encode(source)
  const pointer = exports.bgraph_alloc(bytes.length)
  new Uint8Array(exports.memory.buffer, pointer, bytes.length).set(bytes)
  try {
    return readResult(exports, call(exports, pointer, bytes.length))
  } finally {
    exports.bgraph_free(pointer, bytes.length)
  }
}

export async function checkBgraph(source: string): Promise<BgraphDiagnostic[]> {
  const raw = await withSource(source, (exports, pointer, length) => exports.bgraph_check(pointer, length))
  const parsed = JSON.parse(raw) as unknown
  if (!Array.isArray(parsed)) throw new Error('Le moteur de diagrammes a renvoyé des diagnostics illisibles.')
  return parsed.flatMap((value) => {
    if (!value || typeof value !== 'object') return []
    const diagnostic = value as Record<string, unknown>
    if (diagnostic.severity !== 'error' && diagnostic.severity !== 'warning') return []
    return [{
      severity: diagnostic.severity,
      line: typeof diagnostic.line === 'number' ? diagnostic.line : 0,
      col: typeof diagnostic.col === 'number' ? diagnostic.col : 0,
      message: typeof diagnostic.message === 'string' ? diagnostic.message : 'Diagnostic sans message',
    }]
  })
}

const SVG_TAGS = new Set([
  'circle', 'defs', 'ellipse', 'g', 'line', 'marker', 'path', 'polygon', 'polyline',
  'rect', 'svg', 'text', 'title', 'tspan',
])

const SVG_ATTRIBUTES = new Set([
  'aria-label', 'cx', 'cy', 'd', 'dominant-baseline', 'dy', 'fill', 'fill-opacity',
  'font-family', 'font-size', 'font-weight', 'height', 'id', 'marker-end', 'marker-start',
  'markerheight', 'markerunits', 'markerwidth', 'orient', 'points', 'r', 'refx', 'refy',
  'role', 'rx', 'ry', 'stroke', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin',
  'stroke-width', 'text-anchor', 'transform', 'viewbox', 'width', 'x', 'x1', 'x2',
  'xmlns', 'y', 'y1', 'y2',
])

export function sanitizeBgraphSvg(svg: string): string {
  const xml = new DOMParser().parseFromString(svg, 'image/svg+xml')
  if (xml.querySelector('parsererror') || xml.documentElement.localName !== 'svg') {
    throw new Error('Le moteur de diagrammes a produit une image illisible.')
  }
  for (const element of Array.from(xml.querySelectorAll('*'))) {
    const tag = element.localName.toLowerCase()
    if (!SVG_TAGS.has(tag)) throw new Error(`Élément SVG interdit : ${tag}`)
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase()
      const value = attribute.value.trim()
      if (!SVG_ATTRIBUTES.has(name) || name.startsWith('on')) {
        throw new Error(`Attribut SVG interdit : ${attribute.name}`)
      }
      if (name === 'xmlns') {
        if (value !== 'http://www.w3.org/2000/svg') throw new Error('Espace de noms SVG interdit.')
        continue
      }
      if (/\b(?:https?|data|javascript):/i.test(value)) throw new Error('URL interdite dans le diagramme.')
      if (/url\s*\(/i.test(value) && !/^url\(#[A-Za-z0-9_.:-]+\)$/.test(value)) {
        throw new Error('Référence externe interdite dans le diagramme.')
      }
    }
  }
  return new XMLSerializer().serializeToString(xml.documentElement)
}

export async function renderBgraph(source: string): Promise<string> {
  const diagnostics = await checkBgraph(source)
  const errors = diagnostics.filter((diagnostic) => diagnostic.severity === 'error')
  if (errors.length) throw new BgraphValidationError(errors)
  const svg = await withSource(source, (exports, pointer, length) => exports.bgraph_render(pointer, length))
  if (svg.startsWith('error:')) throw new Error(svg.slice('error:'.length).trim())
  return sanitizeBgraphSvg(svg)
}

export async function bgraphRecipe(genre: string): Promise<string> {
  if (!examples) {
    const exports = await loadBgraph()
    const raw = readResult(exports, exports.bgraph_examples())
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) throw new Error('Le catalogue bgraph est illisible.')
    examples = new Map(parsed.flatMap((item) => {
      if (!item || typeof item !== 'object') return []
      const entry = item as Record<string, unknown>
      return typeof entry.name === 'string' && typeof entry.source === 'string'
        ? [[entry.name, entry.source] as const]
        : []
    }))
  }
  const recipe = examples.get(genre)
  if (!recipe) throw new Error(`Le genre bgraph « ${genre} » n'est pas disponible.`)
  return recipe
}

export function measureBgraphSvg(svg: string): BgraphRenderMetrics {
  const xml = new DOMParser().parseFromString(svg, 'image/svg+xml')
  const viewBox = xml.documentElement.getAttribute('viewBox')
    ?.trim()
    .split(/[\s,]+/)
    .map(Number)
  const width = viewBox?.length === 4 && viewBox.every(Number.isFinite) ? Math.abs(viewBox[2]) : 0
  const height = viewBox?.length === 4 && viewBox.every(Number.isFinite) ? Math.abs(viewBox[3]) : 0
  return {
    width,
    height,
    aspectRatio: height > 0 ? width / height : 0,
    textCount: xml.querySelectorAll('text').length,
  }
}

export function inspectBgraphQuality(source: string, svg: string): BgraphQualityIssue[] {
  const issues: BgraphQualityIssue[] = []
  const metrics = measureBgraphSvg(svg)
  if (metrics.width > 0 && metrics.height > 0) {
    const ratio = metrics.aspectRatio
    if (ratio > 4.2 || ratio < 0.24) {
      issues.push({
        code: 'extreme-aspect-ratio',
        message: `Le canevas a un ratio ${ratio >= 1 ? `${ratio.toFixed(1)}:1` : `1:${(1 / ratio).toFixed(1)}`} : il sera minuscule dans la fenêtre. Recompose-le sur 2 à 4 rangées ou colonnes.`,
      })
    }
  }

  const freeNodes = [...source.matchAll(/^\s*node\s+\S+/gm)].length
  const explicitPlacements = [...source.matchAll(/^\s*node\s+[^\n]*(?:\bat\s*\(|\bright-of\b|\bleft-of\b|\babove\b|\bbelow\b)/gm)].length
  const flowsDown = /\b(?:flow|direction)\s*:\s*(?:down|TB)\b/i.test(source)
  if (freeNodes >= 5 && explicitPlacements <= 1 && !flowsDown) {
    issues.push({
      code: 'implicit-horizontal-flow',
      message: `${freeNodes} nœuds reposent sur le flux horizontal implicite. Place chaque zone explicitement et crée une hiérarchie ; pour une architecture, utilise plutôt “type block”, des groupes et des ancrages below/right-of.`,
    })
  }

  const labels = [...source.matchAll(/^\s*(?:node|block|entity|state|participant)\s+\S+\s+"([^"\n]*)"/gm)]
    .map((match) => match[1])
  const longLabels = labels.filter((label) => label.length > 48).length
  if (longLabels) {
    issues.push({
      code: 'overlong-labels',
      message: `${longLabels} libellé${longLabels > 1 ? 's sont' : ' est'} trop long${longLabels > 1 ? 's' : ''}. Garde les noms sous 48 caractères et déplace les explications dans “description”.`,
    })
  }
  if (/\[(?:web:)?\d+\]/i.test(source)) {
    issues.push({
      code: 'citation-markers',
      message: 'Les repères de citation [n] ne doivent pas apparaître dans le diagramme.',
    })
  }
  return issues
}

export function assertBgraphQuality(source: string, svg: string): void {
  const issues = inspectBgraphQuality(source, svg)
  if (issues.length) throw new BgraphQualityError(issues)
}

export class BgraphValidationError extends Error {
  constructor(readonly diagnostics: BgraphDiagnostic[]) {
    super(diagnostics.map(formatDiagnostic).join('\n'))
    this.name = 'BgraphValidationError'
  }
}

export class BgraphQualityError extends Error {
  constructor(readonly issues: BgraphQualityIssue[]) {
    super(issues.map((issue) => issue.message).join('\n'))
    this.name = 'BgraphQualityError'
  }
}

function formatDiagnostic(diagnostic: BgraphDiagnostic): string {
  const position = diagnostic.line > 0 ? `ligne ${diagnostic.line}, colonne ${diagnostic.col}` : 'source'
  return `${position} : ${diagnostic.message}`
}

export function extractBgraphSource(output: string): string | null {
  const tagged = output.match(/<bgraph>\s*([\s\S]*?)\s*<\/bgraph>/i)?.[1]
  const fenced = output.match(/```(?:bgraph|bd)\s*\n([\s\S]*?)```/i)?.[1]
  const source = (tagged ?? fenced ?? '').trim()
  return source && source.length <= MAX_BGRAPH_SOURCE_CHARS ? source : null
}

export function diagramTitle(question: string): string {
  const clean = question.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim()
  if (!clean) return 'Diagramme'
  const withoutLead = clean.replace(/^(?:peux-tu\s+|pourrais-tu\s+|fais(?:-moi)?\s+|crée(?:-moi)?\s+|génère(?:-moi)?\s+)/i, '')
  const value = withoutLead.charAt(0).toUpperCase() + withoutLead.slice(1)
  return value.length > 72 ? `${value.slice(0, 69).trimEnd()}…` : value
}

const DIAGRAM_GRAMMAR = `Tu es le directeur visuel d'un outil de diagrammes. Tu produis un diagramme bgraph valide, synthétique et immédiatement lisible à partir de la demande et du contexte déjà fournis.
Réponds UNIQUEMENT avec <bgraph> puis la source puis </bgraph>. Aucun Markdown, aucune explication.

Choisis d'abord silencieusement le bon genre :
- architecture, composants, services, systèmes ou responsabilités → type block ;
- processus ou décisions simples (6 boîtes maximum) → diagramme libre ;
- échanges chronologiques → type sequence ; hiérarchie d'idées → type mindmap ;
- parts chiffrées → type pie ; comparaison chiffrée → type bar ; dates → type timeline.

Règles de composition impératives :
- identifiants ASCII uniques sans espace ; libellés humains entre guillemets ; guillemets internes évités ;
- aucune instruction include, from:, URL ou ressource externe ;
- fond clair #ffffff, texte #1c1a16, traits sobres ;
- vise un canevas paysage équilibré entre 4:3 et 16:9, jamais une chaîne sur une seule ligne ;
- architecture : 5 à 10 blocs, 2 à 4 niveaux visuels, zones liées regroupées ; place CHAQUE bloc ou groupe avec at, below, above, right-of ou left-of ;
- nom d'un bloc ≤ 36 caractères ; mets le détail dans description (≤ 90 caractères), jamais dans le nom ;
- n'affiche aucun repère de citation comme [3] ou [web:2] ;
- 14 éléments maximum ; privilégie la structure essentielle plutôt que l'exhaustivité ;
- n'invente aucune donnée absente du contexte.

Architecture ou composants — utilise ce profil, pas une suite de node :
type block { title: "Architecture" }
graph { background: #ffffff padding: 34 gap: 58 }
block utilisateur "Utilisateur" person at (0, 0) { description: "Déclenche le flux." }
group coeur "Services métier" right-of utilisateur gap 72 {
  block api "API" container at (0, 0) { description: "Orchestre les demandes." }
  block moteur "Moteur" component below api gap 52 { description: "Applique les règles métier." }
}
block donnees "Données" database right-of moteur gap 72 { description: "Conserve l'état de référence." }
utilisateur -> api "demande"
api -> moteur "orchestre"
moteur -> donnees "lit et écrit"

Processus libre court — répartis les branches verticalement :
graph { background: #ffffff padding: 30 gap: 54 flow: down }
style node { fill: #f4f1e9 stroke: #8c877d 1.2 font: 13 #1c1a16 radius: 8 padding: 14 }
style edge { stroke: #777168 1.3 font: 11 #4f4a43 }
node entree "Entrée" at (0, 0)
node traitement "Traitement" below entree gap 54
node sortie "Sortie" below traitement gap 54
node exception "Exception" right-of traitement gap 80
entree -> traitement "déclenche"
traitement -> sortie
traitement -> exception "si échec"

Pour des parts chiffrées : type pie { title: "Titre" labels: percent } puis slice identifiant "Libellé" 42.
Pour comparer des séries : type bar { title: "Titre" size: 520 280 categories: "A" "B" } puis series id "Libellé" 10 20.
Pour une chronologie : type timeline { title: "Titre" size: 760 36 } puis event id "Libellé" 2026-08-27.
Pour une carte mentale : type mindmap { title: "Titre" row: 150 spacing: 22 }, puis topic id "Libellé" et parent -> enfant.
Pour des échanges : type sequence { title: "Titre" column: 160 row: 46 numbered: on }, puis participant id "Libellé" et a -> b "message".`

export function buildBgraphPrompt(previousSource?: string | null): string {
  if (!previousSource) return DIAGRAM_GRAMMAR
  return `${DIAGRAM_GRAMMAR}

L’utilisateur veut modifier ce diagramme existant. Pars de cette source et applique sa nouvelle demande en conservant ce qui n’est pas concerné :
<previous-bgraph>
${previousSource.slice(0, MAX_BGRAPH_SOURCE_CHARS)}
</previous-bgraph>`
}

export function buildBgraphCorrectionPrompt(source: string | null, diagnostics: readonly BgraphDiagnostic[] | string): string {
  const details = typeof diagnostics === 'string' ? diagnostics : diagnostics.map(formatDiagnostic).join('\n')
  return `${DIAGRAM_GRAMMAR}

La tentative précédente est invalide :
${source ?? '(aucune balise <bgraph> exploitable)'}

Diagnostics :
${details}

Corrige entièrement la source. Réponds uniquement avec <bgraph>...</bgraph>.`
}
