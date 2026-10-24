<script lang="ts" module>
  import { EditorView } from '@codemirror/view'

  // Dernier défilement connu de chaque vue, tenu par un écouteur `scroll` passif. L'état
  // mis en cache à chaque transaction le lit ici au lieu de `scrollDOM.scrollTop` : lu
  // juste après la mutation du DOM, ce dernier forçait un layout synchrone à chaque touche.
  // Indexé par VUE et non par instance : un état mis en cache peut être rouvert par l'autre
  // volet, et son écouteur de mise à jour l'accompagne.
  const lastScrollTop = new WeakMap<EditorView, number>()
</script>

<script lang="ts">
  import { onMount, tick } from 'svelte'
  import { EditorState, type Extension } from '@codemirror/state'
  import { app, COLUMN_PX, docHeadings, forcePreview, isDirty, openCopilot, workspace, zoomDocText } from '../lib/stores.svelte'
  import { cacheEditorRuntime, editorRuntimeForTab, publishEditorSelection, registerEditor, registeredTabForPane, selectionForPane, unregisterEditor, updateEditorRegistration } from '../lib/editor-registry.svelte'
  import { baseExtensions, htmlSourceExtensions, livePreviewComp, previewExtensions, serializeDoc, sourceExtensions, txtExtensions } from '../lib/editor/editor'
  import { docDirCompartment, docDirFacet } from '../lib/editor/live-preview'
  import { revealMatch, searchFlashField } from '../lib/editor/search-flash'
  import { isRephrasePreviewUpdate, rephrasePreviewField, setRephrasePreview, syncRephrasePreview } from '../lib/editor/rephrase-preview'
  import { parentPath } from '../lib/explorer'
  import { revealHtmlPassage, sandboxDoc } from '../lib/html'
  import { markdownTextLength } from '../lib/images'
  import { writePastedImage } from '../lib/tauri'
  import { imageMarkdown, imageStamp, sniffImageExt } from '../lib/paste-image'
  import { acceptRephrase, cancelRephrase, copilot, rephrase, rephraseSelection, retryRephrase } from '../lib/copilot.svelte'
  import {
    insertHr,
    insertTable,
    setHeading,
    toggleBold,
    toggleInlineCode,
    toggleItalic,
    toggleLink,
    toggleList,
    toggleQuote,
    toggleStrike,
    wrapCodeBlock,
  } from '../lib/editor/format-commands'
  import { diffWords, MAX_INSTRUCTION, normalizeInstruction, type RephraseMode } from '../lib/copilot-service'
  import DokuMark from '../lib/DokuMark.svelte'
  import PdfView from './PdfView.svelte'
  import DocxView from './DocxView.svelte'
  import type { PaneId } from '../lib/workspace'
  import { tooltip } from '../lib/tooltip'

  const MAX_PASTE_IMAGE = 25 * 1024 * 1024 // 25 Mo : garde-fou mémoire (tablette ARM)

  // Coller une image (12.1). Le File doit être extrait du presse-papier SYNCHRONEMENT
  // (clipboardData devient inerte dès le premier await) ; l'écriture + l'insertion se
  // font ensuite en asynchrone. Retourner true = collage pris en charge (CM ne colle pas
  // de texte) ; false = laisser CM coller le texte normalement.
  function imagePasteHandler(tabId: number): Extension {
    return EditorView.domEventHandlers({
      paste(event, view) {
        const items = event.clipboardData?.items
        if (!items) return false
        let file: File | null = null
        for (let i = 0; i < items.length; i++) {
          const it = items[i]
          if (it.kind === 'file' && it.type.startsWith('image/')) {
            file = it.getAsFile()
            if (file) break
          }
        }
        if (!file) return false // pas d'image exploitable → coller texte normal
        // Tout item image/* est consommé ici (preventDefault synchrone obligatoire) ; le
        // sniff du format vient APRÈS l'await → un format non reconnu (BMP/SVG/TIFF) est
        // rejeté par un bandeau plutôt que recollé en texte. Tradeoff assumé, ne pas
        // « corriger » en fall-through (le sniff ne peut pas être synchrone ici).
        event.preventDefault()
        void pasteImage(tabId, file, view)
        return true
      },
    })
  }

  async function pasteImage(tabId: number, file: File, view: EditorView) {
    const tab = app.tabs.find((t) => t.id === tabId)
    if (!tab) return
    if (!tab.path) {
      app.banner = {
        tone: 'warning',
        title: 'Document non enregistré',
        message: 'Enregistrez le document avant de coller une image.',
      }
      return
    }
    const dir = parentPath(tab.path)
    if (!dir) {
      app.banner = {
        tone: 'error',
        title: 'Dossier introuvable',
        message: 'Impossible de localiser le dossier du document.',
      }
      return
    }
    if (file.size > MAX_PASTE_IMAGE) {
      app.banner = {
        tone: 'warning',
        title: 'Image trop volumineuse',
        message: 'La taille maximale autorisée est de 25 Mo.',
      }
      return
    }
    const bytes = new Uint8Array(await file.arrayBuffer())
    const ext = sniffImageExt(bytes)
    if (!ext) {
      app.banner = {
        tone: 'error',
        title: 'Image non reconnue',
        message: "Le format de l’image dans le presse-papier n’est pas pris en charge.",
      }
      return
    }
    let name: string | null
    try {
      name = await writePastedImage(dir, bytes, imageStamp(new Date()), ext)
    } catch (err) {
      console.error("Écriture de l'image collée échouée", err)
      app.banner = {
        tone: 'error',
        title: 'Collage impossible',
        message: 'L’image n’a pas pu être enregistrée ; aucun lien n’a été inséré.',
      }
      return
    }
    if (!name) return // navigateur : no-op
    // L'éditeur est partagé entre onglets : si l'utilisateur a changé d'onglet pendant
    // l'écriture, NE PAS insérer le lien dans le mauvais document (le fichier est bien
    // écrit → aucune perte).
    if (workspace[paneId].tabId !== tabId || registeredTabForPane(paneId) !== tabId) {
      app.banner = {
        tone: 'warning',
        title: 'Onglet changé',
        message: 'L’image a été enregistrée, mais son lien n’a pas été inséré.',
      }
      return
    }
    view.dispatch(view.state.replaceSelection(imageMarkdown(name)))
  }

  let { onOpen, paneId, tabId }: { onOpen: () => void; paneId: PaneId; tabId: number | null } = $props()
  const tab = $derived(app.tabs.find((item) => item.id === tabId))
  const paneSelection = $derived(selectionForPane(paneId))
  const sourceMode = $derived(workspace[paneId].sourceMode)
  // Recalculé à chaque frappe en vue scindée (le contenu change) : un mémo par onglet n'y
  // gagnerait rien. On saute donc le balayage O(taille) quand le seuil est hors d'atteinte —
  // omitEmbeddedImageData remplace une image d'au moins 18 caractères par 2 de plus au
  // pire, le texte ne dépasse jamais 10/9 de la source.
  const SPLIT_SOURCE_CHARS = 450_000
  const splitLargeSourceMode = $derived(Boolean(
    workspace.split && tab && tab.content.length * 10 >= SPLIT_SOURCE_CHARS * 9 &&
      (tab.kind === 'md' ? markdownTextLength(tab.content) : tab.content.length) >= SPLIT_SOURCE_CHARS,
  ))
  const effectiveSourceMode = $derived(sourceMode || (tab?.heavy ?? false) || splitLargeSourceMode)
  // Onglet HTML en mode rendu : aperçu sandboxé (iframe), pas l'éditeur (FR-8).
  const htmlRender = $derived(tab?.kind === 'html' && !sourceMode)
  // Onglet PDF : viewer lecture seule (11.1), pas l'éditeur.
  const pdfRender = $derived(tab?.kind === 'pdf')
  // Onglet DOCX (ADR-0023) : éditeur SuperDoc, chargé à la demande.
  const docxRender = $derived(tab?.kind === 'docx')

  let host: HTMLElement | undefined = $state()
  let htmlFrame: HTMLIFrameElement | undefined = $state()
  // Nouvel objet à chaque chargement : l'effet de révélation se relance même pour le même onglet.
  let htmlFrameLoad = $state<{ tabId: number } | null>(null)
  let view: EditorView | null = null
  // rev auquel l'état caché de chaque onglet a été construit (invalidation au reload externe).
  let renderedId = -1
  let renderedRev = -1
  let registeredId: number | null = null
  let selectionMenu = $state<{ left: number; top: number; origin: string; kbd: boolean } | null>(null)
  // Dernier geste : clavier (Maj+flèches, Ctrl+A…) ou pointeur. Un menu de sélection né du
  // clavier apparaît sans animation.
  let selectionByKey = false
  let selectionMenuExpanded = $state(false)
  let selectionMenuInsertOpen = $state(false)
  let selectionMenuConfig = $state(false)
  let selectionMenuEl: HTMLElement | undefined = $state()
  let selectionMenuTimer: ReturnType<typeof setTimeout> | undefined
  // Consigne libre (21.x) : le champ REMPLACE sa propre entrée de menu au lieu de s'ajouter
  // dessous — le tiroir garde sa hauteur et l'attention va au seul endroit où l'on écrit.
  let selectionMenuCustomOpen = $state(false)
  let customInstruction = $state('')
  let customInputEl: HTMLInputElement | undefined = $state()

  // Copilote non configuré : le clic sur un verbe affiche une note dans le popover au lieu de
  // lancer une génération vouée à l'échec (brief w3 « Aucun modèle actif »). Chaque
  // fournisseur lit SON état — en MiniMax, l'état du compte OpenAI n'a rien à dire ici.
  const copilotNeedsSetup = $derived.by(() => {
    if (app.copilotProvider === 'openai')
      return copilot.openAiAuthenticated === false || copilot.openAiPreferredAvailable === false
    if (app.copilotProvider === 'minimax')
      return copilot.minimaxStatus !== null && (!copilot.minimaxStatus.keyPresent || copilot.minimaxStatus.keyRejected)
    return !app.activeModel
  })
  const setupNote = $derived(
    app.copilotProvider === 'openai'
      ? 'Compte OpenAI non connecté — connectez-le dans Modèles, ou choisissez un modèle local.'
      : app.copilotProvider === 'minimax'
        ? 'Clé MiniMax non connectée — connectez-la dans Modèles, ou choisissez un modèle local.'
        : 'Aucun modèle actif — choisissez ou téléchargez un modèle pour utiliser Doku-San.',
  )

  function hideSelectionMenu() {
    clearTimeout(selectionMenuTimer)
    selectionMenu = null
    selectionMenuExpanded = false
    selectionMenuConfig = false
    selectionMenuInsertOpen = false
    closeCustomInstruction()
  }

  // La consigne n'est PAS conservée d'une ouverture à l'autre : elle vise un passage précis
  // (« traduis ce paragraphe »), et la ressortir sur une autre sélection serait un piège.
  function closeCustomInstruction() {
    selectionMenuCustomOpen = false
    customInstruction = ''
  }

  function positionSelectionMenu(currentView: EditorView) {
    const sel = currentView.state.selection.main
    if (sel.empty || copilot.generating || rephrase.current || tab?.kind === 'pdf') {
      selectionMenu = null
      return
    }
    const start = currentView.coordsAtPos(sel.from)
    const end = currentView.coordsAtPos(sel.to)
    if (!start || !end) {
      selectionMenu = null
      return
    }

    const menuWidth = 264
    // Hauteur MESURÉE (la constante de repli dérivait à chaque verbe ajouté — critique du
    // plan 21.x). Décomposition exacte quel que soit l'état des DEUX tiroirs (réécriture,
    // insertion — mutuellement exclusifs) : chrome = hauteur totale − hauteurs RENDUES des
    // tiroirs ; hauteur cible = chrome + contenu (scrollHeight) du tiroir qui s'ouvre.
    // Replis calibrés pour la toute première ouverture (menu pas encore dans le DOM).
    const rewInner = selectionMenuEl?.querySelector<HTMLElement>('.selection-rewrite-inner')
    const insInner = selectionMenuEl?.querySelector<HTMLElement>('.selection-insert-inner')
    const chromeH = selectionMenuEl
      ? selectionMenuEl.offsetHeight - (rewInner?.offsetHeight ?? 0) - (insInner?.offsetHeight ?? 0)
      : undefined
    const drawerH = selectionMenuExpanded ? (rewInner?.scrollHeight ?? 0) : selectionMenuInsertOpen ? (insInner?.scrollHeight ?? 0) : 0
    const anyOpen = selectionMenuExpanded || selectionMenuInsertOpen
    const menuHeight = chromeH !== undefined ? chromeH + drawerH : anyOpen ? 470 : 230
    const viewportMargin = 12
    const gap = 8
    const anchorX = end.left
    const editorRect = currentView.dom.getBoundingClientRect()
    const selectionTop = Math.min(start.top, end.top)
    const selectionBottom = Math.max(start.bottom, end.bottom)
    const viewportMaxLeft = window.innerWidth - menuWidth - viewportMargin
    const editorMinLeft = Math.max(viewportMargin, editorRect.left + viewportMargin)
    const editorMaxLeft = Math.min(viewportMaxLeft, editorRect.right - menuWidth - viewportMargin)
    const minLeft = editorMaxLeft >= editorMinLeft ? editorMinLeft : viewportMargin
    const maxLeft = editorMaxLeft >= editorMinLeft ? editorMaxLeft : viewportMaxLeft
    const left = Math.min(Math.max(anchorX - menuWidth / 2, minLeft), maxLeft)
    const above = selectionTop - menuHeight - gap
    // Sous la sélection : plafonné par le bas de la fenêtre, MAIS aussi borné par le haut.
    // Sans cette borne basse, un menu plus haut que la fenêtre (tiroir ouvert, fenêtre
    // courte) se voyait remonter au-dessus du bord supérieur et clippé de l'autre côté.
    const below = Math.max(viewportMargin, Math.min(selectionBottom + gap, window.innerHeight - menuHeight - viewportMargin))
    const top = above >= 48 ? above : below
    // Le menu grandit depuis la sélection (fin de sélection en x, bord le plus proche en
    // y), pas depuis son centre.
    const originX = Math.min(Math.max(anchorX - left, 0), menuWidth)
    // `kbd` décidé à l'ouverture seulement : retirer `.kbd` d'un menu affiché relancerait
    // son animation d'entrée.
    selectionMenu = { left, top, origin: `${originX}px ${above >= 48 ? '100%' : '0'}`, kbd: selectionMenu ? selectionMenu.kbd : selectionByKey }
    selectionMenuTimer = undefined

    // Le menu est RETIRÉ du DOM à chaque fermeture : `selectionMenuEl` est donc undefined
    // à CHAQUE ouverture, et `menuHeight` n'est alors qu'une estimation de repli. Quand
    // elle sous-estime, le plafond calculé plus haut ne plafonne rien et le menu déborde
    // sous le bas de la fenêtre — précisément là où l'on se rabat dessous, faute de place
    // au-dessus. Une seconde passe, une fois l'élément monté, mesure pour de vrai.
    // Pas de récursion : à ce moment `chromeH` est défini, donc rien n'est reprogrammé.
    if (chromeH === undefined) {
      void tick().then(() => {
        if (selectionMenu && selectionMenuEl) positionSelectionMenu(currentView)
      })
    }
  }

  function publishSelection(currentView: EditorView, publishedTabId = renderedId, pointerUp = false) {
    const sel = currentView.state.selection.main
    const text = sel.empty ? '' : currentView.state.sliceDoc(sel.from, sel.to)
    publishEditorSelection(paneId, publishedTabId, currentView, { from: sel.from, to: sel.to, text })
    clearTimeout(selectionMenuTimer)
    // Un aperçu de reformulation en cours a priorité : pas de menu par-dessus le widget.
    // /\S/.test évite la copie intégrale qu'un .trim() ferait sur une grande sélection.
    if (sel.empty || !/\S/.test(text) || rephrase.current) {
      selectionMenu = null
      selectionMenuExpanded = false
      selectionMenuConfig = false
      selectionMenuInsertOpen = false
      return
    }
    if (suppressMenuOnce) {
      suppressMenuOnce = false
      return
    }
    // Sélection à la souris terminée (relâché) : la bulle vient tout de suite. Les 120 ms ne
    // servent qu'au clavier (Maj+flèches en rafale) et au glisser en cours. 0 et non un appel
    // direct : le `mouseup` de CM6 (qui peut encore réduire la sélection) passe d'abord.
    const delay = pointerUp && !selectionByKey ? 0 : 120
    selectionMenuTimer = setTimeout(() => positionSelectionMenu(currentView), delay)
  }

  function toggleRewriteOptions() {
    selectionMenuExpanded = !selectionMenuExpanded
    selectionMenuInsertOpen = false
    selectionMenuConfig = selectionMenuExpanded && copilotNeedsSetup
    closeCustomInstruction()
    if (view) positionSelectionMenu(view)
  }

  function toggleInsertOptions() {
    selectionMenuInsertOpen = !selectionMenuInsertOpen
    selectionMenuExpanded = false
    selectionMenuConfig = false
    closeCustomInstruction()
    if (view) positionSelectionMenu(view)
  }

  // Ouvre le champ de consigne libre. Le focus part dans l'input : la sélection CM6 SURVIT au
  // blur (elle vit dans l'état, pas dans le DOM), c'est elle que `rephraseSelection` relira.
  // Repositionnement APRÈS le rendu — la hauteur du tiroir a changé.
  async function openCustomInstruction() {
    if (copilotNeedsSetup) {
      selectionMenuConfig = true
      if (view) positionSelectionMenu(view)
      return
    }
    selectionMenuCustomOpen = true
    await tick()
    if (view) positionSelectionMenu(view)
    customInputEl?.focus()
  }

  function submitCustomInstruction(event: Event) {
    event.preventDefault()
    const consigne = normalizeInstruction(customInstruction)
    if (!consigne) return
    hideSelectionMenu()
    void rephraseSelection('custom', consigne)
  }

  // Échap dans le champ referme le champ, PAS tout le menu : le geste « je me suis trompé de
  // consigne » ne doit pas coûter la sélection. Le preventDefault protège du handler document,
  // qui écarterait le menu entier ; un second Échap l'atteindra.
  async function onCustomKeyDown(event: KeyboardEvent) {
    if (event.key !== 'Escape') return
    event.preventDefault()
    closeCustomInstruction()
    await tick()
    if (!view) return
    positionSelectionMenu(view)
    view.focus()
  }

  // mousedown : preventDefault SEUL — ne pas voler focus/sélection à l'éditeur
  // (motif rephrase-preview) ; l'action part au click.
  function keepEditorFocus(e: MouseEvent) {
    e.preventDefault()
  }

  // Effets inline (gras, italique…) : la sélection persiste → le menu reste ouvert
  // pour enchaîner (Ctrl+B puis Ctrl+I), l'updateListener le repositionne.
  function runFormat(cmd: (v: EditorView) => boolean) {
    if (!view) return
    cmd(view)
    view.focus()
  }

  // Actions du tiroir (titres, blocs) : le geste est complet → le menu se referme.
  // Les opérations de ligne gardent la sélection → l'updateListener republierait le
  // menu aussitôt ; on avale UNE publication (le prochain geste le rouvrira).
  let suppressMenuOnce = false
  function runInsertAction(cmd: (v: EditorView) => boolean) {
    if (!view) return
    const v = view
    hideSelectionMenu()
    suppressMenuOnce = true
    cmd(v)
    v.focus()
  }

  async function copySelection() {
    const text = paneSelection.text
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      hideSelectionMenu()
    } catch {
      view?.focus()
    }
  }

  async function cutSelection() {
    if (!view) return
    const { from, to } = view.state.selection.main
    const text = view.state.sliceDoc(from, to)
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      view.dispatch({
        changes: { from, to, insert: '' },
        selection: { anchor: from },
        userEvent: 'delete.cut',
      })
      view.focus()
      hideSelectionMenu()
    } catch {
      view.focus()
    }
  }

  async function pasteClipboard() {
    if (!view) return
    try {
      const text = await navigator.clipboard.readText()
      if (!text) return
      const { from, to } = view.state.selection.main
      view.dispatch({
        changes: { from, to, insert: text },
        selection: { anchor: from + text.length },
        userEvent: 'input.paste',
      })
      view.focus()
      hideSelectionMenu()
    } catch {
      view.focus()
    }
  }

  // Lance la proposition EN PLACE (brief w3) : le panneau ne s'ouvre plus, l'aperçu recouvre
  // la sélection dans l'éditeur (rephrase-preview) jusqu'à Accepter/Refuser.
  function runSelectionAction(mode: RephraseMode) {
    if (copilotNeedsSetup) {
      selectionMenuConfig = true
      if (view) positionSelectionMenu(view)
      return
    }
    hideSelectionMenu()
    void rephraseSelection(mode)
  }

  function openModelSettings() {
    hideSelectionMenu()
    cancelRephrase()
    openCopilot('models')
  }

  function makeState(tabId: number, content: string): EditorState {
    const tab = app.tabs.find((t) => t.id === tabId)
    const dir = parentPath(tab?.path ?? null) ?? ''
    const extra: Extension[] = [
      docDirCompartment.of(docDirFacet.of(dir)),
      searchFlashField,
      rephrasePreviewField,
      EditorView.updateListener.of((u) => {
        if (u.docChanged) {
          const t = app.tabs.find((x) => x.id === tabId)
          if (t) t.content = serializeDoc(u.state.doc.toString(), t.eol)
          // Édition étrangère pendant un aperçu de reformulation : le champ s'est déjà vidé
          // atomiquement ; on annule la machine (abort si streaming) — rien n'était écrit.
          // Les $effect Svelte tournent en microtâche APRÈS le cycle CM → aucun dispatch
          // pendant un update en cours.
          if (rephrase.current && !isRephrasePreviewUpdate(u)) cancelRephrase()
        }
        const runtimeTab = app.tabs.find((item) => item.id === tabId)
        if (runtimeTab) cacheEditorRuntime(tabId, u.state, runtimeTab.rev, lastScrollTop.get(u.view) ?? 0)
        // Publie la sélection courante (16.1) : le copilote propose « Reformuler » quand
        // `text` est non vide. Sur édition, les bornes bougent → on republie aussi.
        if (u.selectionSet || u.docChanged) {
          publishSelection(u.view, tabId)
        }
      }),
    ]
    // Coller une image (12.1) : Markdown uniquement (le lien ![]() n'a de sens qu'en md).
    if (tab?.kind === 'md') extra.push(imagePasteHandler(tabId))
    return EditorState.create({
      doc: content,
      extensions:
        tab?.kind === 'html'
          ? htmlSourceExtensions(extra)
          : tab?.kind === 'txt'
            ? txtExtensions(extra)
            : baseExtensions(effectiveSourceMode, extra),
    })
  }

  // Scroll-spy : titre courant = dernier titre au-dessus du haut du viewport (4.6).
  // Titres seulement pour le Markdown (un .txt/.html n'a pas de structure de titres).
  function updateActiveHeading(v: EditorView) {
    if (workspace.activePaneId !== paneId) return
    // Gros fichier : pas de scroll-spy (docHeadings est O(doc), gèlerait le scroll).
    const headings = tab?.kind === 'md' && !tab.heavy ? docHeadings(tab.content) : []
    if (!headings.length) {
      app.activeHeadingLine = 0
      return
    }
    const block = v.elementAtHeight(v.scrollDOM.scrollTop + 24)
    const topLine = v.state.doc.lineAt(block.from).number
    let active = headings[0].line
    for (const h of headings) {
      if (h.line <= topLine) active = h.line
      else break
    }
    app.activeHeadingLine = active
  }

  // Le zoom change la hauteur des lignes : CodeMirror remesure (curseur, défilement), et le
  // volet actif affiche brièvement le niveau — y compris au clavier (Ctrl+0/=/-), mais
  // l'entrée du badge ne s'anime que pour Ctrl+molette : un raccourci reste immobile.
  let zoomBadge = $state(false)
  let zoomBadgeKbd = $state(false)
  let zoomBadgeTimer: ReturnType<typeof setTimeout> | undefined
  let seenZoom = app.docZoom
  // Posé par Ctrl+molette juste avant zoomDocText, consommé par l'effet ci-dessous.
  let wheelZoomPending = false
  $effect(() => {
    const zoom = app.docZoom
    view?.requestMeasure()
    if (zoom === seenZoom) return
    seenZoom = zoom
    const fromWheel = wheelZoomPending
    wheelZoomPending = false
    if (paneId !== workspace.activePaneId) return
    // Décidé à l'apparition seulement : retirer `.kbd` du badge affiché rejouerait l'entrée.
    if (!zoomBadge) zoomBadgeKbd = !fromWheel
    zoomBadge = true
    clearTimeout(zoomBadgeTimer)
    zoomBadgeTimer = setTimeout(() => (zoomBadge = false), 1400)
  })

  onMount(() => {
    view = new EditorView({ parent: host! })
    if (tabId != null) {
      registerEditor(paneId, tabId, view)
      registeredId = tabId
    }
    // Throttle rAF : le scroll molette émet 60-100 events/s ; un seul updateActiveHeading
    // par frame suffit (le scroll-spy vise la frame affichée, pas chaque event).
    let scrollScheduled = false
    const onScroll = () => {
      selectionMenu = null
      if (!view) return
      const top = view.scrollDOM.scrollTop
      lastScrollTop.set(view, top)
      const current = app.tabs.find((item) => item.id === renderedId)
      if (current) cacheEditorRuntime(current.id, view.state, current.rev, top)
      if (scrollScheduled) return
      scrollScheduled = true
      requestAnimationFrame(() => {
        scrollScheduled = false
        if (view) updateActiveHeading(view)
      })
    }
    const onSelectionIntent = () => {
      if (!view) return
      publishSelection(view, renderedId, true)
    }
    const onPointerDown = (event: PointerEvent) => {
      selectionByKey = false
      const target = event.target as Node | null
      if (selectionMenuEl?.contains(target)) return
      if (view?.dom.contains(target)) return
      hideSelectionMenu()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      selectionByKey = true
      if (event.key !== 'Escape') return
      // Un Échap déjà consommé par un autre overlay (modale, recherche…) ne doit pas écarter
      // une proposition qui a coûté une génération complète.
      if (event.defaultPrevented) return
      // Priorité à l'aperçu de reformulation : Échap = annuler (streaming) ou refuser (prêt),
      // document intact dans tous les cas (brief w3).
      if (rephrase.current) {
        cancelRephrase()
        return
      }
      if (selectionMenu) hideSelectionMenu()
    }
    // Ctrl+molette : zoom du texte, ancré sur la ligne sous le pointeur (elle reste sous la
    // souris au lieu de glisser). Écouté sur l'éditeur seul : PDF, Word et aperçu HTML le
    // masquent et gardent leur propre zoom. Throttle : un pavé tactile émet des rafales.
    let lastWheelZoom = 0
    const onWheel = (event: WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey) || !event.deltaY || !view) return
      event.preventDefault()
      const now = Date.now()
      if (now - lastWheelZoom < 90) return
      lastWheelZoom = now
      const anchor = view.posAtCoords({ x: event.clientX, y: event.clientY })
      const offset = event.clientY - view.scrollDOM.getBoundingClientRect().top
      wheelZoomPending = true
      const changed = zoomDocText(event.deltaY < 0 ? 1 : -1)
      if (!changed) wheelZoomPending = false
      if (!changed || anchor == null) return
      requestAnimationFrame(() => {
        view?.requestMeasure()
        view?.dispatch({ effects: EditorView.scrollIntoView(anchor, { y: 'start', yMargin: offset }) })
      })
    }
    view.dom.addEventListener('wheel', onWheel, { passive: false })
    view.scrollDOM.addEventListener('scroll', onScroll, { passive: true })
    // Pas de listener keyup : toute sélection clavier passe par un dispatch CM6, déjà
    // couvert par l'updateListener (selectionSet) — le keyup doublait chaque publication.
    view.dom.addEventListener('pointerup', onSelectionIntent)
    window.addEventListener('resize', hideSelectionMenu)
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      clearTimeout(selectionMenuTimer)
      view?.dom.removeEventListener('wheel', onWheel)
      view?.scrollDOM.removeEventListener('scroll', onScroll)
      clearTimeout(zoomBadgeTimer)
      view?.dom.removeEventListener('pointerup', onSelectionIntent)
      window.removeEventListener('resize', hideSelectionMenu)
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      const current = app.tabs.find((item) => item.id === renderedId)
      if (current && view) cacheEditorRuntime(current.id, view.state, current.rev, view.scrollDOM.scrollTop)
      if (view && registeredId != null) unregisterEditor(paneId, registeredId, view)
      view?.destroy()
    }
  })

  $effect(() => {
    if (!view) return
    const currentDir = parentPath(tab?.path ?? null) ?? ''
    if (tab) {
      if (registeredId == null) registerEditor(paneId, tab.id, view)
      else updateEditorRegistration(paneId, tab.id, view)
      registeredId = tab.id
    } else if (registeredId != null) {
      unregisterEditor(paneId, registeredId, view)
      registeredId = null
    }
    if (tab && tab.id !== renderedId) {
      if (renderedId !== -1) {
        // Ne jamais mettre en cache un état portant encore l'aperçu de reformulation : au
        // retour sur l'onglet, la décoration renaîtrait orpheline (l'effet de sync la
        // nettoierait, mais la robustesse ne doit pas dépendre de cet ordre).
        if ((view.state.field(rephrasePreviewField, false)?.size ?? 0) > 0) {
          view.dispatch({ effects: setRephrasePreview.of(null) })
        }
        const previous = app.tabs.find((item) => item.id === renderedId)
        if (previous) cacheEditorRuntime(previous.id, view.state, previous.rev, view.scrollDOM.scrollTop)
      }
      // Cache réutilisable seulement s'il a été bâti au rev courant de l'onglet.
      const cached = editorRuntimeForTab(tab.id, tab.rev)
      view.setState(cached?.state ?? makeState(tab.id, tab.content))
      renderedId = tab.id
      renderedRev = tab.rev
      if (cached) requestAnimationFrame(() => {
        if (view && renderedId === tab.id) view.scrollDOM.scrollTop = cached.scrollTop
      })
    } else if (tab && tab.rev !== renderedRev) {
      // Onglet actif rechargé depuis le disque : reconstruire depuis le contenu frais.
      view.setState(makeState(tab.id, tab.content))
      renderedRev = tab.rev
      cacheEditorRuntime(tab.id, view.state, tab.rev, 0)
    }
    if (tab && view.state.facet(docDirFacet) !== currentDir) {
      view.dispatch({ effects: docDirCompartment.reconfigure(docDirFacet.of(currentDir)) })
    }
    const useSource = effectiveSourceMode
    view.dispatch({ effects: livePreviewComp.reconfigure(useSource ? sourceExtensions() : previewExtensions()) })
    view.requestMeasure({ read: () => view && updateActiveHeading(view) })
    // Resync de la sélection publiée (16.1) : setState (changement d'onglet/reload) ne déclenche
    // pas toujours selectionSet — on lit l'état courant pour éviter une sélection périmée.
    const sel = view.state.selection.main
    publishEditorSelection(paneId, tab?.id ?? -1, view, {
      from: sel.from,
      to: sel.to,
      text: sel.empty ? '' : view.state.sliceDoc(sel.from, sel.to),
    })
    selectionMenu = null
  })

  $effect(() => {
    if (copilot.generating || app.copilotExpanded || htmlRender || pdfRender) hideSelectionMenu()
  })

  // Aperçu de reformulation en place (16.2, brief w3). Déclaré APRÈS l'effet de switch
  // d'onglet : quand l'onglet ou son rev change, le setState tourne d'abord — on revalide
  // ensuite ici que la plage porte toujours l'original. Indispensable pour le rechargement
  // externe (bump de rev) : setState ne passe par AUCUNE transaction, ni l'auto-dismiss du
  // champ ni l'updateListener ne le voient.
  // En-tête de l'aperçu pendant le streaming. Une consigne libre RÉPÈTE la consigne : c'est la
  // seule trace de ce qui a été demandé (le champ est refermé), et elle rend l'aperçu lisible
  // quand plusieurs essais s'enchaînent. Tronquée — l'en-tête partage sa ligne avec « Échap ».
  const LABEL_INSTRUCTION_MAX = 38
  function rephraseLabel(cur: { mode: RephraseMode; instruction: string }): string {
    if (cur.mode === 'correct') return 'Doku-San corrige…'
    if (cur.mode !== 'custom') return 'Doku-San reformule…'
    const consigne =
      cur.instruction.length > LABEL_INSTRUCTION_MAX
        ? `${cur.instruction.slice(0, LABEL_INSTRUCTION_MAX - 1).trimEnd()}…`
        : cur.instruction
    return `Doku-San : « ${consigne} »`
  }

  const rephraseDiff = $derived(
    rephrase.current?.phase === 'ready' ? diffWords(rephrase.current.original, rephrase.current.text) : [],
  )
  $effect(() => {
    const cur = rephrase.current
    void tab?.rev // re-déclenche sur rechargement externe de l'onglet affiché
    if (!view) return
    if (workspace.activePaneId !== paneId) {
      syncRephrasePreview(view, null, { onAccept: acceptRephrase, onReject: cancelRephrase, onRetry: retryRephrase, onChooseModel: openModelSettings })
      return
    }
    if (cur) {
      const stale =
        cur.tabId !== tab?.id ||
        cur.to > view.state.doc.length ||
        view.state.sliceDoc(cur.from, cur.to) !== cur.original
      if (stale) {
        cancelRephrase()
        return
      }
    }
    syncRephrasePreview(
      view,
      cur
        ? {
            from: cur.from,
            to: cur.to,
            snapshot: {
              phase: cur.phase,
              label: rephraseLabel(cur),
              text: cur.text,
              diff: rephraseDiff,
              message: cur.error,
              busy: copilot.generating,
            },
          }
        : null,
      { onAccept: acceptRephrase, onReject: cancelRephrase, onRetry: retryRephrase, onChooseModel: openModelSettings },
    )
  })

  // Révélation d'une occurrence de recherche (9.4). Déclaré APRÈS l'effet de switch
  // d'onglet ci-dessus : quand un clic ouvre un onglet, le setState y tourne d'abord
  // (contenu prêt), puis celui-ci saute + surligne. Onglet déjà actif : contenu déjà là.
  $effect(() => {
    const reveal = app.pendingReveal
    if (!reveal || !tab || tab.path !== reveal.path || (reveal.tabId != null && reveal.tabId !== tab.id)) return
    // HTML en aperçu : l'éditeur est masqué, le passage se révèle dans l'iframe. Tant que
    // srcdoc charge (ou montre encore l'onglet précédent), `htmlFrameLoad` relancera l'effet.
    if (htmlRender && reveal.text) {
      if (!htmlFrame || htmlFrameLoad?.tabId !== tab.id) return
      if (revealHtmlPassage(htmlFrame, reveal.text, app.theme === 'dark') === 'pending') return
      app.pendingReveal = null
      return
    }
    if (!view) return
    revealMatch(view, reveal.line, reveal.col, reveal.length, { select: reveal.select })
    app.pendingReveal = null
  })
