<script lang="ts">
  import { onMount, tick } from 'svelte'
  import { app, workspace } from '../lib/stores.svelte'
  import { keepPdfAnnotationManifestAside, readFileBytes, readPdfAnnotationManifest, writePdfAnnotationManifest } from '../lib/tauri'
  import {
    clusterPdfNotePins,
    parsePdfAnnotationManifest,
    pdfAnnotationIdentity,
    pdfNoteFromDrawing,
    pdfNotes,
    removeOrphanedPdfDrawings,
    removePdfDrawing,
    updatePdfDrawingComment,
    upsertPdfDrawing,
    type PdfAnnotationManifest,
    type PdfNote,
  } from '../lib/pdf-annotations'
  import {
    PDF_DRAWING_COLOR,
    PDF_DRAWING_STROKE_WIDTH,
    PDF_HIGHLIGHT_COLOR,
    PDF_HIGHLIGHT_STROKE_WIDTH,
    appendPdfStroke,
    appendPdfTextHighlightRects,
    createPdfShapeDrawing,
    createPdfTextHighlightDrawing,
    extendPdfDrawingPoints,
    fitPdfDrawingPoints,
    pdfStrokePoints,
    isPdfShapeDrawing,
    isPdfStrokeDrawing,
    isPdfTextHighlight,
    mergePdfLineRects,
    pdfDrawingBox,
    pdfStrokePathData,
    smoothPdfDrawingStroke,
    translatePdfDrawing,
    type PdfDrawing,
    type PdfDrawingPoint,
    type PdfDrawingRect,
    type PdfInkMode,
    type PdfShapeDrawing,
    type PdfShapeKind,
    type PdfStrokeDrawing,
    type PdfStrokeKind,
  } from '../lib/pdf-drawing'
  import { coveredPdfTextBoxes, joinPdfHighlightQuote } from '../lib/pdf-highlight-text'
  import type { PdfDoc } from '../lib/pdf'
  import type { TextLayer } from 'pdfjs-dist'
  import { PDF_MAX_ZOOM, PDF_MIN_ZOOM, clampPdfZoom, fitPdfPage, stepPdfZoom } from '../lib/pdf-layout'
  import type { PaneId } from '../lib/workspace'

  let { path, sourceBytes, paneId = 'primary' }: { path: string; sourceBytes?: Uint8Array; paneId?: PaneId } = $props()

  let container: HTMLElement | undefined = $state()
  let shell: HTMLElement | undefined = $state()
  let status: 'loading' | 'ready' | 'error' = $state('loading')
  let message = $state('')
  let annotationManifest: PdfAnnotationManifest | null = $state(null)
  let annotationListOpen = $state(false)
  let savingAnnotation = $state(false)
  let staleAnnotations = $state(false)
  // Carnet présent mais incompréhensible : il faudra le mettre à l'abri avant d'écrire.
  let unreadableManifest = false
  let activeNoteIds = $state<string[]>([])
  let editingNoteId = $state<string | null>(null)
  let noteEditDraft = $state('')
  let noteEditInput: HTMLTextAreaElement | undefined = $state()
  // Bulle de note ancrée sur l'annotation (coordonnées dans le contenu défilant).
  let noteBubble: { id: string; page: number; left: number; top: number; tail: number } | null = $state(null)
  let noteBubbleDraft = $state('')
  let noteBubbleInput: HTMLTextAreaElement | undefined = $state()
  // Une note déjà écrite s'ouvre en LECTURE ; on n'entre en écriture qu'en le
  // demandant (crayon), ou d'emblée quand la note n'existe pas encore.
  let noteBubbleEditing = $state(false)
  let undoStack: PdfAnnotationManifest[] = $state([])
  let redoStack: PdfAnnotationManifest[] = $state([])
  let annotationMode = $state(false)
  let drawingTool: 'select' | 'pen' | 'shape' | 'eraser' = $state('select')
  // Le surligneur est un MODE du crayon, pas un outil à part. Deux variantes : celle
  // qui épouse le texte sélectionné, et le trait libre.
  let inkMode: PdfInkMode = $state('ink')
  let drawingShape: PdfShapeKind = $state('rectangle')
  let drawingPaletteOpen = $state(false)
  let drawingStrokeMenuOpen = $state(false)
  let drawingShapeMenuOpen = $state(false)
  let drawingInkMenuOpen = $state(false)
  let selectedDrawingId = $state<string | null>(null)
  // 100 % = la vue d'ouverture (page à la largeur du lecteur), pas une taille
  // physique : « revenir à la normale » rend donc exactement ce qu'on avait.
  let zoom = $state(1)
  let previewDrawing: PdfDrawing | null = null
  // Identité de l'aperçu : jamais persistée, jamais sélectionnable, seulement peinte.
  const PREVIEW_ID = '__preview__'
  const PREVIEW_STAMP = '1970-01-01T00:00:00.000Z'
  let drawingFrame = 0
  const pendingDrawingPages = new Set<number>()
  type DrawingGesture =
    | { kind: 'stroke'; pointerId: number; page: number; drawing: PdfStrokeDrawing }
    | { kind: 'shape'; pointerId: number; page: number; start: PdfDrawingPoint; drawing: PdfShapeDrawing }
    | { kind: 'move'; pointerId: number; page: number; start: PdfDrawingPoint; original: PdfDrawing; drawing: PdfDrawing }
  let drawingGesture: DrawingGesture | null = null
  let requestFit = () => {}
  // Style mémorisé par famille d'outil : un surligneur noir de 4 px n'aurait aucun
  // sens, et repasser au crayon ne doit pas hériter du jaune épais du surligneur.
  const toolStyles = $state({
    ink: { color: PDF_DRAWING_COLOR, strokeWidth: PDF_DRAWING_STROKE_WIDTH },
    highlight: { color: PDF_HIGHLIGHT_COLOR, strokeWidth: PDF_HIGHLIGHT_STROKE_WIDTH },
    text: { color: PDF_HIGHLIGHT_COLOR, strokeWidth: PDF_HIGHLIGHT_STROKE_WIDTH },
    shape: { color: PDF_DRAWING_COLOR, strokeWidth: PDF_DRAWING_STROKE_WIDTH },
  })
  const notes = $derived.by(() => {
    const manifest: PdfAnnotationManifest | null = annotationManifest
    return manifest ? pdfNotes(manifest) : []
  })
  const selectedDrawing = $derived.by(() => {
    const manifest: PdfAnnotationManifest | null = annotationManifest
    return manifest?.drawings.find((drawing) => drawing.id === selectedDrawingId) ?? null
  })
  // La palette suit ce qu'on est en train d'éditer : le tracé sélectionné s'il y en a
  // un, sinon l'outil actif. Une seule source de vérité, donc pas de dérive possible
  // entre ce que montre la barre et ce que produira le prochain geste.
  const paletteKind = $derived.by((): 'ink' | 'highlight' | 'text' | 'shape' => {
    const selected = selectedDrawing
    if (selected) {
      return selected.kind === 'highlight' || selected.kind === 'text' || selected.kind === 'ink'
        ? selected.kind
        : 'shape'
    }
    return drawingTool === 'pen' ? inkMode : 'shape'
  })
  // Le surlignage de texte prend l'épaisseur de la ligne : il n'y a rien à régler.
  const strokeWidthAdjustable = $derived(paletteKind !== 'text')
  // Ce que le pointeur doit servir : sélectionner du texte, tracer, désigner un tracé
  // ou gommer. Une seule source pour router les événements en CSS.
  const pointerMode = $derived.by((): 'pick' | 'text' | 'draw' | 'erase' => {
    if (drawingTool === 'eraser') return 'erase'
    if (drawingTool === 'select') return 'pick'
    if (drawingTool === 'shape') return 'draw'
    return inkMode === 'text' ? 'text' : 'draw'
  })
  const drawingColor = $derived(selectedDrawing?.color ?? toolStyles[paletteKind].color)
  const drawingStrokeWidth = $derived(selectedDrawing?.strokeWidth ?? toolStyles[paletteKind].strokeWidth)
  const annotationRailVisible = $derived(notes.some((note) => note.status === 'active' && Boolean(note.comment)))
  // Un dessin orphelin n'est plus rendu (ses coordonnées ne veulent plus rien dire sur
  // la nouvelle mise en page) : sans ce compte, il resterait dans le manifeste sans
  // qu'aucun écran ne le mentionne ni ne permette de s'en débarrasser.
  const orphanedDrawings = $derived.by(() => {
    const manifest: PdfAnnotationManifest | null = annotationManifest
    return manifest ? manifest.drawings.filter((drawing) => drawing.status === 'orphaned').length : 0
  })
  // Un orphelin commenté ou surligné garde sa ligne au carnet ; seuls les tracés nus
  // deviennent totalement invisibles — ce sont eux que le compteur doit révéler.
  const hiddenOrphanDrawings = $derived.by(() => {
    const manifest: PdfAnnotationManifest | null = annotationManifest
    if (!manifest) return 0
    const listed = new Set(notes.map((note) => note.id))
    return manifest.drawings.filter((drawing) => drawing.status === 'orphaned' && !listed.has(drawing.id)).length
  })
  const pageWraps = new Map<number, HTMLDivElement>()
  const visibleAnnotationPages = new Set<number>()
  // Doc pdf.js courant, hissé hors du onMount : la révélation de citation (effet plus
  // bas) lit les coordonnées du texte de la page ciblée.
  let pdf: PdfDoc | null = null
  const drawingColors = [
    { value: '#FFFFFF', label: 'Blanc', darkCheck: true },
    { value: '#000000', label: 'Noir', darkCheck: false },
    { value: '#F02F2F', label: 'Rouge', darkCheck: false },
    { value: '#00A84F', label: 'Vert', darkCheck: false },
    { value: '#176BFF', label: 'Bleu', darkCheck: false },
    { value: '#FFD400', label: 'Jaune', darkCheck: true },
  ] as const
  // Palette dédiée au surligneur : le trait est rendu en multiply, donc le blanc
  // serait invisible et le noir masquerait le texte. Que des teintes claires.
  const highlightColors = [
    { value: '#FFD400', label: 'Jaune', darkCheck: true },
    { value: '#8CE99A', label: 'Vert', darkCheck: true },
    { value: '#FFB067', label: 'Orange', darkCheck: true },
    { value: '#FF8AC6', label: 'Rose', darkCheck: true },
    { value: '#8AC6FF', label: 'Bleu', darkCheck: true },
  ] as const
  const drawingStrokeWidths = [
    { value: 2, label: 'Fin' },
    { value: 4, label: 'Moyen' },
    { value: 8, label: 'Épais' },
  ] as const
  const highlightStrokeWidths = [
    { value: 12, label: 'Fin' },
    { value: 20, label: 'Moyen' },
    { value: 32, label: 'Épais' },
  ] as const
  const drawingShapes = [
    { value: 'rectangle', label: 'Rectangle', icon: 'rectangle' },
    { value: 'ellipse', label: 'Ellipse', icon: 'circle' },
  ] as const satisfies readonly { value: PdfShapeKind; label: string; icon: string }[]
  const inkModes = [
    { value: 'ink', label: 'Crayon', icon: 'stylus' },
    { value: 'text', label: 'Surligneur', icon: 'ink_highlighter' },
    { value: 'highlight', label: 'Surligneur libre', icon: 'gesture' },
  ] as const satisfies readonly { value: PdfInkMode; label: string; icon: string }[]
  const highlighterPalette = $derived(paletteKind === 'highlight' || paletteKind === 'text')
  const paletteColors = $derived<readonly { value: string; label: string; darkCheck: boolean }[]>(
    highlighterPalette ? highlightColors : drawingColors,
  )
  const paletteStrokeWidths = $derived<readonly { value: number; label: string }[]>(
    paletteKind === 'highlight' ? highlightStrokeWidths : drawingStrokeWidths,
  )
  const inkModeLabel = $derived.by(() => inkModes.find((mode) => mode.value === inkMode)?.label ?? 'Crayon')
  const inkModeIcon = $derived.by(() => inkModes.find((mode) => mode.value === inkMode)?.icon ?? 'stylus')
  const noteKindLabels: Record<PdfNote['kind'], string> = {
    text: 'Surlignage',
    highlight: 'Surlignage libre',
    ink: 'Tracé',
    rectangle: 'Rectangle',
    ellipse: 'Ellipse',
  }
  // Le carnet ne liste un tracé qu'une fois commenté ou porteur d'une citation : la
  // ligne en cours de rédaction doit donc y être ajoutée le temps de la saisie, sans
  // quoi « Commenter » ouvrirait un carnet où l'objet visé n'apparaît pas.
  const listedNotes = $derived.by(() => {
    const manifest: PdfAnnotationManifest | null = annotationManifest
    const editing = editingNoteId
    if (!manifest || !editing || notes.some((note) => note.id === editing)) return notes
    const drawing = manifest.drawings.find((item) => item.id === editing)
    return drawing ? [...notes, pdfNoteFromDrawing(drawing)].sort((left, right) => left.page - right.page || left.top - right.top) : notes
  })

  function drawingPoint(event: PointerEvent, layer: SVGSVGElement): PdfDrawingPoint {
    const rect = layer.getBoundingClientRect()
    return {
      x: Math.min(Math.max((event.clientX - rect.left) / Math.max(rect.width, 1), 0), 1),
      y: Math.min(Math.max((event.clientY - rect.top) / Math.max(rect.height, 1), 0), 1),
    }
  }

  // Épaisseur écran d'un trait : relative à la page, donc stable au zoom et au DPR.
  function strokePixels(strokeWidth: number, width: number, height: number): number {
    return Math.max(1.6, strokeWidth * Math.min(width, height) / 1_000)
  }

  function svgElement(tag: string): SVGElement {
    return document.createElementNS('http://www.w3.org/2000/svg', tag)
  }

  function svgGroup(id: string): SVGGElement {
    const group = svgElement('g') as SVGGElement
    group.dataset.drawingId = id
    return group
  }

  // Géométrie d'un tracé en pixels de page : un chemin pour les traits, un rectangle
  // par ligne pour un surlignage de texte, une boîte pour les formes.
  function drawingGeometry(drawing: PdfDrawing, width: number, height: number, strokeWidth: number): SVGElement[] {
    if (isPdfStrokeDrawing(drawing)) {
      // Une passe = un sous-chemin : les passes d'un même bloc restent un seul objet
      // SVG, donc une seule cible de pointage et un seul contour de sélection.
      const path = svgElement('path')
      path.setAttribute('d', pdfStrokePathData(drawing.strokes, width, height))
      path.setAttribute('stroke-linecap', 'round')
      path.setAttribute('stroke-linejoin', 'round')
      return [path]
    }
    if (isPdfTextHighlight(drawing)) {
      return drawing.rects.map((rect) => {
        const box = svgElement('rect')
        box.setAttribute('x', String(rect.left * width))
        box.setAttribute('y', String(rect.top * height))
        box.setAttribute('width', String(rect.width * width))
        box.setAttribute('height', String(rect.height * height))
        box.setAttribute('rx', '2')
        return box
      })
    }
    if (drawing.kind === 'rectangle') {
      const box = svgElement('rect')
      box.setAttribute('x', String(drawing.left * width))
      box.setAttribute('y', String(drawing.top * height))
      box.setAttribute('width', String(drawing.width * width))
      box.setAttribute('height', String(drawing.height * height))
      box.setAttribute('rx', String(Math.max(2, strokeWidth)))
      return [box]
    }
    const ellipse = svgElement('ellipse')
    ellipse.setAttribute('cx', String((drawing.left + drawing.width / 2) * width))
    ellipse.setAttribute('cy', String((drawing.top + drawing.height / 2) * height))
    ellipse.setAttribute('rx', String(drawing.width * width / 2))
    ellipse.setAttribute('ry', String(drawing.height * height / 2))
    return [ellipse]
  }

  function renderPdfDrawingsForPage(page: number, force = false) {
    const wrap = pageWraps.get(page)
    const layer = wrap?.querySelector<SVGSVGElement>('.pdf-drawing-layer')
    const highlightLayer = wrap?.querySelector<SVGSVGElement>('.pdf-highlight-layer')
    if (!wrap || !layer || !highlightLayer) return
    // Même virtualisation que les surlignages : sans ce garde-fou, chaque ajustement
    // de mise en page reconstruit le SVG des N pages du document, visibles ou non.
    if (!force && !visibleAnnotationPages.has(page)) {
      layer.replaceChildren()
      highlightLayer.replaceChildren()
      return
    }
    const width = Math.max(wrap.clientWidth, 1)
    const height = Math.max(wrap.clientHeight, 1)
    for (const target of [layer, highlightLayer]) {
      target.setAttribute('viewBox', `0 0 ${width} ${height}`)
      target.replaceChildren()
    }
    const drawings = (annotationManifest?.drawings ?? []).filter((drawing) => drawing.status === 'active' && drawing.page === page)
    if (previewDrawing?.page === page) {
      const at = drawings.findIndex((drawing) => drawing.id === previewDrawing?.id)
      if (at >= 0) drawings[at] = previewDrawing
      else drawings.push(previewDrawing)
    }
    for (const drawing of drawings) {
      const strokeWidth = strokePixels(drawing.strokeWidth, width, height)
      const shapes = drawingGeometry(drawing, width, height, strokeWidth)
      const painted = isPdfTextHighlight(drawing)
      const group = svgGroup(drawing.id)
      for (const shape of shapes) {
        // Un surlignage de texte se REMPLIT (il épouse la ligne) ; tout le reste se
        // trace. Deux modèles de peinture, un seul chemin de code.
        shape.classList.add(painted ? 'pdf-text-fill' : 'pdf-drawing-stroke')
        if (drawing.kind === 'highlight') shape.classList.add('pdf-highlight-stroke')
        shape.setAttribute('fill', painted ? drawing.color : 'none')
        shape.setAttribute('stroke', painted ? 'none' : drawing.color)
        if (!painted) shape.setAttribute('stroke-width', String(strokeWidth))
        group.appendChild(shape)
      }
      if (drawing.id === selectedDrawingId && annotationMode) {
        const outline = svgGroup(drawing.id)
        for (const shape of shapes) {
          const selection = shape.cloneNode(true) as SVGElement
          selection.classList.remove('pdf-drawing-stroke', 'pdf-highlight-stroke', 'pdf-text-fill')
          selection.classList.add('pdf-drawing-selection')
          selection.setAttribute('fill', 'none')
          selection.setAttribute('stroke-width', String(painted ? 2 : strokeWidth + 5))
          outline.appendChild(selection)
        }
        group.prepend(...outline.childNodes)
      }
      // Les surlignages se peignent dans une couche à part, sous la couche texte et en
      // multiply : c'est ce qui laisse le texte lisible AU TRAVERS. Un `mix-blend-mode`
      // posé sur un enfant de la couche haute ne verrait que le SVG pour fond
      // (contexte d'empilement), donc ne fondrait avec rien.
      ;(painted || drawing.kind === 'highlight' ? highlightLayer : layer).appendChild(group)
      // La cible de pointage reste TOUJOURS dans la couche haute : sélection, gomme
      // et déplacement gardent ainsi un seul et même chemin d'événements.
      const hitGroup = svgGroup(drawing.id)
      for (const shape of shapes) {
        const hit = shape.cloneNode(true) as SVGElement
        hit.classList.remove('pdf-drawing-stroke', 'pdf-highlight-stroke', 'pdf-text-fill')
        hit.classList.add(painted ? 'pdf-text-hit' : 'pdf-drawing-hit')
        hit.setAttribute('stroke', 'transparent')
        hit.setAttribute('stroke-width', String(Math.max(16, strokeWidth + 12)))
        if (!isPdfStrokeDrawing(drawing)) hit.setAttribute('fill', 'transparent')
        hitGroup.appendChild(hit)
      }
      layer.appendChild(hitGroup)
    }
  }

  // Une seule frame partagée, mais un ensemble de pages en attente : annuler la frame
  // précédente sans mémoriser sa page laissait un aperçu figé sur la page abandonnée.
  function scheduleDrawingRender(page: number) {
    pendingDrawingPages.add(page)
    if (drawingFrame) return
    drawingFrame = requestAnimationFrame(() => {
      drawingFrame = 0
      for (const pending of pendingDrawingPages) renderPdfDrawingsForPage(pending)
      pendingDrawingPages.clear()
    })
  }

  function renderPdfDrawings() {
    for (const page of pageWraps.keys()) renderPdfDrawingsForPage(page)
  }

  // Texte d'une portion de span, borné par la plage horizontale balayée. Mesuré
  // caractère par caractère : la largeur d'un glyphe varie, donc découper au prorata
  // du nombre de caractères donnerait une citation décalée.
  function sliceSpanText(span: HTMLElement, wrap: DOMRect, from: number, to: number): string {
    const node = span.firstChild
    const content = span.textContent ?? ''
    if (!node || node.nodeType !== Node.TEXT_NODE || !content) return ''
    const range = document.createRange()
    let start = -1
    let end = -1
    for (let index = 0; index < content.length; index++) {
      range.setStart(node, index)
      range.setEnd(node, index + 1)
      const rect = range.getBoundingClientRect()
      if (!rect.width) continue
      const center = (rect.left + rect.width / 2 - wrap.left) / wrap.width
      if (center < from || center > to) continue
      if (start < 0) start = index
      end = index + 1
    }
    return start < 0 ? '' : content.slice(start, end)
  }

  // Citation d'un bloc de surligneur : le texte réellement recouvert, lu dans la
  // couche texte de pdf.js. Vide si la page n'a pas de texte (PDF scanné) — le trait
  // reste valide, il n'aura simplement pas d'extrait au carnet.
  function highlightQuote(drawing: PdfStrokeDrawing): string {
    const wrap = pageWraps.get(drawing.page)
    const layer = wrap?.querySelector<HTMLElement>('.textLayer')
    const wrapRect = wrap?.getBoundingClientRect()
    if (!layer || !wrapRect?.width || !wrapRect.height) return ''
    const spans = Array.from(layer.querySelectorAll<HTMLElement>('span'))
      .filter((span) => span.firstChild?.nodeType === Node.TEXT_NODE && span.textContent?.trim())
    const boxes = spans.map((span) => {
      const rect = span.getBoundingClientRect()
      return {
        left: (rect.left - wrapRect.left) / wrapRect.width,
        right: (rect.right - wrapRect.left) / wrapRect.width,
        top: (rect.top - wrapRect.top) / wrapRect.height,
        bottom: (rect.bottom - wrapRect.top) / wrapRect.height,
      }
    })
    const thickness = strokePixels(drawing.strokeWidth, wrapRect.width, wrapRect.height) / 2
    const covered = coveredPdfTextBoxes(boxes, pdfStrokePoints(drawing), thickness / wrapRect.width, thickness / wrapRect.height)
    return joinPdfHighlightQuote(covered.map(({ index, from, to }) => sliceSpanText(spans[index], wrapRect, from, to)))
  }

  function withHighlightQuote(drawing: PdfStrokeDrawing): PdfStrokeDrawing {
    return drawing.kind === 'highlight' ? { ...drawing, quote: highlightQuote(drawing) } : drawing
  }

  function selectionElement(node: Node): Element | null {
    return node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement
  }

  // Bloc de surlignage en cours : surligner un paragraphe se fait souvent en plusieurs
  // passes (une par ligne). Tant qu'elles s'enchaînent — même page, même couleur, même
  // outil — elles nourrissent le MÊME objet, qu'on commente et supprime d'un bloc.
  // Toute autre action (outil, sélection, annuler, Échap) referme le bloc ; la fenêtre
  // de temps n'est qu'un garde-fou pour la pause longue, pas le mécanisme principal.
  const HIGHLIGHT_BLOCK_DELAY = 6_000
  let highlightBlock: { id: string; page: number; at: number } | null = null

  function mergeableHighlight(page: number, kind: 'text' | 'highlight'): PdfDrawing | null {
    const block = highlightBlock
    if (!block || block.page !== page || Date.now() - block.at > HIGHLIGHT_BLOCK_DELAY) return null
    const drawing = annotationManifest?.drawings.find((item) => item.id === block.id)
    if (!drawing || drawing.status !== 'active' || drawing.kind !== kind) return null
    return drawing.color === drawingColor && drawing.strokeWidth === drawingStrokeWidth ? drawing : null
  }

  function rememberHighlightBlock(id: string, page: number) {
    highlightBlock = { id, page, at: Date.now() }
  }

  function endHighlightBlock() {
    highlightBlock = null
  }

  function clampRect(rect: DOMRect, page: DOMRect): PdfDrawingRect | null {
    const left = Math.max(rect.left, page.left)
    const top = Math.max(rect.top, page.top)
    const right = Math.min(rect.right, page.right)
    const bottom = Math.min(rect.bottom, page.bottom)
    if (right <= left || bottom <= top || !page.width || !page.height) return null
    return {
      left: (left - page.left) / page.width,
      top: (top - page.top) / page.height,
      width: (right - left) / page.width,
      height: (bottom - top) / page.height,
    }
  }

  // Texte réellement couvert par un rectangle de surlignage : on retrouve les lignes
  // de la couche texte qu'il traverse et on les tronque à ses bords. La citation
  // décrit ainsi EXACTEMENT ce qui est peint — y compris après le bridage ci-dessous.
  function rectQuote(wrap: HTMLElement, wrapRect: DOMRect, rect: PdfDrawingRect): string {
    const layer = wrap.querySelector<HTMLElement>('.textLayer')
    if (!layer) return ''
    const middle = (rect.top + rect.height / 2) * wrapRect.height + wrapRect.top
    const parts: string[] = []
    for (const span of layer.querySelectorAll<HTMLElement>('span')) {
      if (span.firstChild?.nodeType !== Node.TEXT_NODE) continue
      const box = span.getBoundingClientRect()
      if (!box.height || middle < box.top || middle > box.bottom) continue
      parts.push(sliceSpanText(span, wrapRect, rect.left, rect.left + rect.width))
    }
    return joinPdfHighlightQuote(parts)
  }

  // Surligneur de texte : le geste EST une sélection de texte, donc le trait épouse
  // les lignes (un rectangle par ligne) et cite exactement les mots couverts. Posé au
  // relâchement, sans menu intermédiaire — l'outil dit déjà ce qu'on veut faire.
  // Géométrie du surlignage à venir, dans le repère de la page. Partagée par l'aperçu
  // et par l'enregistrement : ce qu'on montre pendant le geste EST ce qui sera posé.
  function selectionHighlight(sweep: { from: number; to: number } | null) {
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null
    const range = selection.getRangeAt(0)
    const layer = selectionElement(range.commonAncestorContainer)?.closest('.textLayer')
      ?? selectionElement(range.startContainer)?.closest('.textLayer')
    const wrap = layer?.closest<HTMLDivElement>('.pdf-page-wrap')
    if (!layer || !wrap || !container?.contains(wrap)) return null
    // Une sélection qui déborde sur la page suivante est ramenée à sa page de départ :
    // les rectangles n'ont de sens que dans le repère d'UNE page. Sans ce recadrage,
    // le geste ne produirait rien du tout — échec muet.
    const pageRange = range.cloneRange()
    if (!layer.contains(range.endContainer)) pageRange.setEnd(layer, layer.childNodes.length)
    const pageRect = wrap.getBoundingClientRect()
    const rects = Array.from(pageRange.getClientRects())
      // La sélection du navigateur déborde volontiers d'une ligne : dès que le pointeur
      // dépasse la fin d'une ligne, elle avale la suivante. On ne garde donc que les
      // lignes que la souris a VRAIMENT balayées, verticalement.
      .filter((rect) => !sweep || (rect.top + rect.bottom) / 2 >= sweep.from - rect.height * 0.6)
      .filter((rect) => !sweep || (rect.top + rect.bottom) / 2 <= sweep.to + rect.height * 0.6)
      .map((rect) => clampRect(rect, pageRect))
      .filter((rect): rect is PdfDrawingRect => Boolean(rect))
    const lines = mergePdfLineRects(rects)
    return lines.length ? { page: Number(wrap.dataset.page), wrap, pageRect, rects: lines } : null
  }

  // Aperçu vivant : la sélection native du navigateur est masquée en mode surligneur
  // (elle montre un débordement qui ne sera PAS surligné), remplacée par le surlignage
  // exact, dessiné dans sa couche habituelle.
  function renderTextHighlightPreview(sweep: { from: number; to: number } | null) {
    const found = pointerMode === 'text' ? selectionHighlight(sweep) : null
    const previous = previewDrawing?.page
    previewDrawing = found && {
      id: PREVIEW_ID, kind: 'text', page: found.page, rects: found.rects, quote: '',
      color: drawingColor, strokeWidth: drawingStrokeWidth, comment: '',
      createdAt: PREVIEW_STAMP, updatedAt: PREVIEW_STAMP, status: 'active',
    }
    if (previous && previous !== found?.page) scheduleDrawingRender(previous)
    if (found) scheduleDrawingRender(found.page)
  }

  function clearTextHighlightPreview() {
    const page = previewDrawing?.page
    previewDrawing = null
    if (page) scheduleDrawingRender(page)
  }

  async function captureTextHighlight(sweep: { from: number; to: number } | null) {
    if (!annotationMode || pointerMode !== 'text' || savingAnnotation || !annotationManifest) return
    const found = selectionHighlight(sweep)
    // La sélection n'est effacée QUE si elle est la nôtre : sinon ce volet effaçait
    // celle que l'utilisateur venait de faire dans l'autre, rendant la copie impossible.
    if (!found) return
    window.getSelection()?.removeAllRanges()
    const { page, wrap, pageRect, rects } = found
    // Citation vide (texte pivoté, rectangles par caractère introuvables) : le
    // surlignage est posé quand même, comme sur une page scannée. L'aperçu venait de le
    // montrer — l'abandonner ici aurait été un échec muet.
    const quote = joinPdfHighlightQuote(rects.map((rect) => rectQuote(wrap, pageRect, rect)))
    try {
      // Plusieurs sélections d'affilée sur la même page forment UN bloc : c'est le
      // geste naturel pour surligner un paragraphe ligne à ligne.
      const block = mergeableHighlight(page, 'text')
      const next = block?.kind === 'text'
        ? appendPdfTextHighlightRects(block, rects, quote)
        : createPdfTextHighlightDrawing(page, rects, { quote, color: drawingColor })
      if (await commitAnnotationManifest(upsertPdfDrawing(annotationManifest, next))) {
        rememberHighlightBlock(next.id, page)
      }
    } catch {
      app.banner = {
        tone: 'warning',
        title: 'Carnet d’annotations rempli',
        message: 'Supprimez une annotation avant d’en ajouter une nouvelle.',
      }
    }
  }

  function drawingIdFromTarget(target: EventTarget | null): string | null {
    return target instanceof Element ? target.closest<SVGGElement>('[data-drawing-id]')?.dataset.drawingId ?? null : null
  }

  function cancelDrawingGesture() {
    const page = drawingGesture?.page
    drawingGesture = null
    previewDrawing = null
    if (page) scheduleDrawingRender(page)
  }

  async function deleteDrawing(id: string) {
    if (!annotationManifest || savingAnnotation) return
    selectedDrawingId = null
    await commitAnnotationManifest(removePdfDrawing(annotationManifest, id))
  }

  function handleDrawingPointerDown(event: PointerEvent, page: number, layer: SVGSVGElement) {
    if (!annotationMode || event.button !== 0 || savingAnnotation) return
    event.preventDefault()
    shell?.focus({ preventScroll: true })
    const point = drawingPoint(event, layer)
    const drawingId = drawingIdFromTarget(event.target)
    if (drawingTool === 'eraser') {
      if (drawingId) void deleteDrawing(drawingId)
      return
    }
    if (drawingTool === 'select') {
      selectedDrawingId = drawingId
      renderPdfDrawings()
      if (!drawingId) return
      const original = annotationManifest?.drawings.find((drawing) => drawing.id === drawingId)
      if (!original) return
      if (isDoublePress(drawingId)) {
        // Différé d'un tour : ouvrir la bulle DANS le pointerdown la ferait refermer
        // aussitôt par le gestionnaire global qui referme les surfaces au clic ailleurs.
        setTimeout(() => void openNoteBubble(original))
        return
      }
      if (original.kind === 'rectangle' || original.kind === 'ellipse') drawingShape = original.kind
      else if (isPdfStrokeDrawing(original)) inkMode = original.kind
      drawingGesture = { kind: 'move', pointerId: event.pointerId, page, start: point, original, drawing: original }
      previewDrawing = original
      try { layer.setPointerCapture(event.pointerId) } catch { /* capture indisponible hors geste natif */ }
      return
    }
    const now = new Date().toISOString()
    if (drawingTool === 'pen') {
      const base = {
        id: globalThis.crypto.randomUUID(), page, strokes: [[point]], color: drawingColor,
        strokeWidth: drawingStrokeWidth, comment: '', createdAt: now, updatedAt: now, status: 'active' as const,
      }
      const drawing: PdfStrokeDrawing = inkMode === 'highlight'
        ? { ...base, kind: 'highlight', quote: '' }
        : { ...base, kind: 'ink' }
      drawingGesture = { kind: 'stroke', pointerId: event.pointerId, page, drawing }
      previewDrawing = drawing
    } else {
      const drawing: PdfShapeDrawing = {
        id: globalThis.crypto.randomUUID(), kind: drawingShape, page, left: point.x, top: point.y, width: 0, height: 0,
        color: drawingColor, strokeWidth: drawingStrokeWidth, comment: '', createdAt: now, updatedAt: now, status: 'active',
      }
      drawingGesture = { kind: 'shape', pointerId: event.pointerId, page, start: point, drawing }
      previewDrawing = drawing
    }
    selectedDrawingId = null
    try { layer.setPointerCapture(event.pointerId) } catch { /* capture indisponible hors geste natif */ }
    scheduleDrawingRender(page)
  }

  function handleDrawingPointerMove(event: PointerEvent, layer: SVGSVGElement) {
    const gesture = drawingGesture
    if (!gesture || gesture.pointerId !== event.pointerId) return
    event.preventDefault()
    if (gesture.kind === 'stroke') {
      const coalesced = event.getCoalescedEvents?.()
      const events = coalesced?.length ? coalesced : [event]
      gesture.drawing = {
        ...gesture.drawing,
        strokes: [extendPdfDrawingPoints(gesture.drawing.strokes[0] ?? [], events.map((sample) => drawingPoint(sample, layer)))],
      }
    } else if (gesture.kind === 'shape') {
      const point = drawingPoint(event, layer)
      gesture.drawing = {
        ...gesture.drawing,
        left: Math.min(gesture.start.x, point.x),
        top: Math.min(gesture.start.y, point.y),
        width: Math.abs(gesture.start.x - point.x),
        height: Math.abs(gesture.start.y - point.y),
      }
    } else {
      const point = drawingPoint(event, layer)
      gesture.drawing = translatePdfDrawing(gesture.original, { x: point.x - gesture.start.x, y: point.y - gesture.start.y })
    }
    previewDrawing = gesture.drawing
    scheduleDrawingRender(gesture.page)
  }

  async function handleDrawingPointerUp(event: PointerEvent, layer: SVGSVGElement) {
    const gesture = drawingGesture
    if (!gesture || gesture.pointerId !== event.pointerId || !annotationManifest) return
    if (layer.hasPointerCapture(event.pointerId)) layer.releasePointerCapture(event.pointerId)
    drawingGesture = null
    previewDrawing = null
    let drawing: PdfDrawing | null = gesture.drawing
    let block = false
    if (gesture.kind === 'stroke') {
      // `fit` et non `simplify` : un tracé au-delà du plafond serait tronqué à la
      // relecture du manifeste, donc reviendrait amputé au prochain démarrage.
      // Lissage symétrique AU COMMIT : le geste est terminé, on peut donc regarder de
      // part et d'autre de chaque point et retirer le tremblement sans retarder le trait.
      const stroke = fitPdfDrawingPoints(smoothPdfDrawingStroke(gesture.drawing.strokes[0] ?? []))
      if (stroke.length < 2) {
        drawing = null
      } else if (gesture.drawing.kind === 'highlight') {
        // Passes consécutives = un seul bloc, comme pour le surligneur de texte.
        const previous = mergeableHighlight(gesture.page, 'highlight')
        drawing = withHighlightQuote(previous?.kind === 'highlight'
          ? appendPdfStroke(previous, stroke)
          : { ...gesture.drawing, strokes: [stroke], updatedAt: new Date().toISOString() })
        block = true
      } else {
        drawing = { ...gesture.drawing, strokes: [stroke], updatedAt: new Date().toISOString() }
      }
    } else if (gesture.kind === 'shape') {
      try {
        drawing = createPdfShapeDrawing(gesture.page, gesture.start, drawingPoint(event, layer), gesture.drawing.kind, {
          id: gesture.drawing.id, now: gesture.drawing.createdAt, color: gesture.drawing.color, strokeWidth: gesture.drawing.strokeWidth,
          comment: gesture.drawing.comment,
        })
      } catch {
        drawing = null
      }
    } else if (JSON.stringify(gesture.drawing) === JSON.stringify(gesture.original)) {
      drawing = null
    } else if (isPdfStrokeDrawing(gesture.drawing)) {
      // Un surlignage déplacé ne recouvre plus le même texte : sa citation doit suivre,
      // sinon le carnet cite un passage que le trait ne touche plus.
      drawing = withHighlightQuote(gesture.drawing)
    }
    renderPdfDrawingsForPage(gesture.page)
    if (!drawing) return
    if (!block) endHighlightBlock()
    selectedDrawingId = gesture.kind === 'move' ? drawing.id : null
    try {
      if (await commitAnnotationManifest(upsertPdfDrawing(annotationManifest, drawing)) && block) {
        rememberHighlightBlock(drawing.id, gesture.page)
      }
    } catch {
      app.banner = { tone: 'warning', title: 'Carnet de dessins rempli', message: 'Supprimez un dessin avant d’en ajouter un nouveau.' }
    }
  }

  // Le zoom ne touche qu'à la mise en page : la bulle et les menus sont refermés
  // (leurs coordonnées deviendraient fausses), le carnet et les tracés suivent.
  function applyZoom(next: number) {
    const value = clampPdfZoom(next)
    if (value === zoom) return
    zoom = value
    closeNoteBubble()
    requestFit()
  }

  function zoomBy(direction: 1 | -1) {
    applyZoom(stepPdfZoom(zoom, direction))
  }

  function resetZoom() {
    applyZoom(1)
  }

  function closeToolMenus() {
    drawingPaletteOpen = false
    drawingStrokeMenuOpen = false
    drawingShapeMenuOpen = false
    drawingInkMenuOpen = false
  }

  function setDrawingTool(tool: typeof drawingTool) {
    drawingTool = tool
    if (tool !== 'select') {
      selectedDrawingId = null
      window.getSelection()?.removeAllRanges()
    }
    closeNoteBubble()
    endHighlightBlock()
    cancelDrawingGesture()
    renderPdfDrawings()
  }

  // Le style courant appartient soit au tracé sélectionné, soit à la famille d'outil.
  // On écrit toujours dans la famille : le prochain geste reprend le dernier choix,
  // même s'il a été fait en éditant un tracé existant.
  async function applyDrawingStyle(patch: Partial<{ color: string; strokeWidth: number }>) {
    Object.assign(toolStyles[paletteKind], patch)
    const selected = selectedDrawing
    if (!annotationManifest || !selected || savingAnnotation) return
    if (Object.entries(patch).every(([key, value]) => selected[key as 'color' | 'strokeWidth'] === value)) return
    await commitAnnotationManifest(upsertPdfDrawing(annotationManifest, {
      ...selected,
      ...patch,
      updatedAt: new Date().toISOString(),
    }))
  }

  async function chooseDrawingColor(color: string) {
    drawingPaletteOpen = false
    await applyDrawingStyle({ color })
  }

  async function chooseDrawingStrokeWidth(strokeWidth: number) {
    drawingStrokeMenuOpen = false
    await applyDrawingStyle({ strokeWidth })
  }

  // Un menu d'outil sert à DEUX choses : convertir l'objet sélectionné, ou choisir ce
  // que produira le prochain geste. Sans ce partage, choisir « Crayon » alors qu'un
  // crayon est déjà sélectionné ne ferait rien du tout — cul-de-sac.
  async function chooseDrawingShape(shape: PdfShapeKind) {
    drawingShape = shape
    drawingShapeMenuOpen = false
    const selected = selectedDrawing
    if (!annotationManifest || !selected || savingAnnotation || !isPdfShapeDrawing(selected) || selected.kind === shape) {
      setDrawingTool('shape')
      return
    }
    await commitAnnotationManifest(upsertPdfDrawing(annotationManifest, {
      ...selected,
      kind: shape,
      updatedAt: new Date().toISOString(),
    }))
  }

  // Crayon ↔ surligneur, exactement comme rectangle ↔ ellipse. La conversion reprend
  // le style de la famille d'arrivée — un surligneur noir de 4 px n'aurait aucun sens
  // — et recalcule la citation, puisque le trait couvre le même texte.
  async function chooseInkMode(mode: PdfInkMode) {
    inkMode = mode
    drawingInkMenuOpen = false
    const selected = selectedDrawing
    // Un surlignage de texte et un trait n'ont pas la même géométrie : seule la
    // conversion crayon ↔ surligneur libre a un sens.
    const convertible = selected && isPdfStrokeDrawing(selected) && mode !== 'text' && selected.kind !== mode
    if (!annotationManifest || !convertible || savingAnnotation) {
      setDrawingTool('pen')
      return
    }
    const base = { ...selected, ...toolStyles[mode], updatedAt: new Date().toISOString() }
    const converted: PdfStrokeDrawing = mode === 'highlight'
      ? withHighlightQuote({ ...base, kind: 'highlight', quote: '' })
      : { ...base, kind: 'ink' }
    await commitAnnotationManifest(upsertPdfDrawing(annotationManifest, converted))
  }

  function toggleAnnotationMode() {
    annotationMode = !annotationMode
    drawingTool = 'select'
    annotationListOpen = false
    closeNoteBubble()
    endHighlightBlock()
    closeToolMenus()
    selectedDrawingId = null
    cancelDrawingGesture()
    renderPdfDrawings()
    void tick().then(() => shell?.focus({ preventScroll: true }))
  }

  // Les surlignages sont désormais des tracés : cette passe ne pose plus que les
  // épingles de la gouttière, le dessin lui-même vivant dans les couches SVG.
  function renderAnnotationMarksForPage(page: number, force = false) {
    const wrap = pageWraps.get(page)
    if (!wrap) return
    renderPdfDrawingsForPage(page, force)
    wrap.querySelectorAll('.pdf-annotation-comment-pin').forEach((pin) => pin.remove())
    if (!force && !visibleAnnotationPages.has(page)) return
    const pageNotes = notes.filter((note) => note.page === page)
    for (const cluster of clusterPdfNotePins(pageNotes, wrap.clientHeight)) {
      const first = cluster[0]
      const pin = document.createElement('button')
      pin.type = 'button'
      pin.className = `pdf-annotation-comment-pin${cluster.length > 1 ? ' cluster' : ''}`
      pin.dataset.annotationId = first.id
      pin.style.top = `${Math.max(first.top, 0.015) * 100}%`
      if (cluster.length === 1) {
        const icon = document.createElement('span')
        icon.className = 'msr'
        icon.textContent = 'edit_note'
        pin.title = first.comment
        pin.setAttribute('aria-label', `Commentaire : ${first.comment}`)
        pin.appendChild(icon)
      } else {
        pin.textContent = String(cluster.length)
        pin.title = `${cluster.length} commentaires proches`
        pin.setAttribute('aria-label', `${cluster.length} commentaires proches`)
      }
      pin.addEventListener('click', (event) => {
        event.stopPropagation()
        // Une seule note : la bulle s'ouvre sur place. Plusieurs notes voisines : le
        // carnet, seul endroit qui peut les montrer côte à côte.
        const single = cluster.length === 1
          ? annotationManifest?.drawings.find((drawing) => drawing.id === first.id)
          : null
        if (single) void openNoteBubble(single)
        else void openNoteGroup(cluster)
      })
      wrap.appendChild(pin)
    }
  }

  function renderAnnotationMarks() {
    for (const page of pageWraps.keys()) renderAnnotationMarksForPage(page)
  }

  async function persistAnnotationManifest(next: PdfAnnotationManifest): Promise<boolean> {
    savingAnnotation = true
    try {
      // Carnet existant illisible : on le met à l'abri AVANT d'écrire par-dessus, et on
      // le dit. Un simple retour à une version antérieure de Doku ne doit pas détruire
      // le travail accumulé.
      if (unreadableManifest) {
        const kept = await keepPdfAnnotationManifestAside(next.document.key, new Date().toISOString().replace(/[:.]/g, '-'))
        unreadableManifest = false
        app.banner = kept
          ? {
            tone: 'warning',
            title: 'Ancien carnet illisible mis de côté',
            message: 'Doku n’a pas su relire les annotations existantes de ce PDF. Elles sont conservées telles quelles à côté du nouveau carnet.',
          }
          : {
            tone: 'error',
            title: 'Ancien carnet illisible',
            message: 'Doku n’a pas su relire les annotations existantes de ce PDF, ni les mettre à l’abri. Annotation interrompue pour ne rien écraser.',
          }
        if (!kept) return false
      }
      await writePdfAnnotationManifest(next.document.key, JSON.stringify(next))
      annotationManifest = next
      staleAnnotations = next.drawings.some((drawing) => drawing.status === 'orphaned')
      // Un annuler ou un coup de gomme peut faire disparaître le dessin sélectionné :
      // garder son id laisserait les contrôles couleur/épaisseur ouverts sur un objet
      // qui n'existe plus (commande sans effet).
      if (selectedDrawingId && !next.drawings.some((drawing) => drawing.id === selectedDrawingId && drawing.status === 'active')) {
        selectedDrawingId = null
      }
      renderAnnotationMarks()
      repositionNoteBubble()
      await tick()
      requestFit()
      return true
    } catch (error) {
      // La CAUSE, pas seulement le fait. Un `catch {}` muet ici a coûté un aller-retour
      // complet au premier essai sous Linux : « n'a pas pu sauvegarder » couvre aussi bien
      // un disque plein qu'un refus de permission ou un chemin hors périmètre, et ni
      // l'utilisateur ni nous ne pouvions les distinguer.
      const raison = error instanceof Error ? error.message : String(error)
      console.error('[pdf] annotation non enregistrée', error)
      app.banner = {
        tone: 'error',
        title: 'Annotation non enregistrée',
        message: `Doku n’a pas pu sauvegarder cette annotation localement : ${raison}`,
      }
      return false
    } finally {
      savingAnnotation = false
    }
  }

  async function commitAnnotationManifest(next: PdfAnnotationManifest): Promise<boolean> {
    if (!annotationManifest) return false
    const previous: PdfAnnotationManifest = annotationManifest
    if (!await persistAnnotationManifest(next)) return false
    undoStack = [...undoStack.slice(-49), previous]
    redoStack = []
    shell?.focus({ preventScroll: true })
    return true
  }

  async function deleteNote(note: PdfNote) {
    if (!annotationManifest || savingAnnotation) return
    if (editingNoteId === note.id) editingNoteId = null
    await commitAnnotationManifest(removePdfDrawing(annotationManifest, note.id))
  }

  async function purgeOrphanedDrawings() {
    if (!annotationManifest || savingAnnotation) return
    const next = removeOrphanedPdfDrawings(annotationManifest)
    if (!await commitAnnotationManifest(next)) return
    if (!pdfNotes(next).length) annotationListOpen = false
  }

  async function undoAnnotation() {
    endHighlightBlock()
    if (!annotationManifest || savingAnnotation || undoStack.length === 0) return
    const previous = undoStack.at(-1)!
    const current = annotationManifest
    if (!await persistAnnotationManifest(previous)) return
    undoStack = undoStack.slice(0, -1)
    redoStack = [...redoStack.slice(-49), current]
    shell?.focus({ preventScroll: true })
  }

  async function redoAnnotation() {
    endHighlightBlock()
    if (!annotationManifest || savingAnnotation || redoStack.length === 0) return
    const next = redoStack.at(-1)!
    const current = annotationManifest
    if (!await persistAnnotationManifest(next)) return
    redoStack = redoStack.slice(0, -1)
    undoStack = [...undoStack.slice(-49), current]
    shell?.focus({ preventScroll: true })
  }

  // Les écouteurs Échap/raccourcis vivent sur `document` : en espace scindé, deux
  // lecteurs PDF (ou un lecteur et un éditeur) les reçoivent tous. Ce volet ne répond
  // que s'il est le volet actif ET que le focus est chez lui ou nulle part (une
  // sélection de texte à la souris laisse le focus sur `body`).
  function ownsGlobalKeys(): boolean {
    if (workspace.activePaneId !== paneId) return false
    const active = document.activeElement
    return !active || active === document.body || Boolean(shell?.contains(active))
  }

  // Cible en cours de saisie : AUCUN raccourci de la vue ne doit s'y appliquer. Sans
  // ce garde, un retour arrière dans la bulle de note supprimait l'annotation ET sa
  // note au lieu d'effacer un caractère — la bulle vit dans le shell, donc le volet
  // se croyait légitime.
  function isTypingTarget(target: EventTarget | null): boolean {
    return target instanceof HTMLInputElement
      || target instanceof HTMLTextAreaElement
      || (target instanceof HTMLElement && target.isContentEditable)
  }

  function handleAnnotationShortcut(event: KeyboardEvent) {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return
    if (isTypingTarget(event.target)) return
    const key = event.key.toLowerCase()
    if (key === 'z' && event.shiftKey) {
      if (!redoStack.length) return
      event.preventDefault()
      void redoAnnotation()
    } else if (key === 'z') {
      if (!undoStack.length) return
      event.preventDefault()
      void undoAnnotation()
    } else if (key === 'y') {
      if (!redoStack.length) return
      event.preventDefault()
      void redoAnnotation()
    }
  }

  async function openNoteGroup(group: PdfNote[]) {
    if (!group.length) return
    activeNoteIds = group.map((note) => note.id)
    annotationListOpen = true
    await tick()
    const item = shell?.querySelector<HTMLElement>(`[data-annotation-item="${CSS.escape(group[0].id)}"]`)
    item?.scrollIntoView({ block: 'nearest' })
    item?.querySelector<HTMLElement>('.annotation-body')?.focus({ preventScroll: true })
  }

  async function startNoteEdit(note: PdfNote) {
    activeNoteIds = [note.id]
    editingNoteId = note.id
    noteEditDraft = note.comment
    annotationListOpen = true
    await tick()
    noteEditInput?.focus({ preventScroll: true })
    shell?.querySelector<HTMLElement>(`[data-annotation-item="${CSS.escape(note.id)}"]`)?.scrollIntoView({ block: 'nearest' })
  }

  // Bulle de note : la note vit SUR l'annotation, pas dans un panneau à côté. Elle est
  // posée dans le repère de contenu du lecteur (pas de l'écran), donc elle suit
  // naturellement le défilement sans écouteur de scroll.
  const NOTE_BUBBLE_WIDTH = 272
  const NOTE_BUBBLE_MARGIN = 12

  function noteBubbleAnchor(drawing: PdfDrawing) {
    const wrap = pageWraps.get(drawing.page)
    const view = container
    if (!wrap || !view) return null
    const width = Math.max(wrap.clientWidth, 1)
    const height = Math.max(wrap.clientHeight, 1)
    const box = pdfDrawingBox(drawing)
    const centre = wrap.offsetLeft + (box.left + box.width / 2) * width
    // On borne les ARÊTES de la bulle, pas son centre : centrée sur une annotation
    // proche d'un bord, une bulle de 272 px déborderait de 136 px et serait tronquée.
    // Même largeur qu'en CSS, sinon le calcul et le rendu divergeraient.
    const half = Math.min(NOTE_BUBBLE_WIDTH, Math.max(view.clientWidth - 32, 160)) / 2
    // Bornes dans le repère du CONTENU (celui de `left`), pas de la fenêtre visible :
    // zoomé, `wrap.offsetLeft` dépasse largement `clientWidth`, et borner sur la
    // fenêtre plaquait la bulle à des centaines de pixels à gauche de son tracé.
    const span = Math.max(view.scrollWidth, view.clientWidth)
    const lowest = NOTE_BUBBLE_MARGIN + half
    const highest = Math.max(lowest, span - NOTE_BUBBLE_MARGIN - half)
    const left = Math.min(Math.max(centre, lowest), highest)
    return {
      id: drawing.id,
      page: drawing.page,
      left,
      top: wrap.offsetTop + (box.top + box.height) * height + 12,
      // La queue rattrape le décalage pour continuer à désigner l'annotation, sans
      // sortir de la zone plate de la bulle (les angles sont arrondis).
      tail: Math.min(Math.max(centre - left, -(half - 20)), half - 20),
    }
  }

  async function openNoteBubble(drawing: PdfDrawing) {
    const anchor = noteBubbleAnchor(drawing)
    if (!anchor) return
    noteBubble = anchor
    noteBubbleDraft = drawing.comment
    editingNoteId = null
    if (drawing.comment) {
      noteBubbleEditing = false
      return
    }
    await editNoteBubble()
  }

  async function editNoteBubble() {
    noteBubbleEditing = true
    await tick()
    noteBubbleInput?.focus({ preventScroll: true })
    // Curseur en fin de note : une sélection totale ferait tout perdre à la frappe.
    noteBubbleInput?.setSelectionRange(noteBubbleDraft.length, noteBubbleDraft.length)
  }

  function closeNoteBubble() {
    noteBubble = null
    noteBubbleDraft = ''
    noteBubbleEditing = false
  }

  function repositionNoteBubble() {
    const open = noteBubble
    const drawing = open && annotationManifest?.drawings.find((item) => item.id === open.id)
    if (!open) return
    if (!drawing || drawing.status !== 'active') {
      closeNoteBubble()
      return
    }
    noteBubble = noteBubbleAnchor(drawing) ?? null
  }

  async function saveNoteBubble() {
    const open = noteBubble
    if (!open || !annotationManifest || savingAnnotation) return
    const drawing = annotationManifest.drawings.find((item) => item.id === open.id)
    if (!drawing) return closeNoteBubble()
    if (noteBubbleDraft.trim() === drawing.comment) return closeNoteBubble()
    if (await commitAnnotationManifest(updatePdfDrawingComment(annotationManifest, open.id, noteBubbleDraft))) {
      closeNoteBubble()
    }
  }

  function handleNoteBubbleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      closeNoteBubble()
    } else if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault()
      void saveNoteBubble()
    }
  }


  // Double-clic sur un tracé = le commenter. Détecté à la main sur `pointerdown` : le
  // `preventDefault()` du geste supprime les événements souris de compatibilité, donc
  // un écouteur `dblclick` ne serait JAMAIS appelé sur cette couche.
  const DOUBLE_PRESS_DELAY = 400
  let lastPress: { id: string; at: number } | null = null

  function isDoublePress(id: string): boolean {
    const now = Date.now()
    const repeat = Boolean(lastPress && lastPress.id === id && now - lastPress.at < DOUBLE_PRESS_DELAY)
    lastPress = repeat ? null : { id, at: now }
    return repeat
  }

  async function cancelNoteEdit(id: string) {
    editingNoteId = null
    noteEditDraft = ''
    await tick()
    shell?.querySelector<HTMLButtonElement>(`[data-annotation-edit="${CSS.escape(id)}"]`)?.focus({ preventScroll: true })
  }

  async function saveNoteEdit(note: PdfNote) {
    if (!annotationManifest || savingAnnotation) return
    if (noteEditDraft.trim() === note.comment) {
      await cancelNoteEdit(note.id)
      return
    }
    if (!await commitAnnotationManifest(updatePdfDrawingComment(annotationManifest, note.id, noteEditDraft))) return
    editingNoteId = null
    noteEditDraft = ''
    activeNoteIds = [note.id]
    await tick()
    shell?.querySelector<HTMLButtonElement>(`[data-annotation-edit="${CSS.escape(note.id)}"]`)?.focus({ preventScroll: true })
  }

  function handleNoteEditKeydown(event: KeyboardEvent, note: PdfNote) {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      void cancelNoteEdit(note.id)
    } else if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault()
      void saveNoteEdit(note)
    }
  }

  function revealNote(note: PdfNote) {
    const wrap = pageWraps.get(note.page)
    if (!wrap) return
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
    renderAnnotationMarksForPage(note.page, true)
    const targets = wrap.querySelectorAll<Element>(`[data-drawing-id="${CSS.escape(note.id)}"]`)
    // Centrer le TRACÉ, pas la page : une note en haut ou en bas d'une grande page
    // restait hors écran alors que la page, elle, était bien centrée.
    ;(targets[0] ?? wrap).scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' })
    targets.forEach((target) => {
      target.classList.remove('attention')
      requestAnimationFrame(() => target.classList.add('attention'))
    })
    annotationListOpen = false
    activeNoteIds = [note.id]
  }

  // Surligne les rectangles du passage cité dans le wrapper de la page (fractions 0..1 →
  // % du canvas, insensible au zoom/DPR). Éléments transitoires, retirés après le fondu.
  // Rend le PREMIER repère posé : c'est lui qu'il faut amener sous les yeux. Cadrer
  // sur la page laissait un extrait de bas de page hors écran.
  async function highlightPassage(wrap: HTMLElement, page: number, text: string): Promise<HTMLElement | null> {
    if (!pdf) return null
    const { getCitedRects } = await import('../lib/pdf')
    const rects = await getCitedRects(pdf, page, text).catch(() => [])
    if (!rects.length) return null
    const marks: HTMLElement[] = []
    for (const r of rects) {
      const m = document.createElement('div')
      m.className = 'pdf-cite-mark'
      m.style.left = `${r.left * 100}%`
      m.style.top = `${r.top * 100}%`
      m.style.width = `${r.width * 100}%`
      m.style.height = `${r.height * 100}%`
      wrap.appendChild(m)
      marks.push(m)
    }
    setTimeout(() => marks.forEach((m) => m.remove()), 4200)
    return marks[0] ?? null
  }

  // Révélation d'une page citée (citations ancrées sur PDF). Les canvases sont créés
  // en boucle asynchrone après le montage : on réessaie jusqu'à ce que la page existe
  // (borné — un PDF corrompu ne doit pas faire boucler à vide).
  let revealTimer: ReturnType<typeof setTimeout> | undefined
  $effect(() => {
    const reveal = app.pendingPdfReveal
    if (!reveal || reveal.path !== path) return
    let tries = 0
    const attempt = () => {
      const canvas = container?.querySelector(`canvas.pdf-page[data-page="${reveal.page}"]`)
      if (canvas) {
        app.pendingPdfReveal = null
        const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
        canvas.scrollIntoView({ block: 'start', behavior: reduced ? 'auto' : 'smooth' })
        const wrap = canvas.parentElement
        const fallbackHalo = () => {
          canvas.classList.add('pdf-page-cited')
          setTimeout(() => canvas.classList.remove('pdf-page-cited'), 1800)
        }
        // Surlignage précis si le passage est fourni ET retrouvé ; sinon halo de page.
        // Second cadrage une fois le passage localisé : le premier (haut de page) sert de
        // retour immédiat pendant la recherche des rectangles, mais il n'est le bon que si
        // le passage est en tête de page. Sinon on recentre sur le surlignage.
        if (reveal.text && wrap) {
          void highlightPassage(wrap, reveal.page, reveal.text).then((mark) => {
            if (mark) mark.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' })
            else fallbackHalo()
          })
        } else {
          fallbackHalo()
        }
        return
      }
      if (++tries < 50) revealTimer = setTimeout(attempt, 100) // ≤ 5 s : pages en cours de création
      else app.pendingPdfReveal = null
    }
    attempt()
    return () => clearTimeout(revealTimer)
  })

  onMount(() => {
    let cancelled = false
    let destroyPdf: (() => Promise<void>) | null = null
    let observer: IntersectionObserver | null = null
    let resizeObserver: ResizeObserver | null = null
    let fitFrame = 0
    let rerenderTimer: ReturnType<typeof setTimeout> | undefined
    const host = container!
    const closeTransientUi = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null
      // Cliquer l'annotation qui PORTE la bulle ne la referme pas : sinon le second
      // appui d'un double-clic refermerait la bulle que le premier vient d'ouvrir.
      const onOwnDrawing = Boolean(noteBubble) && drawingIdFromTarget(event.target) === noteBubble?.id
      if (noteBubble && !onOwnDrawing && !target?.closest('.note-bubble')) {
        // Une note en cours de frappe est ENREGISTRÉE, jamais jetée : rien dans
        // l'historique ne pourrait la rattraper (il ne contient que des manifestes
        // déjà commités), et un simple clic pour faire défiler suffisait à la perdre.
        if (noteBubbleEditing) void saveNoteBubble()
        else closeNoteBubble()
      }
      if (annotationListOpen && !target?.closest('.annotation-list') && !target?.closest('.annotation-toggle')) {
        annotationListOpen = false
      }
      // En mode « désigner », la couche de dessin ne reçoit pas les clics du fond de
      // page : sans ceci, une sélection ne se défaisait JAMAIS au clic ailleurs.
      if (selectedDrawingId && !drawingIdFromTarget(event.target) && !target?.closest('.drawing-toolbar') && !target?.closest('.note-bubble')) {
        selectedDrawingId = null
        renderPdfDrawings()
      }
      if (drawingPaletteOpen && !target?.closest('.drawing-color-menu') && !target?.closest('.drawing-color-toggle')) {
        drawingPaletteOpen = false
      }
      if (drawingStrokeMenuOpen && !target?.closest('.drawing-stroke-menu') && !target?.closest('.drawing-stroke-toggle')) {
        drawingStrokeMenuOpen = false
      }
      if (drawingShapeMenuOpen && !target?.closest('.drawing-shape-menu') && !target?.closest('.drawing-shape-toggle')) {
        drawingShapeMenuOpen = false
      }
      if (drawingInkMenuOpen && !target?.closest('.drawing-ink-menu') && !target?.closest('.drawing-ink-toggle')) {
        drawingInkMenuOpen = false
      }
    }
    // Échap épluche UNE couche à la fois, de la plus éphémère à la plus durable :
    // sans cette cascade, fermer un menu d'outil faisait AUSSI sortir du mode Annoter
    // dans la même pression (toutes les branches s'exécutaient d'affilée).
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !ownsGlobalKeys()) return
      if (drawingGesture) {
        cancelDrawingGesture()
      } else if (noteBubble) {
        closeNoteBubble()
      } else if (drawingPaletteOpen || drawingStrokeMenuOpen || drawingShapeMenuOpen || drawingInkMenuOpen) {
        closeToolMenus()
      } else if (annotationListOpen) {
        annotationListOpen = false
      } else if (selectedDrawingId) {
        selectedDrawingId = null
        renderPdfDrawings()
      } else if (annotationMode) {
        toggleAnnotationMode()
      }
    }
    // Ctrl + molette : le zoom du document, pas celui de la fenêtre — d'où le
    // preventDefault. Un cran par impulsion, avec un délai minimal : sinon un pavé
    // tactile (qui émet des dizaines d'événements par pincement) traverse toute
    // l'échelle d'un coup.
    let lastWheelZoom = 0
    const handleWheelZoom = (event: WheelEvent) => {
      if (!event.ctrlKey || !event.deltaY) return
      event.preventDefault()
      const now = Date.now()
      if (now - lastWheelZoom < 110) return
      lastWheelZoom = now
      zoomBy(event.deltaY < 0 ? 1 : -1)
    }
    const handleShortcuts = (event: KeyboardEvent) => {
      if (!ownsGlobalKeys() || isTypingTarget(event.target)) return
      if ((event.ctrlKey || event.metaKey) && !event.altKey) {
        if (event.key === '0') {
          event.preventDefault()
          resetZoom()
          return
        }
        if (event.key === '+' || event.key === '=') {
          event.preventDefault()
          zoomBy(1)
          return
        }
        if (event.key === '-') {
          event.preventDefault()
          zoomBy(-1)
          return
        }
      }
      if (annotationMode && selectedDrawingId && (event.key === 'Delete' || event.key === 'Backspace')) {
        event.preventDefault()
        void deleteDrawing(selectedDrawingId)
        return
      }
      handleAnnotationShortcut(event)
    }
    // On mémorise la bande verticale réellement balayée par la souris : c'est elle qui
    // borne la sélection, pas les caprices du navigateur en bout de ligne.
    let sweepFrom: number | null = null
    let sweepTo = 0
    let previewFrame = 0
    const sweepBand = (from: number, to: number) => ({ from: Math.min(from, to), to: Math.max(from, to) })
    const startSweep = (event: MouseEvent) => {
      sweepFrom = event.clientY
      sweepTo = event.clientY
    }
    const trackSweep = (event: MouseEvent) => {
      if (sweepFrom === null || pointerMode !== 'text') return
      sweepTo = event.clientY
      // Une frame suffit : la sélection ne bouge pas plus vite que l'écran.
      if (previewFrame) return
      previewFrame = requestAnimationFrame(() => {
        previewFrame = 0
        if (sweepFrom !== null) renderTextHighlightPreview(sweepBand(sweepFrom, sweepTo))
      })
    }
    const finishTextHighlight = (event: MouseEvent) => {
      const from = sweepFrom
      sweepFrom = null
      if (previewFrame) cancelAnimationFrame(previewFrame)
      previewFrame = 0
      clearTextHighlightPreview()
      void captureTextHighlight(from === null ? null : sweepBand(from, event.clientY))
    }
    host.addEventListener('wheel', handleWheelZoom, { passive: false })
    host.addEventListener('mousedown', startSweep)
    host.addEventListener('mousemove', trackSweep)
    // Relâchement écouté sur le DOCUMENT, en phase de CAPTURE : lâcher la souris hors
    // de la page laissait sinon l'aperçu figé à l'écran, sans rien enregistrer — et un
    // composant traversé en chemin peut couper la propagation avant le document. La
    // géométrie est de toute façon revérifiée (la sélection doit être dans CE lecteur).
    document.addEventListener('mouseup', finishTextHighlight, true)
    document.addEventListener('pointerdown', closeTransientUi)
    document.addEventListener('keydown', closeOnEscape)
    document.addEventListener('keydown', handleShortcuts)

    interface PageView {
      baseWidth: number
      baseHeight: number
      wrap: HTMLDivElement
      canvas: HTMLCanvasElement
      targetScale: number
      targetCssScale: number
      textLayer: HTMLDivElement
      textLayerInstance: TextLayer | null
    }

    const pages = new Map<number, PageView>()
    const visiblePages = new Set<number>()
    const renderedScales = new Map<number, number>()
    const renderJobs = new Map<number, Promise<void>>()
    const textJobs = new Map<number, Promise<void>>()

    // Les pixels d'une page ne sont JAMAIS rendus. Sans cette purge, parcourir un long
    // document à fort zoom accumule les backing stores (jusqu'à 16 Mpx par page depuis
    // le zoom, soit ~64 Mo) : quarante pages visitées suffisent à mettre à genoux une
    // tablette 16 Go. On garde une fenêtre autour de ce qui est visible ; une page
    // revisitée est re-rendue, coût déjà amorti par le re-rendu différé.
    const KEEP_AROUND = 2
    function releaseDistantCanvases() {
      if (!visiblePages.size) return
      const lowest = Math.min(...visiblePages) - KEEP_AROUND
      const highest = Math.max(...visiblePages) + KEEP_AROUND
      for (const [pageNumber, page] of pages) {
        if (pageNumber >= lowest && pageNumber <= highest) continue
        if (page.canvas.width <= 1 && page.canvas.height <= 1) continue
        if (renderJobs.has(pageNumber)) continue
        page.canvas.width = 1
        page.canvas.height = 1
        renderedScales.delete(pageNumber)
        page.textLayerInstance?.cancel()
        page.textLayerInstance = null
        page.textLayer.replaceChildren()
      }
    }

    async function ensureTextLayer(pageNumber: number) {
      const pageView = pages.get(pageNumber)
      const doc = pdf
      if (!pageView || !doc || cancelled || pageView.targetCssScale <= 0) return
      const running = textJobs.get(pageNumber)
      if (running) return running
      const scale = pageView.targetCssScale
      const job = (async () => {
        const pdfPage = await doc.getPage(pageNumber)
        try {
          const viewport = pdfPage.getViewport({ scale })
          pageView.wrap.style.setProperty('--scale-factor', String(viewport.scale))
          pageView.wrap.style.setProperty('--user-unit', String(viewport.userUnit))
          if (pageView.textLayerInstance) {
            pageView.textLayerInstance.update({ viewport })
          } else {
            const { TextLayer } = await import('pdfjs-dist')
            const layer = new TextLayer({
              textContentSource: await pdfPage.getTextContent(),
              container: pageView.textLayer,
              viewport,
            })
            pageView.textLayerInstance = layer
            await layer.render()
          }
        } finally {
          pdfPage.cleanup()
        }
      })()
      textJobs.set(pageNumber, job)
      try {
        await job
      } catch {
        pageView.textLayerInstance?.cancel()
        pageView.textLayerInstance = null
        pageView.textLayer.replaceChildren()
      } finally {
        if (textJobs.get(pageNumber) === job) textJobs.delete(pageNumber)
      }
      if (!cancelled && visiblePages.has(pageNumber) && Math.abs(pageView.targetCssScale - scale) >= 0.001) {
        void ensureTextLayer(pageNumber)
      }
    }

    async function ensureRendered(pageNumber: number) {
      const page = pages.get(pageNumber)
      const doc = pdf
      if (!page || !doc || cancelled || page.targetScale <= 0) return

      const running = renderJobs.get(pageNumber)
      if (running) {
        await running.catch(() => {})
        if (!cancelled && visiblePages.has(pageNumber)) void ensureRendered(pageNumber)
        return
      }

      const targetScale = page.targetScale
      const renderedScale = renderedScales.get(pageNumber)
      if (renderedScale !== undefined && Math.abs(renderedScale - targetScale) < 0.001) return

      const job = import('../lib/pdf')
        .then(({ renderPage }) => renderPage(doc, pageNumber, page.canvas, targetScale))
      renderJobs.set(pageNumber, job)
      try {
        await job
        if (!cancelled) renderedScales.set(pageNumber, targetScale)
      } catch {
        // Un redimensionnement peut rendre une échelle obsolète pendant un rendu. La
        // demande la plus récente est rejouée juste après, sans erreur visible.
      } finally {
        if (renderJobs.get(pageNumber) === job) renderJobs.delete(pageNumber)
      }

      if (!cancelled && visiblePages.has(pageNumber) && Math.abs(page.targetScale - targetScale) >= 0.001) {
        void ensureRendered(pageNumber)
      }
      if (!cancelled && visiblePages.has(pageNumber)) void ensureTextLayer(pageNumber)
    }

    function applyFit() {
      const host = container
      if (!host || cancelled || pages.size === 0 || host.clientWidth <= 0) return

      // Point horizontal gardé au centre : en zoomant, on reste sur la même colonne du
      // document au lieu d'être renvoyé au bord gauche.
      const overflow = host.scrollWidth - host.clientWidth
      const centre = overflow > 0 ? (host.scrollLeft + host.clientWidth / 2) / host.scrollWidth : 0.5

      let anchor: { page: PageView; progress: number } | null = null
      if (host.scrollTop > 0) {
        const scrollTop = host.scrollTop
        let current = pages.values().next().value as PageView | undefined
        for (const page of pages.values()) {
          if (page.wrap.offsetTop > scrollTop + 1) break
          current = page
        }
        if (current) {
          const height = Math.max(current.wrap.offsetHeight, 1)
          anchor = {
            page: current,
            progress: Math.min(Math.max((scrollTop - current.wrap.offsetTop) / height, 0), 1),
          }
        }
      }

      // Largeur mesurée au plancher : `clientWidth` est un entier arrondi alors que la
      // boîte de padding est fractionnaire (volet scindé). Arrondi vers le haut, la
      // page dépassait d'un demi-pixel — `safe center` basculait alors en `start` et
      // une scrollbar horizontale fantôme apparaissait.
      const available = Math.floor(host.getBoundingClientRect().width) - (host.offsetWidth - host.clientWidth)
      for (const page of pages.values()) {
        const fitted = fitPdfPage(
          available,
          annotationRailVisible ? 120 : 24,
          page.baseWidth,
          page.baseHeight,
          window.devicePixelRatio || 1,
          zoom,
        )
        page.targetScale = fitted.renderScale
        page.targetCssScale = fitted.cssWidth / page.baseWidth
        const cssWidth = `${fitted.cssWidth}px`
        const cssHeight = `${fitted.cssHeight}px`
        page.wrap.style.width = cssWidth
        page.wrap.style.height = cssHeight
        page.canvas.style.width = cssWidth
        page.canvas.style.height = cssHeight
        // La couche texte de pdf.js dimensionne SA PROPRE boîte à partir de cette
        // variable. Ne la poser que dans `ensureTextLayer` (débouncé, et seulement pour
        // les pages visibles) laissait une page revenue de zoom 400 % avec une couche
        // texte 4 fois trop large : elle gonflait la largeur défilante et poussait le
        // document hors de l'axe au retour à 100 %.
        page.wrap.style.setProperty('--scale-factor', String(page.targetCssScale))
      }

      if (anchor) {
        host.scrollTop = anchor.page.wrap.offsetTop + anchor.progress * anchor.page.wrap.offsetHeight
      }
      // Sans la branche `else`, le retour à une mise en page qui tient dépendait du
      // rognage du navigateur — donc du hasard.
      if (host.scrollWidth > host.clientWidth) {
        host.scrollLeft = centre * host.scrollWidth - host.clientWidth / 2
      } else {
        host.scrollLeft = 0
      }

      renderAnnotationMarks()
      repositionNoteBubble()

      clearTimeout(rerenderTimer)
      rerenderTimer = setTimeout(() => {
        for (const pageNumber of visiblePages) {
          void ensureRendered(pageNumber)
          void ensureTextLayer(pageNumber)
        }
      }, 140)
    }

    function scheduleFit() {
      if (fitFrame) cancelAnimationFrame(fitFrame)
      fitFrame = requestAnimationFrame(() => {
        fitFrame = 0
        applyFit()
      })
    }
    requestFit = scheduleFit

    ;(async () => {
      const bytes = sourceBytes ?? await readFileBytes(path)
      if (cancelled) return
      if (!bytes) {
        status = 'error'
        message = 'Lecture du fichier impossible.'
        return
      }
      try {
        const identity = await pdfAnnotationIdentity(path, bytes)
        const stored = await readPdfAnnotationManifest(identity.key)
        const parsed = parsePdfAnnotationManifest(stored, identity)
        const { loadPdf, pageSize } = await import('../lib/pdf')
        const loaded = await loadPdf(bytes)
        if (cancelled) {
          void loaded.destroy()
          return
        }
        pdf = loaded.doc
        destroyPdf = loaded.destroy
        annotationManifest = parsed.manifest
        unreadableManifest = parsed.unreadable
        staleAnnotations = parsed.stale
          || parsed.manifest.drawings.some((drawing) => drawing.status === 'orphaned')
        status = 'ready'

        observer = new IntersectionObserver(
          (entries) => {
            for (const e of entries) {
              const canvas = e.target as HTMLCanvasElement
              const n = Number(canvas.dataset.page)
              if (e.isIntersecting) {
                visiblePages.add(n)
                visibleAnnotationPages.add(n)
                renderAnnotationMarksForPage(n)
                void ensureRendered(n)
              } else {
                visiblePages.delete(n)
                visibleAnnotationPages.delete(n)
                renderAnnotationMarksForPage(n)
              }
            }
            releaseDistantCanvases()
          },
          { root: host, rootMargin: '300px' },
        )

        for (let n = 1; n <= pdf.numPages; n++) {
          if (cancelled) break
          const dims = await pageSize(pdf, n, 1)
          // Wrapper positionné : reçoit les surlignages de citation en overlay (%).
          const wrap = document.createElement('div')
          wrap.className = 'pdf-page-wrap'
          wrap.dataset.page = String(n)
          const canvas = document.createElement('canvas')
          canvas.className = 'pdf-page'
          canvas.dataset.page = String(n)
          canvas.width = Math.max(1, Math.round(dims.width))
          canvas.height = Math.max(1, Math.round(dims.height))
          const textLayer = document.createElement('div')
          textLayer.className = 'textLayer'
          // Couche du surligneur : SOUS la couche texte et fondue en multiply, pour
          // que le texte du canvas reste lisible au travers du trait.
          const highlightLayer = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
          highlightLayer.classList.add('pdf-highlight-layer')
          highlightLayer.dataset.page = String(n)
          highlightLayer.setAttribute('aria-hidden', 'true')
          const drawingLayer = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
          drawingLayer.classList.add('pdf-drawing-layer')
          drawingLayer.dataset.page = String(n)
          drawingLayer.setAttribute('aria-hidden', 'true')
          drawingLayer.addEventListener('pointerdown', (event) => handleDrawingPointerDown(event, n, drawingLayer))
          drawingLayer.addEventListener('pointermove', (event) => handleDrawingPointerMove(event, drawingLayer))
          drawingLayer.addEventListener('pointerup', (event) => void handleDrawingPointerUp(event, drawingLayer))
          drawingLayer.addEventListener('pointercancel', cancelDrawingGesture)
          wrap.append(canvas, highlightLayer, textLayer, drawingLayer)
          host.appendChild(wrap)
          pageWraps.set(n, wrap)
          pages.set(n, {
            baseWidth: dims.width,
            baseHeight: dims.height,
            wrap,
            canvas,
            targetScale: 0,
            targetCssScale: 0,
            textLayer,
            textLayerInstance: null,
          })
          observer.observe(canvas)
        }

        applyFit()
        renderAnnotationMarks()
        resizeObserver = new ResizeObserver(scheduleFit)
        resizeObserver.observe(host)
        window.addEventListener('resize', scheduleFit)
      } catch (err) {
        if (!cancelled) {
          status = 'error'
          message = String(err)
        }
      }
    })()

    return () => {
      cancelled = true
      observer?.disconnect()
      resizeObserver?.disconnect()
      window.removeEventListener('resize', scheduleFit)
      if (fitFrame) cancelAnimationFrame(fitFrame)
      if (drawingFrame) cancelAnimationFrame(drawingFrame)
      clearTimeout(rerenderTimer)
      if (requestFit === scheduleFit) requestFit = () => {}
      if (previewFrame) cancelAnimationFrame(previewFrame)
      host.removeEventListener('wheel', handleWheelZoom)
      host.removeEventListener('mousedown', startSweep)
      host.removeEventListener('mousemove', trackSweep)
      // Le drapeau de capture fait partie de l'IDENTITÉ de l'écouteur : l'omettre ici
      // ne retirait rien. L'instance morte continuait alors d'effacer la sélection de
      // texte à chaque clic, partout dans l'application.
      document.removeEventListener('mouseup', finishTextHighlight, true)
      document.removeEventListener('pointerdown', closeTransientUi)
      document.removeEventListener('keydown', closeOnEscape)
      document.removeEventListener('keydown', handleShortcuts)
      for (const page of pages.values()) page.textLayerInstance?.cancel()
      pageWraps.clear()
      visibleAnnotationPages.clear()
      pdf = null
      void destroyPdf?.()
    }
  })
