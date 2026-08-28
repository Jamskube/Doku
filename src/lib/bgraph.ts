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
  code:
    | 'implicit-horizontal-flow' | 'extreme-aspect-ratio' | 'overlong-labels' | 'citation-markers'
    | 'hidden-edge-label' | 'overlapping-boxes' | 'box-overlaps-group' | 'edge-crosses-box'
    | 'overlapping-labels' | 'overlapping-text'
  message: string
}

export interface BgraphRect { x: number; y: number; w: number; h: number }

export interface BgraphLayout {
  canvas: { width: number; height: number }
  groups: { id: string; label: string[]; rect: BgraphRect }[]
  nodes: { id: string; label: string[]; rect: BgraphRect }[]
  edges: {
    from: string | null
    to: string | null
    label: string | null
    labelRect: BgraphRect | null
    // La route telle que dessinée, coudes compris — pas ses deux extrémités.
    points: [number, number][]
  }[]
  // Les textes libres. Pour un `block` ou un `bpmn`, les libellés des boîtes en
  // font partie — ils portent leur corps de police, que les rectangles ne donnent
  // pas. Le moteur ne rend pas leur largeur : elle s'estime.
  annotations: { text: string; size: number; x: number; y: number }[]
}

// Un venn chevauche par définition : c'est le seul genre où deux boîtes qui se
// recouvrent sont le propos et non le défaut. Les seuils qui suivent viennent de
// la mesure des 30 recettes officielles : l'événement attaché d'un `bpmn` mord
// 50 % de sa tâche, le cadre d'un `sequence` mord 14 % d'un participant — deux
// motifs voulus. Au-delà, c'est une superposition franche.
const DELIBERATE_OVERLAP_GENRES = new Set(['venn'])
const BOX_OVERLAP_RATIO = 0.7
const GROUP_OVERLAP_RATIO = 0.3
// Le moteur ne donne pas la largeur d'un texte libre. La table Helvetica qu'il
// utilise tourne autour de 0,5 em par caractère ; l'estimation ne signale aucune
// des 30 recettes, donc elle est assez prudente pour servir de garde.
const CHARACTER_WIDTH_RATIO = 0.5


interface BgraphExports extends WebAssembly.Exports {
  memory: WebAssembly.Memory
  bgraph_alloc(length: number): number
  bgraph_free(pointer: number, length: number): void
  bgraph_render(pointer: number, length: number): number
  bgraph_check(pointer: number, length: number): number
  bgraph_examples(): number
  bgraph_result_len(): number
}

type BgraphLayoutExport = (pointer: number, length: number) => number

// `bgraph_layout` est ajouté par le fork Doku, et ne peut pas être déclaré
// optionnel sur `WebAssembly.Exports`, dont l'index refuse `undefined`. On le
// cherche donc à l'exécution : sur un module non forké, les gardes géométriques
// se retirent au lieu de faire échouer le rendu.
function layoutExport(exports: BgraphExports): BgraphLayoutExport | null {
  const found = (exports as unknown as Record<string, unknown>).bgraph_layout
  return typeof found === 'function' ? (found as BgraphLayoutExport) : null
}

let api: BgraphExports | null = null
let loading: Promise<BgraphExports> | null = null
let examples: Map<string, string> | null = null
const encoder = new TextEncoder()
const decoder = new TextDecoder()

// Une panique traversant la frontière wasm emporte le module entier : l'instance
// reste en place mais tout appel ultérieur repanique. Sans réarmement, une seule
// source pathologique ferait tomber toutes les cartes de la session, y compris
// celles restaurées d'anciennes discussions.
function resetBgraph(): void {
  api = null
  loading = null
}

function isWasmTrap(error: unknown): boolean {
  if (typeof WebAssembly.RuntimeError === 'function' && error instanceof WebAssembly.RuntimeError) return true
  return error instanceof Error && error.name === 'RuntimeError'
}

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