</script>

<div class="doc">
  {#if zoomBadge}
    <button class="zoom-badge" class:kbd={zoomBadgeKbd} use:tooltip={{ label: 'Revenir à 100 %', kbd: 'Ctrl+0' }} onclick={() => zoomDocText(0)}>{Math.round(app.docZoom * 100)} %</button>
  {/if}
  {#if tab?.heavy && !app.focus}
    <div class="heavy-notice" role="status">
      <svg class="icon" style="font-size:16px" aria-hidden="true"><use href="#i-zap" /></svg>
      <span>Fichier volumineux — affiché en mode source pour rester fluide.</span>
      <button class="heavy-action" onclick={() => forcePreview(tab!.id)}>Afficher l'aperçu</button>
    </div>
  {/if}
  {#if splitLargeSourceMode && !tab?.heavy && !app.focus}
    <div class="heavy-notice" role="status">
      <svg class="icon" style="font-size:16px" aria-hidden="true"><use href="#i-zap" /></svg>
      <span>Vue scindée — aperçu suspendu pour garder ce document volumineux fluide.</span>
    </div>
  {/if}
  {#if app.focus && tab && isDirty(tab)}
    <!-- Mode focus : les onglets sont masqués ; on garde un signal « non enregistré » discret. -->
    <span class="focus-dirty" title="Modifications non enregistrées" aria-label="Modifications non enregistrées"></span>
  {/if}
  {#if htmlRender}
    <iframe class="html-view" title="Aperçu HTML" sandbox="allow-same-origin" bind:this={htmlFrame} onload={() => (htmlFrameLoad = { tabId: tab!.id })} srcdoc={sandboxDoc(tab!.content, app.theme, COLUMN_PX[app.columnWidth])}></iframe>
  {/if}
  {#if docxRender}
    <!-- Keyé par id, comme le PDF : changer d'onglet détruit l'instance SuperDoc. -->
    {#key tab!.id}
      <DocxView path={tab!.path ?? ''} tabId={tab!.id} />
    {/key}
  {/if}
  {#if pdfRender}
    <!-- Keyé par id : changer d'onglet PDF remonte le viewer → pdf.destroy()/cancel au démontage. -->
    {#key tab!.id}
      <PdfView path={tab!.path ?? ''} {paneId} />
    {/key}
  {/if}
  <div class="editor-host doku-doc" class:source-mode={effectiveSourceMode} class:txt={tab?.kind === 'txt'} class:hidden={htmlRender || pdfRender || docxRender} bind:this={host}></div>

  {#if selectionMenu}
    <div
      class="selection-menu"
      class:expanded={selectionMenuExpanded}
      class:kbd={selectionMenu.kbd}
      bind:this={selectionMenuEl}
      style="left:{selectionMenu.left}px;top:{selectionMenu.top}px;transform-origin:{selectionMenu.origin}"
      role="menu"
      aria-label="Actions sur la sélection"
    >
      {#if tab?.kind === 'md'}
        <div class="selection-format-row" role="group" aria-label="Mise en forme">
          <button class="selection-format-btn" use:tooltip={{ label: 'Gras', kbd: 'Ctrl+B' }} aria-label="Gras" onmousedown={keepEditorFocus} onclick={() => runFormat(toggleBold)}>
            <svg class="icon" aria-hidden="true"><use href="#i-bold" /></svg>
          </button>
          <button class="selection-format-btn" use:tooltip={{ label: 'Italique', kbd: 'Ctrl+I' }} aria-label="Italique" onmousedown={keepEditorFocus} onclick={() => runFormat(toggleItalic)}>
            <svg class="icon" aria-hidden="true"><use href="#i-italic" /></svg>
          </button>
          <button class="selection-format-btn" use:tooltip={'Barré'} aria-label="Barré" onmousedown={keepEditorFocus} onclick={() => runFormat(toggleStrike)}>
            <svg class="icon" aria-hidden="true"><use href="#i-strikethrough" /></svg>
          </button>
          <button class="selection-format-btn" use:tooltip={'Code inline'} aria-label="Code inline" onmousedown={keepEditorFocus} onclick={() => runFormat(toggleInlineCode)}>
            <svg class="icon" aria-hidden="true"><use href="#i-code" /></svg>
          </button>
          <button class="selection-format-btn" use:tooltip={{ label: 'Lien', kbd: 'Ctrl+K' }} aria-label="Lien" onmousedown={keepEditorFocus} onclick={() => runFormat(toggleLink)}>
            <svg class="icon" aria-hidden="true"><use href="#i-link" /></svg>
          </button>
        </div>
        <div class="selection-menu-sep"></div>
      {/if}
      <button class="selection-menu-action" role="menuitem" onclick={copySelection}>
        <svg class="icon" aria-hidden="true"><use href="#i-copy" /></svg><span class="selection-menu-label">Copier</span><kbd>Ctrl+C</kbd>
      </button>
      <button class="selection-menu-action" role="menuitem" onclick={cutSelection}>
        <svg class="icon" aria-hidden="true"><use href="#i-scissors" /></svg><span class="selection-menu-label">Couper</span><kbd>Ctrl+X</kbd>
      </button>
      <button class="selection-menu-action" role="menuitem" onclick={pasteClipboard}>
        <svg class="icon" aria-hidden="true"><use href="#i-clipboard-paste" /></svg><span class="selection-menu-label">Coller</span><kbd>Ctrl+V</kbd>
      </button>
      <div class="selection-menu-sep"></div>
      {#if tab?.kind === 'md'}
        <button
          class="selection-menu-action selection-menu-rewrite"
          class:open={selectionMenuInsertOpen}
          role="menuitem"
          aria-haspopup="true"
          aria-expanded={selectionMenuInsertOpen}
          onclick={toggleInsertOptions}
        >
          <svg class="icon" aria-hidden="true"><use href="#i-heading-1" /></svg>
          <span class="selection-menu-label">Titres &amp; blocs</span>
          <svg class="icon selection-menu-chevron" aria-hidden="true"><use href="#i-chevron-right" /></svg>
        </button>
        <div
          class="selection-rewrite-options"
          class:open={selectionMenuInsertOpen}
          role="group"
          aria-label="Titres et blocs"
          aria-hidden={!selectionMenuInsertOpen}
          inert={!selectionMenuInsertOpen}
        >
          <div class="selection-insert-inner">
            <button class="selection-menu-action selection-menu-subaction" role="menuitem" onmousedown={keepEditorFocus} onclick={() => runInsertAction((v) => setHeading(v, 1))}>
              <svg class="icon" aria-hidden="true"><use href="#i-heading-1" /></svg><span>Titre 1</span>
            </button>
            <button class="selection-menu-action selection-menu-subaction" role="menuitem" onmousedown={keepEditorFocus} onclick={() => runInsertAction((v) => setHeading(v, 2))}>
              <svg class="icon" aria-hidden="true"><use href="#i-heading-2" /></svg><span>Titre 2</span>
            </button>
            <button class="selection-menu-action selection-menu-subaction" role="menuitem" onmousedown={keepEditorFocus} onclick={() => runInsertAction((v) => setHeading(v, 3))}>
              <svg class="icon" aria-hidden="true"><use href="#i-heading-3" /></svg><span>Titre 3</span>
            </button>
            <button class="selection-menu-action selection-menu-subaction" role="menuitem" onmousedown={keepEditorFocus} onclick={() => runInsertAction(toggleList)}>
              <svg class="icon" aria-hidden="true"><use href="#i-list" /></svg><span>Liste</span>
            </button>
            <button class="selection-menu-action selection-menu-subaction" role="menuitem" onmousedown={keepEditorFocus} onclick={() => runInsertAction(toggleQuote)}>
              <svg class="icon" aria-hidden="true"><use href="#i-quote" /></svg><span>Citation</span>
            </button>
            <button class="selection-menu-action selection-menu-subaction" role="menuitem" onmousedown={keepEditorFocus} onclick={() => runInsertAction(wrapCodeBlock)}>
              <svg class="icon" aria-hidden="true"><use href="#i-code" /></svg><span>Bloc de code</span>
            </button>
            <button class="selection-menu-action selection-menu-subaction" role="menuitem" onmousedown={keepEditorFocus} onclick={() => runInsertAction(insertHr)}>
              <svg class="icon" aria-hidden="true"><use href="#i-minus" /></svg><span>Séparateur</span>
            </button>
            <button class="selection-menu-action selection-menu-subaction" role="menuitem" onmousedown={keepEditorFocus} onclick={() => runInsertAction(insertTable)}>
              <svg class="icon" aria-hidden="true"><use href="#i-table" /></svg><span>Tableau</span>
            </button>
          </div>
        </div>
      {/if}
      <button
        class="selection-menu-action selection-menu-rewrite"
        class:open={selectionMenuExpanded}
        role="menuitem"
        aria-haspopup="true"
        aria-expanded={selectionMenuExpanded}
        onclick={toggleRewriteOptions}
      >
        <span class="selection-menu-spark"><svg class="icon" aria-hidden="true"><use href="#i-sparkles" /></svg></span>
        <span class="selection-menu-label">Réécrire avec Doku-San</span>
        <svg class="icon selection-menu-chevron" aria-hidden="true"><use href="#i-chevron-right" /></svg>
      </button>
      <div
        class="selection-rewrite-options"
        class:open={selectionMenuExpanded}
        role="group"
        aria-label="Options de réécriture"
        aria-hidden={!selectionMenuExpanded}
        inert={!selectionMenuExpanded}
      >
        <div class="selection-rewrite-inner">
          {#if selectionMenuConfig}
            <div class="selection-menu-note" role="note">{setupNote}</div>
            <button class="selection-menu-action selection-menu-subaction" role="menuitem" onclick={openModelSettings}>
              <svg class="icon" aria-hidden="true"><use href="#i-layers" /></svg><span>Choisir un modèle</span>
            </button>
          {:else}
            <button class="selection-menu-action selection-menu-subaction" role="menuitem" onclick={() => runSelectionAction('clarify')}>
              <svg class="icon" aria-hidden="true"><use href="#i-wand-sparkles" /></svg><span>Clarifier</span>
            </button>
            <button class="selection-menu-action selection-menu-subaction" role="menuitem" onclick={() => runSelectionAction('shorten')}>
              <svg class="icon" aria-hidden="true"><use href="#i-shrink" /></svg><span>Raccourcir</span>
            </button>
            <button class="selection-menu-action selection-menu-subaction" role="menuitem" onclick={() => runSelectionAction('tone')}>
              <svg class="icon" aria-hidden="true"><use href="#i-sliders-horizontal" /></svg><span>Adopter un ton neutre</span>
            </button>
            <button class="selection-menu-action selection-menu-subaction" role="menuitem" onclick={() => runSelectionAction('correct')}>
              <svg class="icon" aria-hidden="true"><use href="#i-spell-check" /></svg><span>Corriger</span>
            </button>
            <button class="selection-menu-action selection-menu-subaction" role="menuitem" onclick={() => runSelectionAction('bullets')}>
              <svg class="icon" aria-hidden="true"><use href="#i-list" /></svg><span>En liste à puces</span>
            </button>
            <button class="selection-menu-action selection-menu-subaction" role="menuitem" onclick={() => runSelectionAction('tasks')}>
              <svg class="icon" aria-hidden="true"><use href="#i-list-checks" /></svg><span>En cases à cocher</span>
            </button>
            <div class="selection-menu-sep"></div>
            {#if selectionMenuCustomOpen}
              <form class="selection-custom" onsubmit={submitCustomInstruction}>
                <input
                  class="selection-custom-field"
                  bind:this={customInputEl}
                  bind:value={customInstruction}
                  onkeydown={onCustomKeyDown}
                  type="text"
                  maxlength={MAX_INSTRUCTION}
                  autocomplete="off"
                  spellcheck="false"
                  placeholder="Traduis en anglais…"
                  aria-label="Votre consigne pour Doku-San"
                />
                <button class="selection-custom-send" type="submit" disabled={!customInstruction.trim()} aria-label="Appliquer la consigne">
                  <svg class="icon" aria-hidden="true"><use href="#i-arrow-up" /></svg>
                </button>
              </form>
            {:else}
              <button class="selection-menu-action selection-menu-subaction" role="menuitem" onclick={openCustomInstruction}>
                <svg class="icon" aria-hidden="true"><use href="#i-notebook-pen" /></svg><span>Demander autre chose…</span>
              </button>
            {/if}
          {/if}
        </div>
      </div>
    </div>
  {/if}

  {#if !tab}
    <div class="empty">
      <span class="empty-mark"><DokuMark size={64} /></span>
      <p class="empty-title">Aucun document ouvert</p>
      <button class="empty-open" onclick={onOpen}>
        <svg class="icon" style="font-size:16px" aria-hidden="true"><use href="#i-folder-open" /></svg>
        Ouvrir un fichier
        <span class="keys"><kbd>Ctrl+O</kbd></span>
      </button>
      <dl class="empty-shortcuts">
        <div><dt><kbd>Ctrl+/</kbd></dt><dd>source ↔ rendu</dd></div>
        <div><dt><kbd>F9</kbd></dt><dd>mode focus</dd></div>
        <div><dt><kbd>Ctrl+Maj+E</kbd></dt><dd>explorateur</dd></div>
        <div><dt><kbd>Ctrl+Maj+P</kbd></dt><dd>plan</dd></div>
      </dl>
    </div>
  {/if}
</div>

<style>
  .doc { position: relative; flex: 1; min-height: 0; display: flex; flex-direction: column; background: var(--cream-content); }
  .zoom-badge {
    position: absolute; z-index: 20; left: 50%; bottom: 22px; transform: translateX(-50%);
    height: var(--control-sm); padding: 0 12px; border: 0; border-radius: var(--radius-full);
    background: var(--ink); color: var(--cream-content);
    font: var(--weight-control) var(--text-sm) var(--font-sans); font-variant-numeric: tabular-nums; cursor: pointer;
    box-shadow: var(--shadow-lg); animation: zoom-badge-in var(--duration-basic) var(--ease-enter);
  }
  @keyframes zoom-badge-in { from { opacity: 0; translate: 0 4px; } }
  .zoom-badge.kbd { animation: none; }

  /* Alerte en ligne à la Kube : filet plutôt qu'ombre, une seule action secondaire. */
  .heavy-notice {
    flex: none;
    max-width: var(--doc-width, 680px);
    width: 100%;
    margin: 8px auto 0;
    padding: 6px 6px 6px 12px;
    min-height: var(--control-lg);
    display: flex;
    align-items: center;
    gap: 8px;
    border-radius: var(--radius-xl);
    background: var(--surface);
    box-shadow: inset 0 0 0 1px var(--line-1);
    color: var(--ink-3);
    font-size: var(--text-xs);
  }
  /* --warn seul tombe à 2,2:1 sur la surface : la teinte texte garde le sens lisible. */
  .heavy-notice > .icon { color: var(--warn-text); }
  .heavy-notice > span { flex: 1; min-width: 0; }
  .heavy-action {
    flex: none;
    height: var(--control-2xs);
    padding: 0 10px;
    border: 0;
    /* Concentrique : notice --radius-xl (12) − gouttière 6 = 6. */
    border-radius: var(--radius-sm);
    background: var(--accent-soft);
    color: var(--ink);
    font-size: var(--text-sm);
    font-weight: var(--weight-control);
    cursor: pointer;
    transition: background-color var(--duration-basic) ease;
  }
  .heavy-action:hover { background: rgba(var(--ink-rgb), 0.12); }
  .heavy-action:focus-visible { outline-offset: -1px; }

  .empty {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 24px 12px;
    background: var(--cream-content);
    user-select: none;
  }
  .empty-mark { display: inline-flex; color: var(--ink-4); opacity: 0.35; }
  .empty-title { margin: 0; font-size: var(--text-lg); line-height: 24px; font-weight: var(--weight-strong); letter-spacing: var(--tracking-tight); color: var(--ink-2); text-wrap: balance; }
  .empty-open {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: var(--control-md);
    margin-top: 4px;
    padding: 0 8px 0 12px;
    border: 0;
    border-radius: var(--radius-lg);
    background: var(--accent-soft);
    color: var(--ink);
    font-size: 13px;
    font-weight: 510;
    cursor: pointer;
    transition: background-color var(--duration-basic) ease;
  }
  .empty-open:hover { background: rgba(var(--ink-rgb), 0.12); }
  .empty-open .keys { display: inline-flex; gap: 2px; margin-left: 4px; color: var(--ink-3); }
  /* Touche à la Kube : capuchon plat teinté par la couleur du texte qui l'entoure, donc
     juste dans le bouton comme dans la liste des raccourcis sans règle de plus. */
  .empty kbd {
    min-width: 16px;
    padding: 2px 5px;
    border-radius: var(--radius-xs);
    background: color-mix(in srgb, currentColor 10%, transparent);
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    font-weight: 400;
    line-height: 1;
    text-align: center;
  }
  .empty-shortcuts {
    margin: 12px 0 0;
    display: grid;
    grid-template-columns: auto auto;
    gap: 8px 24px;
    font-size: 12px;
    color: var(--ink-3);
  }
  .empty-shortcuts div { display: flex; align-items: center; gap: 8px; }
  .empty-shortcuts dt { display: inline-flex; gap: 2px; }
  .empty-shortcuts dd { margin: 0; }
  .focus-dirty {
    position: absolute;
    top: 14px;
    right: 16px;
    z-index: 2;
    width: 7px;
    height: 7px;
    border-radius: var(--radius-full);
    background: var(--ink-3);
    opacity: 0.55;
    pointer-events: none;
  }
  .editor-host { flex: 1; min-height: 0; user-select: text; }
  .editor-host.hidden { display: none; }
  .html-view {
    flex: 1;
    min-height: 0;
    width: 100%;
    border: 0;
    background: var(--cream-content);
  }
  .editor-host :global(.cm-editor) { height: 100%; }

  /* Menu de sélection à la Kube : surface élevée opaque (le texte dessous bouge), gouttière
     4px, rangées de 32px au rayon concentrique (12 − 4 = 8), ombre de rôle « menu ». */
  .selection-menu {
    position: fixed;
    z-index: var(--z-popover);
    width: 264px;
    padding: 4px;
    border-radius: var(--radius-xl);
    background: var(--composer-bg);
    box-shadow: var(--shadow-xl);
    color: var(--ink);
    font-family: var(--font-sans);
    font-size: 13px;
    user-select: none;
    animation: doku-pop-in var(--duration-basic) var(--ease-enter-snappy);
    /* Filet : même si la mesure se trompe, le menu reste entièrement atteignable —
       il défile au lieu d'avoir ses derniers boutons coupés hors écran. */
    max-height: calc(100vh - 24px);
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  .selection-menu.kbd { animation: none; }
  .selection-menu-sep { height: 1px; margin: 4px 8px; background: var(--line-1); }
  .selection-format-row { display: flex; gap: 2px; }
  .selection-format-btn {
    flex: 1;
    height: var(--control-sm);
    display: grid;
    place-items: center;
    border: 0;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--ink-3);
    cursor: pointer;
    transition: background-color var(--duration-basic) ease, color var(--duration-basic) ease;
  }
  .selection-format-btn .icon { font-size: 16px; }
  .selection-format-btn:hover { background: rgba(var(--ink-rgb), 0.06); color: var(--ink); }
  .selection-format-btn:active { background: rgba(var(--ink-rgb), 0.12); }
  .selection-format-btn:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: -1px; }
  /* Doigt : changements VISIBLES → dernier pointeur utilisé (main.ts), pas `any-pointer`. */
  :global(:root[data-input='touch']) .selection-format-btn { height: 40px; min-width: 36px; }
  :global(:root[data-input='touch']) .selection-menu-action,
  :global(:root[data-input='touch']) .selection-custom { min-height: 40px; }
  .selection-menu-action {
    width: 100%;
    height: var(--control-md);
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 8px;
    border: 0;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--ink);
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition: background-color var(--duration-basic) ease;
  }
  .selection-menu-action .icon { font-size: 15px; color: var(--ink-4); transition: color var(--duration-basic) ease; }
  /* `overflow: hidden` n'est PAS décoratif : sans lui, un libellé trop long pour la largeur
     du menu ne rétrécit pas — il déborde et se superpose à ce qui suit (vécu : « Réécrire avec
     Doku-San » passait par-dessus le compteur de caractères, depuis retiré). */
  .selection-menu-label { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .selection-menu-action kbd {
    margin-left: auto;
    color: var(--ink-4);
    font-family: inherit;
    font-size: 12px;
  }
  .selection-menu-action:hover,
  .selection-menu-rewrite.open { background: var(--accent-soft); }
  .selection-menu-action:hover .icon { color: var(--ink-2); }
  .selection-menu-action:active { background: rgba(var(--ink-rgb), 0.12); }
  .selection-menu-action:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: -2px; }
  /* Tuile de 20px à la place d'une icône de 15px : les marges négatives la ramènent à
     l'encombrement d'une icône, le libellé reste dans l'axe des autres rangées. */
  .selection-menu-spark {
    flex: none;
    margin: 0 -2px 0 -3px;
    width: 20px;
    height: 20px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-sm);
    background: var(--surface-2);
  }
  .selection-menu-spark .icon { font-size: 12px; color: var(--ink-3); }
  .selection-menu-action .selection-menu-chevron {
    font-size: 14px;
    transition: transform var(--duration-basic) var(--ease-enter-snappy), color var(--duration-basic) ease;
  }
  .selection-menu-rewrite.open .selection-menu-chevron { transform: rotate(90deg); }
  .selection-rewrite-options {
    display: grid;
    grid-template-rows: 0fr;
    opacity: 0;
    transition:
      grid-template-rows var(--duration-moderate) var(--ease-enter-snappy),
      opacity var(--duration-basic) ease;
  }
  .selection-rewrite-options.open { grid-template-rows: 1fr; opacity: 1; }
  /* Sortie plus brève que l'entrée : replier, c'est congédier. */
  .selection-rewrite-options:not(.open) { transition-duration: var(--duration-basic); }
  .selection-rewrite-inner,
  .selection-insert-inner { min-height: 0; overflow: hidden; }
  /* Sous-rangées : l'icône s'aligne sur le libellé de la rangée parente. */
  .selection-menu-subaction {
    height: var(--control-md);
    padding-left: 31px;
    color: var(--ink-2);
  }
  .selection-menu-subaction:hover { color: var(--ink); }
  .selection-menu-subaction .icon { font-size: 14px; }
  .selection-menu-note {
    margin: 4px 8px 4px 31px;
    font-size: 12px;
    line-height: 1.5;
    color: var(--ink-3);
  }

  /* Consigne libre : la rangée emprunte la grammaire du composeur du copilote — champ posé
     sur --composer-bg, bouton d'envoi rond à l'encre. Même geste ailleurs dans l'app, donc
     même vocabulaire ici, en format menu. */
  .selection-custom {
    display: flex;
    align-items: center;
    gap: 4px;
    margin: 2px 0;
    padding: 2px 2px 2px 10px;
    /* Pilule : le bouton d'envoi rond, à 2px du bord, reste concentrique. */
    border-radius: var(--radius-full);
    background: var(--composer-bg);
    box-shadow: inset 0 0 0 1px var(--line-1);
    transition: box-shadow var(--duration-basic) ease;
  }
  .selection-custom:hover { box-shadow: inset 0 0 0 1px var(--line-3); }
  .selection-custom:focus-within { box-shadow: inset 0 0 0 1px var(--focus-ring); }
  .selection-custom-field {
    flex: 1;
    min-width: 0;
    height: var(--control-sm);
    border: 0;
    padding: 0;
    background: none;
    color: var(--ink);
    font: inherit;
  }
  /* L'anneau de focus vit sur la rangée entière (:focus-within) — un second liseré autour du
     seul champ ferait deux cadres concentriques. */
  .selection-custom-field:focus { outline: none; }
  .selection-custom-field::placeholder { color: var(--ink-4); }
  .selection-custom-send {
    position: relative;
    flex: none;
    width: var(--control-2xs);
    height: var(--control-2xs);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 0;
    border-radius: var(--radius-full);
    background: var(--ink);
    color: var(--cream-content);
    cursor: pointer;
    transition:
      background-color var(--duration-basic) ease,
      opacity var(--duration-basic) ease,
      transform var(--duration-basic) var(--ease-enter-snappy);
  }
  .selection-custom-send:active:not(:disabled) { transform: scale(0.97); }
  .selection-custom-send .icon { font-size: 14px; }
  .selection-custom-send:not(:disabled):hover { background: var(--ink-2); }
  .selection-custom-send:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
  .selection-custom-send:disabled { opacity: var(--opacity-disabled); cursor: default; }
  /* 24px au doigt : zone portée à 40 sans changer le rendu. À gauche, 4px seulement :
     l'écart avec le champ voisin n'est que de 4px. */
  @media (any-pointer: coarse) {
    .selection-custom-send::after { content: ''; position: absolute; inset: -8px -8px -8px -4px; }
  }

  .editor-host.source-mode :global(.cm-content),
  .editor-host.txt :global(.cm-content) {
    font-family: var(--font-mono);
    font-size: 14px;
    line-height: 1.7;
  }
</style>