</script>

<div
  class="pdf-shell"
  class:annotation-mode={annotationMode}
  data-pointer-mode={annotationMode ? pointerMode : 'read'}
  bind:this={shell}
  tabindex="-1"
  role="group"
  aria-label="Lecteur PDF"
>
  <div class="pdf-view" class:with-annotation-rail={annotationRailVisible} bind:this={container} role="document" aria-label="Document PDF">
    {#if status === 'loading'}
      <div class="pdf-state">Chargement du PDF…</div>
    {:else if status === 'error'}
      <div class="pdf-state pdf-error">Impossible d'afficher ce PDF. {message}</div>
    {/if}

    {#if noteBubble}
      <!-- Posée dans le repère du contenu défilant : elle reste collée à son annotation
           quand on fait défiler le document, sans écouteur de scroll. -->
      <div
        class="note-bubble"
        style={`left:${noteBubble.left}px;top:${noteBubble.top}px;--tail:${noteBubble.tail}px`}
        role="dialog"
        aria-label="Note de l’annotation"
      >
        {#if noteBubbleEditing}
          <textarea
            bind:this={noteBubbleInput}
            bind:value={noteBubbleDraft}
            maxlength="8000"
            rows="2"
            placeholder="Écrire une note…"
            onkeydown={handleNoteBubbleKeydown}
          ></textarea>
          <div class="note-bubble-actions">
            <button type="button" onclick={closeNoteBubble}>Fermer</button>
            <button
              class="primary round"
              type="button"
              title="Valider (Ctrl + Entrée)"
              aria-label="Valider la note"
              disabled={savingAnnotation}
              onclick={() => void saveNoteBubble()}
            >
              <span class="msr">check</span>
            </button>
          </div>
        {:else}
          <p class="note-bubble-text">{noteBubbleDraft}</p>
          <div class="note-bubble-actions">
            <button
              class="round"
              type="button"
              title="Modifier la note"
              aria-label="Modifier la note"
              onclick={() => void editNoteBubble()}
            >
              <span class="msr">edit_square</span>
            </button>
          </div>
        {/if}
      </div>
    {/if}
  </div>

  <div class="pdf-actions">
    <div class="zoom-control" role="group" aria-label="Zoom du document">
      <button
        aria-label="Réduire"
        title="Réduire (Ctrl + molette)"
        disabled={status !== 'ready' || zoom <= PDF_MIN_ZOOM}
        onclick={() => zoomBy(-1)}
      >
        <span class="msr">remove</span>
      </button>
      <!-- Le niveau n'apparaît qu'une fois zoomé : au repos il ne dirait rien, et
           c'est exactement là qu'il devient le bouton « revenir à la normale ». -->
      {#if zoom !== 1}
        <button class="zoom-level" title="Revenir à 100 % (Ctrl + 0)" onclick={resetZoom}>
          {Math.round(zoom * 100)} %
        </button>
      {/if}
      <button
        aria-label="Agrandir"
        title="Agrandir (Ctrl + molette)"
        disabled={status !== 'ready' || zoom >= PDF_MAX_ZOOM}
        onclick={() => zoomBy(1)}
      >
        <span class="msr">add</span>
      </button>
    </div>
    <button
      class="annotate-toggle"
      class:active={annotationMode}
      aria-label={annotationMode ? 'Terminer l’annotation' : 'Annoter le PDF'}
      aria-pressed={annotationMode}
      title={annotationMode ? 'Terminer l’annotation' : 'Annoter le PDF'}
      disabled={status !== 'ready'}
      onclick={toggleAnnotationMode}
    >
      <span class="msr">stylus</span>
      <span class="annotate-toggle-label">Annoter</span>
    </button>

  {#if notes.length || orphanedDrawings}
    <button
      class="annotation-toggle"
      class:active={annotationListOpen}
      aria-label="Afficher les annotations"
      aria-expanded={annotationListOpen}
      title="Annotations du PDF"
      onclick={() => annotationListOpen = !annotationListOpen}
    >
      <span class="msr">edit_note</span>
      <span>{notes.length + hiddenOrphanDrawings}</span>
    </button>
  {/if}
  </div>

  {#if annotationMode}
    <div class="drawing-toolbar" role="toolbar" aria-label="Outils d’annotation PDF">
      <div class="drawing-tools" aria-label="Outil actif">
        <button class:active={drawingTool === 'select'} aria-pressed={drawingTool === 'select'} title="Sélectionner du texte ou un dessin" aria-label="Sélectionner du texte ou un dessin" onclick={() => setDrawingTool('select')}>
          <span class="msr">near_me</span>
        </button>
        <div class="drawing-control">
          <button
            class="drawing-ink-toggle"
            class:active={drawingTool === 'pen' || drawingInkMenuOpen}
            aria-pressed={drawingTool === 'pen'}
            aria-expanded={drawingInkMenuOpen}
            title={inkModeLabel}
            aria-label={`Choisir le type de trait, outil sélectionné : ${inkModeLabel.toLowerCase()}`}
            onclick={() => {
              const open = !drawingInkMenuOpen
              closeToolMenus()
              drawingInkMenuOpen = open
              // Avec un tracé sélectionné, le bouton n'ouvre QUE le menu : basculer
              // d'outil déselectionnerait, et la conversion deviendrait inatteignable.
              if (!selectedDrawing) setDrawingTool('pen')
            }}
          >
            <span class="msr">{inkModeIcon}</span>
            <span class="msr control-chevron">expand_more</span>
          </button>
          {#if drawingInkMenuOpen}
            <div class="drawing-ink-menu drawing-popover" role="radiogroup" aria-label="Type de trait">
              {#each inkModes as mode}
                <button
                  role="radio"
                  aria-checked={inkMode === mode.value}
                  aria-label={mode.label}
                  class:selected={inkMode === mode.value}
                  onclick={() => void chooseInkMode(mode.value)}
                >
                  <span class="msr">{mode.icon}</span>
                  <span>{mode.label}</span>
                  {#if inkMode === mode.value}<span class="msr shape-check">check</span>{/if}
                </button>
              {/each}
            </div>
          {/if}
        </div>
        <div class="drawing-control">
          <button
            class="drawing-shape-toggle"
            class:active={drawingTool === 'shape' || drawingShapeMenuOpen}
            aria-pressed={drawingTool === 'shape'}
            aria-expanded={drawingShapeMenuOpen}
            title={`Forme : ${drawingShape === 'ellipse' ? 'Ellipse' : 'Rectangle'}`}
            aria-label={`Choisir une forme, forme sélectionnée : ${drawingShape === 'ellipse' ? 'ellipse' : 'rectangle'}`}
            onclick={() => {
              const open = !drawingShapeMenuOpen
              closeToolMenus()
              drawingShapeMenuOpen = open
              if (!selectedDrawing) setDrawingTool('shape')
            }}
          >
            <span class="msr">{drawingShape === 'ellipse' ? 'circle' : 'rectangle'}</span>
            <span class="msr control-chevron">expand_more</span>
          </button>
          {#if drawingShapeMenuOpen}
            <div class="drawing-shape-menu drawing-popover" role="radiogroup" aria-label="Forme du dessin">
              {#each drawingShapes as shape}
                <button
                  role="radio"
                  aria-checked={drawingShape === shape.value}
                  aria-label={shape.label}
                  class:selected={drawingShape === shape.value}
                  onclick={() => void chooseDrawingShape(shape.value)}
                >
                  <span class="msr">{shape.icon}</span>
                  <span>{shape.label}</span>
                  {#if drawingShape === shape.value}<span class="msr shape-check">check</span>{/if}
                </button>
              {/each}
            </div>
          {/if}
        </div>
        <button class:active={drawingTool === 'eraser'} aria-pressed={drawingTool === 'eraser'} title="Gomme" aria-label="Gomme" onclick={() => setDrawingTool('eraser')}>
          <span class="msr">ink_eraser</span>
        </button>
      </div>
      {#if drawingTool === 'pen' || drawingTool === 'shape' || selectedDrawingId}
      {#if strokeWidthAdjustable}
      <div class="drawing-control">
        <button
          class="drawing-stroke-toggle"
          class:active={drawingStrokeMenuOpen}
          aria-label={`Choisir l'épaisseur, ${paletteStrokeWidths.find((item) => item.value === drawingStrokeWidth)?.label ?? drawingStrokeWidth}`}
          aria-expanded={drawingStrokeMenuOpen}
          title="Épaisseur du trait"
          onclick={() => {
            const open = !drawingStrokeMenuOpen
            closeToolMenus()
            drawingStrokeMenuOpen = open
          }}
        >
          <span class="drawing-stroke-preview" style={`--stroke-preview:${drawingStrokeWidth / (paletteKind === 'highlight' ? 4 : 1)}px`}></span>
        </button>
        {#if drawingStrokeMenuOpen}
          <div class="drawing-stroke-menu drawing-popover" role="radiogroup" aria-label="Épaisseur du trait">
            {#each paletteStrokeWidths as stroke}
              <button
                role="radio"
                aria-checked={drawingStrokeWidth === stroke.value}
                aria-label={stroke.label}
                title={stroke.label}
                class:selected={drawingStrokeWidth === stroke.value}
                onclick={() => void chooseDrawingStrokeWidth(stroke.value)}
              >
                <span class="drawing-stroke-sample" style={`--stroke-preview:${stroke.value / (paletteKind === 'highlight' ? 4 : 1)}px`}></span>
              </button>
            {/each}
          </div>
        {/if}
      </div>
      {/if}
      <div class="drawing-control">
        <button
          class="drawing-color-toggle"
          class:active={drawingPaletteOpen}
          aria-label="Choisir la couleur"
          aria-expanded={drawingPaletteOpen}
          title={highlighterPalette ? 'Couleur du surligneur' : 'Couleur du crayon et des formes'}
          onclick={() => {
            const open = !drawingPaletteOpen
            closeToolMenus()
            drawingPaletteOpen = open
          }}
        >
          <span class="drawing-color-dot" style={`--drawing-swatch:${drawingColor}`}></span>
        </button>
        {#if drawingPaletteOpen}
          <div class="drawing-color-menu drawing-popover" role="radiogroup" aria-label="Couleur du dessin">
            {#each paletteColors as color}
              <button
                role="radio"
                aria-checked={drawingColor === color.value}
                aria-label={color.label}
                title={color.label}
                class:selected={drawingColor === color.value}
                style={`--drawing-swatch:${color.value}`}
                onclick={() => void chooseDrawingColor(color.value)}
              >
                <span></span>
                {#if drawingColor === color.value}
                  <span class="msr" class:dark-check={color.darkCheck}>check</span>
                {/if}
              </button>
            {/each}
          </div>
        {/if}
      </div>
      <span class="toolbar-divider" aria-hidden="true"></span>
      {/if}
      <button disabled={!undoStack.length || savingAnnotation} title="Annuler (Ctrl+Z)" aria-label="Annuler" onclick={() => void undoAnnotation()}>
        <span class="msr">undo</span>
      </button>
      <button disabled={!redoStack.length || savingAnnotation} title="Rétablir (Ctrl+Y)" aria-label="Rétablir" onclick={() => void redoAnnotation()}>
        <span class="msr">redo</span>
      </button>
      <span class="toolbar-divider" aria-hidden="true"></span>
      <button class="drawing-done" title="Terminer" aria-label="Terminer l’annotation" onclick={toggleAnnotationMode}>
        <span class="msr">check</span>
        <span>Terminer</span>
      </button>
    </div>
  {/if}

  {#if annotationListOpen && annotationManifest}
    <section class="annotation-list" aria-label="Annotations du PDF">
      <header>
        <div>
          <strong>Annotations</strong>
          <span>
            {notes.length} au total{hiddenOrphanDrawings ? ` · ${hiddenOrphanDrawings} tracé${hiddenOrphanDrawings > 1 ? 's' : ''} orphelin${hiddenOrphanDrawings > 1 ? 's' : ''}` : ''}
          </span>
        </div>
        <button class="icon-button" aria-label="Fermer" onclick={() => annotationListOpen = false}><span class="msr">close</span></button>
      </header>
      {#if staleAnnotations}
        <div class="annotation-warning">
          <p>Le PDF a changé. Les annotations existantes sont conservées sans être replacées.</p>
          {#if orphanedDrawings}
            <p>{orphanedDrawings} tracé{orphanedDrawings > 1 ? 's' : ''} ne {orphanedDrawings > 1 ? 'peuvent' : 'peut'} plus être {orphanedDrawings > 1 ? 'affichés' : 'affiché'} sur cette version.</p>
            <button disabled={savingAnnotation} onclick={() => void purgeOrphanedDrawings()}>
              Supprimer {orphanedDrawings > 1 ? 'ces tracés' : 'ce tracé'}
            </button>
          {/if}
        </div>
      {/if}
      <div class="annotation-items">
        {#if !listedNotes.length}
          <p class="annotation-empty">Aucune annotation sur ce document. Passez le surligneur sur un passage, ou commentez un tracé.</p>
        {/if}
        {#each listedNotes as note (note.id)}
          <article
            class:orphaned={note.status === 'orphaned'}
            class:current={activeNoteIds.includes(note.id)}
            data-annotation-item={note.id}
          >
            {#if editingNoteId === note.id}
              <form class="annotation-editor" onsubmit={(event) => { event.preventDefault(); void saveNoteEdit(note) }}>
                <label>
                  <span>{noteKindLabels[note.kind]} · page {note.page}</span>
                  <textarea
                    bind:this={noteEditInput}
                    bind:value={noteEditDraft}
                    maxlength="8000"
                    placeholder="Ajouter un commentaire…"
                    onkeydown={(event) => handleNoteEditKeydown(event, note)}
                  ></textarea>
                </label>
                <div class="annotation-editor-actions">
                  <button type="button" onclick={() => void cancelNoteEdit(note.id)}>Annuler</button>
                  <button
                    class="primary"
                    type="submit"
                    disabled={savingAnnotation || noteEditDraft.trim() === note.comment}
                  >Enregistrer</button>
                </div>
              </form>
            {:else}
              <button class="annotation-body" disabled={note.status === 'orphaned'} onclick={() => revealNote(note)}>
                <span>{noteKindLabels[note.kind]} · page {note.page}</span>
                {#if note.quote}<q>{note.quote}</q>{/if}
                {#if note.comment}<p>{note.comment}</p>{/if}
              </button>
              <div class="annotation-item-actions">
                <button
                  class="annotation-edit"
                  data-annotation-edit={note.id}
                  aria-label={note.comment ? 'Modifier le commentaire' : 'Ajouter un commentaire'}
                  onclick={() => void startNoteEdit(note)}
                >
                  <span class="msr">edit_square</span>
                </button>
                <button class="annotation-delete" aria-label="Supprimer l’annotation" onclick={() => void deleteNote(note)}>
                  <span class="msr">delete</span>
                </button>
              </div>
            {/if}
          </article>
        {/each}
      </div>
    </section>
  {/if}
</div>

<style>
  .pdf-shell {
    /* Curseur gomme dessiné en ligne (la CSP autorise `data:` pour les images). Le
       `not-allowed` d'avant affichait un sens interdit : il annonçait l'inverse de ce
       qui allait se passer. Fond blanc + contour sombre pour rester lisible aussi bien
       sur la page que sur le fond de l'application ; repli `crosshair` si l'image est
       refusée, jamais un curseur trompeur. */
    --pdf-eraser-cursor:
      url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><g transform="rotate(-45 11 13)"><rect x="4.5" y="8.5" width="13" height="9" rx="2.4" fill="%23ffffff" stroke="%231c1a16" stroke-width="1.6"/><path d="M11 8.5v9" stroke="%231c1a16" stroke-width="1.4"/></g></svg>')
      6 17,
      crosshair;
    position: relative;
    container-type: inline-size;
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }
  .pdf-shell:focus { outline: none; }
  .pdf-view {
    /* Repère des éléments ancrés au contenu (bulle de note) : positionnés ici, ils
       défilent avec les pages au lieu de flotter au-dessus. */
    position: relative;
    width: 100%;
    height: 100%;
    min-height: 0;
    overflow: auto;
    /* Reserve la gouttiere de scrollbar en amont : sans ca, la scrollbar verticale
       apparait apres coup, retrecit la largeur utile et force `max-width:100%` a
       reechantillonner le canvas d'un facteur non-entier -> flou. clientWidth mesure
       ici exclut deja la gouttiere, donc la largeur du canvas colle au conteneur. */
    scrollbar-gutter: stable;
    display: flex;
    flex-direction: column;
    /* `safe` : une page plus large que le lecteur (zoom) reste atteignable au
       défilement — un centrage strict rendrait son bord gauche inaccessible. */
    align-items: safe center;
    gap: 14px;
    padding: 20px 12px 60px;
    background: var(--cream-base);
  }
  /* Gouttière d'épingles réservée DES DEUX CÔTÉS : n'en réserver qu'à droite laissait
     la page collée à gauche (12 px contre 60), et ce décalage apparaissait avec la
     première note commentée — d'où un centrage qui semblait fautif « parfois ». */
  .pdf-view.with-annotation-rail {
    padding-inline: 60px;
  }
  .pdf-view :global(.pdf-page-wrap) {
    --user-unit: 1;
    --total-scale-factor: calc(var(--scale-factor) * var(--user-unit));
    --scale-round-x: 1px;
    --scale-round-y: 1px;
    position: relative;
    flex: 0 0 auto;
    background: #fff;
  }
  /* Pas de `max-width: 100%` ici : la largeur est posée en pixels par `applyFit`, et
     un plafond à 100 % annulerait le zoom (et rééchantillonnerait le canvas). */
  .pdf-view :global(canvas.pdf-page) {
    position: relative;
    z-index: 0;
    display: block;
    box-shadow: 0 1px 6px rgba(var(--shadow-rgb), 0.14);
    border-radius: 2px;
    background: #fff;
    scroll-margin-top: 14px;
  }
  .pdf-view :global(.textLayer) {
    --min-font-size: 1;
    --text-scale-factor: calc(var(--total-scale-factor) * var(--min-font-size));
    --min-font-size-inv: calc(1 / var(--min-font-size));
    position: absolute;
    inset: 0;
    z-index: 2;
    overflow: clip;
    color-scheme: only light;
    line-height: 1;
    text-align: initial;
    letter-spacing: normal;
    word-spacing: normal;
    transform-origin: 0 0;
    forced-color-adjust: none;
    text-size-adjust: none;
    user-select: text;
  }
  .pdf-view :global(.textLayer :is(span, br)) {
    position: absolute;
    color: transparent;
    white-space: pre;
    cursor: text;
    transform-origin: 0 0;
    user-select: text;
  }
  .pdf-view :global(.textLayer > :not(.markedContent)),
  .pdf-view :global(.textLayer .markedContent span:not(.markedContent)) {
    --font-height: 0;
    --scale-x: 1;
    --rotate: 0deg;
    z-index: 1;
    font-size: calc(var(--text-scale-factor) * var(--font-height));
    transform: rotate(var(--rotate)) scaleX(var(--scale-x)) scale(var(--min-font-size-inv));
  }
  .pdf-view :global(.textLayer .markedContent) {
    display: contents;
  }
  .pdf-view :global(.textLayer ::selection) {
    background: color-mix(in srgb, AccentColor, transparent 42%);
    color: transparent;
  }
  .pdf-view :global(.textLayer br::selection) {
    background: transparent;
  }
  /* Le surligneur vit sous la couche texte et se fond en multiply : c'est ce qui
     laisse lire le texte du canvas AU TRAVERS du trait. Poser le mix-blend-mode sur
     un enfant de la couche haute ne servirait à rien — celle-ci a un z-index, donc
     crée un contexte d'empilement, et l'enfant se fondrait avec du vide. */
  .pdf-view :global(.pdf-highlight-layer) {
    position: absolute;
    inset: 0;
    z-index: 1;
    width: 100%;
    height: 100%;
    overflow: visible;
    pointer-events: none;
    mix-blend-mode: multiply;
  }
  .pdf-view :global(.pdf-highlight-stroke) {
    stroke-opacity: 0.58;
  }
  .pdf-view :global(.pdf-text-fill) {
    fill-opacity: 0.6;
  }
  .pdf-view :global(.pdf-drawing-layer) {
    position: absolute;
    inset: 0;
    z-index: 3;
    width: 100%;
    height: 100%;
    overflow: visible;
    pointer-events: none;
    touch-action: none;
  }
  /* Routage du pointeur par MODE, pas par outil : le surligneur de texte est un mode
     du crayon mais se comporte comme la sélection (c'est le texte qu'on attrape). */
  .pdf-view :global(.pdf-drawing-stroke),
  .pdf-view :global(.pdf-text-fill),
  .pdf-view :global(.pdf-drawing-hit),
  .pdf-view :global(.pdf-text-hit) { pointer-events: none; }
  [data-pointer-mode='draw'] .pdf-view :global(.pdf-drawing-layer),
  [data-pointer-mode='erase'] .pdf-view :global(.pdf-drawing-layer) { pointer-events: auto; }
  [data-pointer-mode='draw'] .pdf-view :global(.pdf-drawing-layer) { cursor: crosshair; }
  /* La gomme ne s'affiche QUE sur ce qu'elle peut effacer : ailleurs sur la page, le
     curseur reste neutre. Le survol devient ainsi la réponse à « est-ce que ça part
     si je clique ici ? » — les zones de pointage épousent déjà les tracés. */
  [data-pointer-mode='draw'] .pdf-view :global(.textLayer),
  [data-pointer-mode='erase'] .pdf-view :global(.textLayer) {
    pointer-events: none;
    user-select: none;
  }
  [data-pointer-mode='text'] .pdf-view :global(.textLayer) { cursor: text; }
  /* En mode surligneur, la sélection native ment : elle avale des lignes entières que
     le surlignage ne retiendra pas. On l'efface au profit de l'aperçu exact, peint par
     le composant. Si cette règle échouait, on retomberait sur la sélection bleue —
     dégradation visible, jamais une disparition. */
  [data-pointer-mode='text'] .pdf-view :global(.textLayer ::selection) { background: transparent; }
  [data-pointer-mode='pick'] .pdf-view :global(.pdf-drawing-hit) {
    pointer-events: stroke;
    cursor: move;
  }
  [data-pointer-mode='erase'] .pdf-view :global(.pdf-drawing-hit) {
    pointer-events: stroke;
    cursor: var(--pdf-eraser-cursor);
  }
  [data-pointer-mode='erase'] .pdf-view :global(:is(rect, ellipse).pdf-drawing-hit) { pointer-events: all; }
  /* Un surlignage de texte s'attrape sur toute sa surface : contrairement à un
     rectangle dessiné, son intérieur lui appartient. */
  [data-pointer-mode='pick'] .pdf-view :global(.pdf-text-hit) {
    pointer-events: all;
    cursor: move;
  }
  [data-pointer-mode='erase'] .pdf-view :global(.pdf-text-hit) {
    pointer-events: all;
    cursor: var(--pdf-eraser-cursor);
  }
  .pdf-view :global(.pdf-drawing-selection) {
    fill: none;
    stroke: color-mix(in srgb, #74536f 38%, white);
    stroke-dasharray: 5 4;
    pointer-events: none;
    opacity: 0.8;
  }
  .pdf-view :global(.pdf-annotation-comment-pin) {
    position: absolute;
    z-index: 4;
    width: 26px;
    height: 26px;
    display: grid;
    place-items: center;
    padding: 0;
    border: 0;
    border-radius: 999px;
    left: calc(100% + 8px);
    transform: translateY(-46%);
    background: var(--pdf-annotation-pin-bg);
    color: var(--pdf-annotation-pin-ink);
    box-shadow: 0 0 0 1px var(--elevation-ring), 0 4px 12px rgba(var(--shadow-rgb), 0.22);
    font: 700 11px/1 var(--font-sans);
    font-variant-numeric: tabular-nums;
    cursor: pointer;
    transition: background-color 140ms ease, box-shadow 140ms ease, opacity 140ms ease, transform 100ms ease;
  }
  .pdf-view :global(.pdf-annotation-comment-pin .msr) {
    font-size: 16px;
  }
  .pdf-view :global(.pdf-annotation-comment-pin::before) {
    content: '';
    position: absolute;
    inset: -7px;
  }
  .pdf-view :global(.pdf-annotation-comment-pin:hover) {
    background: var(--pdf-annotation-pin-bg);
    opacity: 0.88;
    box-shadow: 0 0 0 1px var(--elevation-ring), 0 6px 16px rgba(var(--shadow-rgb), 0.28);
  }
  .pdf-view :global(.pdf-annotation-comment-pin:active) {
    transform: translateY(-46%) scale(0.96);
  }
  .pdf-view :global(.pdf-annotation-comment-pin:focus-visible) {
    outline: 2px solid var(--ink-3);
    outline-offset: 2px;
  }
  /* Surlignage d'un passage cité : marqueur ambré en multiply (le texte du canvas reste
     net dessous), fondu doux avant retrait des nœuds. */
  .pdf-view :global(.pdf-cite-mark) {
    position: absolute;
    z-index: 3;
    background: rgba(255, 205, 84, 0.42);
    mix-blend-mode: multiply;
    border-radius: 2px;
    pointer-events: none;
    animation: pdf-cite-mark 4.2s ease forwards;
  }
  @keyframes pdf-cite-mark {
    0%, 65% { opacity: 1; }
    100% { opacity: 0; }
  }
  /* Halo transitoire de la page citée : même vocabulaire que le flash de recherche de
     l'éditeur (révélation brève, sans état persistant). */
  .pdf-view :global(canvas.pdf-page-cited) {
    animation: pdf-cited 1.8s ease;
  }
  @keyframes pdf-cited {
    0%, 60% { box-shadow: 0 0 0 3px var(--ink-3), 0 1px 6px rgba(var(--shadow-rgb), 0.14); }
    100% { box-shadow: 0 1px 6px rgba(var(--shadow-rgb), 0.14); }
  }
  /* Bulle de note : la queue pointe l'annotation, décalée de --tail quand la bulle a
     dû être ramenée dans la page. */
  .note-bubble {
    position: absolute;
    z-index: 7;
    /* Même expression que NOTE_BUBBLE_WIDTH côté script : le cadrage est calculé sur
       cette largeur, elles doivent rester identiques. */
    width: min(272px, calc(100% - 32px));
    display: grid;
    gap: 4px;
    padding: 12px 12px 10px;
    transform: translateX(-50%);
    /* Aucune bordure : un filet posé en ombre suit le thème (clair ou sombre) et se
       superpose à deux ombres portées — une de contact, une diffuse — au lieu de
       cerner la bulle d'un trait dur. */
    border-radius: 18px;
    background: var(--surface);
    box-shadow:
      0 0 0 1px var(--elevation-ring),
      0 2px 6px rgba(var(--shadow-rgb), 0.05),
      0 16px 40px rgba(var(--shadow-rgb), 0.18);
    transform-origin: calc(50% + var(--tail, 0px)) 0;
    transition: box-shadow 160ms cubic-bezier(0.2, 0, 0, 1);
  }
  .note-bubble:focus-within {
    box-shadow:
      0 0 0 1px var(--line-3),
      0 2px 6px rgba(var(--shadow-rgb), 0.05),
      0 18px 44px rgba(var(--shadow-rgb), 0.22);
  }
  /* Queue : même surface, et son filet ne couvre que les deux arêtes exposées après
     rotation — la ligne de contour reste continue tout autour de la bulle. */
  .note-bubble::before {
    content: '';
    position: absolute;
    top: -5px;
    left: calc(50% + var(--tail, 0px));
    width: 11px;
    height: 11px;
    transform: translateX(-50%) rotate(45deg);
    border-radius: 3px 0 0 0;
    background: var(--surface);
    box-shadow: -1px -1px 0 0 var(--elevation-ring);
  }
  @media (prefers-reduced-motion: no-preference) {
    .note-bubble { animation: note-bubble-pop 150ms cubic-bezier(0.2, 0, 0, 1); }
    @keyframes note-bubble-pop {
      from { opacity: 0; transform: translateX(-50%) scale(0.94); }
      to { opacity: 1; transform: translateX(-50%) scale(1); }
    }
  }
  /* Le champ n'a ni cadre ni fond : la bulle EST sa surface. */
  .note-bubble textarea {
    width: 100%;
    min-height: 48px;
    max-height: 220px;
    field-sizing: content;
    resize: none;
    padding: 0;
    border: 0;
    outline: none;
    background: transparent;
    color: var(--ink);
    caret-color: var(--ink);
    font: 400 13px/1.55 var(--font-sans);
    text-wrap: pretty;
  }
  .note-bubble textarea::placeholder {
    color: var(--ink-4);
    opacity: 0.7;
  }
  /* Même métrique que le champ : passer de la lecture à l'écriture ne fait pas
     sauter le texte d'un pixel. */
  .note-bubble-text {
    margin: 0;
    max-height: 220px;
    overflow: auto;
    color: var(--ink);
    font: 400 13px/1.55 var(--font-sans);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    text-wrap: pretty;
  }
  .note-bubble-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 2px;
  }
  .note-bubble-actions button {
    height: 32px;
    padding: 0 13px;
    border: 0;
    border-radius: 999px;
    background: transparent;
    color: var(--ink-4);
    font: 600 12px/1 var(--font-sans);
    cursor: pointer;
    transition: background-color 140ms cubic-bezier(0.2, 0, 0, 1), color 140ms cubic-bezier(0.2, 0, 0, 1), transform 100ms cubic-bezier(0.2, 0, 0, 1);
  }
  .note-bubble-actions button:hover { background: var(--surface-hover); color: var(--ink-2); }
  .note-bubble-actions button:active:not(:disabled) { transform: scale(0.96); }
  /* Boutons ronds : rayon concentrique avec la bulle (18 − 12 de marge = 6), donc un
     cercle de 32 px tombe juste dans l'angle intérieur. */
  .note-bubble-actions .round {
    width: 32px;
    padding: 0;
    display: inline-grid;
    place-items: center;
  }
  .note-bubble-actions .round .msr { font-size: 17px; }
  .note-bubble-actions .primary.round .msr { font-size: 18px; }
  .note-bubble-actions .primary { background: var(--ink); color: var(--cream-content); }
  .note-bubble-actions .primary:hover { background: var(--ink-2); color: var(--cream-content); }
  .note-bubble-actions button:disabled { opacity: 0.45; cursor: default; }
  .pdf-state {
    margin: auto;
    color: var(--ink-4);
    font-size: 13px;
    font-family: var(--font-mono);
  }
  .pdf-error {
    max-width: 420px;
    text-align: center;
    color: var(--err);
  }
  .annotation-toggle,
  .annotate-toggle,
  .drawing-toolbar button,
  .icon-button,
  .annotation-edit,
  .annotation-delete {
    border: 0;
    color: var(--ink-2);
    font: 500 12.5px/1 var(--font-sans);
    cursor: pointer;
  }
  .pdf-actions {
    position: absolute;
    z-index: 8;
    /* Coin haut-DROIT, aux côtés du bouton du copilote qu'on esquive juste en dessous.
       Le coin gauche est l'espace où retombent les menus d'onglets : y poser un
       contrôle permanent le ferait recouvrir à chaque ouverture.
       Même `top` que `.collapse-btn` (App.svelte : top 8, hauteur 32) pour que les
       deux rangées tiennent la même ligne — mesuré, pas estimé. */
    top: 8px;
    right: 12px;
    display: flex;
    align-items: center;
    gap: 5px;
  }
  /* Là où le bouton du copilote surplombe ce lecteur, on lui laisse sa place. */
  :global(.workspace:not(.split)) .pdf-actions,
  :global(.workspace.split:not(.vertical) .workspace-pane.secondary) .pdf-actions {
    right: 56px;
  }
  .zoom-control {
    height: 32px;
    display: inline-flex;
    align-items: center;
    padding: 0 2px;
    border-radius: 999px;
    background: var(--surface);
    box-shadow: 0 5px 16px rgba(var(--shadow-rgb), 0.14);
  }
  .zoom-control button {
    height: 28px;
    min-width: 28px;
    display: inline-grid;
    place-items: center;
    padding: 0;
    border: 0;
    border-radius: 999px;
    background: transparent;
    color: var(--ink-2);
    cursor: pointer;
    transition: background-color 140ms cubic-bezier(0.2, 0, 0, 1), color 140ms cubic-bezier(0.2, 0, 0, 1), transform 100ms cubic-bezier(0.2, 0, 0, 1);
  }
  .zoom-control button:hover:not(:disabled) { background: var(--surface-hover); color: var(--ink); }
  .zoom-control button:active:not(:disabled) { transform: scale(0.96); }
  .zoom-control button:disabled { opacity: 0.35; cursor: default; }
  .zoom-control button:focus-visible { outline: 2px solid var(--line-3); outline-offset: -2px; }
  .zoom-control .msr { font-size: 16px; }
  .zoom-control .zoom-level {
    min-width: 46px;
    padding: 0 4px;
    color: var(--ink-2);
    font: 600 11.5px/1 var(--font-sans);
    font-variant-numeric: tabular-nums;
  }
  .annotation-toggle,
  .annotate-toggle {
    height: 32px;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 0 10px;
    border: 0;
    border-radius: 999px;
    background: var(--surface);
    box-shadow: 0 5px 16px rgba(var(--shadow-rgb), 0.14);
    transition: background-color 140ms ease, color 140ms ease, box-shadow 140ms ease, transform 100ms ease;
  }
  .annotation-toggle:hover,
  .annotation-toggle.active,
  .annotate-toggle:hover,
  .annotate-toggle.active {
    background: var(--surface-2);
    color: var(--ink);
    box-shadow: 0 0 0 1px var(--elevation-ring), 0 6px 18px rgba(var(--shadow-rgb), 0.20);
  }
  .annotation-toggle:active,
  .annotate-toggle:active { transform: scale(0.96); }
  .annotation-toggle:focus-visible,
  .annotate-toggle:focus-visible,
  .drawing-toolbar button:focus-visible { outline: 2px solid var(--line-3); outline-offset: 2px; }
  .annotate-toggle:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .annotation-toggle .msr,
  .annotate-toggle .msr {
    font-size: 16px;
  }
  .annotation-toggle > span:last-child { font-variant-numeric: tabular-nums; }
  .drawing-toolbar {
    position: absolute;
    z-index: 10;
    left: 50%;
    bottom: 18px;
    max-width: calc(100% - 24px);
    min-height: 46px;
    display: flex;
    align-items: center;
    gap: 3px;
    padding: 4px;
    transform: translateX(-50%);
    border: 1px solid var(--line-2);
    border-radius: 999px;
    background: var(--surface);
    box-shadow: 0 14px 38px rgba(var(--shadow-rgb), 0.26);
  }
  .drawing-tools {
    display: flex;
    align-items: center;
    gap: 3px;
  }
  .drawing-control {
    position: relative;
    display: flex;
    align-items: center;
  }
  .drawing-toolbar button {
    height: 36px;
    min-width: 36px;
    /* Jamais comprimé sous son contenu : le flex rétrécissait les boutons libellés
       sans que leur texte ne rétrécisse, et celui-ci débordait par-dessus le voisin —
       des boîtes qui ne se chevauchent pas, mais un rendu qui se chevauche. */
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    padding: 0 9px;
    border: 0;
    border-radius: 999px;
    background: transparent;
    transition: background-color 140ms ease, color 140ms ease, transform 100ms ease;
  }
  .drawing-toolbar button:hover:not(:disabled) {
    background: var(--surface-hover);
    color: var(--ink);
  }
  .drawing-toolbar button.active {
    background: var(--accent-soft);
    color: var(--ink);
  }
  .drawing-toolbar button:active:not(:disabled) { transform: scale(0.96); }
  .drawing-toolbar button:disabled {
    opacity: 0.36;
    cursor: default;
  }
  .drawing-toolbar .msr { font-size: 18px; }
  .drawing-toolbar .drawing-shape-toggle {
    gap: 1px;
    padding: 0 6px 0 8px;
  }
  .drawing-toolbar .control-chevron {
    margin-right: -2px;
    font-size: 13px;
    color: var(--ink-4);
  }
  .drawing-stroke-preview,
  .drawing-stroke-sample {
    width: 20px;
    display: block;
    border-radius: 999px;
    background: currentColor;
  }
  .drawing-stroke-preview { height: clamp(2px, var(--stroke-preview), 8px); }
  .drawing-stroke-sample { height: clamp(2px, var(--stroke-preview), 8px); }
  .drawing-color-dot {
    width: 18px;
    height: 18px;
    display: block;
    border-radius: 999px;
    background: var(--drawing-swatch);
    box-shadow: 0 0 0 1px rgba(var(--shadow-rgb), 0.28), inset 0 0 0 1px rgba(255, 255, 255, 0.24);
  }
  .drawing-popover {
    position: absolute;
    left: 50%;
    bottom: calc(100% + 8px);
    padding: 5px;
    transform: translateX(-50%);
    border: 1px solid var(--line-2);
    border-radius: 999px;
    background: var(--surface);
    box-shadow: 0 12px 30px rgba(var(--shadow-rgb), 0.24);
  }
  .drawing-color-menu,
  .drawing-stroke-menu {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .drawing-shape-menu,
  .drawing-ink-menu {
    width: 152px;
    display: grid;
    gap: 2px;
    padding: 5px;
    border-radius: 12px;
  }
  .drawing-toolbar .drawing-shape-menu button,
  .drawing-toolbar .drawing-ink-menu button {
    width: 100%;
    justify-content: flex-start;
    padding: 0 9px;
  }
  .drawing-shape-menu button span:nth-child(2),
  .drawing-ink-menu button span:nth-child(2) { flex: 1; text-align: left; }
  .drawing-shape-menu .shape-check,
  .drawing-ink-menu .shape-check { font-size: 14px; }
  .drawing-shape-menu button.selected,
  .drawing-ink-menu button.selected,
  .drawing-stroke-menu button.selected { background: var(--accent-soft); }
  .drawing-toolbar .drawing-ink-toggle {
    gap: 1px;
    padding: 0 6px 0 8px;
  }
  .drawing-color-menu button {
    position: relative;
    width: 32px;
    min-width: 32px;
    height: 32px;
    padding: 0;
  }
  .drawing-stroke-menu button {
    width: 36px;
    min-width: 36px;
    padding: 0 8px;
  }
  .drawing-color-menu button > span:first-child {
    position: absolute;
    inset: 5px;
    border-radius: 999px;
    background: var(--drawing-swatch);
    box-shadow: 0 0 0 1px rgba(var(--shadow-rgb), 0.24), inset 0 0 0 1px rgba(255, 255, 255, 0.22);
  }
  .drawing-color-menu button.selected { background: var(--accent-soft); }
  .drawing-color-menu button .msr {
    position: relative;
    z-index: 1;
    color: white;
    font-size: 14px;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.55);
  }
  .drawing-color-menu button .msr.dark-check {
    color: #111111;
    text-shadow: 0 1px 1px rgba(255, 255, 255, 0.45);
  }
  .toolbar-divider {
    width: 1px;
    height: 22px;
    flex: 0 0 auto;
    margin: 0 2px;
    background: var(--line-2);
  }
  .drawing-toolbar .drawing-done {
    padding: 0 13px 0 10px;
    background: var(--ink);
    color: var(--cream-content);
  }
  .drawing-toolbar .drawing-done:hover:not(:disabled) {
    background: var(--ink-2);
    color: var(--cream-content);
  }
  /* Le carnet s'ouvre sous son bouton (top 8 + 32 de haut + 8 d'écart). */
  .annotation-list {
    position: absolute;
    z-index: 9;
    top: 48px;
    right: 24px;
    width: min(340px, calc(100% - 32px));
    max-height: min(520px, calc(100% - 64px));
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid var(--line-2);
    border-radius: 14px;
    background: var(--surface);
    box-shadow: 0 16px 42px rgba(var(--shadow-rgb), 0.24);
  }
  .annotation-list header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 14px 10px 16px;
  }
  .annotation-list header div {
    display: grid;
    gap: 3px;
  }
  .annotation-list header strong {
    color: var(--ink);
    font: 600 13px/1.2 var(--font-sans);
  }
  .annotation-list header div > span,
  .annotation-body > span {
    color: var(--ink-4);
    font: 500 10.5px/1.2 var(--font-sans);
  }
  .icon-button,
  .annotation-edit,
  .annotation-delete {
    width: 30px;
    height: 30px;
    display: grid;
    place-items: center;
    flex: 0 0 auto;
    border-radius: 999px;
    background: transparent;
  }
  .icon-button:hover,
  .annotation-edit:hover,
  .annotation-delete:hover {
    background: var(--surface-hover);
    color: var(--ink);
  }
  .icon-button .msr,
  .annotation-edit .msr,
  .annotation-delete .msr {
    font-size: 16px;
  }
  .annotation-warning {
    display: grid;
    gap: 7px;
    justify-items: start;
    margin: 0 12px 10px;
    padding: 9px 10px;
    border-radius: 8px;
    background: color-mix(in srgb, var(--warn) 12%, transparent);
    color: var(--warn-text);
    font: 500 11.5px/1.4 var(--font-sans);
  }
  .annotation-warning p { margin: 0; }
  .annotation-warning button {
    min-height: 26px;
    padding: 0 10px;
    border: 1px solid color-mix(in srgb, var(--warn-text) 32%, transparent);
    border-radius: 999px;
    background: transparent;
    color: var(--warn-text);
    font: 600 11px/1 var(--font-sans);
    cursor: pointer;
  }
  .annotation-warning button:hover:not(:disabled) {
    background: color-mix(in srgb, var(--warn) 18%, transparent);
  }
  .annotation-warning button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .annotation-empty {
    margin: 0;
    padding: 14px 8px 12px;
    color: var(--ink-4);
    font: 400 11.5px/1.45 var(--font-sans);
  }
  .annotation-items {
    min-height: 0;
    overflow: auto;
    padding: 0 8px 8px;
  }
  .annotation-items article {
    display: flex;
    align-items: flex-start;
    border-top: 1px solid var(--line-1);
  }
  .annotation-items article.current {
    border-radius: 8px;
    background: var(--accent-soft);
  }
  .annotation-items article.orphaned {
    opacity: 0.58;
  }
  .annotation-item-actions {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 8px 2px 0 0;
  }
  .annotation-body {
    min-width: 0;
    flex: 1;
    display: grid;
    gap: 5px;
    padding: 12px 8px;
    border: 0;
    background: transparent;
    color: var(--ink-2);
    text-align: left;
    cursor: pointer;
  }
  .annotation-body:disabled {
    cursor: default;
  }
  .annotation-body q {
    display: -webkit-box;
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    color: var(--ink-2);
    font: 500 12px/1.4 var(--font-sans);
  }
  .annotation-body p {
    margin: 0;
    color: var(--ink-4);
    font: 400 11.5px/1.4 var(--font-sans);
  }
  .annotation-editor {
    min-width: 0;
    flex: 1;
    display: grid;
    gap: 8px;
    padding: 10px 8px 12px;
  }
  .annotation-editor label {
    display: grid;
    gap: 6px;
  }
  .annotation-editor label > span {
    color: var(--ink-4);
    font: 500 10.5px/1.2 var(--font-sans);
  }
  .annotation-editor textarea {
    width: 100%;
    min-height: 72px;
    resize: vertical;
    padding: 9px 10px;
    border: 0;
    border-radius: 10px;
    outline: none;
    background: var(--cream-content);
    color: var(--ink);
    box-shadow: inset 0 0 0 1px var(--line-2);
    font: 400 12.5px/1.45 var(--font-sans);
  }
  .annotation-editor textarea:focus {
    box-shadow: inset 0 0 0 1px var(--ink-3), 0 0 0 2px color-mix(in srgb, var(--ink-3) 14%, transparent);
  }
  .annotation-editor-actions {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
  }
  .annotation-editor-actions button {
    min-height: 30px;
    padding: 0 12px;
    border: 0;
    border-radius: 999px;
    background: transparent;
    color: var(--ink-3);
    font: 600 11.5px/1 var(--font-sans);
    cursor: pointer;
  }
  .annotation-editor-actions button:hover {
    background: var(--surface-hover);
    color: var(--ink);
  }
  .annotation-editor-actions .primary {
    background: var(--ink);
    color: var(--cream-content);
  }
  .annotation-editor-actions .primary:hover {
    background: var(--ink-2);
    color: var(--cream-content);
  }
  .annotation-editor-actions button:disabled {
    opacity: 0.45;
    cursor: default;
  }
  /* Un tracé révélé depuis le carnet clignote sur place — même vocabulaire que le
     surlignage hérité, mais appliqué au trait SVG. */
  .pdf-view :global(.pdf-drawing-layer .attention),
  .pdf-view :global(.pdf-highlight-layer .attention) {
    animation: drawing-attention 1.2s ease;
  }
  @keyframes drawing-attention {
    0%, 55% { opacity: 0.25; }
    100% { opacity: 1; }
  }
  @media (prefers-reduced-motion: reduce) {
    .pdf-view :global(.pdf-drawing-layer .attention),
    .pdf-view :global(.pdf-highlight-layer .attention) { animation: none; }
  }
  @container (max-width: 440px) {
    .annotate-toggle-label,
    .drawing-done span:last-child {
      display: none;
    }
    .drawing-toolbar .drawing-done { padding: 0 9px; }
    .drawing-toolbar {
      gap: 1px;
      padding: 3px;
    }
    .drawing-tools { gap: 1px; }
    .drawing-toolbar button {
      height: 34px;
      min-width: 32px;
      padding: 0 7px;
    }
    .drawing-toolbar .drawing-shape-toggle {
      min-width: 40px;
      padding: 0 4px 0 7px;
    }
    .drawing-color-menu button,
    .drawing-stroke-menu button { min-width: 32px; }
    .toolbar-divider { display: none; }
  }
  @media (pointer: coarse) {
    .drawing-toolbar button {
      width: 44px;
      height: 44px;
    }
    .drawing-toolbar .drawing-done { width: auto; }
  }
  @media (pointer: coarse) {
    @container (max-width: 440px) {
      .drawing-toolbar button {
        width: 36px;
        min-width: 36px;
        height: 40px;
      }
      .drawing-toolbar .drawing-shape-toggle { width: 42px; }
      .drawing-toolbar .drawing-done { width: 36px; }
    }
  }
</style>