function callOnce(
  exports: BgraphExports,
  source: string,
  call: (exports: BgraphExports, pointer: number, length: number) => number,
): string {
  const bytes = encoder.encode(source)
  const pointer = exports.bgraph_alloc(bytes.length)
  new Uint8Array(exports.memory.buffer, pointer, bytes.length).set(bytes)
  let result: string
  try {
    result = readResult(exports, call(exports, pointer, bytes.length))
  } catch (error) {
    // Libérer dans un module qui vient de paniquer déclencherait la panique suivante.
    if (!isWasmTrap(error)) exports.bgraph_free(pointer, bytes.length)
    throw error
  }
  exports.bgraph_free(pointer, bytes.length)
  return result
}

async function withSource(source: string, call: (exports: BgraphExports, pointer: number, length: number) => number): Promise<string> {
  if (source.length > MAX_BGRAPH_SOURCE_CHARS) throw new Error('Le diagramme produit est trop volumineux.')
  try {
    return callOnce(await loadBgraph(), source, call)
  } catch (error) {
    if (!isWasmTrap(error)) throw error
    resetBgraph()
    try {
      return callOnce(await loadBgraph(), source, call)
    } catch (retried) {
      // Ne jamais laisser une instance morte derrière soi : le prochain diagramme
      // repartirait d'un module condamné.
      if (isWasmTrap(retried)) resetBgraph()
      throw retried
    }
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

// `filter` et `feDropShadow` sont inertes — pas de script, pas de ressource
// externe — et le moteur les émet dès qu'un style porte `shadow: on`, propriété
// documentée qu'un modèle peut inventer. Sans elles, ce simple mot déclenchait un
// rejet dur que la boucle de correction ne pouvait pas résoudre.
const SVG_TAGS = new Set([
  'circle', 'defs', 'ellipse', 'fedropshadow', 'filter', 'g', 'line', 'marker', 'path',
  'polygon', 'polyline', 'rect', 'svg', 'text', 'title', 'tspan',
])

const SVG_ATTRIBUTES = new Set([
  'aria-label', 'cx', 'cy', 'd', 'dominant-baseline', 'dx', 'dy', 'fill', 'fill-opacity',
  'filter', 'flood-opacity', 'font-family', 'font-size', 'font-weight', 'height', 'id',
  'marker-end', 'marker-start', 'markerheight', 'markerunits', 'markerwidth', 'orient',
  'points', 'r', 'refx', 'refy', 'role', 'rx', 'ry', 'stddeviation', 'stroke',
  'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'stroke-opacity',
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

function readRect(value: unknown): BgraphRect | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const parts = [raw.x, raw.y, raw.w, raw.h]
  if (!parts.every((part) => typeof part === 'number' && Number.isFinite(part))) return null
  return { x: raw.x as number, y: raw.y as number, w: raw.w as number, h: raw.h as number }
}

function readLabelLines(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((line): line is string => typeof line === 'string') : []
}

/**
 * La mise en page résolue : chaque boîte avec son identifiant et son rectangle.
 *
 * `null` quand le module ne porte pas l'export — un `bgraph.wasm` non forké reste
 * parfaitement utilisable, il perd seulement les gardes géométriques.
 */
export async function layoutBgraph(source: string): Promise<BgraphLayout | null> {
  if (!layoutExport(await loadBgraph())) return null
  const raw = await withSource(source, (exports, pointer, length) => {
    const call = layoutExport(exports)
    if (!call) throw new Error('Le moteur de diagrammes ne sait pas rendre la mise en page.')
    return call(pointer, length)
  })
  if (raw.startsWith('error:')) throw new Error(raw.slice('error:'.length).trim())
  const parsed = JSON.parse(raw) as Record<string, unknown>
  const canvas = parsed.canvas as Record<string, unknown> | undefined
  const boxes = (value: unknown) => (Array.isArray(value) ? value : []).flatMap((item) => {
    const entry = (item ?? {}) as Record<string, unknown>
    const rect = readRect(entry.rect)
    return rect && typeof entry.id === 'string'
      ? [{ id: entry.id, label: readLabelLines(entry.label), rect }]
      : []
  })
  return {
    canvas: {
      width: typeof canvas?.width === 'number' ? canvas.width : 0,
      height: typeof canvas?.height === 'number' ? canvas.height : 0,
    },
    groups: boxes(parsed.groups),
    nodes: boxes(parsed.nodes),
    edges: (Array.isArray(parsed.edges) ? parsed.edges : []).map((item) => {
      const entry = (item ?? {}) as Record<string, unknown>
      return {
        from: typeof entry.from === 'string' ? entry.from : null,
        to: typeof entry.to === 'string' ? entry.to : null,
        label: typeof entry.label === 'string' ? entry.label : null,
        labelRect: readRect(entry.label_rect),
        points: (Array.isArray(entry.points) ? entry.points : []).flatMap((point) => {
          const pair = Array.isArray(point) ? point : []
          return pair.length === 2 && pair.every((value) => typeof value === 'number' && Number.isFinite(value))
            ? [[pair[0], pair[1]] as [number, number]]
            : []
        }),
      }
    }),
    annotations: (Array.isArray(parsed.annotations) ? parsed.annotations : []).flatMap((item) => {
      const entry = (item ?? {}) as Record<string, unknown>
      return typeof entry.text === 'string' && typeof entry.size === 'number'
        && typeof entry.x === 'number' && typeof entry.y === 'number'
        ? [{ text: entry.text, size: entry.size, x: entry.x, y: entry.y }]
        : []
    }),
  }
}

function intersects(a: BgraphRect, b: BgraphRect): boolean {
  const width = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
  const height = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  return width > 1 && height > 1
}

// Quelle part du plus petit des deux rectangles est recouverte.
function overlapRatio(a: BgraphRect, b: BgraphRect): number {
  const width = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
  const height = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  if (width <= 0 || height <= 0) return 0
  const smallest = Math.min(a.w * a.h, b.w * b.h)
  return smallest > 0 ? (width * height) / smallest : 0
}

// Un texte libre n'a pas de rectangle : le moteur ne rend que son ancre et son
// corps. Il est centré sur son ancre, ce que confirme le `text-anchor="middle"`
// de la sortie SVG.
function annotationRect(annotation: { text: string; size: number; x: number; y: number }): BgraphRect {
  const width = annotation.text.length * annotation.size * CHARACTER_WIDTH_RATIO
  return { x: annotation.x - width / 2, y: annotation.y - annotation.size / 2, w: width, h: annotation.size }
}

function encloses(outer: BgraphRect, inner: BgraphRect): boolean {
  return outer.x <= inner.x + 1
    && outer.y <= inner.y + 1
    && outer.x + outer.w >= inner.x + inner.w - 1
    && outer.y + outer.h >= inner.y + inner.h - 1
}

// Un segment traverse-t-il un rectangle ? Vrai aussi quand il y entre sans en
// ressortir, ce qu'un test d'intersection des seuls bords manquerait.
function segmentCrosses(from: [number, number], to: [number, number], box: BgraphRect): boolean {
  const inside = (x: number, y: number) => x > box.x && x < box.x + box.w && y > box.y && y < box.y + box.h
  if (inside(from[0], from[1]) || inside(to[0], to[1])) return true
  // Découpage de Liang-Barsky : la portion du segment qui reste dans la boîte.
  const dx = to[0] - from[0]
  const dy = to[1] - from[1]
  const edges: [number, number][] = [
    [-dx, from[0] - box.x],
    [dx, box.x + box.w - from[0]],
    [-dy, from[1] - box.y],
    [dy, box.y + box.h - from[1]],
  ]
  let enter = 0
  let leave = 1
  for (const [slope, distance] of edges) {
    if (slope === 0) {
      if (distance < 0) return false
      continue
    }
    const ratio = distance / slope
    if (slope < 0) enter = Math.max(enter, ratio)
    else leave = Math.min(leave, ratio)
  }
  // Un simple frôlement du bord ne compte pas : il faut une traversée visible.
  return leave - enter > 0.02
}

function boxName(box: { id: string; label: string[] }): string {
  const label = box.label.filter(Boolean).join(' ').trim()
  return label ? `« ${label} »` : `\`${box.id}\``
}

/**
 * Les défauts que seule la mise en page révèle : un texte qu'une boîte recouvre,
 * deux boîtes superposées, un canevas dont le texte devient illisible une fois
 * réduit à la largeur de la carte.
 *
 * Fonction pure sur la mise en page — testable sans modèle et sans WASM.
 */
export function inspectBgraphGeometry(source: string, layout: BgraphLayout): BgraphQualityIssue[] {
  const issues: BgraphQualityIssue[] = []
  const archetype = source.match(/^[^\S\n]*type\s+([a-z]+)/m)?.[1] ?? 'free'

  // Les nœuds sont peints APRÈS les libellés d'arête : la boîte gagne et le texte
  // ne se voit pas rogné, il disparaît. C'est le défaut que l'usage a remonté.
  const hidden = layout.edges.flatMap((edge) => {
    if (!edge.labelRect || !edge.label) return []
    const covering = layout.nodes.find((node) => intersects(edge.labelRect!, node.rect))
    return covering ? [`« ${edge.label.replace(/\s+/g, ' ').trim()} » sous ${boxName(covering)}`] : []
  })
  if (hidden.length) {
    issues.push({
      code: 'hidden-edge-label',
      message: `${hidden.length} libellé${hidden.length > 1 ? 's de liaison disparaissent' : ' de liaison disparaît'} sous une boîte : ${hidden.join(' ; ')}. Écarte les boîtes concernées avec un “gap” plus large, ou déplace le texte avec “label-offset”.`,
    })
  }

  // Deux libellés qui se marchent dessus. Le moteur les écarte des traits, pas les
  // uns des autres : sa propre note de conception le dit. Le résultat se lit comme
  // un mot coupé en deux.
  const labelled = layout.edges.filter((edge) => edge.labelRect && edge.label)
  const tangled: string[] = []
  for (let i = 0; i < labelled.length; i += 1) {
    for (let j = i + 1; j < labelled.length; j += 1) {
      if (!intersects(labelled[i].labelRect!, labelled[j].labelRect!)) continue
      const short = (edge: typeof labelled[number]) => `« ${edge.label!.replace(/\s+/g, ' ').trim()} »`
      tangled.push(`${short(labelled[i])} et ${short(labelled[j])}`)
    }
  }
  if (tangled.length) {
    issues.push({
      code: 'overlapping-labels',
      message: `${tangled.length} paire${tangled.length > 1 ? 's de libellés se chevauchent' : ' de libellés se chevauche'} : ${tangled.join(' ; ')}. Écarte les boîtes concernées, ou déplace un des textes avec “label-offset”.`,
    })
  }

  // Une liaison qui passe au travers d'une boîte qui n'est ni son départ ni son
  // arrivée. Le routeur tourne les angles mais n'évite rien : il ne contourne
  // aucun obstacle, et le trait se lit comme s'il reliait la mauvaise boîte.
  const crossings = layout.edges.flatMap((edge) => {
    const crossed = layout.nodes.filter((node) => {
      if (node.id === edge.from || node.id === edge.to) return false
      return edge.points.some((point, index) =>
        index > 0 && segmentCrosses(edge.points[index - 1], point, node.rect))
    })
    return crossed.map((node) => {
      const ends = [edge.from, edge.to].filter(Boolean).join(' → ')
      return `${ends || 'une liaison'} au travers de ${boxName(node)}`
    })
  })
  if (crossings.length) {
    issues.push({
      code: 'edge-crosses-box',
      message: `${crossings.length} liaison${crossings.length > 1 ? 's traversent une boîte' : ' traverse une boîte'} qu'elle ne relie pas : ${crossings.join(' ; ')}. Déplace une boîte, élargis le “gap”, ou passe cette liaison en “router: straight”.`,
    })
  }

  if (!DELIBERATE_OVERLAP_GENRES.has(archetype)) {
    const collisions: string[] = []
    for (let i = 0; i < layout.nodes.length; i += 1) {
      for (let j = i + 1; j < layout.nodes.length; j += 1) {
        const a = layout.nodes[i], b = layout.nodes[j]
        if (encloses(a.rect, b.rect) || encloses(b.rect, a.rect)) continue
        if (overlapRatio(a.rect, b.rect) < BOX_OVERLAP_RATIO) continue
        collisions.push(`${boxName(a)} et ${boxName(b)}`)
      }
    }
    if (collisions.length) {
      issues.push({
        code: 'overlapping-boxes',
        message: `${collisions.length} paire${collisions.length > 1 ? 's de boîtes se superposent' : ' de boîtes se superpose'} presque entièrement : ${collisions.join(' ; ')}. Ancre-les l'une par rapport à l'autre avec below/right-of plutôt que par des coordonnées absolues.`,
      })
    }

    // Un bloc entièrement dans un groupe en est membre. Un bloc qui n'en mord
    // qu'une partie déborde de son cadre — et le cadre est peint sous lui.
    const straddling = layout.groups.flatMap((group) => layout.nodes
      .filter((node) => !encloses(group.rect, node.rect) && overlapRatio(group.rect, node.rect) >= GROUP_OVERLAP_RATIO)
      .map((node) => `${boxName(node)} sur ${boxName(group)}`))
    if (straddling.length) {
      issues.push({
        code: 'box-overlaps-group',
        message: `${straddling.length} boîte${straddling.length > 1 ? 's débordent' : ' déborde'} du cadre d'un groupe : ${straddling.join(' ; ')}. Place-la dans le groupe, ou ancre-la à l'extérieur avec un “gap” suffisant.`,
      })
    }
  }

  // Deux textes de boîte qui se marchent dessus. Ils n'ont pas de rectangle dans
  // la mise en page : leur largeur s'estime, prudemment — aucune des 30 recettes
  // officielles n'est signalée par cette règle.
  const texts = layout.annotations.filter((annotation) => annotation.text.trim())
  const collidingTexts: string[] = []
  for (let i = 0; i < texts.length; i += 1) {
    for (let j = i + 1; j < texts.length; j += 1) {
      if (!intersects(annotationRect(texts[i]), annotationRect(texts[j]))) continue
      collidingTexts.push(`« ${texts[i].text.trim()} » et « ${texts[j].text.trim()} »`)
    }
  }
  if (collidingTexts.length) {
    issues.push({
      code: 'overlapping-text',
      message: `${collidingTexts.length} paire${collidingTexts.length > 1 ? 's de textes se chevauchent' : ' de textes se chevauche'} : ${collidingTexts.join(' ; ')}. Écarte les éléments concernés, ou raccourcis ces textes.`,
    })
  }

  // Pas de garde de lisibilité ici. Mesurée sur les diagrammes réels, elle
  // signalait tout : à la largeur de la carte, un canevas de 760 px rend déjà son
  // texte de 13 px à 6,5 px, et les vues acceptées font 806 à 1377 px de large.
  // Un seuil qui refuse tout ne protège de rien — à rouvrir avec une mesure.
  return issues
}

export async function bgraphRecipe(genre: string): Promise<string> {
  if (!examples) {
    const readExamples = async () => {
      const exports = await loadBgraph()
      return readResult(exports, exports.bgraph_examples())
    }
    let raw: string
    try {
      raw = await readExamples()
    } catch (error) {
      if (!isWasmTrap(error)) throw error
      resetBgraph()
      raw = await readExamples()
    }
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

export interface BgraphLabelOffset {
  from: string
  to: string
  dx: number
  dy: number
}

const LABEL_CLEARANCE = 8
const EDGE_ARROW = String.raw`(?:<->|<-|-->|\.\.>|--|->|\.\.)`

function shifted(rect: BgraphRect, dx: number, dy: number): BgraphRect {
  return { x: rect.x + dx, y: rect.y + dy, w: rect.w, h: rect.h }
}

/**
 * De combien déplacer chaque libellé recouvert pour qu'il se dégage.
 *
 * Le moteur refuse de réparer lui-même — élargir un écart déplace une boîte, ce
 * que sa règle de conception lui interdit. Mais il expose `label-offset`, qui ne
 * bouge que le texte, et la mise en page donne les deux rectangles : le calcul
 * est déterministe, et ne coûte aucun appel au modèle.
 */
export function planLabelOffsets(layout: BgraphLayout): BgraphLabelOffset[] {
  const plans: BgraphLabelOffset[] = []
  const boxes = layout.nodes.map((node) => node.rect)
  // La position courante de chaque libellé, mise à jour au fil des déplacements
  // décidés. Les planifier tous depuis le même instantané ferait se fuir
  // mutuellement deux libellés qui se gênent, pour les retrouver superposés
  // ailleurs : le second doit voir où le premier est parti.
  const placed = new Map<number, BgraphRect>()
  layout.edges.forEach((edge, index) => {
    if (edge.labelRect) placed.set(index, edge.labelRect)
  })

  for (const [index, edge] of layout.edges.entries()) {
    const rect = placed.get(index)
    if (!rect || !edge.from || !edge.to) continue
    // Les autres libellés comptent autant que les boîtes : un texte sur un texte
    // se lit aussi mal qu'un texte sous une boîte.
    const others = [...placed.entries()].filter(([other]) => other !== index).map(([, other]) => other)
    const obstacles = [...boxes, ...others]
    const covering = obstacles.filter((obstacle) => intersects(rect, obstacle))
    if (!covering.length) continue

    const first = edge.points[0]
    const last = edge.points[edge.points.length - 1]
    const horizontal = !first || !last || Math.abs(last[0] - first[0]) >= Math.abs(last[1] - first[1])

    // Un libellé se dégage perpendiculairement à sa liaison : le pousser le long
    // du trait le rapprocherait simplement de la boîte suivante.
    const up = Math.min(...covering.map((box) => box.y)) - (rect.y + rect.h) - LABEL_CLEARANCE
    const down = Math.max(...covering.map((box) => box.y + box.h)) - rect.y + LABEL_CLEARANCE
    const left = Math.min(...covering.map((box) => box.x)) - (rect.x + rect.w) - LABEL_CLEARANCE
    const right = Math.max(...covering.map((box) => box.x + box.w)) - rect.x + LABEL_CLEARANCE
    const straight: [number, number][] = horizontal
      ? [[0, up], [0, down], [left, 0], [right, 0]]
      : [[left, 0], [right, 0], [0, up], [0, down]]
    // Le déplacement minimal ne dégage pas toujours : sur un diagramme dense il
    // heurte l'obstacle suivant. On tente donc plus loin, puis en diagonale, avant
    // de renvoyer le problème au modèle.
    const candidates: [number, number][] = []
    for (const scale of [1, 1.7, 2.6]) {
      for (const [dx, dy] of straight) candidates.push([dx * scale, dy * scale])
    }
    for (const [dx] of straight.filter(([x]) => x !== 0)) {
      for (const [, dy] of straight.filter(([, y]) => y !== 0)) candidates.push([dx, dy])
    }

    // Le plus petit déplacement qui dégage vraiment : inutile de libérer une boîte
    // pour en heurter une autre.
    const clear = candidates
      .filter(([dx, dy]) => obstacles.every((obstacle) => !intersects(shifted(rect, dx, dy), obstacle)))
      .sort((a, b) => Math.hypot(a[0], a[1]) - Math.hypot(b[0], b[1]))[0]
    if (!clear) continue
    placed.set(index, shifted(rect, clear[0], clear[1]))
    plans.push({ from: edge.from, to: edge.to, dx: Math.round(clear[0]), dy: Math.round(clear[1]) })
  }
  return plans
}

/**
 * Réécrit la source en épinglant les libellés déplacés.
 *
 * Volontairement prudente : une arête dont le bloc s'étale sur plusieurs lignes,
 * ou qui porte déjà un `label-offset`, est laissée telle quelle plutôt que
 * réécrite de travers. Ce qu'elle ne répare pas revient au modèle.
 */
export function applyLabelOffsets(source: string, offsets: readonly BgraphLabelOffset[]): string | null {
  if (!offsets.length) return null
  const lines = source.split('\n')
  const used = new Set<number>()
  let applied = 0

  for (const offset of offsets) {
    const pattern = new RegExp(`^\\s*${escapeIdentifier(offset.from)}\\s*${EDGE_ARROW}\\s*${escapeIdentifier(offset.to)}(?![\\w-])`)
    const index = lines.findIndex((line, at) => !used.has(at) && pattern.test(line))
    if (index < 0) continue
    const line = lines[index]
    if (line.includes('//')) continue
    // Un déplacement déjà posé s'additionne : le nouveau se calcule depuis la
    // position courante, pas depuis l'origine. C'est ce qui permet d'itérer.
    const existing = line.match(/\b(?:label|text)-offset:\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/)
    if (existing) {
      const total = `label-offset: ${Math.round(Number(existing[1]) + offset.dx)} ${Math.round(Number(existing[2]) + offset.dy)}`
      lines[index] = line.replace(existing[0], total)
      used.add(index)
      applied += 1
      continue
    }
    const declaration = `label-offset: ${offset.dx} ${offset.dy}`
    if (line.trimEnd().endsWith('}')) {
      const close = line.lastIndexOf('}')
      lines[index] = `${line.slice(0, close).trimEnd()} ${declaration} ${line.slice(close)}`
    } else if (line.includes('{')) {
      continue // bloc sur plusieurs lignes : ne pas réécrire à l'aveugle
    } else {
      lines[index] = `${line.trimEnd()} { ${declaration} }`
    }
    used.add(index)
    applied += 1
  }
  return applied ? lines.join('\n') : null
}

function escapeIdentifier(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')
}

/**
 * Dégage les libellés recouverts, sans rien demander au modèle.
 *
 * `null` quand il n'y a rien à réparer, que le moteur ne sait pas rendre la mise
 * en page, ou que la source résiste à une réécriture sûre.
 */
export const MAX_GEOMETRY_REPAIR_PASSES = 3

export async function repairDiagramGeometry(source: string): Promise<string | null> {
  let current = source
  let improved: string | null = null
  // Déplacer un libellé hors de sa forme fait suivre le canevas : les positions
  // bougent, et une passe peut donc en découvrir une autre. Bornée, et on
  // s'arrête dès qu'une passe n'apporte plus rien.
  for (let pass = 0; pass < MAX_GEOMETRY_REPAIR_PASSES; pass += 1) {
    const layout = await layoutBgraph(current).catch(() => null)
    if (!layout) break
    const next = applyLabelOffsets(current, planLabelOffsets(layout))
    if (!next || next === current) break
    current = next
    improved = next
  }
  return improved
}

export function assertBgraphQuality(source: string, svg: string): void {
  const issues = inspectBgraphQuality(source, svg)
  if (issues.length) throw new BgraphQualityError(issues)
}

/**
 * Désarme les gardes géométriques sans toucher au reste, si elles se mettaient à
 * refuser des diagrammes corrects.
 */
export const DIAGRAM_STRICT_GEOMETRY: boolean = true

/**
 * La porte de GÉNÉRATION : le contrôle de composition, plus les défauts que seule
 * la mise en page révèle.
 *
 * Volontairement distincte d'`assertBgraphQuality`, qui reste la porte
 * d'AFFICHAGE : `renderBgraph` est appelé à chaque affichage, y compris pour une
 * discussion archivée. Y rendre un défaut bloquant remplacerait par une carte
 * d'erreur tout diagramme déjà accepté avant ce contrôle.
 */
export async function inspectDiagramForGeneration(source: string, svg: string): Promise<BgraphQualityIssue[]> {
  const issues = inspectBgraphQuality(source, svg)
  if (DIAGRAM_STRICT_GEOMETRY) {
    // Un module non forké ne porte pas l'export : on garde les gardes d'avant
    // plutôt que de faire échouer la génération.
    const layout = await layoutBgraph(source).catch(() => null)
    if (layout) issues.push(...inspectBgraphGeometry(source, layout))
  }
  return issues
}

/**
 * Rend une source candidate, en réparant d'abord ce qui se répare sans le modèle.
 *
 * Rend la source **retenue** — réparée le cas échéant — et ce qu'il reste de
 * défauts. Ne lève que sur un rendu impossible : un défaut de composition est un
 * résultat, pas une exception, parce que l'appelant peut préférer une vue
 * imparfaite à pas de vue du tout.
 */
export async function renderDiagramForGeneration(
  source: string,
): Promise<{ source: string; svg: string; issues: BgraphQualityIssue[] }> {
  const svg = await renderBgraph(source)
  const issues = await inspectDiagramForGeneration(source, svg)
  if (!issues.length) return { source, svg, issues }

  const repaired = await repairDiagramGeometry(source)
  if (!repaired) return { source, svg, issues }
  const repairedSvg = await renderBgraph(repaired).catch(() => null)
  if (!repairedSvg) return { source, svg, issues }
  const remaining = await inspectDiagramForGeneration(repaired, repairedSvg)
  // La réparation ne doit jamais empirer les choses.
  return remaining.length < issues.length
    ? { source: repaired, svg: repairedSvg, issues: remaining }
    : { source, svg, issues }
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
