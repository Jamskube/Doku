<script lang="ts">
  import { tick, untrack } from 'svelte'
  import { fly } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { activeEditorSelection, activeTab, app, isCloudProvider, openPath, toggleSidebarView, visibleTabs, type CopilotProvider, type DocKind, type DocTab } from '../lib/stores.svelte'
  import { closeWindow, fileSizeAt, isTauri, minimizeWindow, openContextFilesDialog, openFolderDialog, readFileBytes, readTextFileAt, toggleMaximizeWindow } from '../lib/tauri'
  import { formatBytes, VOICE_MODULE } from '../lib/llama'
  import { startVoice, stopVoice, voice } from '../lib/voice.svelte'
  import { addCopilotContext, beginOpenAiAuth, cancelOpenAiConnection, cancelPull, clearGeneratedDocumentTarget, connectMinimax, copilot, disconnectMinimaxKey, disconnectOpenAiAccount, ensureCopilotReady, jumpToCitation, newChat as clearChat, pullModel, refreshMinimaxStatus, refreshModels, refreshOpenAiStatus, removeCopilotContext, removeModel, retryGeneration, reviseDiagram, reviseGeneratedDocument, saveMessageAsNote, scheduleConversationPersist, selectDiagramCandidate, sendChat, setActiveModel, setChatOutputMode, setCopilotContextFolder, setCopilotMemoryFolder, setCopilotProvider, setWebSearchEnabled, stopChat, summarizeDoc, type ChatMsg, type ChatOutputMode } from '../lib/copilot.svelte'
  import { conversations } from '../lib/copilot-conversations.svelte'
  import { MINIMAX_DEFAULT_MODEL, minimaxThinkingSwitchable } from '../lib/compat'
  import { markdownTextLength } from '../lib/images'
  import { cloudOnlyMode, matchSlashCommand, nextTrayIndex, OUTPUT_MODES, OUTPUT_ORDER, slashQuery, suggestSlashCommands, type SlashCommand, type SlashSuggestion } from '../lib/composer-commands'
  import { vaultLabel, vaultShortLabel } from '../lib/platform'
  import { clampCopilotWidth, copilotMaxWidthCss, copilotWidthCss, COPILOT_DEFAULT_WIDTH, COPILOT_MAX_WIDTH, COPILOT_MIN_WIDTH } from '../lib/copilot-width'
  import { DEFAULT_EMBED_MODEL, noteTitle } from '../lib/rag'
  import { cancelRagIndexing, deleteRagIndex, ragState, refreshRagIndex } from '../lib/rag-index.svelte'
  import { baseName, parentPath } from '../lib/explorer'
  import { MAX_DOC_CHARS, MAX_DOC_CHARS_CLOUD, type SummaryMode } from '../lib/copilot-service'
  import { openOpenAiAuthPage, OPENAI_MODEL } from '../lib/openai'
  import { renderChatMarkdown } from '../lib/export/render-md'
  import { annotateCitations, type CitedPassage } from '../lib/citations'
  import { cleanContextLabel, contextItemId, MAX_CONTEXT_ITEMS, MAX_CONTEXT_LOAD_CONCURRENCY, MAX_CONTEXT_PDF_BYTES, MAX_CONTEXT_TEXT_BYTES, pathBelongsToFolder, truncateContextItem, type CopilotContextItem } from '../lib/copilot-context'
  import { cloudMemory, deleteCloudMemoryRecord, loadCloudMemory, memoryWorkspace, undoCloudMemory, updateCloudMemoryRecord, type MemoryWorkspace } from '../lib/copilot-memory.svelte'
  import { NOTICE_DELAY, autoDismiss } from '../lib/auto-dismiss'
  import type { CloudMemoryProvider, MemoryRecord, MemoryType } from '../lib/copilot-memory'
  import { addWebCitationMarkers, annotateWebCitations } from '../lib/web-citations'
  import { codeLanguages, decorateChatBlocks } from '../lib/chat-blocks'
  import { createStickToBottom } from '../lib/stick-to-bottom'
  import { placeHoverCard } from '../lib/hover-card'
  import { tooltip } from '../lib/tooltip'
  import { streamReveal } from '../lib/copilot-stream-reveal'
  import { shortModelName } from '../lib/copilot-model-label'
  import { liquidThumb } from '../lib/liquid'
  import CopilotEvidence from './CopilotEvidence.svelte'
  import CopilotDropletMenu, { type DropItem } from './CopilotDropletMenu.svelte'
  import CopilotDiagram from './CopilotDiagram.svelte'
  import CopilotDocument from './CopilotDocument.svelte'
  import type { DocumentBlockTarget, GeneratedDocumentArtifact } from '../lib/generated-document'
  import type { DiagramArtifact } from '../lib/bgraph'

  // Rendu d'une réponse : Markdown assaini PUIS puces de citation (l'annotation opère
  // après DOMPurify — seul notre markup de puce est injecté). Sans sources (petit doc,
  // refus honnête), les marqueurs [n] éventuels sont retirés (count = 0).
  function renderAnswer(m: ChatMsg): string {
    const marked = addWebCitationMarkers(m.content, m.webCitations ?? [])
    const rendered = annotateCitations(renderChatMarkdown(marked), m.sources?.length ?? 0)
    return decorateChatBlocks(annotateWebCitations(rendered, m.webCitations?.length ?? 0), codeLanguages(marked))
  }

  // Clic délégué sur les puces [n] injectées via {@html} (pas de handlers Svelte dedans).
  function onAnswerClick(e: MouseEvent, m: ChatMsg) {
    const codeCopy = (e.target as HTMLElement).closest?.<HTMLButtonElement>('.cop-code-copy')
    if (codeCopy) {
      void copyCodeBlock(codeCopy)
      return
    }
    const webChip = (e.target as HTMLElement).closest?.('.cop-web-cite')
    if (webChip) {
      const n = Number.parseInt(webChip.getAttribute('data-web-cite') ?? '', 10)
      const citation = m.webCitations?.find((source) => source.n === n)
      if (citation) void openWebSource(citation.url)
      return
    }
    const chip = (e.target as HTMLElement).closest?.('.cop-cite')
    if (!chip) return
    dismissCitePreview()
    const n = Number.parseInt(chip.getAttribute('data-cite') ?? '', 10)
    const passage = m.sources?.find((s) => s.n === n)
    if (passage) void revealCitation(passage)
  }

  async function openWebSource(url: string) {
    let safe: URL
    try { safe = new URL(url) } catch { return }
    if (safe.protocol !== 'https:') return
    if (isTauri) {
      const { openUrl } = await import('@tauri-apps/plugin-opener')
      await openUrl(safe.href)
    } else globalThis.open(safe.href, '_blank', 'noopener,noreferrer')
  }

  // En plein écran, une citation n'a de sens que si sa source redevient visible.
  // On restaure d'abord la vue partagée, puis le pipeline existant ouvre et révèle
  // le passage. `tick` laisse le layout sortir de l'état plein écran avant que
  // CodeMirror/PDF calcule son scroll dans la largeur retrouvée.
  async function revealCitation(passage: CitedPassage) {
    if (app.copilotExpanded) {
      app.copilotExpanded = false
      await tick()
    }
    await jumpToCitation(passage)
  }

  // --- Aperçu flottant d'un passage cité (survol ou focus d'une puce [n]) : les lignes
  // de l'extrait réellement fourni au modèle, sans avoir à cliquer. Contenu rendu en
  // TEXTE (jamais {@html}) — c'est du contenu de document, pas du markup de confiance.
  let panelEl = $state<HTMLElement | null>(null)

  // --- Séparateur de largeur (même geste que celui des volets) ---------------------
  // La largeur réglée pendant le glisser reste LOCALE : `app.copilotWidth` déclenche
  // l'$effect de persistance d'App.svelte, et l'écrire à chaque frame ferait un
  // `localStorage.setItem` par image. On ne la publie donc qu'au relâchement.
  let resizeWidth = $state<number | null>(null)
  let resizing = $state(false)
  let resizeFrame = 0
  let pendingWidth = COPILOT_DEFAULT_WIDTH
  const panelWidth = $derived(resizeWidth ?? app.copilotWidth)
  // `--copilot-width` est hérité par toute la conversation : le réécrire à chaque image
  // recalculait le style de chaque descendant. Pendant le glisser, seule la `flex-basis`
  // du panneau bouge ; la variable n'est posée qu'au relâchement.
  const committedWidthCss = $derived(copilotWidthCss(app.copilotWidth))
  const dragWidthCss = $derived(resizeWidth === null ? null : copilotWidthCss(resizeWidth))
  const maxWidthCss = $derived(copilotMaxWidthCss(app.sidebarOpen))
  // Redimensionnement aux flèches : aucune animation (geste clavier, répété en rafale).
  let keySnap = $state(false)
  let keySnapToken = 0

  /** Place partagée par la zone document et le panneau — sidebar exclue. */
  function availableWidth(): number {
    const shell = panelEl?.parentElement?.getBoundingClientRect()
    if (!shell) return Number.POSITIVE_INFINITY
    // Le voisin de gauche est la zone document (App.svelte) : mesurer son bord gauche
    // plutôt que supposer une largeur de sidebar, qui se replie et se déploie.
    const doc = panelEl?.previousElementSibling?.getBoundingClientRect()
    return doc ? shell.right - doc.left : shell.width
  }

  function scheduleWidth(width: number) {
    pendingWidth = clampCopilotWidth(width, availableWidth())
    if (resizeFrame) return
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0
      resizeWidth = pendingWidth
    })
  }

  function commitWidth(width: number) {
    if (resizeFrame) {
      cancelAnimationFrame(resizeFrame)
      resizeFrame = 0
    }
    app.copilotWidth = clampCopilotWidth(width, availableWidth())
    resizeWidth = null
  }

  function resizeStart(event: PointerEvent) {
    const handle = event.currentTarget as HTMLElement
    handle.setPointerCapture(event.pointerId)
    pendingWidth = app.copilotWidth
    resizing = true
  }

  function resizeMove(event: PointerEvent) {
    const handle = event.currentTarget as HTMLElement
    if (!handle.hasPointerCapture(event.pointerId)) return
    const shell = panelEl?.parentElement?.getBoundingClientRect()
    if (!shell) return
    // Le panneau est le dernier élément de la barre : son bord droit ne bouge pas, donc
    // la largeur voulue est exactement la distance du pointeur à ce bord.
    scheduleWidth(shell.right - event.clientX)
  }

  function resizeEnd(event: PointerEvent) {
    const handle = event.currentTarget as HTMLElement
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId)
    if (!resizing) return
    resizing = false
    commitWidth(pendingWidth)
  }

  function commitWidthInstantly(width: number) {
    keySnap = true
    commitWidth(width)
    // Deux images : la première calcule le style AVEC la nouvelle largeur et sans
    // transition ; retirer la classe plus tôt laisserait le rideau rejouer. Le jeton
    // empêche une touche précédente de la retirer sous une touche répétée.
    const token = ++keySnapToken
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (token === keySnapToken) keySnap = false
    }))
  }

  function resizeKey(event: KeyboardEvent) {
    // Le panneau est à droite : vers la GAUCHE l'élargit. La flèche suit le bord qu'on
    // déplace, pas la valeur — c'est ce que fait le séparateur des volets.
    const step = event.key === 'ArrowLeft' ? 24 : event.key === 'ArrowRight' ? -24 : 0
    if (step !== 0) {
      event.preventDefault()
      commitWidthInstantly(panelWidth + step)
      return
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      commitWidthInstantly(event.key === 'Home' ? COPILOT_MIN_WIDTH : COPILOT_MAX_WIDTH)
    }
  }

  $effect(() => () => {
    if (resizeFrame) cancelAnimationFrame(resizeFrame)
  })

  // Cartes de survol (aperçu de citation, info-bulle Réfléchir) : règles Kube hover card,
  // comme CopilotEvidence — 200 ms au pointeur, tout de suite au focus clavier, jamais au
  // doigt. Rendues en couche supérieure (`popover`) : `contain: paint` du panneau les
  // rognerait. La largeur ne vit qu'en CSS : on mesure la carte montée pour la placer.
  function placeCard(el: HTMLElement, anchor: HTMLElement) {
    if (typeof el.showPopover === 'function' && !el.matches(':popover-open')) el.showPopover()
    const place = placeHoverCard(
      anchor.getBoundingClientRect(),
      { width: el.offsetWidth, height: el.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight },
    )
    el.style.left = `${place.left}px`
    el.style.top = `${place.top}px`
    el.style.transformOrigin = `${place.originX}px ${place.side === 'bottom' ? 'top' : 'bottom'}`
    anchor.setAttribute('aria-describedby', el.id)
    return () => anchor.removeAttribute('aria-describedby')
  }

  let citePreview = $state.raw<{ n: number; name: string | null; text: string; anchor: HTMLElement } | null>(null)
  let citePreviewTimer: ReturnType<typeof setTimeout> | undefined

  function citeChip(e: Event): HTMLElement | null {
    return (e.target as HTMLElement).closest?.<HTMLElement>('.cop-cite') ?? null
  }
  function showCitePreview(chip: HTMLElement, m: ChatMsg, delay: number) {
    clearTimeout(citePreviewTimer)
    citePreviewTimer = setTimeout(() => {
      const n = Number.parseInt(chip.getAttribute('data-cite') ?? '', 10)
      const passage = m.sources?.find((s) => s.n === n)
      if (passage && chip.isConnected) citePreview = { n, name: passage.name, text: passage.text, anchor: chip }
    }, delay)
  }
  // Carte déjà ouverte : passer d'une puce à la voisine ne réarme pas le délai.
  function onAnswerCitePointer(e: PointerEvent, m: ChatMsg) {
    const chip = citeChip(e)
    if (chip && e.pointerType !== 'touch') showCitePreview(chip, m, citePreview ? 0 : 200)
  }
  function onAnswerCiteFocus(e: FocusEvent, m: ChatMsg) {
    const chip = citeChip(e)
    if (chip?.matches(':focus-visible')) showCitePreview(chip, m, 0)
  }
  function onAnswerCiteOut(e: Event, delay = 0) {
    if (!citeChip(e)) return
    clearTimeout(citePreviewTimer)
    citePreviewTimer = setTimeout(dismissCitePreview, delay)
  }
  function onAnswerKey(e: KeyboardEvent) {
    if (e.key !== 'Escape' || !citePreview) return
    e.stopPropagation()
    dismissCitePreview()
  }
  function dismissCitePreview() {
    clearTimeout(citePreviewTimer)
    if (citePreview) citePreview = null
  }

  const openAiModel = $derived(app.openaiModel || OPENAI_MODEL)
  const openAiChoices = $derived(copilot.openAiModels.length > 0 ? copilot.openAiModels : [openAiModel])

  // Bouton « Réfléchir » et son info-bulle (même carte de survol que l'aperçu de citation).
  const thinkModel = $derived(app.copilotProvider === 'openai' ? openAiModel : app.minimaxModel || MINIMAX_DEFAULT_MODEL)
  const thinkAlways = $derived(app.copilotProvider === 'minimax' && !minimaxThinkingSwitchable(thinkModel))
  const thinkTipText = $derived(
    thinkAlways
      ? { title: 'Réflexion permanente', text: `${thinkModel} réfléchit toujours avant de répondre : sa réflexion ne peut pas être coupée.`, hint: 'Choisissez MiniMax-M3 pour la piloter' }
      : app.copilotThinking
        ? { title: 'Réflexion activée', text: `${thinkModel} raisonne avant chaque réponse : plus fouillée, mais plus lente et plus coûteuse.`, hint: 'Cliquer pour revenir aux réponses rapides' }
        : { title: 'Réfléchir', text: 'Laisse le modèle raisonner avant de répondre, pour les questions difficiles. Réponses plus lentes et plus coûteuses.', hint: 'Désactivé · réponses rapides' },
  )
  let thinkTip = $state.raw<HTMLElement | null>(null)
  let thinkTipTimer: ReturnType<typeof setTimeout> | undefined
  function showThinkTip(button: HTMLElement, delay: number) {
    clearTimeout(thinkTipTimer)
    thinkTipTimer = setTimeout(() => {
      if (button.isConnected) thinkTip = button
    }, delay)
  }
  function hideThinkTip() {
    clearTimeout(thinkTipTimer)
    thinkTip = null
  }

  // Nom complet en info-bulle ; le menu n'en montre que la partie distinctive (après le
  // dernier « / » : « hf.co/LiquidAI/LFM2-2.6B-GGUF:Q4_0 » se tronquait sur « hf.co/Liq… »).
  const identityModel = $derived(
    app.copilotProvider === 'openai'
      ? openAiModel
      : app.copilotProvider === 'minimax'
        ? app.minimaxModel || MINIMAX_DEFAULT_MODEL
        : app.activeModel || 'Aucun modèle actif',
  )

  // Modèle de chat du catalogue llama.cpp (models.rs, ADR-0032) : LFM3-Omni 2B en Q4_0. Plus de
  // téléchargement libre par nom (pas de registre) : le catalogue est fermé.
  const RECO_MODEL = 'lfm3-omni-2b'
  const SUGGESTIONS = [RECO_MODEL]
  // Chips de la bibliothèque : masquer les modèles déjà installés (cliquer re-téléchargerait).
  const installableSuggestions = $derived(SUGGESTIONS.filter((s) => !copilot.models.some((m) => m.name === s)))

  // Vue Modèles : liste à l'ouverture (intention explicite). L'effet ne track QUE la vue —
  // `refreshModels` (lit ET écrit copilot.*) est `untrack`é pour ne pas s'auto-re-déclencher.
  // La vue « chat » ne démarre JAMAIS le moteur (coquille statique) → aucun spawn au boot.
  let authCodeCopied = $state(false)
  $effect(() => {
    if (app.copilotOpen && app.copilotView === 'models') {
      if (app.copilotProvider === 'openai') untrack(() => void refreshOpenAiStatus())
      else if (app.copilotProvider === 'minimax') untrack(() => void refreshMinimaxStatus())
      else untrack(() => void refreshModels())
    }
  })

  // Connexion MiniMax : la clé ne vit que dans ce champ le temps de la validation —
  // vidée dès le succès (elle repose ensuite dans le Credential Manager, côté Rust).
  let minimaxKeyInput = $state('')
  async function submitMinimaxKey() {
    const key = minimaxKeyInput.trim()
    if (!key) return
    const ok = await connectMinimax(key)
    if (ok) minimaxKeyInput = ''
  }

  const libraryTotal = $derived(copilot.models.reduce((sum, m) => sum + m.size, 0))

  // --- Sélecteur unifié « Modèle actif » : un dropdown groupé par fournisseur remplace
  // les onglets. Matériau flottant volontairement LOCAL : menu de choix (menuitemradio,
  // Kube PickerMenu) ≠ menus TitleBar/Sidebar (commandes) — l'extraction d'un matériau partagé
  // reste une dette notée, pas aggravée à l'aveugle ici.
  let pickerOpen = $state(false)
  let pickerRootEl = $state<HTMLElement | null>(null)
  let pickerTriggerEl = $state<HTMLButtonElement | null>(null)
  let pickerListEl = $state<HTMLElement | null>(null)

  // Les modèles d'embedding restent gérables dans BIBLIOTHÈQUE mais ne sont jamais
  // proposés comme modèle de chat (même prédicat que l'auto-activation post-pull).
  const chatModels = $derived(copilot.models.filter((m) => m.kind === 'chat'))

  // « jamais de fonctionnalité qui ment » : le trigger et les en-têtes de groupe reprennent
  // la MÊME machine d'états que les cartes fournisseur (checking / connecté / aucun
  // modèle / clé refusée / à connecter), jamais un binaire connecté-ou-pas.
  type PickerState = { label: string; kind: 'ok' | 'warn' | 'off' | 'busy' }
  const openAiState = $derived.by((): PickerState => {
    if (copilot.openAiChecking) return { label: 'vérification…', kind: 'busy' }
    if (copilot.openAiAuthenticated && copilot.openAiPreferredAvailable === false)
      return { label: 'aucun modèle', kind: 'warn' }
    if (copilot.openAiAuthenticated) return { label: 'connecté', kind: 'ok' }
    return { label: 'à connecter', kind: 'off' }
  })
  const minimaxState = $derived.by((): PickerState => {
    if (copilot.minimaxChecking || copilot.minimaxConnecting) return { label: 'vérification…', kind: 'busy' }
    if (copilot.minimaxStatus?.keyRejected) return { label: 'clé refusée', kind: 'warn' }
    if (copilot.minimaxStatus?.connected) return { label: 'connecté', kind: 'ok' }
    return { label: 'à connecter', kind: 'off' }
  })
  // Un modèle actif supprimé hors app (fichier effacé à la main) laisserait le trigger afficher un
  // fantôme — signalé seulement quand la liste a réellement été lue (modelsLoaded),
  // jamais sur une liste vide parce que le moteur n'a pas démarré.
  const localModelMissing = $derived(
    !!app.activeModel && copilot.modelsLoaded && !copilot.models.some((m) => m.name === app.activeModel),
  )
  // Repli identique à resolveRuntime : un statut connecté avec catalogue vide (erreur
  // partielle) propose quand même la valeur qui répondrait réellement aux questions.
  const modelState = $derived.by((): PickerState['kind'] => {
    if (app.copilotProvider === 'openai') return openAiState.kind
    if (app.copilotProvider === 'minimax') return minimaxState.kind
    if (copilot.loading) return 'busy'
    return app.activeModel && !localModelMissing ? 'ok' : 'warn'
  })
  // Capsule modèle du composeur : ouvre le sélecteur existant, dans la vue Modèles.
  async function openModelPicker() {
    app.copilotView = 'models'
    await tick()
    if (!pickerOpen) togglePicker()
    await tick()
    const options = pickerOptions()
    ;(options.find((o) => o.getAttribute('aria-checked') === 'true') ?? options[0])?.focus()
  }
  const minimaxChoices = $derived(
    copilot.minimaxStatus?.connected && !copilot.minimaxStatus.keyRejected && copilot.minimaxStatus.models.length > 0
      ? copilot.minimaxStatus.models
      : [app.minimaxModel || MINIMAX_DEFAULT_MODEL],
  )

  // Sections repliables dans le pop (même mécanique que les tiroirs du popover de
  // sélection) : une seule ouverte à la fois, celle du fournisseur courant par défaut —
  // sinon le catalogue MiniMax à lui seul rend le menu énorme.
  let pickerSection = $state<CopilotProvider | null>(null)

  function togglePicker() {
    pickerOpen = !pickerOpen
    if (!pickerOpen) return
    pickerSection = app.copilotProvider
    // Refresh paresseux des états INCONNUS seulement (handler d'événement : rien à
    // untracker) — les en-têtes de section affichent ces statuts, sections fermées
    // comprises, donc on lève l'inconnu dès l'ouverture du menu. Lister les modèles
    // locaux spawne le sidecar — intention assumée (on ouvre pour choisir).
    if (copilot.models.length === 0 && !copilot.loading) void refreshModels()
    if (copilot.openAiAuthenticated === null) void refreshOpenAiStatus()
    if (copilot.minimaxStatus === null) void refreshMinimaxStatus()
  }
  function toggleSection(p: CopilotProvider) {
    pickerSection = pickerSection === p ? null : p
  }
  function closePicker(restoreFocus = false) {
    pickerOpen = false
    if (restoreFocus) pickerTriggerEl?.focus()
  }
  function pickLocal(name: string) {
    setActiveModel(name)
    closePicker(true)
  }
  function pickOpenAi(model: string) {
    app.openaiModel = model
    setCopilotProvider('openai')
    closePicker(true)
  }
  function pickMinimax(model: string) {
    app.minimaxModel = model
    setCopilotProvider('minimax')
    closePicker(true)
  }
  function pickManageLocal() {
    setCopilotProvider('local')
    closePicker(true)
  }
  function pickerOptions(): HTMLButtonElement[] {
    // Les entrées des sections fermées sont inert (non focusables) : on les exclut
    // aussi de la navigation aux flèches.
    return Array.from(
      pickerListEl?.querySelectorAll<HTMLButtonElement>('button[role="menuitem"], button[role="menuitemradio"]') ?? [],
    ).filter((b) => !b.closest('[inert]'))
  }
  function onTriggerKeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const fromEnd = e.key === 'ArrowUp'
      e.preventDefault()
      if (!pickerOpen) togglePicker()
      void tick().then(() => {
        const opts = pickerOptions()
        ;(fromEnd ? opts[opts.length - 1] : opts[0])?.focus()
      })
    } else if (e.key === 'Escape' && pickerOpen) {
      // stopPropagation : le listener global d'App traite aussi Échap (mode focus,
      // panneau étendu) — un Échap qui ferme le dropdown ne doit fermer QUE lui.
      e.stopPropagation()
      closePicker()
    }
  }
  function onPickerKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      closePicker(true)
      return
    }
    if (e.key === 'Tab') {
      // Sans preventDefault, Tab focuserait une option du pop en cours de démontage
      // et le focus finirait sur <body> — rendu au trigger, le flux Tab reprend là.
      e.preventDefault()
      closePicker(true)
      return
    }
    const opts = pickerOptions()
    if (opts.length === 0) return
    const idx = opts.indexOf(document.activeElement as HTMLButtonElement)
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      ;(opts[idx + 1] ?? opts[0]).focus()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      ;(opts[idx - 1] ?? opts[opts.length - 1]).focus()
    } else if (e.key === 'Home') {
      e.preventDefault()
      opts[0].focus()
    } else if (e.key === 'End') {
      e.preventDefault()
      opts[opts.length - 1].focus()
    }
  }

  function startPull(name: string) {
    void pullModel(name)
  }

  async function copyOpenAiCode() {
    const code = copilot.openAiAuth?.userCode
    if (!code) return
    await navigator.clipboard.writeText(code)
    authCodeCopied = true
    setTimeout(() => (authCodeCopied = false), 1600)
  }

  // Suppression d'un modèle : confirmation INLINE dans la ligne (pas de confirm() natif qui
  // casse l'univers de l'app, pas de modale — registre produit). La ligne se transforme en
  // question Annuler/Supprimer ; le modèle ACTIF est signalé explicitement.
  let confirmDelete = $state<string | null>(null)

  function doRemove(name: string) {
    confirmDelete = null
    void removeModel(name)
  }

  // --- Index sémantique du dossier (15.2, ADR-0015) ---
  // Le service RAG n'importe ni stores ni copilot : la vue fournit dossier, modèle et port.
  const ragDir = $derived(copilot.contextFolder?.path ?? app.explorerDir ?? parentPath(activeTab()?.path ?? null))
  // '' = réglage effacé (modèle supprimé du disque) : on repropose le défaut.
  const embedModelName = $derived(app.embedModel || DEFAULT_EMBED_MODEL)
  const embedInstalled = $derived(copilot.models.some((m) => m.name === embedModelName))
  const voiceInstalled = $derived(copilot.models.some((m) => m.name === VOICE_MODULE))
  const ragIndexing = $derived(ragState.phase === 'indexing' && ragState.dir === ragDir)
  const ragReadyHere = $derived(ragState.phase === 'ready' && ragState.dir === ragDir)

  async function indexFolder() {
    const dir = ragDir
    if (!dir || ragState.phase === 'indexing') return
    if (!app.embedModel) app.embedModel = DEFAULT_EMBED_MODEL
    const port = await ensureCopilotReady()
    if (port == null) return
    void refreshRagIndex(port, app.embedModel, dir, true)
  }

  // Depuis la carte d'erreur « modèle non installé » : pull PUIS relance de l'index —
  // sinon le message d'erreur périmé resterait affiché jusqu'à un clic manuel.
  async function pullEmbedAndIndex(name: string) {
    await pullModel(name)
    if (copilot.models.some((m) => m.name === name)) await indexFolder()
  }

  // --- Portée des questions (15.3) : document courant ou dossier entier ---
  // Le mode « document entier (index) » n'existe qu'en local : un utilisateur OpenAI
  // garde la troncature 14.3 (pas de spawn du sidecar en douce) — badge et comportement
  // lisent le MÊME prédicat (copilot.models).
  const docIndexAvailable = $derived(app.copilotProvider === 'local' && embedInstalled)
  const folderMeta = $derived.by(() => {
    if (!ragDir) return 'Aucun dossier — ouvrez un document enregistré'
    if (ragIndexing) return 'Indexation en cours…'
    if (ragReadyHere) {
      return ragState.files > 0
        ? `${ragState.files} note${ragState.files > 1 ? 's' : ''} indexée${ragState.files > 1 ? 's' : ''} · réponses citées`
        : 'Index vide — voir Modèles'
    }
    // Phase idle : un index persisté peut exister (chargé à la première question) —
    // ne JAMAIS affirmer « non indexé » sans avoir regardé le disque.
    return 'Réponses citées depuis vos notes · index géré dans Modèles'
  })

  // --- Chat (14.1) ---
  let draft = $state('')
  let promptEl = $state<HTMLTextAreaElement | null>(null)
  let scroller = $state<HTMLElement | null>(null)
  let activityDrawerOpen = $state(false)
  let activityButtonEl = $state<HTMLButtonElement | null>(null)
  let activityDrawerEl = $state<HTMLElement | null>(null)
  // Tiroir du composeur (Kube ComposerDrawer) : la rangée « Contexte » dépasse de derrière
  // la saisie ; la déplier révèle les sources en hauteur, la saisie restant ancrée en bas.
  let contextOpen = $state(false)
  let contextToggleEl = $state<HTMLButtonElement | null>(null)
  // Geste clavier (`detail === 0`, frappe) : tiroir et tray changent d'état sans animer.
  let drawerKbd = $state(false)

  // Fin de réponse annoncée UNE fois au lecteur d'écran (le flux, lui, ne l'est pas : une
  // région live sur le texte qui s'écrit répéterait chaque token). Vidée au départ suivant
  // pour qu'un même libellé soit réannoncé.
  let answerAnnouncement = $state('')
  let wasGenerating = false
  $effect(() => {
    const generating = copilot.generating
    if (generating) answerAnnouncement = ''
    else if (wasGenerating) {
      const last = untrack(() => copilot.messages.at(-1))
      if (last?.role === 'assistant' && !last.failed && !last.config) answerAnnouncement = 'Réponse de Doku-San prête'
    }
    wasGenerating = generating
  })

  const numberFormatter = new Intl.NumberFormat('fr-FR')
  const timeFormatter = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' })

  // Budget de contexte du fournisseur COURANT (21.x) : 12k local (num_ctx), 240k cloud.
  // Badge et comportement (prepareDocMessages) lisent le MÊME prédicat isCloudProvider.
  const docBudget = $derived(isCloudProvider(app.copilotProvider) ? MAX_DOC_CHARS_CLOUD : MAX_DOC_CHARS)

  // Doc courant tronqué en Q&A (14.3) : signal DÉTERMINISTE à l'utilisateur (ne dépend pas du
  // modèle) — un « je ne trouve pas » peut alors venir de la partie non lue, pas d'une absence.
  const docTruncated = $derived.by(() => {
    const t = activeTab()
    return !!t && t.kind !== 'pdf' && textLengthOf(t) > docBudget
  })

  const contextDetails = $derived.by(() => {
    const t = activeTab()
    if (!t) return { count: 0, name: 'Aucun document actif', meta: 'Le chat ne reçoit aucun contenu.', state: 'Vide' }
    if (t.kind === 'pdf') {
      // Le texte d'un PDF est lu à la demande (18.2) → le badge ne le connaît qu'APRÈS une
      // première lecture (copilot.pdfDoc). Avant : neutre, honnête (n'affirme rien).
      const ex = copilot.pdfDoc?.path === t.path ? copilot.pdfDoc : null
      if (ex?.scanned) return { count: 1, name: t.name, meta: 'PDF scanné · pas de couche texte (OCR requis)', state: 'PDF image' }
      if (ex && ex.charCount > docBudget) {
        return {
          count: 1,
          name: t.name,
          meta: `PDF · ${numberFormatter.format(ex.charCount)} caractères`,
          // Gros PDF : couvert en entier PAR L'INDEX si un modèle d'embed est là, sinon
          // lecture partielle (parité honnête avec les notes, Major reviewer 18.2).
          state: docIndexAvailable ? 'Document entier (index)' : 'Lecture partielle',
        }
      }
      if (ex) return { count: 1, name: t.name, meta: 'PDF · texte lu', state: 'Document entier' }
      return { count: 1, name: t.name, meta: 'PDF · texte lu à la demande', state: 'Document PDF' }
    }
    const format = t.kind === 'md' ? 'Markdown' : t.kind === 'html' ? 'HTML' : 'Texte'
    const readableChars = Math.min(textLengthOf(t), docBudget)
    return {
      count: 1,
      name: t.name,
      // « Document entier (index) » (15.3) : le doc dépasse la fenêtre mais l'index
      // éphémère le couvre EN ENTIER — le badge d'avertissement 14.3 ne reste que
      // lorsqu'aucun modèle d'embedding local n'est disponible. La méta suit : afficher
      // « 12 000 caractères transmis » à côté de « Document entier » serait contradictoire.
      meta:
        docTruncated && docIndexAvailable
          ? `${format} · ${numberFormatter.format(textLengthOf(t))} caractères couverts par l'index`
          : `${format} · ${numberFormatter.format(readableChars)} caractères transmis`,
      state: docTruncated ? (docIndexAvailable ? 'Document entier (index)' : 'Lecture partielle') : 'Document entier',
    }
  })
  const automaticContextTabs = $derived.by(() => {
    if (copilot.scope !== 'doc') return []
    const current = activeTab()?.id
    return visibleTabs().filter((tab) => tab.id !== current)
  })
  const contextCount = $derived(
    (copilot.scope === 'folder' ? (ragDir ? 1 : 0) : contextDetails.count + automaticContextTabs.length)
      + copilot.contextItems.length + (copilot.webSearchEnabled ? 1 : 0),
  )
  const contextSummary = $derived(
    copilot.scope === 'folder'
      ? `${ragDir ? '1 dossier' : 'Aucun dossier'}${copilot.contextItems.length ? ` + ${copilot.contextItems.length}` : ''}`
      : `${contextCount} source${contextCount > 1 ? 's' : ''}`,
  )
  const cloudDestination = $derived(
    app.copilotProvider === 'openai' ? 'OpenAI' : app.copilotProvider === 'minimax' ? 'MiniMax' : null,
  )
  const hasSupplementalContext = $derived(
    automaticContextTabs.length > 0 || copilot.contextItems.length > 0 || copilot.contextFolder !== null || copilot.webSearchEnabled,
  )

  function automaticContextMeta(tab: DocTab): string {
    if (tab.kind === 'pdf') return 'PDF · texte lu à la demande · volet visible'
    const format = tab.kind === 'md' ? 'Markdown' : tab.kind === 'html' ? 'HTML' : 'Texte'
    return `${format} · ${numberFormatter.format(textLengthOf(tab))} caractères · volet visible`
  }
  const memoryDocument = $derived.by(() => {
    const tab = activeTab()
    return tab?.path ? { path: tab.path, label: tab.name, kind: 'document' as const } : null
  })
  const effectiveMemoryFolder = $derived(
    copilot.memoryFolder && pathBelongsToFolder(memoryDocument?.path, copilot.memoryFolder.path)
      ? copilot.memoryFolder
      : null,
  )
  const memoryTarget = $derived(
    effectiveMemoryFolder
      ? { ...effectiveMemoryFolder, kind: 'folder' as const }
      : memoryDocument,
  )
  const memoryFolderCandidate = $derived.by(() => {
    if (copilot.contextFolder) return copilot.contextFolder
    const path = parentPath(activeTab()?.path ?? null)
    return path ? { path, label: baseName(path) } : null
  })
  let shownMemoryWorkspace = $state<MemoryWorkspace | null>(null)
  let memoryLoadNonce = 0
  let editingMemory = $state<string | null>(null)
  let memoryDraft = $state({ name: '', description: '', type: 'fact' as MemoryType, content: '' })
  let confirmMemoryDelete = $state<string | null>(null)

  async function refreshMemoryView(target = memoryTarget) {
    if (!target) {
      shownMemoryWorkspace = null
      return
    }
    const nonce = ++memoryLoadNonce
    const workspace = await memoryWorkspace(target.path, target.label, target.kind)
    if (nonce !== memoryLoadNonce) return
    shownMemoryWorkspace = workspace
    await loadCloudMemory(workspace, true)
  }

  $effect(() => {
    const target = memoryTarget
    if (app.copilotView === 'memory') untrack(() => void refreshMemoryView(target))
  })

  function openMemoryView() {
    app.copilotView = 'memory'
    void refreshMemoryView()
  }

  function useDocumentMemory() {
    setCopilotMemoryFolder(null)
  }

  function useFolderMemory() {
    if (!memoryFolderCandidate) return
    setCopilotMemoryFolder(memoryFolderCandidate)
  }

  function memoryActionButton(id: string, action: 'edit' | 'delete'): HTMLButtonElement | null {
    return panelEl?.querySelector<HTMLButtonElement>(`[data-memory-id="${id}"][data-memory-action="${action}"]`) ?? null
  }

  async function editMemory(record: MemoryRecord) {
    editingMemory = record.id
    memoryDraft = { name: record.name, description: record.description, type: record.type, content: record.content }
    confirmMemoryDelete = null
    await tick()
    panelEl?.querySelector<HTMLInputElement>('.cop-memory-form input')?.focus()
  }

  async function cancelMemoryEdit(id: string) {
    editingMemory = null
    await tick()
    memoryActionButton(id, 'edit')?.focus()
  }

  async function askMemoryDelete(id: string) {
    confirmMemoryDelete = id
    editingMemory = null
    await tick()
    panelEl?.querySelector<HTMLButtonElement>('.cop-memory-confirm button')?.focus()
  }

  async function cancelMemoryDelete(id: string) {
    confirmMemoryDelete = null
    await tick()
    memoryActionButton(id, 'delete')?.focus()
  }

  async function saveMemoryEdit(record: MemoryRecord) {
    if (!shownMemoryWorkspace || !isCloudProvider(app.copilotProvider) || !memoryDraft.name.trim() || !memoryDraft.description.trim() || !memoryDraft.content.trim()) return
    await updateCloudMemoryRecord({
      workspace: shownMemoryWorkspace,
      id: record.id,
      name: memoryDraft.name.trim(),
      description: memoryDraft.description.trim(),
      type: memoryDraft.type,
      content: memoryDraft.content.trim(),
      provider: app.copilotProvider as CloudMemoryProvider,
    })
    editingMemory = null
    await tick()
    memoryActionButton(record.id, 'edit')?.focus()
  }

  async function removeMemory(id: string) {
    if (!shownMemoryWorkspace || !isCloudProvider(app.copilotProvider)) return
    await deleteCloudMemoryRecord(shownMemoryWorkspace, id, app.copilotProvider as CloudMemoryProvider)
    confirmMemoryDelete = null
    if (editingMemory === id) editingMemory = null
    await tick()
    panelEl?.querySelector<HTMLElement>('#cop-memory-title')?.focus()
  }

  function memoryTypeLabel(type: MemoryType): string {
    return type === 'preference' ? 'Préférence' : type === 'decision' ? 'Décision' : type === 'reference' ? 'Référence' : type === 'open_question' ? 'Question ouverte' : 'Information'
  }

  function memoryBatchLabel(): string {
    const batch = cloudMemory.lastBatch
    if (!batch) return ''
    const parts = []
    if (batch.created) parts.push(`${batch.created} ajoutée${batch.created > 1 ? 's' : ''}`)
    if (batch.updated) parts.push(`${batch.updated} actualisée${batch.updated > 1 ? 's' : ''}`)
    if (batch.deleted) parts.push(`${batch.deleted} oubliée${batch.deleted > 1 ? 's' : ''}`)
    return parts.join(' · ')
  }

  function toggleContext(keyboard: boolean) {
    drawerKbd = keyboard
    contextOpen = !contextOpen
  }

  function onContextKey(e: KeyboardEvent) {
    if (e.key !== 'Escape') return
    e.preventDefault()
    e.stopPropagation()
    drawerKbd = true
    contextOpen = false
    contextToggleEl?.focus()
  }

  async function startNewChat() {
    if (!(await clearChat())) return
    draft = ''
    activityDrawerOpen = false
    contextOpen = false
    addMenuOpen = false
    requestAnimationFrame(() => promptEl?.focus())
  }

  $effect(() => {
    void [
      copilot.messages.map((message) => `${message.role}:${message.content}:${message.streaming ? 1 : 0}`).join('|'),
      copilot.contextRevision,
      copilot.scope,
      copilot.contextFolder?.path,
      copilot.memoryFolder?.path,
      copilot.webSearchEnabled,
    ]
    if (!conversations.restoring && conversations.activeId) scheduleConversationPersist()
  })

  function hasEvidence(message: ChatMsg): boolean {
    if (message.config || message.notice) return false
    return Boolean(
      message.activity?.length || message.sources?.length || message.webCitations?.length ||
      message.contextSources?.length || message.memorySources?.length,
    )
  }

  const evidenceTurns = $derived(copilot.messages.flatMap((message, index) => {
    if (message.role !== 'assistant' || !hasEvidence(message)) return []
    const question = copilot.messages[index - 1]?.role === 'user' ? copilot.messages[index - 1].content : 'Réponse de Doku-San'
    return [{ index, question, message }]
  }))

  async function toggleActivityDrawer() {
    activityDrawerOpen = !activityDrawerOpen
    if (activityDrawerOpen) {
      await tick()
      activityDrawerEl?.focus()
    }
  }

  function closeActivityDrawer(returnFocus = true) {
    activityDrawerOpen = false
    if (returnFocus) requestAnimationFrame(() => activityButtonEl?.focus())
  }

  function onAdvancedSummaryKey(e: KeyboardEvent) {
    if (e.key !== 'Enter' && e.key !== ' ') return
    e.preventDefault()
    const details = (e.currentTarget as HTMLElement).parentElement as HTMLDetailsElement | null
    if (details) details.open = !details.open
  }

  // --- Menu de l'identité ------------------------------------------------------------
  // Les destinations secondaires vivent sous « Doku-San » pour garder le header calme.
  // Le pop est rendu à la racine du panneau : il échappe ainsi au chrome et à ses clips.
  let identityMenuOpen = $state(false)
  let identityButtonEl = $state<HTMLButtonElement | null>(null)
  let identityMenuEl = $state<HTMLElement | null>(null)
  let identityMenuPos = $state<{ left: number; top: number } | null>(null)
  const IDENTITY_MENU_W = 232

  function closeIdentityMenu(restoreFocus = false) {
    identityMenuOpen = false
    if (restoreFocus) identityButtonEl?.focus()
  }

  // Ouverture au clavier (Entrée/Espace → `click` de detail 0) : pas d'entrée animée.
  // Posé à l'ouverture seulement : retirer `.kbd` d'un menu affiché relancerait son keyframe.
  let identityMenuKbd = $state(false)

  function toggleIdentityMenu(keyboard = false) {
    identityMenuOpen = !identityMenuOpen
    if (identityMenuOpen) identityMenuKbd = keyboard
    if (!identityMenuOpen || !identityButtonEl || !panelEl) return
    const trigger = identityButtonEl.getBoundingClientRect()
    const panel = panelEl.getBoundingClientRect()
    // Aligné sur le bord DROIT du déclencheur (bouton « … » de la capsule d'actions).
    const left = Math.min(Math.max(Math.round(trigger.right - panel.left - IDENTITY_MENU_W), 8), Math.round(panel.width - IDENTITY_MENU_W - 8))
    identityMenuPos = { left, top: Math.round(trigger.bottom - panel.top) + 6 }
    void tick().then(() => identityMenuEl?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus())
  }

  function openCopilotView(view: 'models' | 'memory') {
    closeIdentityMenu()
    if (view === 'memory') openMemoryView()
    else app.copilotView = 'models'
  }

  function onIdentityMenuKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      closeIdentityMenu(true)
      return
    }
    if (e.key === 'Tab') {
      closeIdentityMenu()
      return
    }
    const options = Array.from(identityMenuEl?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])
    if (!options.length) return
    const index = options.indexOf(document.activeElement as HTMLButtonElement)
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const offset = e.key === 'ArrowDown' ? 1 : -1
      options[(index + offset + options.length) % options.length]?.focus()
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault()
      ;(e.key === 'Home' ? options[0] : options.at(-1))?.focus()
    }
  }

  // Envoie le brouillon ; capture un SNAPSHOT du doc courant (le contexte ne change pas si
  // l'utilisateur change d'onglet pendant la génération).
  function send() {
    const q = draft.trim()
    if (!q || copilot.generating) return
    draft = ''
    const t = activeTab()
    void sendChat(q, { name: t?.name ?? null, text: t?.content ?? '', kind: t?.kind ?? 'md', path: t?.path ?? null }, copilot.scope)
  }

  // « Relancer » la dernière réponse : la paire question/réponse est retirée puis la question
  // repart avec le document et la portée COURANTS (comme un renvoi manuel).
  function regenerate(i: number) {
    const question = copilot.messages[i - 1]
    if (question?.role !== 'user' || copilot.generating) return
    copilot.messages.splice(i - 1, 2)
    const t = activeTab()
    void sendChat(question.content, { name: t?.name ?? null, text: t?.content ?? '', kind: t?.kind ?? 'md', path: t?.path ?? null }, copilot.scope)
  }

  async function editDiagram(artifact: DiagramArtifact) {
    reviseDiagram(artifact)
    draft = 'Modifie ce diagramme : '
    contextOpen = false
    await tick()
    promptEl?.focus()
    promptEl?.setSelectionRange(draft.length, draft.length)
  }

  async function editGeneratedDocument(artifact: GeneratedDocumentArtifact, target?: DocumentBlockTarget) {
    reviseGeneratedDocument(artifact, target)
    draft = target ? 'Modifie cette partie : ' : 'Modifie ce document : '
    contextOpen = false
    await tick()
    promptEl?.focus()
    promptEl?.setSelectionRange(draft.length, draft.length)
  }

  // Pastille de livrable : pas d'entrée animée quand le choix vient du clavier. Ne change
  // que pastille masquée — retirer `.kbd` d'une pastille affichée relancerait son keyframe.
  let modePillKbd = $state(false)
  function setOutputModeFrom(mode: ChatOutputMode, keyboard: boolean) {
    if (copilot.outputMode === 'answer') modePillKbd = keyboard
    setChatOutputMode(mode)
  }

  function chooseOutputMode(mode: ChatOutputMode, keyboard: boolean) {
    setOutputModeFrom(mode, keyboard)
    closeAddMenu(true)
  }

  // Commandes « / » du composeur : la reconnaissance est pure (`composer-commands.ts`),
  // la décision reste ici — un livrable cloud demandé en local se dit au lieu de basculer.
  function runSlashCommand(command: SlashCommand, withSuffix = false, keyboard = true): boolean {
    const action = command.action
    if (action.kind === 'mode') {
      if (cloudOnlyMode(action.mode) && !isCloudProvider(app.copilotProvider)) {
        // Bannière de l'app et non `contextError`, qui ne s'affiche que dans le volet
        // Contexte : le message doit apparaître là où la commande vient d'être tapée.
        app.banner = {
          tone: 'warning',
          title: `${OUTPUT_MODES[action.mode].label} demande un modèle cloud`,
          message: 'Choisissez OpenAI ou MiniMax dans Modèles, puis retapez la commande.',
        }
        return false
      }
      setOutputModeFrom(action.mode, keyboard)
      return true
    }
    if (action.kind === 'verbosity') {
      app.copilotVerbosity = action.value
      return true
    }
    if (action.kind === 'web') {
      // « /web » seul bascule ; « /web quelle météo » veut la recherche ACTIVE — la basculer
      // l'aurait coupée si elle l'était déjà.
      setWebSearchEnabled(withSuffix ? true : !copilot.webSearchEnabled)
      return true
    }
    if (contextLoading) {
      app.banner = { tone: 'warning', title: 'Contexte en cours de lecture', message: 'Attendez la fin du chargement avant d’ajouter d’autres sources.' }
      return false
    }
    if (action.target === 'selection') {
      if (!selectionAvailable) {
        app.banner = { tone: 'warning', title: 'Aucune sélection', message: 'Sélectionnez du texte dans le document, puis retapez la commande.' }
        return false
      }
      addSelection()
      return true
    }
    if (action.target === 'files') void addFiles()
    else if (action.target === 'folder') void addFolder()
    else void addClipboard()
    return true
  }

  function consumeSlashCommand(terminal: boolean): boolean {
    const found = matchSlashCommand(draft, terminal)
    if (!found) return false
    const before = draft
    if (!runSlashCommand(found.command, found.rest.trim().length > 0)) return false
    // `addSelection` et consorts ne touchent pas au brouillon : on le nettoie ici, et
    // seulement si la commande a réussi ET que le champ n'a pas bougé entre-temps.
    if (draft === before) draft = found.rest
    // Les actions de contexte referment le menu du « + » en rendant le focus à SON bouton.
    // Après une commande tapée, le curseur doit rester là où l'on écrivait.
    promptEl?.focus()
    return true
  }

  // Autocomplétion (Kube ComposerDrawer, tray) : dès la barre oblique, les commandes
  // sortent de derrière le composeur, à la place du tiroir Contexte. Le focus reste dans
  // la saisie ; la sélection passe par `aria-activedescendant`.
  let slashDismissed = $state(false)
  let slashIndex = $state(0)
  let promptFocused = $state(false)
  let trayListEl = $state<HTMLElement | null>(null)
  const slashPartial = $derived(slashDismissed ? null : slashQuery(draft))
  const slashSuggestions = $derived(slashPartial === null ? [] : suggestSlashCommands(slashPartial))
  const trayOpen = $derived(slashPartial !== null && promptFocused)
  const contextShown = $derived(contextOpen && !trayOpen)
  // Le tray garde son dernier contenu pendant qu'il se replie : vidé d'un coup, il
  // afficherait « aucune commande » le temps de la fermeture.
  let trayFrozen: { query: string; list: SlashSuggestion[] } = { query: '', list: [] }
  const trayView = $derived.by(() => {
    if (trayOpen) trayFrozen = { query: slashPartial ?? '', list: slashSuggestions }
    return trayFrozen
  })

  // Garde l'option active visible après un déplacement CLAVIER seulement : à l'ouverture,
  // la liste se révèle en hauteur et sa hauteur visible trompe le calcul. Calcul local
  // plutôt que `scrollIntoView`, qui ferait aussi défiler `.cop-card` (overflow: hidden).
  async function revealTrayOption() {
    await tick()
    const option = trayListEl?.querySelector<HTMLElement>(`#cop-slash-opt-${slashIndex}`)
    if (!trayListEl || !option) return
    // Rectangles plutôt qu'`offsetTop` : la liste n'est pas le `offsetParent` des options.
    const top = option.getBoundingClientRect().top - trayListEl.getBoundingClientRect().top + trayListEl.scrollTop
    const bottom = top + option.offsetHeight
    if (top < trayListEl.scrollTop) trayListEl.scrollTop = top
    else if (bottom > trayListEl.scrollTop + trayListEl.clientHeight) trayListEl.scrollTop = bottom - trayListEl.clientHeight
  }

  // Le filtre change la liste et ramène la sélection en tête : on remonte avec elle.
  $effect(() => {
    void trayView.query
    if (trayListEl) trayListEl.scrollTop = 0
  })

  function applySlash(suggestion: SlashSuggestion, keyboard = true) {
    drawerKbd = keyboard
    if (!runSlashCommand(suggestion.command, false, keyboard)) return
    draft = ''
    slashDismissed = false
    slashIndex = 0
    promptEl?.focus()
  }

  // La frappe rouvre toujours la liste (une commande abandonnée puis reprise doit
  // suggérer à nouveau) et repart du premier choix, la saisie ayant changé.
  function onPromptInput() {
    drawerKbd = true
    slashDismissed = false
    slashIndex = 0
    consumeSlashCommand(false)
  }

  // --- Ajouter du contexte -------------------------------------------------------------
  // Le pop vit à la racine de .cop-panel (contain: layout paint), comme les autres surfaces
  // flottantes. Les lectures sont bornées AVANT chargement et limitées à deux en parallèle.
  let addMenuOpen = $state(false)
  let addMenuEl = $state<HTMLElement | null>(null)
  let addButtonEl = $state<HTMLButtonElement | null>(null)
  let addContextButtonEl = $state<HTMLButtonElement | null>(null)
  let browserFilesEl = $state<HTMLInputElement | null>(null)
  let browserFolderEl = $state<HTMLInputElement | null>(null)
  let contextLoading = $state(false)
  let addMenuPos = $state<{ left: number; bottom: number; originX: number } | null>(null)
  const ADD_MENU_W = 288
  // Le menu du « + » porte trois sections dépliables — Créer, Contexte, Style — sur le
  // motif du menu de compte de OnePortal : une seule ouverte à la fois, chacune montrant
  // sa valeur courante en sous-titre pour que l'état se lise sans rien déplier.
  type MenuSection = 'create' | 'context' | 'verb'
  let menuSection = $state<MenuSection | null>(null)

  function toggleMenuSection(id: MenuSection) {
    menuSection = menuSection === id ? null : id
    // La jauge prend le focus dès que sa section s'ouvre : flèches immédiatement opérantes.
    if (menuSection === 'verb') void tick().then(() => addMenuEl?.querySelector<HTMLInputElement>('.cop-verb-slider')?.focus())
  }
  const selectionAvailable = $derived(!!activeEditorSelection().text.trim() && activeTab()?.kind !== 'pdf')
  // Ce que le modèle reçoit : le texte SANS les octets d'images intégrées. Le badge doit
  // compter la même chose, sinon il annonce une lecture partielle d'un document envoyé entier.
  // Mémo par onglet : markdownTextLength parcourt tout le document (deux regex) et quatre dérivés
  // le relisent à chaque frappe ; on ne recalcule que si le contenu a changé.
  const textLengthMemo = new WeakMap<object, { content: string; n: number }>()
  const textLengthOf = (t: { kind: DocKind; content: string }) => {
    if (t.kind !== 'md') return t.content.length
    const hit = textLengthMemo.get(t)
    if (hit && hit.content === t.content) return hit.n
    const n = markdownTextLength(t.content)
    textLengthMemo.set(t, { content: t.content, n })
    return n
  }

  function closeAddMenu(restoreFocus = false) {
    // Les actions de contexte passent aussi par ici depuis les gouttes et les commandes « / » :
    // rendre le focus au bouton Outils n'a de sens que si SON menu était ouvert.
    const wasOpen = addMenuOpen
    addMenuOpen = false
    if (restoreFocus && wasOpen) addButtonEl?.focus()
  }

  // Même règle que le menu de l'identité : `.kbd` posé à l'ouverture seulement.
  let addMenuKbd = $state(false)

  function toggleAddMenu(keyboard = false) {
    addMenuOpen = !addMenuOpen
    if (addMenuOpen) {
      menuSection = null
      addMenuKbd = keyboard
      dropsOpen = false
    }
    copilot.contextError = ''
    const trigger = addButtonEl
    if (!addMenuOpen || !trigger || !panelEl) return
    const r = trigger.getBoundingClientRect()
    const a = panelEl.getBoundingClientRect()
    const left = Math.min(Math.max(Math.round(r.left - a.left), 8), Math.round(a.width - ADD_MENU_W - 8))
    // L'échelle d'apparition part du « + », même quand le bord du panneau décale le menu.
    addMenuPos = { left, bottom: Math.round(a.bottom - r.top) + 8, originX: Math.round(r.left + r.width / 2 - a.left - left) }
    void tick().then(() => addMenuEl?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus())
  }

  function onAddMenuKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      closeAddMenu(true)
      return
    }
    if (e.key === 'Tab') {
      closeAddMenu()
      return
    }
    // Les flèches appartiennent au <input type="range"> quand il a le focus : ce sont
    // ses crans, pas la navigation du menu.
    if ((document.activeElement as HTMLElement | null)?.matches('input[type="range"]')) return
    const options = Array.from(addMenuEl?.querySelectorAll<HTMLButtonElement>('.cop-sec, .cop-add-context-action:not(:disabled)') ?? [])
    if (!options.length) return
    const index = options.indexOf(document.activeElement as HTMLButtonElement)
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      ;(options[index + 1] ?? options[0]).focus()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      ;(options[index - 1] ?? options.at(-1))?.focus()
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault()
      ;(e.key === 'Home' ? options[0] : options.at(-1))?.focus()
    }
  }

  // « + » de la rangée des puces : les actions de contexte en gouttes (CopilotDropletMenu).
  // Le menu Outils garde les mêmes actions dans sa section Contexte.
  let dropsOpen = $state(false)
  let dropsKbd = $state(false)
  let dropsEl = $state<HTMLElement | null>(null)
  let dropsAnchor = $state<{ x: number; y: number; width: number } | null>(null)
  const dropItems = $derived<DropItem[]>([
    ...(selectionAvailable ? [{ id: 'selection', label: 'Sélection actuelle', icon: 'text-align-justify-start', run: () => runDrop(addSelection) }] : []),
    { id: 'files', label: 'Fichiers…', icon: 'file-text', run: () => runDrop(addFiles) },
    { id: 'folder', label: 'Dossier de notes…', icon: 'folder', run: () => runDrop(addFolder) },
    { id: 'clipboard', label: 'Presse-papiers', icon: 'clipboard-paste', run: () => runDrop(addClipboard) },
    { id: 'web', label: 'Recherche Web', icon: 'globe', checked: copilot.webSearchEnabled, run: () => runDrop(() => setWebSearchEnabled(!copilot.webSearchEnabled)) },
  ])

  function closeDrops(restoreFocus = false) {
    dropsOpen = false
    if (restoreFocus) addContextButtonEl?.focus()
  }

  function runDrop(action: () => unknown) {
    closeDrops(true)
    void action()
  }

  function toggleDrops(keyboard: boolean) {
    if (dropsOpen) return closeDrops(keyboard)
    if (!addContextButtonEl || !panelEl) return
    addMenuOpen = false
    copilot.contextError = ''
    const r = addContextButtonEl.getBoundingClientRect()
    const a = panelEl.getBoundingClientRect()
    dropsAnchor = { x: r.left + r.width / 2 - a.left, y: r.top + r.height / 2 - a.top, width: a.width }
    dropsKbd = keyboard
    dropsOpen = true
  }

  function contextItem(kind: CopilotContextItem['kind'], label: string, text: string, path?: string | null, signature?: string): CopilotContextItem | null {
    if (!text.trim()) return null
    const bounded = truncateContextItem(text)
    const owner = activeTab()?.path ?? activeTab()?.id
    const selection = activeEditorSelection()
    const id = contextItemId({ kind, path, owner: owner == null ? null : String(owner), from: selection.from, to: selection.to, text: bounded.text })
    return {
      id,
      kind,
      label: cleanContextLabel(label),
      text: bounded.text,
      path,
      signature,
      charCount: text.length,
      truncatedAtLoad: bounded.truncated,
    }
  }

  function addSelection() {
    const tab = activeTab()
    const item = contextItem('selection', `Sélection · ${tab?.name ?? 'document'}`, activeEditorSelection().text)
    if (item) addCopilotContext([item])
    closeAddMenu(true)
  }

  async function readNativeContextFile(path: string): Promise<CopilotContextItem | null> {
    const pdf = /\.pdf$/i.test(path)
    const size = await fileSizeAt(path)
    const limit = pdf ? MAX_CONTEXT_PDF_BYTES : MAX_CONTEXT_TEXT_BYTES
    if (size === null || size > limit) {
      throw new Error(`${cleanContextLabel(path)} dépasse la limite de ${formatBytes(limit)}.`)
    }
    let text: string | null
    if (pdf) {
      const bytes = await readFileBytes(path)
      if (!bytes) throw new Error(`${cleanContextLabel(path)} est illisible.`)
      const { extractPdfText } = await import('../lib/pdf')
      const extraction = await extractPdfText(bytes)
      if (extraction.scanned) throw new Error(`${cleanContextLabel(path)} est un PDF scanné sans couche texte.`)
      text = extraction.text
    } else {
      text = await readTextFileAt(path)
    }
    return text === null ? null : contextItem('file', path, text, path, String(size))
  }

  async function readBrowserContextFile(file: File): Promise<CopilotContextItem | null> {
    const pdf = /\.pdf$/i.test(file.name)
    const limit = pdf ? MAX_CONTEXT_PDF_BYTES : MAX_CONTEXT_TEXT_BYTES
    if (file.size > limit) throw new Error(`${file.name} dépasse la limite de ${formatBytes(limit)}.`)
    let text: string
    if (pdf) {
      const { extractPdfText } = await import('../lib/pdf')
      const extraction = await extractPdfText(new Uint8Array(await file.arrayBuffer()))
      if (extraction.scanned) throw new Error(`${file.name} est un PDF scanné sans couche texte.`)
      text = extraction.text
    } else text = await file.text()
    const relative = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name
    return contextItem('file', relative, text, relative, `${file.size}:${file.lastModified}`)
  }

  async function loadContextBatch<T>(values: readonly T[], reader: (value: T) => Promise<CopilotContextItem | null>) {
    contextLoading = true
    copilot.contextError = ''
    const loaded: CopilotContextItem[] = []
    const errors: string[] = []
    let freeSlots = Math.max(0, MAX_CONTEXT_ITEMS - copilot.contextItems.length)
    const existing = new Set(copilot.contextItems.map((item) => item.id))
    let skipped = 0
    const accepted: T[] = []
    for (const value of values) {
      const rawPath = typeof value === 'string'
        ? value
        : value instanceof File
          ? ((value as File & { webkitRelativePath?: string }).webkitRelativePath || value.name)
          : null
      const id = rawPath ? contextItemId({ kind: 'file', path: rawPath, text: '' }) : null
      if (id && existing.has(id)) accepted.push(value)
      else if (freeSlots > 0) {
        accepted.push(value)
        freeSlots--
      } else skipped++
    }
    try {
      for (let i = 0; i < accepted.length; i += MAX_CONTEXT_LOAD_CONCURRENCY) {
        const batch = await Promise.allSettled(accepted.slice(i, i + MAX_CONTEXT_LOAD_CONCURRENCY).map(reader))
        for (const result of batch) {
          if (result.status === 'fulfilled' && result.value) loaded.push(result.value)
          else if (result.status === 'rejected') errors.push(result.reason instanceof Error ? result.reason.message : String(result.reason))
        }
      }
      if (loaded.length) addCopilotContext(loaded)
      if (skipped) errors.push(`Limite de ${MAX_CONTEXT_ITEMS} sources atteinte : ${skipped} fichier${skipped > 1 ? 's' : ''} non lu${skipped > 1 ? 's' : ''}.`)
      if (errors.length) copilot.contextError = errors.slice(0, 2).join(' ')
    } finally {
      contextLoading = false
    }
  }

  async function addFiles() {
    closeAddMenu()
    if (isTauri) await loadContextBatch(await openContextFilesDialog(), readNativeContextFile)
    else browserFilesEl?.click()
  }

  async function addFolder() {
    closeAddMenu()
    if (!isTauri) {
      browserFolderEl?.click()
      return
    }
    const path = await openFolderDialog(copilot.contextFolder?.path ?? ragDir)
    if (path) setCopilotContextFolder({ path, label: baseName(path) })
  }

  async function addClipboard() {
    closeAddMenu()
    try {
      const text = await navigator.clipboard.readText()
      const item = contextItem('clipboard', 'Texte collé', text)
      if (!item) throw new Error('Le presse-papiers ne contient aucun texte.')
      addCopilotContext([item])
    } catch (error) {
      copilot.contextError = error instanceof Error ? error.message : 'Lecture du presse-papiers refusée.'
    }
  }

  function onBrowserFiles(e: Event) {
    const input = e.currentTarget as HTMLInputElement
    const files = Array.from(input.files ?? [])
    input.value = ''
    void loadContextBatch(files, readBrowserContextFile)
  }

  function onPromptKey(e: KeyboardEvent) {
    // Pendant une composition IME, Entrée valide le mot en cours : jamais un envoi.
    if (e.isComposing || e.keyCode === 229) return
    // Le tray capte d'abord flèches, Entrée, Tab et Échap (Home/End restent à la saisie) :
    // tant qu'il est ouvert, Entrée complète la commande au lieu d'envoyer une demande incomplète.
    if (trayOpen) {
      const count = slashSuggestions.length
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        drawerKbd = true
        slashDismissed = true
        return
      }
      const next = nextTrayIndex(slashIndex, e.key, count)
      if (next !== null) {
        e.preventDefault()
        slashIndex = next
        void revealTrayOption()
        return
      }
      if (count && (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey && !e.altKey))) {
        e.preventDefault()
        // « / » seul puis Entrée : rien n'a été choisi, on n'arme pas la première ligne
        // à l'aveugle — la liste reste, c'est elle la réponse.
        if (e.key === 'Enter' && slashPartial === '' && slashIndex === 0) return
        applySlash(slashSuggestions[Math.min(slashIndex, count - 1)])
        return
      }
    }
    if (e.key !== 'Enter') return
    // Maj+Entrée : saut de ligne natif. Alt+Entrée n'en a aucun dans un textarea : on
    // l'insère (execCommand garde l'annulation et déclenche `input`, donc bind:value).
    if (e.altKey) {
      e.preventDefault()
      document.execCommand('insertText', false, '\n')
      return
    }
    if (e.shiftKey) return
    e.preventDefault()
    // « /pdf » seul dans le champ : la commande arme le livrable, elle n'envoie rien.
    if (consumeSlashCommand(true)) return
    send()
  }

  // Style des réponses (verbosité) : jauge à trois crans, rangée dans la section « Style
  // des réponses » du menu du « + ».
  const VERBOSITY_CHOICES = [
    { value: 'brief', label: 'Bref', hint: "Droit à l'essentiel", icon: 'text-align-start' },
    { value: 'balanced', label: 'Équilibré', hint: 'Longueur naturelle', icon: 'text-align-justify' },
    { value: 'detailed', label: 'Détaillé', hint: 'Développé et structuré', icon: 'text-align-justify-start' },
  ] as const
  // Fermeture au clic extérieur : partagée avec le dropdown Modèle (un seul svelte:window).
  function onGlobalPointerDown(e: PointerEvent) {
    const t = e.target as Node | null
    if (pickerOpen && !pickerRootEl?.contains(t)) pickerOpen = false
    // Le menu vit hors du bouton (racine du panneau) : les deux comptent comme « dedans ».
    if (addMenuOpen && !addButtonEl?.contains(t) && !addMenuEl?.contains(t)) addMenuOpen = false
    if (dropsOpen && !addContextButtonEl?.contains(t) && !dropsEl?.contains(t)) dropsOpen = false
    if (identityMenuOpen && !identityButtonEl?.contains(t) && !identityMenuEl?.contains(t)) identityMenuOpen = false
  }

  // Actions rapides de la vue vide — trois LIVRABLES distincts du même pipeline de résumé
  // (14.2, citations single-fenêtre) : prose, points clés, actions à faire. Pas d'action
  // « Poser une question » : le composer est juste en dessous, elle ne faisait que le focus.
  function quickAction(mode: SummaryMode) {
    const t = activeTab()
    void summarizeDoc({ name: t?.name ?? null, text: t?.content ?? '', kind: t?.kind ?? 'md', path: t?.path ?? null }, mode)
  }

  // Accueil : salutation selon l'heure (lue à l'affichage, une conversation vide ne dure pas
  // assez pour qu'un minuteur vaille son coût).
  const greeting = $derived.by(() => {
    void copilot.messages.length
    const h = new Date().getHours()
    return h >= 18 || h < 5 ? 'Bonsoir' : 'Bonjour'
  })
  // Cartes de l'accueil : les trois livrables du résumé + la portée dossier (réponses citées
  // depuis les notes), qui n'avait jusqu'ici qu'une entrée cachée dans le tiroir Contexte.
  const SUGGESTION_CARDS = [
    { id: 'summary', icon: 'scroll-text', label: 'Résumer', hint: 'L’essentiel en quelques lignes' },
    { id: 'keypoints', icon: 'key-round', label: 'Points clés', hint: 'Idées et chiffres saillants' },
    { id: 'todos', icon: 'list-checks', label: 'Actions à suivre', hint: 'Tâches et décisions à mener' },
    { id: 'folder', icon: 'folder-open', label: 'Interroger le dossier', hint: 'Réponses citées depuis vos notes' },
  ] as const
  function runSuggestion(id: (typeof SUGGESTION_CARDS)[number]['id']) {
    if (id !== 'folder') return quickAction(id)
    copilot.scope = 'folder'
    promptEl?.focus()
  }

  // Les transitions Svelte passent par WAAPI et échappent à la règle globale de mouvement
  // réduit : la sortie du toast lit la préférence elle-même.
  const toastExit = () => ({
    y: -8,
    opacity: 0,
    duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 150,
    easing: cubicOut,
  })

  // Copie d'une réponse : coche brève au succès, bannière à l'échec — jamais muet (Epic 19).
  let copiedIdx = $state(-1)
  let copiedTimer: ReturnType<typeof setTimeout> | undefined
  // Région polie dédiée : vidée à la fin de la coche, une seconde copie est réannoncée.
  let copyAnnouncement = $state('')
  async function copyMessage(i: number, text: string) {
    try {
      await navigator.clipboard.writeText(text)
      copiedIdx = i
      copyAnnouncement = 'Réponse copiée'
      clearTimeout(copiedTimer)
      copiedTimer = setTimeout(() => {
        copiedIdx = -1
        copyAnnouncement = ''
      }, 1300)
    } catch (e) {
      console.error('[copilot] copy', e)
      app.banner = {
        tone: 'error',
        title: 'Copie impossible',
        message: 'Le presse-papiers a refusé le texte. Sélectionnez la réponse et copiez-la avec Ctrl+C.',
      }
    }
  }

  // Sauve la réponse d'index `i` en note. Succès : check 2 s (motif authCodeCopied) ;
  // échec : bannière — un clic sans effet visible violerait « jamais muet » (Epic 19).
  let noteSavedIdx = $state(-1)
  async function saveNote(i: number) {
    const msg = copilot.messages[i]
    // Garde le double-clic ICI aussi : `disabled` ne s'applique qu'au prochain flush —
    // un 2e clic dans la même frame afficherait une fausse bannière d'échec.
    if (!msg || copilot.savingNote) return
    const path = await saveMessageAsNote(msg)
    if (path) {
      noteSavedIdx = i
      setTimeout(() => (noteSavedIdx = -1), 2000)
    } else {
      app.banner = {
        tone: 'error',
        title: 'Note non créée',
        message: 'Impossible d’écrire la note. Vérifiez qu’un dossier est ouvert et accessible en écriture.',
      }
    }
  }

  // Bloc de code d'une réponse ({@html}, donc hors de l'état Svelte) : l'état « copié »
  // vit sur le bouton lui-même, 2 s comme Kube CodeBlock.
  async function copyCodeBlock(button: HTMLButtonElement) {
    if (button.dataset.copied !== undefined) return
    const code = button.closest('.cop-code')?.querySelector('pre')?.textContent ?? ''
    try {
      await navigator.clipboard.writeText(code)
    } catch (e) {
      console.error('[copilot] copy code', e)
      app.banner = {
        tone: 'error',
        title: 'Copie impossible',
        message: 'Le presse-papiers a refusé le code. Sélectionnez-le et copiez-le avec Ctrl+C.',
      }
      return
    }
    // Nom du bouton constant : seule la région live annonce la copie (sinon, deux fois).
    button.dataset.copied = ''
    copyAnnouncement = 'Code copié'
    setTimeout(() => {
      delete button.dataset.copied
      if (copyAnnouncement === 'Code copié') copyAnnouncement = ''
    }, 2000)
  }

  function onScroll() {
    stick?.onScroll()
    // Un aperçu de citation OUVERT devient mensonger au scroll (position figée) → fermé.
    // Le timer d'ouverture en attente survit : il lira la position FRAÎCHE de la puce au
    // moment d'afficher (sinon l'inertie d'un trackpad avale l'aperçu à chaque fois).
    if (citePreview) citePreview = null
  }

  // Suivi du bas (Kube Thread). L'épingle passe par un ResizeObserver sur la conversation,
  // pas par un effet sur le texte : au plus un recalage par frame, aucun travail par jeton.
  let following = $state(true)
  let stick: ReturnType<typeof createStickToBottom> | null = null
  function followConversation(conv: HTMLElement) {
    const box = conv.parentElement as HTMLElement
    stick = createStickToBottom(box, (v) => (following = v))
    stick.scrollToBottom(false)
    const observer = new ResizeObserver(() => stick?.pin())
    observer.observe(conv)
    observer.observe(box)
    return () => {
      observer.disconnect()
      stick = null
      following = true
    }
  }

  // Le bouton devient inerte une fois en bas : au clavier, le focus passe à la saisie
  // plutôt que de tomber sur <body>.
  function jumpToLatest(byKeyboard: boolean) {
    stick?.scrollToBottom(!byKeyboard && !matchMedia('(prefers-reduced-motion: reduce)').matches)
    if (byKeyboard) promptEl?.focus()
  }

  // Une conversation ouverte (tableau REMPLACÉ) s'affiche d'un coup, en bas ; un tour
  // ajouté (push) entre en fondu. `enterFrom` = longueur au dernier remplacement.
  let enterList: ChatMsg[] | null = null
  let enterFromLength = 0
  const enterFrom = $derived.by(() => {
    const list = copilot.messages
    if (list !== enterList) {
      enterList = list
      enterFromLength = untrack(() => list.length)
    }
    return enterFromLength
  })

  // Envoyer une question ramène toujours au bas, même remonté relire ; ouvrir une
  // conversation aussi.
  let seenList: ChatMsg[] | null = null
  let seenLength = 0
  $effect(() => {
    const list = copilot.messages
    const n = list.length
    // Lu ici aussi : sous l'accueil, la liste n'est pas rendue et `enterFrom` ne serait
    // évalué qu'au premier push — le premier échange d'une conversation n'entrerait pas.
    void enterFrom
    untrack(() => {
      const sent = list === seenList && list.slice(seenLength).some((m) => m.role === 'user')
      if (list !== seenList || sent) stick?.scrollToBottom(false)
      seenList = list
      seenLength = n
    })
  })
</script>

<!-- Section « Ajouter un modèle » : les modèles du catalogue pas encore installés. -->
{#snippet addSection(chips: string[])}
  <section>
    <div class="cop-label">Ajouter</div>
    {#if chips.length > 0}
      <div class="cop-chips">
        {#each chips as s (s)}
          <button class="cop-chip" onclick={() => startPull(s)}>
            <svg class="icon" style="font-size:14px;color:var(--ink-4)" aria-hidden="true"><use href="#i-plus" /></svg>{s}
          </button>
        {/each}
      </div>
    {/if}
  </section>
{/snippet}

{#snippet addContextMenu()}
  {#if addMenuOpen && addMenuPos}
    {@const vIdx = Math.max(VERBOSITY_CHOICES.findIndex((c) => c.value === app.copilotVerbosity), 0)}
    {@const vCur = VERBOSITY_CHOICES[vIdx]}
    {@const current = OUTPUT_MODES[copilot.outputMode]}
    <div
      class="cop-add-context-menu"
      class:kbd={addMenuKbd}
      style="left:{addMenuPos.left}px; bottom:{addMenuPos.bottom}px; width:{ADD_MENU_W}px; transform-origin:{addMenuPos.originX}px 100%"
      role="menu"
      tabindex="-1"
      aria-label="Créer, contexte et style"
      bind:this={addMenuEl}
      onkeydown={onAddMenuKeydown}
    >
      <button
        class="cop-sec"
        class:open={menuSection === 'create'}
        aria-expanded={menuSection === 'create'}
        onclick={() => toggleMenuSection('create')}
      >
        <span class="cop-sec-ic"><svg class="icon" aria-hidden="true"><use href="#i-{copilot.outputMode === 'answer' ? 'sparkles' : current.icon}" /></svg></span>
        <span class="cop-sec-copy">
          <strong>Créer</strong>
          <small>{copilot.outputMode === 'answer' ? 'Réponse dans la conversation' : current.label}</small>
        </span>
        <svg class="icon cop-sec-chev" aria-hidden="true"><use href="#i-chevron-down" /></svg>
      </button>
      {#if menuSection === 'create'}
        <div class="cop-sec-body">
          {#each OUTPUT_ORDER as id (id)}
            {@const option = OUTPUT_MODES[id]}
            {@const blocked = cloudOnlyMode(id) && !isCloudProvider(app.copilotProvider)}
            <button
              class="cop-add-context-action"
              class:active={copilot.outputMode === id}
              role="menuitemradio"
              aria-checked={copilot.outputMode === id}
              disabled={blocked}
              onclick={(e) => chooseOutputMode(id, e.detail === 0)}
            >
              <svg class="icon" aria-hidden="true"><use href="#i-{option.icon}" /></svg>
              <span><strong>{option.label}</strong><small>{blocked ? 'Modèle cloud requis' : option.hint}</small></span>
              {#if copilot.outputMode === id}<svg class="icon cop-add-context-check" aria-hidden="true"><use href="#i-check" /></svg>{/if}
            </button>
          {/each}
        </div>
      {/if}

      <button
        class="cop-sec"
        class:open={menuSection === 'context'}
        aria-expanded={menuSection === 'context'}
        onclick={() => toggleMenuSection('context')}
      >
        <span class="cop-sec-ic"><svg class="icon" aria-hidden="true"><use href="#i-layers" /></svg></span>
        <span class="cop-sec-copy">
          <strong>Contexte</strong>
          <small>{#if cloudDestination}{contextSummary} · envoyé à {cloudDestination}{:else}{contextSummary} · reste sur cet appareil{/if}</small>
        </span>
        <svg class="icon cop-sec-chev" aria-hidden="true"><use href="#i-chevron-down" /></svg>
      </button>
      {#if menuSection === 'context'}
        <div class="cop-sec-body">
          <button
            class="cop-add-context-action"
            class:active={copilot.webSearchEnabled}
            role="menuitemcheckbox"
            aria-checked={copilot.webSearchEnabled}
            onclick={() => { setWebSearchEnabled(!copilot.webSearchEnabled); closeAddMenu(true) }}
          >
            <svg class="icon" aria-hidden="true"><use href="#i-search" /></svg><span><strong>Recherche Web</strong><small>Informations actuelles avec sources</small></span>
            <svg class="icon cop-add-context-check" aria-hidden="true"><use href="#i-{copilot.webSearchEnabled ? 'check' : 'plus'}" /></svg>
          </button>
          <button class="cop-add-context-action" role="menuitem" disabled={!selectionAvailable || contextLoading} onclick={addSelection}>
            <svg class="icon" aria-hidden="true"><use href="#i-text-align-justify-start" /></svg><span><strong>Sélection actuelle</strong><small>Capturer le texte sélectionné</small></span>
          </button>
          <button class="cop-add-context-action" role="menuitem" disabled={contextLoading} onclick={() => void addFiles()}>
            <svg class="icon" aria-hidden="true"><use href="#i-file-text" /></svg><span><strong>Fichiers…</strong><small>Markdown, texte, HTML ou PDF</small></span>
          </button>
          <button class="cop-add-context-action" role="menuitem" disabled={contextLoading} onclick={() => void addFolder()}>
            <svg class="icon" aria-hidden="true"><use href="#i-folder" /></svg><span><strong>Dossier de notes…</strong><small>Utiliser son index sémantique</small></span>
          </button>
          <button class="cop-add-context-action" role="menuitem" disabled={contextLoading} onclick={() => void addClipboard()}>
            <svg class="icon" aria-hidden="true"><use href="#i-clipboard-paste" /></svg><span><strong>Texte du presse-papiers</strong><small>Créer un instantané temporaire</small></span>
          </button>
        </div>
      {/if}

      <button
        class="cop-sec"
        class:open={menuSection === 'verb'}
        aria-expanded={menuSection === 'verb'}
        onclick={() => toggleMenuSection('verb')}
      >
        <span class="cop-sec-ic"><svg class="icon" aria-hidden="true"><use href="#i-{vCur.icon}" /></svg></span>
        <span class="cop-sec-copy">
          <strong>Style des réponses</strong>
          <small>{vCur.label} — {vCur.hint}</small>
        </span>
        <svg class="icon cop-sec-chev" aria-hidden="true"><use href="#i-chevron-down" /></svg>
      </button>
      {#if menuSection === 'verb'}
        <div class="cop-sec-body">
          <div class="cop-verb-sliderwrap">
            <!-- Ticks au-dessus de la piste, en ton inverse quand le remplissage les couvre :
                 les crans déjà parcourus restent visibles À TRAVERS la barre. -->
            <div class="cop-verb-ticks" aria-hidden="true">
              {#each VERBOSITY_CHOICES as c, i (c.value)}
                <span class:lit={i < vIdx} class:under-thumb={i === vIdx}></span>
              {/each}
            </div>
            <input
              class="cop-verb-slider"
              type="range"
              min="0"
              max="2"
              step="1"
              value={vIdx}
              style="--fill: calc(13px + (100% - 26px) * {vIdx / 2})"
              aria-label="Style des réponses"
              aria-valuetext={`${vCur.label} — ${vCur.hint}`}
              oninput={(e) => {
                const c = VERBOSITY_CHOICES[Number.parseInt((e.currentTarget as HTMLInputElement).value, 10)]
                if (c) app.copilotVerbosity = c.value
              }}
            />
          </div>
        </div>
      {/if}
    </div>
  {/if}
{/snippet}

{#snippet identityMenu()}
  {#if identityMenuOpen && identityMenuPos}
    <div
      class="cop-identity-menu"
      class:kbd={identityMenuKbd}
      style="left:{identityMenuPos.left}px; top:{identityMenuPos.top}px; width:{IDENTITY_MENU_W}px"
      role="menu"
      aria-label="Menu Doku-San"
      tabindex="-1"
      bind:this={identityMenuEl}
      onkeydown={onIdentityMenuKeydown}
    >
      <button
        role="menuitem"
        class:active={app.copilotView === 'models'}
        onclick={() => openCopilotView('models')}
      >
        <span class="cop-identity-menu-icon"><svg class="icon" aria-hidden="true"><use href="#i-layers" /></svg></span>
        <span><strong>Modèles</strong><small title={identityModel}>{identityModel.slice(identityModel.lastIndexOf('/') + 1)}</small></span>
        <svg class="icon" aria-hidden="true"><use href="#i-{app.copilotView === 'models' ? 'check' : 'chevron-right'}" /></svg>
      </button>
      {#if isCloudProvider(app.copilotProvider)}
        <button
          role="menuitem"
          class:active={app.copilotView === 'memory'}
          onclick={() => openCopilotView('memory')}
        >
          <span class="cop-identity-menu-icon"><svg class="icon" aria-hidden="true"><use href="#i-database" /></svg></span>
          <span><strong>Mémoire</strong><small>{app.cloudMemoryEnabled ? 'Automatique' : 'Désactivée'}</small></span>
          <svg class="icon" aria-hidden="true"><use href="#i-{app.copilotView === 'memory' ? 'check' : 'chevron-right'}" /></svg>
        </button>
      {/if}
    </div>
  {/if}
{/snippet}

{#snippet citePreviewCard()}
  {#if citePreview}
    {@const anchor = citePreview.anchor}
    <div id="cop-cite-preview" class="cop-hover-card" role="tooltip" popover="manual" {@attach (el) => placeCard(el, anchor)}>
      <div class="cop-hover-card-head">
        <span class="cop-source-num">{citePreview.n}</span>
        <span class="cop-hover-card-name">{citePreview.name ?? 'Passage cité'}</span>
      </div>
      <p class="cop-hover-card-text">{citePreview.text}</p>
      <div class="cop-hover-card-hint">Cliquer sur la puce ouvre le passage dans le document</div>
    </div>
  {/if}
{/snippet}

<!-- Échap est géré sur les triggers/pops eux-mêmes (focus toujours dedans quand ouvert)
     avec stopPropagation ; ici seul le clic extérieur, partagé par les deux menus. -->
<svelte:window onpointerdowncapture={pickerOpen || addMenuOpen || dropsOpen || identityMenuOpen ? onGlobalPointerDown : undefined} />

<aside
  class="cop-panel"
  class:open={app.copilotOpen}
  class:expanded={app.copilotExpanded}
  class:resizing
  class:snap={keySnap}
  style:--copilot-width={committedWidthCss}
  style:--copilot-max={maxWidthCss}
  style:flex-basis={dragWidthCss}
  aria-hidden={!app.copilotOpen}
  inert={!app.copilotOpen}
  bind:this={panelEl}
>
  <!-- Séparateur de largeur : même geste que celui des volets (glisser, flèches,
       double-clic pour revenir au défaut). Il vit DANS le panneau plutôt qu'en frère
       dans .app — ainsi il suit le bord du rideau à l'ouverture sans avoir à rejouer
       lui-même l'animation de flex-basis. Masqué en plein écran : là, la largeur n'est
       plus la dimension qui gouverne (voir .cop-panel.expanded). -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    class="cop-resize"
    role="separator"
    tabindex="0"
    aria-orientation="vertical"
    aria-label="Redimensionner le panneau du copilote"
    title="Glissez ou utilisez les flèches pour redimensionner"
    aria-valuemin={COPILOT_MIN_WIDTH}
    aria-valuemax={COPILOT_MAX_WIDTH}
    aria-valuenow={Math.round(panelWidth)}
    onpointerdown={resizeStart}
    onpointermove={resizeMove}
    onpointerup={resizeEnd}
    onpointercancel={resizeEnd}
    ondblclick={() => commitWidth(COPILOT_DEFAULT_WIDTH)}
    onkeydown={resizeKey}
  ></div>

  <!-- Carte flottante (refonte v2) : en-tête et corps vivent sur la même feuille, posée à
       --canvas-gap du bord de la fenêtre. La marge est DANS la largeur du panneau : le
       bornage (copilot-width.ts) et la réserve d'App.svelte n'ont rien à recompter. -->
  <div class="cop-shell">
  <!-- En-tête : identité, actions groupées, contrôles fenêtre (draggable, motif TitleBar) -->
  <header class="cop-head" data-tauri-drag-region>
    <span class="cop-mark" aria-hidden="true">
      <svg class="icon" aria-hidden="true"><use href="#i-leaf" /></svg>
    </span>
    <span class="cop-title" data-tauri-drag-region>Doku-San</span>
    <div class="cop-head-spacer" data-tauri-drag-region></div>
    <div class="cop-cap" role="group" aria-label="Actions du copilote">
      {#if app.copilotView === 'models' || app.copilotView === 'memory'}
        <button class="cop-ic" use:tooltip={'Retour au chat'} aria-label="Retour au chat" onclick={() => (app.copilotView = 'chat')}>
          <svg class="icon" aria-hidden="true"><use href="#i-arrow-left" /></svg>
        </button>
      {:else}
        <button class="cop-ic" use:tooltip={'Nouvelle conversation'} aria-label="Nouvelle conversation" disabled={copilot.messages.length === 0} onclick={() => startNewChat()}>
          <svg class="icon" aria-hidden="true"><use href="#i-square-pen" /></svg>
        </button>
      {/if}
      <button
        class="cop-ic cop-cap-history"
        class:active={app.sidebarOpen && app.sidebarView === 'discussions'}
        use:tooltip={'Discussions'}
        aria-label="Discussions Doku-San"
        aria-pressed={app.sidebarOpen && app.sidebarView === 'discussions'}
        onclick={() => toggleSidebarView('discussions')}
      >
        <svg class="icon" aria-hidden="true"><use href="#i-rotate-ccw-clock" /></svg>
      </button>
      <button
        class="cop-ic"
        class:active={app.copilotExpanded}
        use:tooltip={app.copilotExpanded ? { label: 'Réduire le chat', kbd: 'Échap' } : 'Agrandir le chat'}
        aria-label={app.copilotExpanded ? 'Réduire le chat' : 'Agrandir le chat'}
        aria-pressed={app.copilotExpanded}
        onclick={() => (app.copilotExpanded = !app.copilotExpanded)}
      >
        <svg class="icon" aria-hidden="true"><use href="#i-{app.copilotExpanded ? 'minimize-2' : 'maximize-2'}" /></svg>
      </button>
      {#if app.copilotView === 'chat' && evidenceTurns.length > 0}
        <button
          bind:this={activityButtonEl}
          class="cop-ic"
          class:active={activityDrawerOpen}
          use:tooltip={'Sources et activité'}
          aria-label="Afficher les sources et l’activité"
          aria-expanded={activityDrawerOpen}
          onclick={() => void toggleActivityDrawer()}
        >
          <svg class="icon" aria-hidden="true"><use href="#i-list" /></svg>
        </button>
      {/if}
      <button
        class="cop-ic"
        class:active={identityMenuOpen}
        bind:this={identityButtonEl}
        use:tooltip={'Modèles et mémoire'}
        aria-haspopup="menu"
        aria-expanded={identityMenuOpen}
        aria-label="Plus d’options Doku-San"
        onclick={(e) => toggleIdentityMenu(e.detail === 0)}
        onkeydown={(event) => { if (event.key === 'Escape') closeIdentityMenu(true) }}
      >
        <svg class="icon" aria-hidden="true"><use href="#i-ellipsis" /></svg>
      </button>
    </div>
    <div class="cop-winctl">
      <button class="cop-win" use:tooltip={'Réduire'} aria-label="Réduire" onclick={minimizeWindow}>
        <svg class="icon" aria-hidden="true"><use href="#i-minus" /></svg>
      </button>
      <button class="cop-win" use:tooltip={'Agrandir'} aria-label="Agrandir" onclick={toggleMaximizeWindow}>
        <svg class="icon cop-win-square" aria-hidden="true"><use href="#i-square" /></svg>
      </button>
      <button class="cop-win close" use:tooltip={'Fermer'} aria-label="Fermer" onclick={closeWindow}>
        <svg class="icon" aria-hidden="true"><use href="#i-x" /></svg>
      </button>
    </div>
  </header>

  <!-- Corps : sous l'en-tête, sur la même feuille -->
  <div class="cop-card">
    <div class="cop-scroll" bind:this={scroller} onscroll={onScroll}>
      {#if app.copilotView === 'chat' && cloudMemory.lastBatch}
        <!-- L'auto-effacement referme aussi la fenêtre d'annulation : c'est voulu et
             c'est la convention (l'« Annuler » d'un envoi de mail vit le temps du
             bandeau). Le survol suspend le compte à rebours, donc viser le bouton ne
             fait jamais disparaître la cible.
             L'enveloppe porte la sortie, la carte l'entrée (une seule fois) ; le {#key} ne
             remonte que le filet de vie, qui repart avec le compte à rebours (autoDismiss
             relance son minuteur au changement de `key`). -->
        <div class="cop-toast-slot" out:fly={toastExit()}>
        <div
          class="cop-memory-toast"
          role="status"
          use:autoDismiss={{ delay: NOTICE_DELAY.success, key: cloudMemory.lastBatch, onDismiss: () => (cloudMemory.lastBatch = null) }}
        >
          <svg class="icon" aria-hidden="true"><use href="#i-database" /></svg>
          <span><strong>Mémoire mise à jour</strong><small>{memoryBatchLabel()}</small></span>
          {#if shownMemoryWorkspace ?? cloudMemory.workspace}
            <button onclick={() => void undoCloudMemory((shownMemoryWorkspace ?? cloudMemory.workspace)!)}>Annuler</button>
          {/if}
          <button class="icon" use:tooltip={'Masquer'} aria-label="Masquer la notification" onclick={() => (cloudMemory.lastBatch = null)}><svg class="icon" aria-hidden="true"><use href="#i-x" /></svg></button>
          {#key cloudMemory.lastBatch}
            <span class="toast-life" aria-hidden="true" style:animation-duration="{NOTICE_DELAY.success}ms"></span>
          {/key}
        </div>
        </div>
      {/if}
      {#if app.copilotView === 'chat' && cloudMemory.error}
        <div class="cop-toast-slot" out:fly={toastExit()}>
        <div
          class="cop-memory-toast error"
          role="alert"
          use:autoDismiss={{ delay: NOTICE_DELAY.error, key: cloudMemory.error, onDismiss: () => (cloudMemory.error = '') }}
        >
          <svg class="icon" aria-hidden="true"><use href="#i-triangle-alert" /></svg>
          <span><strong>Mémoire indisponible</strong><small>{cloudMemory.error}</small></span>
          <button onclick={openMemoryView}>Vérifier</button>
          <button class="icon" use:tooltip={'Masquer'} aria-label="Masquer l’erreur mémoire" onclick={() => (cloudMemory.error = '')}><svg class="icon" aria-hidden="true"><use href="#i-x" /></svg></button>
          <!-- Délai 0 = erreur persistante : pas de filet de vie (figé à mi-course sinon). -->
          {#if NOTICE_DELAY.error > 0}
            {#key cloudMemory.error}
              <span class="toast-life" aria-hidden="true" style:animation-duration="{NOTICE_DELAY.error}ms"></span>
            {/key}
          {/if}
        </div>
        </div>
      {/if}
      {#if app.copilotView === 'models'}
        <header class="cop-view-head">
          <h2>Modèles</h2>
          <p>Le moteur qui fait tourner Doku-San : sur cet appareil par défaut, dans le cloud si vous le choisissez.</p>
        </header>
        <div class="cop-picker" bind:this={pickerRootEl}>
          <div class="cop-label" id="cop-picker-label">Modèle actif</div>
          <div class="cop-picker-shell" class:open={pickerOpen}>
            <button
              class="cop-picker-trigger"
              id="cop-picker-trigger"
              bind:this={pickerTriggerEl}
              aria-haspopup="menu"
              aria-expanded={pickerOpen}
              aria-labelledby="cop-picker-label cop-picker-trigger"
              onclick={togglePicker}
              onkeydown={onTriggerKeydown}
            >
              <span class="cop-tile" data-tint={app.copilotProvider === 'local' ? 'sage' : 'slate'} aria-hidden="true"><svg class="icon" aria-hidden="true"><use href="#i-{app.copilotProvider === 'local' ? 'cpu' : 'cloud'}" /></svg></span>
              <span class="cop-picker-name">
                {#if app.copilotProvider === 'openai'}
                  <strong class="sans">{openAiModel}</strong>
                  <small class:warn={openAiState.kind === 'warn'}>OpenAI · {openAiState.label}</small>
                {:else if app.copilotProvider === 'minimax'}
                  <strong class="sans">{app.minimaxModel || MINIMAX_DEFAULT_MODEL}</strong>
                  <small class:warn={minimaxState.kind === 'warn'}>MiniMax · {minimaxState.label}</small>
                {:else if !app.activeModel}
                  <strong class="placeholder">Choisir un modèle</strong>
                  <small>Sur cet appareil · privé</small>
                {:else}
                  <strong>{app.activeModel}</strong>
                  <small class:warn={localModelMissing}>
                    {localModelMissing ? 'introuvable sur le disque — choisissez un modèle' : 'Sur cet appareil · privé'}
                  </small>
                {/if}
              </span>
              <svg class="icon cop-picker-chev" class:open={pickerOpen} aria-hidden="true"><use href="#i-chevron-down" /></svg>
            </button>
            {#if pickerOpen}
              <div
                class="cop-picker-pop"
                role="menu"
                aria-labelledby="cop-picker-label"
                tabindex="-1"
                bind:this={pickerListEl}
                onkeydown={onPickerKeydown}
              >
              <button
                class="cop-picker-sec"
                class:open={pickerSection === 'local'}
                role="menuitem"
                aria-haspopup="true"
                aria-expanded={pickerSection === 'local'}
                onclick={() => toggleSection('local')}
              >
                <svg class="icon" aria-hidden="true"><use href="#i-cpu" /></svg>
                <span class="cop-picker-sec-name">Sur cet appareil</span>
                <span class="cop-picker-sec-state">privé</span>
                <svg class="icon cop-picker-sec-chev" aria-hidden="true"><use href="#i-chevron-right" /></svg>
              </button>
              <div
                class="cop-picker-fold"
                class:open={pickerSection === 'local'}
                role="group"
                aria-label="Modèles locaux"
                aria-hidden={pickerSection !== 'local'}
                inert={pickerSection !== 'local'}
              >
                <div class="cop-picker-fold-inner">
                  {#if copilot.loading}
                    <div class="cop-picker-empty">Démarrage du moteur IA…</div>
                  {:else if chatModels.length > 0}
                    {#each chatModels as m (m.name)}
                      {@const selected = app.copilotProvider === 'local' && m.name === app.activeModel}
                      <button class="cop-picker-opt" role="menuitemradio" aria-checked={selected} onclick={() => pickLocal(m.name)}>
                        <span class="cop-dot" class:on={selected}></span>
                        <span class="cop-model-tag grow">{m.name}</span>
                        <span class="cop-size">{formatBytes(m.size)}</span>
                      </button>
                    {/each}
                    <!-- Accès à la carte locale (bibliothèque, index du dossier, ajouter)
                         SANS changer le modèle actif — l'ancien onglet « Sur cet appareil »
                         offrait ce chemin, le dropdown doit le garder. -->
                    <button class="cop-picker-opt" role="menuitem" onclick={pickManageLocal}>
                      <svg class="icon" aria-hidden="true"><use href="#i-sliders-horizontal" /></svg>
                      <span class="grow">Gérer modèles et index…</span>
                    </button>
                  {:else if !copilot.modelsLoaded}
                    <!-- Liste jamais lue (moteur pas démarré / indisponible) : ne JAMAIS
                         affirmer « aucun modèle installé » sans avoir regardé. -->
                    <button class="cop-picker-opt" role="menuitem" onclick={pickManageLocal}>
                      <svg class="icon" aria-hidden="true"><use href="#i-triangle-alert" /></svg>
                      <span class="grow">Moteur IA indisponible — voir ci-dessous</span>
                    </button>
                  {:else}
                    <!-- Entrée-action (pas un choix de valeur) : bascule sur la section
                         locale où vivent onboarding et téléchargement. -->
                    <button class="cop-picker-opt" role="menuitem" onclick={pickManageLocal}>
                      <svg class="icon" aria-hidden="true"><use href="#i-download" /></svg>
                      <span class="grow">Aucun modèle installé — gérer ci-dessous</span>
                    </button>
                  {/if}
                </div>
              </div>
              <div class="cop-picker-sep"></div>
              <button
                class="cop-picker-sec"
                class:open={pickerSection === 'openai'}
                role="menuitem"
                aria-haspopup="true"
                aria-expanded={pickerSection === 'openai'}
                onclick={() => toggleSection('openai')}
              >
                <svg class="icon" aria-hidden="true"><use href="#i-cloud" /></svg>
                <span class="cop-picker-sec-name">OpenAI</span>
                <span class="cop-picker-sec-state" class:ok={openAiState.kind === 'ok'} class:warn={openAiState.kind === 'warn'}>
                  {openAiState.label}
                </span>
                <svg class="icon cop-picker-sec-chev" aria-hidden="true"><use href="#i-chevron-right" /></svg>
              </button>
              <div
                class="cop-picker-fold"
                class:open={pickerSection === 'openai'}
                role="group"
                aria-label="Modèles OpenAI"
                aria-hidden={pickerSection !== 'openai'}
                inert={pickerSection !== 'openai'}
              >
                <div class="cop-picker-fold-inner">
                  {#each openAiChoices as m (m)}
                    {@const selected = app.copilotProvider === 'openai' && m === openAiModel}
                    <button class="cop-picker-opt" role="menuitemradio" aria-checked={selected} onclick={() => pickOpenAi(m)}>
                      <span class="cop-dot" class:on={selected}></span>
                      <span class="cop-cloud-model grow">{m}</span>
                    </button>
                  {/each}
                </div>
              </div>
              <div class="cop-picker-sep"></div>
              <button
                class="cop-picker-sec"
                class:open={pickerSection === 'minimax'}
                role="menuitem"
                aria-haspopup="true"
                aria-expanded={pickerSection === 'minimax'}
                onclick={() => toggleSection('minimax')}
              >
                <svg class="icon" aria-hidden="true"><use href="#i-cloud" /></svg>
                <span class="cop-picker-sec-name">MiniMax</span>
                <span class="cop-picker-sec-state" class:ok={minimaxState.kind === 'ok'} class:warn={minimaxState.kind === 'warn'}>
                  {minimaxState.label}
                </span>
                <svg class="icon cop-picker-sec-chev" aria-hidden="true"><use href="#i-chevron-right" /></svg>
              </button>
              <div
                class="cop-picker-fold"
                class:open={pickerSection === 'minimax'}
                role="group"
                aria-label="Modèles MiniMax"
                aria-hidden={pickerSection !== 'minimax'}
                inert={pickerSection !== 'minimax'}
              >
                <div class="cop-picker-fold-inner">
                  {#each minimaxChoices as m (m)}
                    {@const selected = app.copilotProvider === 'minimax' && m === (app.minimaxModel || MINIMAX_DEFAULT_MODEL)}
                    <button class="cop-picker-opt" role="menuitemradio" aria-checked={selected} onclick={() => pickMinimax(m)}>
                      <span class="cop-dot" class:on={selected}></span>
                      <span class="cop-cloud-model grow">{m}</span>
                    </button>
                  {/each}
                </div>
              </div>
              </div>
            {/if}
          </div>
        </div>

        {#if app.copilotProvider === 'openai'}
          <div class="cop-openai-view">
            <div class="cop-cloud-hero">
              <div class="cop-cloud-head">
                <span class="cop-tile" data-tint="slate" aria-hidden="true"><svg class="icon" aria-hidden="true"><use href="#i-cloud" /></svg></span>
                <span class="cop-cloud-name">
                  <strong>{openAiModel}</strong>
                  <small>Raisonnement faible · « Réfléchir » pour approfondir</small>
                </span>
                {#if copilot.openAiChecking}
                  <span class="cop-cloud-status checking">Vérification…</span>
                {:else if copilot.openAiAuthenticated && copilot.openAiPreferredAvailable === false}
                  <span class="cop-cloud-status unavailable">Aucun modèle</span>
                {:else if copilot.openAiAuthenticated}
                  <span class="cop-cloud-status ready"><span class="cop-dot breathe"></span>Connecté</span>
                {:else if copilot.openAiAuthPhase === 'waiting'}
                  <span class="cop-cloud-status checking">En attente…</span>
                {:else}
                  <span class="cop-cloud-status">À connecter</span>
                {/if}
              </div>
            </div>

            {#if copilot.openAiAuthenticated}
              <div class:warn={copilot.openAiPreferredAvailable === false} class="cop-cloud-note ok" role="status">
                <svg class="icon" aria-hidden="true"><use href="#i-{copilot.openAiPreferredAvailable === false ? 'triangle-alert' : 'shield-check'}" /></svg>
                <span>
                  <strong>{copilot.openAiPreferredAvailable === false ? 'Aucun modèle disponible' : 'Compte OpenAI connecté'}</strong>
                  <small>
                    {copilot.openAiPreferredAvailable === false
                      ? 'Cet abonnement ne propose aucun modèle dans Codex. Doku ne lancera aucune génération.'
                      : `La session est protégée par ${vaultLabel()}. Aucune clé API n’est demandée ni enregistrée.`}
                  </small>
                </span>
              </div>
              {#if copilot.openAiStatusError}
                <p class="cop-auth-error" role="status">{copilot.openAiStatusError}</p>
              {/if}
              <button class="cop-btn-quiet" onclick={() => void disconnectOpenAiAccount()}>
                <svg class="icon" aria-hidden="true"><use href="#i-log-out" /></svg>Déconnecter le compte
              </button>
            {:else if copilot.openAiAuthPhase === 'waiting' && copilot.openAiAuth}
              <section class="cop-cloud-setup cop-auth-wait" aria-live="polite">
                <span class="cop-auth-mark"><svg class="icon" aria-hidden="true"><use href="#i-app-window" /></svg></span>
                <h3>Validez dans votre navigateur</h3>
                <p>Connectez-vous à OpenAI, puis saisissez ce code sur la page officielle.</p>
                <button class="cop-auth-code" use:tooltip={'Copier le code'} onclick={() => void copyOpenAiCode()}>
                  <span>{copilot.openAiAuth.userCode}</span>
                  <span class="cop-swap" class:on={authCodeCopied} aria-hidden="true"><svg class="icon"><use href="#i-copy" /></svg><svg class="icon"><use href="#i-check" /></svg></span>
                </button>
                <div class="cop-auth-actions">
                  <button class="cop-btn-fill" onclick={() => void openOpenAiAuthPage(copilot.openAiAuth!.verificationUrl)}>
                    <svg class="icon" aria-hidden="true"><use href="#i-external-link" /></svg>Ouvrir OpenAI
                  </button>
                  <button class="cop-btn-quiet" onclick={() => void cancelOpenAiConnection()}>Annuler</button>
                </div>
                <div class="cop-auth-pending"><span></span>En attente de votre validation…</div>
                {#if copilot.openAiAuthError}<p class="cop-auth-error" role="status">{copilot.openAiAuthError}</p>{/if}
              </section>
            {:else}
              <section class="cop-cloud-setup">
                <h3>Connecter votre compte OpenAI</h3>
                <p>Utilisez votre abonnement ChatGPT/Codex comme moteur de Doku-San. La connexion se fait sur la page officielle OpenAI.</p>
                <ol>
                  <li><span class="cop-tile" data-tint="slate" aria-hidden="true"><svg class="icon" aria-hidden="true"><use href="#i-lock-open" /></svg></span><p><strong>Aucune clé API</strong><small>Doku ne vous demandera jamais d’en créer une.</small></p></li>
                  <li><span class="cop-tile" data-tint="sage" aria-hidden="true"><svg class="icon" aria-hidden="true"><use href="#i-shield-check" /></svg></span><p><strong>Validation par OpenAI</strong><small>Votre mot de passe ne transite jamais par Doku.</small></p></li>
                  <li><span class="cop-tile" data-tint="ochre" aria-hidden="true"><svg class="icon" aria-hidden="true"><use href="#i-lock" /></svg></span><p><strong>Session protégée</strong><small>Les jetons restent dans {vaultLabel()}.</small></p></li>
                </ol>
                <button class="cop-btn-fill" onclick={() => void beginOpenAiAuth()} disabled={copilot.openAiAuthPhase === 'starting'}>
                  <svg class="icon" aria-hidden="true"><use href="#i-log-in" /></svg>{copilot.openAiAuthPhase === 'starting' ? 'Connexion…' : 'Se connecter avec OpenAI'}
                </button>
                {#if copilot.openAiAuthError}<p class="cop-auth-error" role="status">{copilot.openAiAuthError}</p>{/if}
              </section>
            {/if}

            <div class="cop-cloud-privacy">
              <svg class="icon" aria-hidden="true"><use href="#i-info" /></svg>
              <p><strong>Envoi volontaire vers le cloud.</strong> Quand OpenAI est actif, la question et le contexte affiché sont transmis au service Codex. Le mode local reste entièrement sur votre machine.</p>
            </div>
          </div>
        {:else if app.copilotProvider === 'minimax'}
          <div class="cop-openai-view">
            <div class="cop-cloud-hero">
              <div class="cop-cloud-head">
                <span class="cop-tile" data-tint="slate" aria-hidden="true"><svg class="icon" aria-hidden="true"><use href="#i-cloud" /></svg></span>
                <span class="cop-cloud-name">
                  <strong>{app.minimaxModel || MINIMAX_DEFAULT_MODEL}</strong>
                  <small>MiniMax · compatible OpenAI</small>
                </span>
                {#if copilot.minimaxChecking || copilot.minimaxConnecting}
                  <span class="cop-cloud-status checking">Vérification…</span>
                {:else if copilot.minimaxStatus?.keyRejected}
                  <span class="cop-cloud-status unavailable">Clé refusée</span>
                {:else if copilot.minimaxStatus?.connected}
                  <span class="cop-cloud-status ready"><span class="cop-dot breathe"></span>Connecté</span>
                {:else}
                  <span class="cop-cloud-status">À connecter</span>
                {/if}
              </div>
            </div>

            {#if copilot.minimaxStatus?.connected && !copilot.minimaxStatus.keyRejected}
              <div class="cop-cloud-note ok" role="status">
                <svg class="icon" aria-hidden="true"><use href="#i-shield-check" /></svg>
                <span>
                  <strong>Clé MiniMax connectée</strong>
                  <small>La clé est protégée par {vaultLabel()} — elle n'apparaît jamais dans les réglages ni dans les fichiers de Doku.</small>
                </span>
              </div>
              {#if copilot.minimaxStatus.error}
                <p class="cop-auth-error" role="status">{copilot.minimaxStatus.error}</p>
              {/if}
              <button class="cop-btn-quiet" onclick={() => void disconnectMinimaxKey()}>
                <svg class="icon" aria-hidden="true"><use href="#i-log-out" /></svg>Déconnecter la clé
              </button>
            {:else}
              <section class="cop-cloud-setup">
                <h3>{copilot.minimaxStatus?.keyRejected ? 'Reconnecter votre clé MiniMax' : 'Connecter votre clé MiniMax'}</h3>
                <p>
                  {copilot.minimaxStatus?.keyRejected
                    ? 'La clé enregistrée a été refusée par le service. Collez une clé valide pour reprendre.'
                    : 'Créez une clé API sur platform.minimax.io, puis collez-la ici. Elle est vérifiée avant d’être enregistrée.'}
                </p>
                <ol>
                  <li><span class="cop-tile" data-tint="sage" aria-hidden="true"><svg class="icon" aria-hidden="true"><use href="#i-shield-check" /></svg></span><p><strong>Vérifiée avant stockage</strong><small>Clé invalide ou réseau en panne : rien n’est enregistré.</small></p></li>
                  <li><span class="cop-tile" data-tint="ochre" aria-hidden="true"><svg class="icon" aria-hidden="true"><use href="#i-lock" /></svg></span><p><strong>Protégée par {vaultShortLabel()}</strong><small>La clé vit dans {vaultLabel()}, jamais dans les fichiers de Doku.</small></p></li>
                </ol>
                <form
                  class="cop-mm-connect"
                  onsubmit={(e) => {
                    e.preventDefault()
                    void submitMinimaxKey()
                  }}
                >
                  <input
                    type="password"
                    placeholder="Clé API MiniMax"
                    autocomplete="off"
                    bind:value={minimaxKeyInput}
                    disabled={copilot.minimaxConnecting}
                  />
                  <button class="cop-btn-fill" type="submit" disabled={copilot.minimaxConnecting || !minimaxKeyInput.trim()}>
                    <svg class="icon" aria-hidden="true"><use href="#i-log-in" /></svg>{copilot.minimaxConnecting ? 'Vérification…' : 'Connecter'}
                  </button>
                </form>
                {#if copilot.minimaxConnectError}<p class="cop-auth-error" role="status">{copilot.minimaxConnectError}</p>{/if}
              </section>
            {/if}

            <div class="cop-cloud-privacy">
              <svg class="icon" aria-hidden="true"><use href="#i-info" /></svg>
              <p><strong>Envoi volontaire vers le cloud.</strong> Quand MiniMax est actif, la question et le contexte affiché sont transmis à api.minimax.io. Le mode local reste entièrement sur votre machine.</p>
            </div>
          </div>
        {:else}
        {#if copilot.error}
          <div class="cop-msg err row">
            <span class="grow-wrap">{copilot.error}</span>
            <button class="cop-dismiss" use:tooltip={'Masquer'} aria-label="Masquer l'erreur" onclick={() => (copilot.error = '')}>
              <svg class="icon" aria-hidden="true"><use href="#i-x" /></svg>
            </button>
          </div>
        {/if}

        {#if copilot.loading}
          <p class="cop-msg">Démarrage du moteur IA…</p>
        {:else if copilot.models.length === 0 && !copilot.pulling}
          <!-- Onboarding : aucun modèle installé -->
          <div class="cop-onboard">
            <div class="cop-onboard-tile"><svg class="icon" style="font-size:24px" aria-hidden="true"><use href="#i-leaf" /></svg></div>
            <div>
              <div class="cop-onboard-title">Activez votre copilote</div>
              <p class="cop-onboard-sub">
                Il tourne <b>entièrement sur votre machine</b>. Téléchargez un modèle pour commencer — rien ne quitte votre ordinateur.
              </p>
            </div>
            <div class="cop-reco">
              <div class="cop-reco-head">
                <span class="cop-model-tag">LFM3-Omni · 2B · Q4_0</span>
                <span class="cop-badge">conseillé</span>
              </div>
              <div class="cop-reco-sub">1,0 Go · français solide, sources citées, optimisé ARM</div>
              <button class="cop-btn-fill" onclick={() => startPull(RECO_MODEL)}>
                <svg class="icon" aria-hidden="true"><use href="#i-download" /></svg>Télécharger ce modèle
              </button>
            </div>
          </div>
        {:else}
          <!-- Une progression est un état système, jamais un réglage avancé : elle reste
               visible même lorsque la gestion locale est repliée. -->
          {#if copilot.pulling}
            <section class="cop-download-now">
              <div class="cop-label">Téléchargement</div>
              <div class="cop-dl">
                <div class="cop-dl-head">
                  <svg class="icon orbit" style="font-size:16px" aria-hidden="true"><use href="#i-loader-circle" /></svg>
                  <span class="cop-model-tag grow" title={copilot.pulling.name}>{copilot.pulling.name}</span>
                  <span class="cop-size">
                    {copilot.pulling.total > 0 ? `${formatBytes(copilot.pulling.done)} / ${formatBytes(copilot.pulling.total)}` : '…'}
                  </span>
                  <button class="cop-del" use:tooltip={'Annuler'} aria-label="Annuler le téléchargement" onclick={cancelPull}>
                    <svg class="icon" aria-hidden="true"><use href="#i-x" /></svg>
                  </button>
                </div>
                <div class="cop-track"><div class="doku-skel" style="width:{copilot.pulling.pct}%;height:100%;border-radius:3px"></div></div>
              </div>
            </section>
          {/if}

          <details class="cop-advanced">
            <summary onkeydown={onAdvancedSummaryKey}>
              <span class="cop-advanced-icon"><svg class="icon" aria-hidden="true"><use href="#i-sliders-horizontal" /></svg></span>
              <span class="cop-advanced-copy">
                <strong>Gérer les modèles locaux</strong>
                <small>{copilot.models.length} installé{copilot.models.length > 1 ? 's' : ''} · {formatBytes(libraryTotal)} · index du dossier</small>
              </span>
              <svg class="icon cop-advanced-chev" aria-hidden="true"><use href="#i-chevron-down" /></svg>
            </summary>
            <div class="cop-sections cop-advanced-body">
            <!-- Le modèle actif vit désormais dans le dropdown « MODÈLE ACTIF » en tête de
                 vue (l'ancienne carte héro faisait doublon) ; la bibliothèque garde la
                 gestion disque (activer/supprimer/tailles). -->
            <!-- Bibliothèque -->
            <section>
              <div class="cop-label row">
                <span>Bibliothèque</span>
                <span class="cop-count">{copilot.models.length} installé{copilot.models.length > 1 ? 's' : ''} · {formatBytes(libraryTotal)}</span>
              </div>
              <div class="cop-lib">
                {#each copilot.models as m (m.name)}
                  {@const isActive = m.name === app.activeModel}
                  {#if confirmDelete === m.name}
                    <div class="cop-row confirm">
                      <span class="cop-confirm-txt">
                        {isActive
                          ? "C'est le modèle actif. Le supprimer du disque ? Action irréversible."
                          : `Supprimer « ${m.name} » du disque ? Action irréversible.`}
                      </span>
                      <div class="cop-confirm-acts">
                        <button class="cop-err-btn" onclick={() => (confirmDelete = null)}>Annuler</button>
                        <button class="cop-err-btn danger" onclick={() => doRemove(m.name)}>Supprimer</button>
                      </div>
                    </div>
                  {:else}
                    {@const embed = m.kind !== 'chat'}
                    <div class="cop-row" class:active={isActive}>
                      <!-- Un modèle d'embedding ne sait pas générer : pick désactivé (même
                           prédicat que le dropdown), icône database au lieu de la pastille. -->
                      <button
                        class="cop-row-pick"
                        use:tooltip={embed ? '' : 'Choisir comme modèle actif'}
                        title={m.kind === 'voice' ? 'Module audio de LFM3 — réservé au mode vocal' : embed ? "Modèle d'embedding — réservé à l'index du dossier" : undefined}
                        aria-pressed={isActive}
                        disabled={embed}
                        onclick={() => setActiveModel(m.name)}
                      >
                        {#if embed}
                          <svg class="icon" style="font-size:14px;color:var(--ink-4)" aria-hidden="true"><use href="#i-{m.kind === 'voice' ? 'mic' : 'database'}" /></svg>
                        {:else}
                          <span class="cop-dot" class:on={isActive}></span>
                        {/if}
                        <span class="cop-model-tag grow">{m.name}</span>
                        <span class="cop-size">{formatBytes(m.size)}</span>
                      </button>
                      <button class="cop-del" use:tooltip={'Supprimer'} aria-label={'Supprimer ' + m.name} onclick={() => (confirmDelete = m.name)}>
                        <svg class="icon" aria-hidden="true"><use href="#i-trash" /></svg>
                      </button>
                    </div>
                  {/if}
                {/each}
              </div>
            </section>

            <!-- Index sémantique du dossier (15.2, ADR-0015) : embeddings 100 % locaux
                 via le sidecar — prépare le mode « dossier » du copilote (15.3). -->
            <section>
              <div class="cop-label row">
                <span>Index du dossier</span>
                {#if ragReadyHere && ragState.files > 0}
                  <span class="cop-count">{ragState.files} note{ragState.files > 1 ? 's' : ''} · {ragState.chunks} passage{ragState.chunks > 1 ? 's' : ''}</span>
                {/if}
              </div>
              <div class="cop-rag">
                <div class="cop-rag-row">
                  <svg class="icon" style="font-size:16px;color:var(--ink-4)" aria-hidden="true"><use href="#i-database" /></svg>
                  <span class="cop-model-tag grow" title="Modèle d'embedding — réglage distinct du modèle de chat">{embedModelName}</span>
                  {#if !embedInstalled}
                    <button class="cop-btn-sm" onclick={() => startPull(embedModelName)} disabled={!!copilot.pulling}>Télécharger</button>
                  {:else if ragIndexing}
                    <button class="cop-del" use:tooltip={"Annuler l'indexation"} aria-label="Annuler l'indexation" onclick={cancelRagIndexing}>
                      <svg class="icon" aria-hidden="true"><use href="#i-x" /></svg>
                    </button>
                  {:else}
                    <!-- Désactivé aussi quand un AUTRE dossier s'indexe (une seule indexation à la fois). -->
                    <button class="cop-btn-sm" onclick={indexFolder} disabled={!ragDir || ragState.phase === 'indexing'} title={ragDir ?? 'Ouvrir un document ou un dossier d’abord'}>Indexer</button>
                  {/if}
                </div>
                {#if ragIndexing}
                  <div class="cop-rag-progress">
                    <span class="cop-rag-note" style="margin-top:0">{ragState.done}/{ragState.total} fichier{ragState.total > 1 ? 's' : ''}</span>
                    <div class="cop-track grow"><div class="doku-skel" style="width:{ragState.total ? Math.round((ragState.done / ragState.total) * 100) : 0}%;height:100%;border-radius:3px"></div></div>
                  </div>
                {:else if ragState.phase === 'error' && ragState.dir === ragDir}
                  <div class="cop-rag-note err">
                    {ragState.error}
                    {#if ragState.needsModel}
                      <button class="cop-err-btn" onclick={() => void pullEmbedAndIndex(ragState.needsModel)}>Télécharger</button>
                    {/if}
                  </div>
                {:else if ragReadyHere}
                  <div class="cop-rag-note">
                    {ragState.canceled ? 'Indexation annulée — index partiel conservé.' : 'Index à jour.'}
                    <!-- Caps JAMAIS silencieux (règle AGENTS.md) : un index partiel qui se tait
                         donnerait des réponses « sûres » sur un corpus incomplet. -->
                    {#if ragState.skipped > 0}
                      Partiel : {ragState.skipped} fichier{ragState.skipped > 1 ? 's' : ''} au-delà du plafond (5000).
                    {/if}
                    {#if ragState.truncated > 0}
                      {ragState.truncated} fichier{ragState.truncated > 1 ? 's' : ''} très long{ragState.truncated > 1 ? 's' : ''} indexé{ragState.truncated > 1 ? 's' : ''} en partie.
                    {/if}
                    {#if ragState.files > 0 && ragDir}
                      <button class="cop-rag-del" onclick={() => void deleteRagIndex(ragDir)}>Supprimer l'index</button>
                    {/if}
                  </div>
                {:else}
                  <div class="cop-rag-note">Prépare les réponses sur tout le dossier, sources citées — 100 % local.</div>
                {/if}
              </div>
            </section>

            <!-- Mode vocal (ADR-0033) : module audio de LFM3, téléchargé une fois. -->
            <section>
              <div class="cop-label row"><span>Voix</span></div>
              <div class="cop-rag">
                <div class="cop-rag-row">
                  <svg class="icon" style="font-size:16px;color:var(--ink-4)" aria-hidden="true"><use href="#i-mic" /></svg>
                  <span class="cop-model-tag grow">Module audio LFM3</span>
                  {#if !voiceInstalled}
                    <button class="cop-btn-sm" onclick={() => startPull(VOICE_MODULE)} disabled={!!copilot.pulling}>Télécharger</button>
                  {/if}
                </div>
                <div class="cop-rag-note">
                  {voiceInstalled
                    ? 'Installé — parlez à Doku-San avec le micro du composeur. Tout reste sur votre machine.'
                    : 'Conversation parlée 100 % locale : 507 Mo, une seule fois (environ 0,5 Go de mémoire en plus).'}
                </div>
              </div>
            </section>

            <!-- Ajouter -->
            {#if installableSuggestions.length}{@render addSection(installableSuggestions)}{/if}
            </div>
          </details>
        {/if}
        {/if}
      {:else if app.copilotView === 'memory'}
        <section class="cop-memory-view" aria-labelledby="cop-memory-title">
          <div class="cop-memory-heading">
            <span class="cop-memory-mark" aria-hidden="true"><svg class="icon" aria-hidden="true"><use href="#i-database" /></svg></span>
            <span>
              <h2 id="cop-memory-title" tabindex="-1">Mémoire du travail</h2>
              <p>{memoryTarget ? (memoryTarget.kind === 'document' ? `Cette note · ${memoryTarget.label}` : `Dossier partagé · ${memoryTarget.label}`) : 'Aucune portée durable'}</p>
            </span>
            {#if cloudMemory.extracting}<span class="cop-memory-sync"><span></span>Analyse en cours</span>{/if}
          </div>

          <div class="cop-memory-control">
            <span>
              <strong>Mémoire automatique</strong>
              <small>Doku-San retient les décisions et préférences utiles après chaque échange cloud.</small>
            </span>
            <button
              class="cop-switch"
              class:on={app.cloudMemoryEnabled}
              role="switch"
              aria-checked={app.cloudMemoryEnabled}
              aria-label="Activer la mémoire automatique"
              onclick={() => (app.cloudMemoryEnabled = !app.cloudMemoryEnabled)}
            ><span></span></button>
          </div>

          <div class="cop-memory-scope" aria-labelledby="cop-memory-scope-label">
            <span class="cop-memory-scope-copy">
              <strong id="cop-memory-scope-label">Portée de la mémoire</strong>
              <small>
                {memoryTarget?.kind === 'folder'
                  ? `Partagée avec toutes les notes du dossier « ${memoryTarget.label} ».`
                  : memoryTarget
                    ? `Attachée uniquement à « ${memoryTarget.label} ». Votre dossier n’est jamais choisi automatiquement.`
                    : 'Enregistrez la note pour lui attacher une mémoire durable.'}
              </small>
            </span>
            <div class="cop-memory-scope-options" use:liquidThumb>
              <span class="cop-memory-scope-thumb" data-liquid-thumb aria-hidden="true"></span>
              <button
                class:active={!effectiveMemoryFolder}
                disabled={!memoryDocument}
                aria-pressed={!effectiveMemoryFolder}
                onclick={useDocumentMemory}
              ><svg class="icon" aria-hidden="true"><use href="#i-file-text" /></svg>Cette note</button>
              <button
                class:active={!!effectiveMemoryFolder}
                disabled={!memoryFolderCandidate}
                aria-pressed={!!effectiveMemoryFolder}
                title={memoryFolderCandidate ? `Partager la mémoire avec le dossier ${memoryFolderCandidate.label}` : 'Aucun dossier disponible'}
                onclick={useFolderMemory}
              ><svg class="icon" aria-hidden="true"><use href="#i-folder" /></svg>{memoryFolderCandidate ? memoryFolderCandidate.label : 'Dossier'}</button>
            </div>
          </div>

          {#if !isCloudProvider(app.copilotProvider)}
            <div class="cop-memory-empty">
              <svg class="icon" aria-hidden="true"><use href="#i-cloud-off" /></svg>
              <strong>La mémoire est réservée aux modèles cloud</strong>
              <p>Choisissez OpenAI ou MiniMax pour la rappeler et la faire évoluer automatiquement.</p>
              <button class="cop-btn-quiet" onclick={() => (app.copilotView = 'models')}>Choisir un fournisseur</button>
            </div>
          {:else if !memoryTarget}
            <div class="cop-memory-empty">
              <svg class="icon" aria-hidden="true"><use href="#i-file-text" /></svg>
              <strong>Aucun travail à mémoriser</strong>
              <p>Enregistrez cette note pour lui donner sa propre mémoire, ou choisissez explicitement un dossier à partager.</p>
            </div>
          {:else if cloudMemory.loading}
            <div class="cop-memory-loading" role="status"><span class="doku-skel"></span><span class="doku-skel"></span><span class="doku-skel"></span></div>
          {:else}
            {#if cloudMemory.error}
              <div class="cop-memory-error" role="alert">
                <svg class="icon" aria-hidden="true"><use href="#i-triangle-alert" /></svg><span>{cloudMemory.error}</span>
                <button use:tooltip={'Masquer'} aria-label="Masquer l'erreur" onclick={() => (cloudMemory.error = '')}><svg class="icon" aria-hidden="true"><use href="#i-x" /></svg></button>
              </div>
            {/if}
            <div class="cop-memory-list-head">
              <span>{cloudMemory.records.length} souvenir{cloudMemory.records.length === 1 ? '' : 's'}</span>
              {#if cloudMemory.undoAvailable && shownMemoryWorkspace}
                <button onclick={() => void undoCloudMemory(shownMemoryWorkspace!)}><svg class="icon" aria-hidden="true"><use href="#i-undo-2" /></svg>Annuler la dernière modification</button>
              {/if}
            </div>
            {#if cloudMemory.records.length === 0}
              <div class="cop-memory-empty quiet">
                <svg class="icon" aria-hidden="true"><use href="#i-book-open" /></svg>
                <strong>La mémoire est prête</strong>
                <p>Continuez votre travail normalement. Après un échange utile, Doku-San enregistrera ici ce qui mérite de survivre à la conversation.</p>
              </div>
            {:else}
              <div class="cop-memory-list">
                {#each cloudMemory.records as record (record.id)}
                  <article class="cop-memory-item">
                    {#if editingMemory === record.id}
                      <form class="cop-memory-form" onsubmit={(e) => { e.preventDefault(); void saveMemoryEdit(record) }}>
                        <label>Titre<input bind:value={memoryDraft.name} maxlength="80" /></label>
                        <label>Résumé<input bind:value={memoryDraft.description} maxlength="240" /></label>
                        <label>Type
                          <select bind:value={memoryDraft.type}>
                            <option value="preference">Préférence</option>
                            <option value="decision">Décision</option>
                            <option value="fact">Information</option>
                            <option value="reference">Référence</option>
                            <option value="open_question">Question ouverte</option>
                          </select>
                        </label>
                        <label>Contenu<textarea bind:value={memoryDraft.content} rows="5" maxlength="2400"></textarea></label>
                        <div class="cop-memory-form-actions">
                          <button type="button" onclick={() => void cancelMemoryEdit(record.id)}>Annuler</button>
                          <button class="primary" type="submit" disabled={!memoryDraft.name.trim() || !memoryDraft.description.trim() || !memoryDraft.content.trim()}>Enregistrer</button>
                        </div>
                      </form>
                    {:else if confirmMemoryDelete === record.id}
                      <div class="cop-memory-confirm">
                        <strong>Oublier « {record.name} » ?</strong>
                        <p>Doku-San ne l'utilisera plus. Cette action peut encore être annulée.</p>
                        <div><button onclick={() => void cancelMemoryDelete(record.id)}>Garder</button><button class="danger" onclick={() => void removeMemory(record.id)}>Oublier</button></div>
                      </div>
                    {:else}
                      <div class="cop-memory-item-head">
                        <span class="cop-memory-type">{memoryTypeLabel(record.type)}</span>
                        <span class="cop-memory-date">{new Date(record.updatedAt).toLocaleDateString('fr-FR')}</span>
                        <button data-memory-id={record.id} data-memory-action="edit" use:tooltip={'Modifier'} aria-label={`Modifier ${record.name}`} onclick={() => void editMemory(record)}><svg class="icon" aria-hidden="true"><use href="#i-pencil" /></svg></button>
                        <button data-memory-id={record.id} data-memory-action="delete" use:tooltip={'Oublier'} aria-label={`Oublier ${record.name}`} onclick={() => void askMemoryDelete(record.id)}><svg class="icon" aria-hidden="true"><use href="#i-trash" /></svg></button>
                      </div>
                      <h3>{record.name}</h3>
                      <p class="cop-memory-description">{record.description}</p>
                      <div class="cop-memory-content">{@html renderChatMarkdown(record.content)}</div>
                    {/if}
                  </article>
                {/each}
              </div>
            {/if}
            <p class="cop-memory-privacy"><svg class="icon" aria-hidden="true"><use href="#i-lock" /></svg> {memoryTarget?.kind === 'folder' ? 'Mémoire partagée avec ce dossier' : 'Mémoire propre à cette note'}, stockée localement dans AppData. Seuls les souvenirs retenus rejoignent ensuite la question cloud.</p>
          {/if}
        </section>
      {:else if copilot.messages.length === 0}
        <!-- Conversation vide (Kube EmptyState + SuggestionCard en rangées) : un point de
             départ, pas une liste de commandes. Les trois livrables documentaires restent ;
             aucune entrée échelonnée (on ne chorégraphie pas l'arrivée d'une vue). -->
        <div class="cop-chat-empty">
          <h2 class="cop-greet">{greeting}.</h2>
          <p class="cop-greet-sub">
            {#if activeTab()}
              Que voulez-vous faire avec <em>{activeTab()?.name}</em>&nbsp;?
            {:else}
              Ouvrez un document, ou posez une question à vos notes.
            {/if}
          </p>
          <div class="cop-suggest">
            {#each SUGGESTION_CARDS as card (card.id)}
              <button class="cop-suggest-card" onclick={() => runSuggestion(card.id)}>
                <span class="cop-suggest-tile" aria-hidden="true"><svg class="icon" aria-hidden="true"><use href="#i-{card.icon}" /></svg></span>
                <span class="cop-suggest-copy"><strong>{card.label}</strong><small>{card.hint}</small></span>
              </button>
            {/each}
          </div>
        </div>
      {:else}
        <!-- Conversation -->
        <div class="cop-conv" {@attach followConversation}>
          {#if copilot.historyOmitted > 0}
            <p class="cop-history-window" role="status">
              <svg class="icon" aria-hidden="true"><use href="#i-rotate-ccw-clock" /></svg>
              {copilot.historyOmitted} ancien{copilot.historyOmitted > 1 ? 's' : ''} message{copilot.historyOmitted > 1 ? 's' : ''} reste{copilot.historyOmitted > 1 ? 'nt' : ''} dans la discussion mais ne rejoint{copilot.historyOmitted > 1 ? 'nent' : ''} pas ce tour.
            </p>
          {/if}
          {#each copilot.messages as m, i (i)}
            {#if m.role === 'user'}
              <div class="cop-user"><div class="cop-user-bubble">{m.content}</div></div>
            {:else if m.config}
              <!-- État de CONFIG (aucun modèle actif) : carte neutre, pas une erreur — rien n'a
                   échoué. Le bouton fait le travail (pas de « icône calques » à traduire). -->
              <div class="cop-err-card" class:enter={i >= enterFrom} role="status">
                <svg class="icon cop-err-icon" aria-hidden="true"><use href="#i-{m.config === 'openai' || m.config === 'minimax' ? 'cloud-off' : m.config === 'embed' ? 'database' : 'layers'}" /></svg>
                <div>
                  <div class="cop-err-title">
                    {m.config === 'openai'
                      ? 'Compte OpenAI non connecté'
                      : m.config === 'minimax'
                        ? 'Clé MiniMax non connectée'
                        : m.config === 'embed'
                          ? "Modèle d'embedding requis"
                          : 'Aucun modèle actif'}
                  </div>
                  <p class="cop-err-msg">{m.content}</p>
                  <button class="cop-err-btn" onclick={() => (app.copilotView = 'models')}>
                    {m.config === 'openai'
                      ? 'Connecter OpenAI'
                      : m.config === 'minimax'
                        ? 'Connecter MiniMax'
                        : m.config === 'embed'
                          ? 'Ouvrir les modèles'
                          : 'Choisir un modèle'}
                  </button>
                </div>
              </div>
            {:else if m.failed}
              <div class="cop-err-card" class:enter={i >= enterFrom} role="alert">
                <svg class="icon cop-err-icon failed" aria-hidden="true"><use href="#i-circle-alert" /></svg>
                <div>
                  <div class="cop-err-title">La génération a échoué</div>
                  <p class="cop-err-msg">{m.content}</p>
                  <div class="cop-err-acts">
                    {#if m.retry}
                      <button class="cop-err-btn primary" onclick={() => retryGeneration(i)}>Réessayer</button>
                    {/if}
                    <button class="cop-err-btn" onclick={() => (app.copilotView = 'models')}>Vérifier le fournisseur</button>
                  </div>
                </div>
              </div>
            {:else}
              <!-- Attente = AVANT le 1er token : l'indicateur remplace l'en-tête (le nom
                   revient au-dessus du texte dès qu'il s'écrit). -->
              {@const waiting = m.streaming && m.content === ''}
              {@const canSave = isTauri && !m.notice && !!m.content && !m.diagram && !m.generatedDocument}
              {@const canCopy = !m.diagram && !m.generatedDocument}
              {@const canRetry = i === copilot.messages.length - 1 && !copilot.generating && !m.notice && !m.diagram && !m.generatedDocument && copilot.messages[i - 1]?.role === 'user'}
              <div class="cop-asst" class:enter={i >= enterFrom} class:last={i === copilot.messages.length - 1}>
                <!-- Signature au premier tour d'une suite : marque, nom, heure. -->
                {#if copilot.messages[i - 1]?.role !== 'assistant'}
                  <div class="cop-asst-head">
                    <span class="cop-asst-mark" aria-hidden="true"><svg class="icon" aria-hidden="true"><use href="#i-leaf" /></svg></span>
                    <span class="cop-asst-name">Doku-San</span>
                    {#if m.at}<time class="cop-asst-time" datetime={new Date(m.at).toISOString()}>{timeFormatter.format(m.at)}</time>{/if}
                  </div>
                {/if}
                {#if waiting}
                  <!-- Étape en cours (draft-agent) : spinner fin + libellé balayé. role=status :
                       la ligne (statut réel ou « réfléchit ») est annoncée au lecteur d'écran. -->
                  <div class="cop-status" role="status">
                    <span class="cop-spinner" aria-hidden="true"></span>
                    <span class="cop-shimmer"><span class="cop-shimmer-mask"><span class="cop-shimmer-text">{m.status ?? 'Doku-San réfléchit'}</span></span></span>
                  </div>
                {:else if m.streaming}
                  <!-- Streaming : texte brut (aucun parse par token) — rendu Markdown à la fin.
                       ::after = caret qui pulse au bout du texte qui s'écrit. -->
                  <div class="cop-md-plain streaming" use:streamReveal={m.content}></div>
                {:else if m.diagram}
                  <CopilotDiagram
                    artifact={m.diagram}
                    onModify={(artifact) => void editDiagram(artifact)}
                    onSelect={(candidateId) => selectDiagramCandidate(i, candidateId)}
                  />
                {:else if m.generatedDocument}
                  <CopilotDocument artifact={m.generatedDocument} onModify={(artifact, target) => void editGeneratedDocument(artifact, target)} />
                {:else}
                  <!-- Réponse terminée : Markdown assaini (allowlist, 0 réseau) + puces [n].
                       svelte-ignore : clic et survol sont délégués aux <button> injectés
                       (focusables — focusin/focusout portent l'équivalent clavier du survol),
                       le wrapper n'est pas lui-même interactif. -->
                  <!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
                  <div
                    class="cop-md"
                    onclick={(e) => onAnswerClick(e, m)}
                    onpointerover={(e) => onAnswerCitePointer(e, m)}
                    onpointerout={(e) => onAnswerCiteOut(e, 100)}
                    onfocusin={(e) => onAnswerCiteFocus(e, m)}
                    onfocusout={(e) => onAnswerCiteOut(e)}
                    onkeydown={onAnswerKey}
                  >{@html renderAnswer(m)}</div>
                {/if}
                <CopilotEvidence
                  message={m}
                  onReveal={(source) => void revealCitation(source)}
                  onOpenWeb={(url) => void openWebSource(url)}
                  onOpenMemory={openMemoryView}
                />
                {#if !m.streaming && (canSave || canCopy || canRetry)}
                  <!-- Rangée d'actions (Kube Message) : révélée au survol du tour ou au focus,
                       toujours visible au doigt. -->
                  <div class="cop-msg-actions">
                    {#if canSave}
                      <!-- Sauver en note (21.x) : la réponse devient un fichier .md du dossier
                           courant — indexable, citable. Feedback succès (check) ET échec
                           (bannière) : jamais de bouton muet (règle Epic 19). -->
                      <button
                        class="cop-copy"
                        class:done={noteSavedIdx === i}
                        use:tooltip={'Sauver en note'}
                        aria-label="Sauver la réponse en note"
                        disabled={copilot.savingNote}
                        onclick={() => void saveNote(i)}
                      >
                        <span class="cop-swap" class:on={noteSavedIdx === i} aria-hidden="true"><svg class="icon"><use href="#i-save" /></svg><svg class="icon"><use href="#i-check" /></svg></span>
                      </button>
                    {/if}
                    {#if canCopy}
                      <button class="cop-copy" class:done={copiedIdx === i} use:tooltip={copiedIdx === i ? 'Copié' : 'Copier'} aria-label="Copier la réponse" onclick={() => copyMessage(i, m.content)}>
                        <span class="cop-swap" class:on={copiedIdx === i} aria-hidden="true"><svg class="icon"><use href="#i-copy" /></svg><svg class="icon"><use href="#i-check" /></svg></span>
                      </button>
                    {/if}
                    {#if canRetry}
                      <button class="cop-copy" use:tooltip={'Relancer'} aria-label="Relancer la réponse" onclick={() => regenerate(i)}>
                        <svg class="icon" aria-hidden="true"><use href="#i-refresh-cw" /></svg>
                      </button>
                    {/if}
                  </div>
                {/if}
              </div>
            {/if}
          {/each}
        </div>
        <!-- Sticky dans le défileur : posé juste au-dessus du dock de saisie quelle que soit
             sa hauteur, sans mesure. Hauteur nulle : ne pousse aucun contenu. Le bouton devient
             inert une fois en bas : un clic ne lui donne pas le focus (il tomberait sur <body>),
             le clavier rend le focus à la saisie. -->
        <div class="cop-jump-dock">
          <button
            class="cop-jump"
            class:shown={!following}
            inert={following}
            use:tooltip={'Aller au dernier message'}
            aria-label="Aller au dernier message"
            onmousedown={(e) => e.preventDefault()}
            onclick={(e) => jumpToLatest(e.detail === 0)}
          >
            <svg class="icon" aria-hidden="true"><use href="#i-arrow-down" /></svg>
          </button>
        </div>
      {/if}
    </div>
    <p class="cop-sr-only" role="status">{answerAnnouncement}</p>
    <p class="cop-sr-only" role="status">{copyAnnouncement}</p>

    <!-- Zone de saisie « imbriquée » (chat réel, 14.1) -->
    {#if app.copilotView === 'chat'}
      <div class="cop-input-wrap">
        <!-- Composeur unifié (refonte v2) : UNE carte. De haut en bas : tray des commandes « / »
             OU sources du contexte (révélés en hauteur, jamais les deux), puces de contexte,
             saisie, barre d'outils. L'ancien tiroir « Contexte » vit désormais dans la carte. -->
        <section class="cop-composer" class:kbd={drawerKbd}>
          <div class="cop-reveal cop-tray" class:open={trayOpen} inert={!trayOpen} aria-hidden={!trayOpen || undefined}>
            <div class="cop-reveal-content">
              {#if trayView.list.length}
                <div id="cop-slash-list" class="cop-tray-list" role="listbox" aria-label="Commandes" bind:this={trayListEl}>
                  {#each trayView.list as suggestion, index (suggestion.token)}
                    {@const action = suggestion.command.action}
                    {@const blocked = action.kind === 'mode' && cloudOnlyMode(action.mode) && !isCloudProvider(app.copilotProvider)}
                    <!-- Le focus reste dans la saisie : l'option n'est pas focalisable et son
                         mousedown est empêché (seul geste qui focalise hors Chromium) ; le
                         clavier passe par la saisie et aria-activedescendant. -->
                    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_interactive_supports_focus -->
                    <div
                      id="cop-slash-opt-{index}"
                      class="cop-tray-option"
                      role="option"
                      aria-selected={index === slashIndex}
                      onpointerdown={(e) => e.preventDefault()}
                      onmousedown={(e) => e.preventDefault()}
                      onpointermove={() => { if (slashIndex !== index) slashIndex = index }}
                      onclick={() => applySlash(suggestion, false)}
                    >
                      <svg class="icon" aria-hidden="true"><use href="#i-{suggestion.command.icon}" /></svg>
                      <!-- Le préfixe déjà tapé en gras, la fin en clair : on voit ce qu'il reste à écrire. -->
                      <span class="cop-tray-name"><b>/{suggestion.token.slice(0, trayView.query.length)}</b>{suggestion.token.slice(trayView.query.length)}</span>
                      <span class="cop-tray-hint">{blocked ? 'Modèle cloud requis' : suggestion.command.hint}</span>
                    </div>
                  {/each}
                </div>
              {:else}
                <p class="cop-tray-empty">Aucune commande ne correspond</p>
              {/if}
            </div>
          </div>
          <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
          <div
            id="cop-context-panel"
            class="cop-reveal"
            class:open={contextShown}
            role="region"
            aria-label="Sources du contexte"
            inert={!contextShown}
            aria-hidden={!contextShown || undefined}
            onkeydown={onContextKey}
          >
            <div class="cop-reveal-content">
              <div class="cop-context-list">
                <!-- Portée des questions (15.3) : document courant OU dossier entier
                     (réponses citant les notes). Une ligne par source, texte ellipsé ;
                     le libellé complet reste dans le nom accessible et l'info-bulle. -->
                <button
                  class="cop-context-row"
                  class:sel={copilot.scope === 'doc'}
                  aria-pressed={copilot.scope === 'doc'}
                  title={`${contextDetails.name} · ${contextDetails.meta}`}
                  onclick={() => (copilot.scope = 'doc')}
                >
                  <svg class="icon cop-drawer-icon" aria-hidden="true"><use href="#i-file-text" /></svg>
                  <span class="cop-drawer-text"><strong>{contextDetails.name}</strong> <small>{contextDetails.meta}</small></span>
                  <span
                    class="cop-context-state"
                    class:warn={docTruncated && !docIndexAvailable}
                    role={docTruncated && !docIndexAvailable ? 'note' : undefined}
                    title={docTruncated
                      ? docIndexAvailable
                        ? 'Recherche sémantique sur tout le document — les réponses citent les extraits retrouvés.'
                        : 'Document trop long : seul son début est transmis au copilote.'
                      : contextDetails.state}
                  >
                    {#if docTruncated && !docIndexAvailable}<svg class="icon" aria-hidden="true"><use href="#i-triangle-alert" /></svg>{/if}
                    {contextDetails.state}
                  </span>
                </button>
                {#each automaticContextTabs as tab (tab.id)}
                  <div class="cop-context-row" role="note" aria-label={`${tab.name}, ajouté automatiquement au contexte`} title={`${tab.name} · ${automaticContextMeta(tab)}`}>
                    <svg class="icon cop-drawer-icon" aria-hidden="true"><use href="#i-file-text" /></svg>
                    <span class="cop-drawer-text"><strong>{tab.name}</strong> <small>{automaticContextMeta(tab)}</small></span>
                    <span class="cop-context-state">Automatique</span>
                  </div>
                {/each}
                <button
                  class="cop-context-row"
                  class:sel={copilot.scope === 'folder'}
                  aria-pressed={copilot.scope === 'folder'}
                  title={folderMeta}
                  onclick={() => (copilot.scope = 'folder')}
                >
                  <svg class="icon cop-drawer-icon" aria-hidden="true"><use href="#i-folder" /></svg>
                  <span class="cop-drawer-text"><strong>Dossier{ragDir ? ` « ${baseName(ragDir)} »` : ''}</strong> <small>{folderMeta}</small></span>
                  <span class="cop-context-state">{copilot.scope === 'folder' ? 'Actif' : 'Choisir'}</span>
                </button>
                {#if copilot.contextFolder}
                  <div class="cop-context-row">
                    <svg class="icon cop-drawer-icon" aria-hidden="true"><use href="#i-folder" /></svg>
                    <span class="cop-drawer-text"><strong>{copilot.contextFolder.label}</strong> <small>Dossier choisi pour les questions et l’index</small></span>
                    <button class="cop-drawer-btn" use:tooltip={'Retirer ce dossier'} aria-label={`Retirer le dossier ${copilot.contextFolder.label}`} onclick={() => setCopilotContextFolder(null)}>
                      <svg class="icon" aria-hidden="true"><use href="#i-x" /></svg>
                    </button>
                  </div>
                {/if}
                {#each copilot.contextItems as item (item.id)}
                  <div class="cop-context-row" title={item.label}>
                    <svg class="icon cop-drawer-icon" aria-hidden="true"><use href="#i-{item.kind === 'clipboard' ? 'clipboard-paste' : item.kind === 'selection' ? 'text-align-justify-start' : 'file-text'}" /></svg>
                    <span class="cop-drawer-text"><strong>{item.label}</strong> <small>{numberFormatter.format(item.charCount)} caractères{item.truncatedAtLoad ? ' · partiel à l’ajout' : ''}</small></span>
                    <!-- title="" : sans lui, le survol du bouton afficherait aussi le title natif de la rangée. -->
                    <button class="cop-drawer-btn" title="" use:tooltip={'Retirer cette source'} aria-label={`Retirer ${item.label}`} onclick={() => removeCopilotContext(item.id)}>
                      <svg class="icon" aria-hidden="true"><use href="#i-x" /></svg>
                    </button>
                  </div>
                {/each}
                {#if copilot.webSearchEnabled}
                  <div class="cop-context-row">
                    <svg class="icon cop-drawer-icon" aria-hidden="true"><use href="#i-search" /></svg>
                    <span class="cop-drawer-text"><strong>Recherche Web</strong></span>
                    <button class="cop-drawer-btn" use:tooltip={'Désactiver la recherche Web'} aria-label="Désactiver la recherche Web" onclick={() => setWebSearchEnabled(false)}>
                      <svg class="icon" aria-hidden="true"><use href="#i-x" /></svg>
                    </button>
                  </div>
                  <!-- Le document alimente la requête quand la question ne se suffit pas : le
                       dire ici, en entier (pas d'ellipse sur ce qui quitte l'appareil), et le
                       rendre vérifiable dans l'activité du tour, qui affiche la requête exacte. -->
                  <p class="cop-context-note">Interroge un moteur de recherche · la question et, si elle est vague, quelques termes clés du document</p>
                {/if}
                {#if cloudDestination}
                  <button class="cop-context-row" onclick={openMemoryView}>
                    <svg class="icon cop-drawer-icon" aria-hidden="true"><use href="#i-database" /></svg>
                    <span class="cop-drawer-text"><strong>Mémoire du travail</strong> <small>{app.cloudMemoryEnabled ? (effectiveMemoryFolder ? `Automatique · dossier ${effectiveMemoryFolder.label}` : 'Automatique · cette note seulement') : 'Désactivée'}</small></span>
                    <span class="cop-drawer-action" aria-hidden="true"><svg class="icon" aria-hidden="true"><use href="#i-chevron-right" /></svg></span>
                  </button>
                {/if}
                {#if cloudDestination && hasSupplementalContext}
                  <p class="cop-context-note cop-context-destination"><svg class="icon" aria-hidden="true"><use href="#i-cloud" /></svg> Sera envoyé à {cloudDestination} avec votre question.</p>
                {/if}
                {#if copilot.contextError}<p class="cop-context-note cop-context-error" role="alert">{copilot.contextError}</p>{/if}
                {#if copilot.messages.length && hasSupplementalContext}
                  <p class="cop-context-note">
                    {automaticContextTabs.length
                      ? 'Les documents visibles sont recapturés à chaque envoi. Les sources ajoutées restent modifiables séparément.'
                      : 'Retirer une source agit sur les prochains envois. Nouvelle conversation purge aussi l’historique.'}
                  </p>
                {/if}
              </div>
            </div>
          </div>

          <!-- Puces de contexte : la première résume la portée (document ou dossier) et déplie
               la liste détaillée ; les sources ajoutées se retirent d'un clic ; « + » ajoute. -->
          <div class="cop-ctx-row">
            <button
              class="cop-ctx-chip lead"
              bind:this={contextToggleEl}
              aria-expanded={contextShown}
              aria-controls="cop-context-panel"
              aria-label={`Contexte : ${contextSummary}${cloudDestination ? `, envoyé à ${cloudDestination}` : ''}. Afficher le détail`}
              title={copilot.scope === 'folder' ? folderMeta : `${contextDetails.name} · ${contextDetails.state}`}
              onclick={(e) => toggleContext(e.detail === 0)}
            >
              <svg class="icon" aria-hidden="true"><use href="#i-{copilot.scope === 'folder' ? 'folder' : 'file-text'}" /></svg>
              <span class="cop-ctx-name">{copilot.scope === 'folder' ? `Dossier${ragDir ? ` ${baseName(ragDir)}` : ''}` : contextDetails.name}</span>
              {#if copilot.scope === 'doc' && docTruncated && !docIndexAvailable}
                <svg class="icon cop-ctx-warn" aria-hidden="true"><use href="#i-triangle-alert" /></svg>
              {/if}
              {#if copilot.scope === 'doc' && automaticContextTabs.length}<span class="cop-ctx-more">+{automaticContextTabs.length}</span>{/if}
              <svg class="icon cop-ctx-chev" aria-hidden="true"><use href="#i-chevron-up" /></svg>
            </button>
            {#each copilot.contextItems as item (item.id)}
              <span class="cop-ctx-chip" title={item.label}>
                <svg class="icon" aria-hidden="true"><use href="#i-{item.kind === 'clipboard' ? 'clipboard-paste' : item.kind === 'selection' ? 'text-align-justify-start' : 'file-text'}" /></svg>
                <span class="cop-ctx-name">{item.label}</span>
                <button title="" use:tooltip={'Retirer cette source'} aria-label={`Retirer ${item.label}`} onclick={() => removeCopilotContext(item.id)}>
                  <svg class="icon" aria-hidden="true"><use href="#i-x" /></svg>
                </button>
              </span>
            {/each}
            {#if copilot.webSearchEnabled}
              <span class="cop-ctx-chip">
                <svg class="icon" aria-hidden="true"><use href="#i-globe" /></svg>
                <span class="cop-ctx-name">Web</span>
                <button title="" use:tooltip={'Désactiver la recherche Web'} aria-label="Désactiver la recherche Web" onclick={() => setWebSearchEnabled(false)}>
                  <svg class="icon" aria-hidden="true"><use href="#i-x" /></svg>
                </button>
              </span>
            {/if}
            <button
              class="cop-ctx-add"
              class:open={dropsOpen}
              bind:this={addContextButtonEl}
              disabled={contextLoading}
              use:tooltip={'Ajouter du contexte'}
              aria-label="Ajouter du contexte"
              aria-haspopup="menu"
              aria-expanded={dropsOpen}
              onclick={(e) => toggleDrops(e.detail === 0)}
            ><svg class="icon" aria-hidden="true"><use href="#i-plus" /></svg></button>
          </div>

            <textarea
              class="cop-input-ta"
              bind:this={promptEl}
              bind:value={draft}
              rows="1"
              placeholder={copilot.outputMode === 'diagram'
                ? 'Décrivez le diagramme à créer…'
                : copilot.outputMode === 'html'
                  ? 'Décrivez la page HTML à créer…'
                  : copilot.outputMode === 'pdf'
                    ? 'Décrivez le document PDF à créer…'
                    : copilot.scope === 'folder' ? 'Demandez à vos notes…' : 'Demandez à Doku-San…'}
              aria-label={copilot.scope === 'folder' ? 'Poser une question sur le dossier de notes' : 'Poser une question sur ce document'}
              aria-autocomplete="list"
              aria-controls={trayOpen && trayView.list.length ? 'cop-slash-list' : undefined}
              aria-activedescendant={trayOpen && slashSuggestions.length ? `cop-slash-opt-${slashIndex}` : undefined}
              onkeydown={onPromptKey}
              oninput={onPromptInput}
              onfocus={() => (promptFocused = true)}
              onblur={() => (promptFocused = false)}
            ></textarea>

          <div class="cop-toolbar">
            <button
              class="cop-input-attach"
              class:open={addMenuOpen}
              bind:this={addButtonEl}
              disabled={contextLoading}
              use:tooltip={'Outils : créer un livrable, contexte, style'}
              aria-label="Outils : créer, contexte et style"
              aria-haspopup="menu"
              aria-expanded={addMenuOpen}
              onclick={(e) => toggleAddMenu(e.detail === 0)}
            ><svg class="icon" aria-hidden="true"><use href="#i-sliders-horizontal" /></svg></button>
            <div class="cop-compose-options">
              <!-- Réflexion des modèles cloud : un bouton à bascule, visible en permanence
                   parce qu'il change le coût et la durée de chaque réponse. -->
              {#if isCloudProvider(app.copilotProvider)}
                <!-- aria-disabled et non disabled : un bouton désactivé ne reçoit aucun
                     survol, et l'info-bulle doit justement expliquer pourquoi. Le nom
                     accessible survit au libellé masqué en pied étroit. -->
                <button
                  class="cop-think-toggle"
                  class:on={app.copilotThinking || thinkAlways}
                  aria-label="Réfléchir"
                  aria-pressed={app.copilotThinking || thinkAlways}
                  aria-disabled={thinkAlways}
                  onclick={() => { if (!thinkAlways) app.copilotThinking = !app.copilotThinking }}
                  onpointerenter={(event) => { if (event.pointerType !== 'touch') showThinkTip(event.currentTarget, 200) }}
                  onpointerleave={hideThinkTip}
                  onfocus={(event) => { if (event.currentTarget.matches(':focus-visible')) showThinkTip(event.currentTarget, 0) }}
                  onblur={hideThinkTip}
                ><svg class="icon" aria-hidden="true"><use href="#i-brain" /></svg><span class="cop-think-label">Réfléchir</span></button>
              {/if}
              <!-- Un livrable armé se voit ici, et nulle part ailleurs : le menu du
                   « + » porte le choix, cette pastille porte l'état. -->
              {#if copilot.outputMode !== 'answer'}
                {@const current = OUTPUT_MODES[copilot.outputMode]}
                <span class="cop-mode-pill" class:kbd={modePillKbd} title={current.label}>
                  <svg class="icon" aria-hidden="true"><use href="#i-{current.icon}" /></svg><span class="cop-mode-label">{current.short}</span>
                  <!-- title="" : bloque le title natif de la pastille, la bulle suffit. -->
                  <button
                    title=""
                    use:tooltip={'Revenir à une réponse'}
                    aria-label={`Retirer le livrable ${current.label}`}
                    onclick={() => setChatOutputMode('answer')}
                  ><svg class="icon" aria-hidden="true"><use href="#i-x" /></svg></button>
                </span>
              {/if}
              {#if copilot.generatedDocumentSeed?.target}
                {@const target = copilot.generatedDocumentSeed.target}
                <span class="cop-mode-pill cop-target-pill" title={`Partie désignée : ${target.excerpt}`}>
                  <svg class="icon" aria-hidden="true"><use href="#i-mouse-pointer-click" /></svg><span class="cop-target-text">{target.excerpt}</span>
                  <button
                    title=""
                    use:tooltip={'Viser tout le document'}
                    aria-label="Retirer la partie désignée"
                    onclick={clearGeneratedDocumentTarget}
                  ><svg class="icon" aria-hidden="true"><use href="#i-x" /></svg></button>
                </span>
              {/if}
            </div>
            <!-- Capsule modèle : point d'état et nom court ; ouvre le sélecteur de la vue Modèles. -->
            <button
              class="cop-model-cap"
              use:tooltip={`Modèle : ${identityModel}`}
              aria-label={`Modèle : ${identityModel}. Changer de modèle`}
              onclick={() => void openModelPicker()}
            >
              <span class="cop-state-dot" data-state={modelState} aria-hidden="true"></span>
              <span class="cop-model-name">{shortModelName(identityModel)}</span>
              <svg class="icon" aria-hidden="true"><use href="#i-chevron-down" /></svg>
            </button>
            <!-- Mode vocal (ADR-0033) : l'état fin (écoute, réflexion, parole) vit dans l'îlot. -->
            <button
              class="cop-mic"
              class:on={voice.phase !== 'off'}
              use:tooltip={voice.phase === 'off' ? 'Parler à Doku-San' : 'Terminer la conversation vocale'}
              aria-label={voice.phase === 'off' ? 'Parler à Doku-San' : 'Terminer la conversation vocale'}
              aria-pressed={voice.phase !== 'off'}
              onclick={() => (voice.phase === 'off' ? void startVoice() : stopVoice())}
            >
              <svg class="icon" aria-hidden="true"><use href="#i-{voice.phase === 'off' ? 'mic' : 'audio-lines'}" /></svg>
            </button>
            <!-- Un seul bouton : le disque Envoyer s'étire en pilule « Arrêter » pendant la
                 génération, puis refond en disque (largeur sur ressort, icônes en fondu). -->
            <button
              class="cop-input-send"
              use:tooltip={copilot.generating ? 'Arrêter la génération' : { label: 'Envoyer', kbd: 'Entrée' }}
              aria-label={copilot.generating ? 'Arrêter la génération' : 'Envoyer'}
              aria-busy={copilot.generating}
              disabled={!copilot.generating && !draft.trim()}
              onclick={() => { if (copilot.generating) stopChat(); else send() }}
            >
              <svg class="icon cop-send-arrow" aria-hidden="true"><use href="#i-arrow-up" /></svg>
              <span class="cop-send-stop" aria-hidden="true"><svg class="icon cop-stop-glyph"><use href="#i-square" /></svg><span class="cop-send-stop-label">Arrêter</span></span>
            </button>
          </div>
          <!-- Une commande « / » de contexte qui échoue (presse-papiers vide, fichier
               illisible) écrit ici quand la liste est repliée : le message doit se lire
               sans rien déplier. -->
          {#if voice.error}
            <p class="cop-context-error cop-context-error-inline cop-voice-error" role="alert">
              <span>{voice.error}</span>
              {#if voice.needsModule}
                {#if voiceInstalled || !copilot.models.some((m) => m.name === RECO_MODEL)}
                  <button class="cop-err-btn" onclick={() => { voice.error = ''; app.copilotView = 'models' }}>Ouvrir les modèles</button>
                {:else}
                  <button class="cop-err-btn" disabled={!!copilot.pulling} onclick={() => { voice.error = ''; startPull(VOICE_MODULE) }}>Télécharger (507 Mo)</button>
                {/if}
              {/if}
              <button class="cop-err-btn" aria-label="Masquer" onclick={() => (voice.error = '')}><svg class="icon" aria-hidden="true"><use href="#i-x" /></svg></button>
            </p>
          {/if}
          {#if copilot.contextError && !contextShown}
            <p class="cop-context-error cop-context-error-inline" role="alert">{copilot.contextError}</p>
          {/if}
        </section>
        <div class="cop-disclaimer">
          <!-- La recherche Web est un SECOND canal de sortie, indépendant du fournisseur :
               un utilisateur MiniMax lisait « contexte envoyé au cloud » sans savoir qu'un
               moteur de recherche était aussi interrogé. Les deux destinations, toujours. -->
          {app.copilotProvider === 'local'
            ? (copilot.webSearchEnabled ? 'Local · la requête de recherche quitte cet appareil' : 'Local · rien ne quitte cet appareil')
            : app.copilotProvider === 'openai'
            ? (copilot.webSearchEnabled ? 'OpenAI · contexte envoyé au cloud, recherche Web incluse' : 'OpenAI · contexte envoyé au cloud')
            : app.copilotProvider === 'minimax'
              ? (copilot.webSearchEnabled ? 'MiniMax · contexte envoyé au cloud + requête envoyée au moteur de recherche' : 'MiniMax · contexte envoyé au cloud')
              : 'Local · rien ne quitte cet appareil'}
          <span>·</span> Doku peut se tromper.
        </div>
      </div>
    {/if}
    {#if app.copilotView === 'chat' && activityDrawerOpen}
      <!-- Voile de clic extérieur : hors de l'ordre de tabulation (Échap ferme déjà). -->
      <button
        class="cop-activity-backdrop"
        tabindex="-1"
        aria-label="Fermer les sources et l’activité"
        onclick={() => closeActivityDrawer()}
      ></button>
      <div
        bind:this={activityDrawerEl}
        class="cop-activity-drawer"
        role="dialog"
        aria-label="Sources et activité de la conversation"
        tabindex="-1"
        onkeydown={(event) => { if (event.key === 'Escape') closeActivityDrawer() }}
      >
        <header>
          <svg class="icon" aria-hidden="true"><use href="#i-list" /></svg>
          <div><strong>Sources et activité</strong><small>{evidenceTurns.length} réponse{evidenceTurns.length > 1 ? 's' : ''}</small></div>
        </header>
        <div class="cop-activity-turns">
          {#each evidenceTurns as turn (turn.index)}
            <section class="cop-activity-turn">
              <p>{turn.question}</p>
              <CopilotEvidence
                message={turn.message}
                collapsed
                onReveal={(source) => void revealCitation(source)}
                onOpenWeb={(url) => void openWebSource(url)}
                onOpenMemory={openMemoryView}
              />
            </section>
          {/each}
        </div>
      </div>
    {/if}
  </div>
  </div>
  <input
    class="cop-hidden-file"
    bind:this={browserFilesEl}
    type="file"
    multiple
    accept=".md,.markdown,.txt,.html,.htm,.pdf"
    onchange={onBrowserFiles}
  />
  <input
    class="cop-hidden-file"
    bind:this={browserFolderEl}
    type="file"
    multiple
    webkitdirectory
    onchange={onBrowserFiles}
  />
  <!-- Hors de .cop-card (overflow hidden) : ces surfaces flottantes se positionnent dans
       le repère du panneau (contain: layout) au-dessus de tout le contenu. -->
  {@render citePreviewCard()}
  {#if thinkTip}
    {@const anchor = thinkTip}
    <div id="cop-think-tip" class="cop-hover-card cop-think-tip" role="tooltip" popover="manual" {@attach (el) => placeCard(el, anchor)}>
      <div class="cop-hover-card-head">
        <svg class="icon" aria-hidden="true"><use href="#i-brain" /></svg>
        <span class="cop-hover-card-name">{thinkTipText.title}</span>
      </div>
      <p class="cop-hover-card-text">{thinkTipText.text}</p>
      <div class="cop-hover-card-hint">{thinkTipText.hint}</div>
    </div>
  {/if}
  {@render addContextMenu()}
  {#if dropsOpen && dropsAnchor}
    <CopilotDropletMenu anchor={dropsAnchor} items={dropItems} keyboard={dropsKbd} onclose={closeDrops} bind:menuEl={dropsEl} />
  {/if}
  {@render identityMenu()}
</aside>

<style>
  .cop-panel {
    /* Repli seulement : la largeur réelle vient d'un style inline (préférence persistée,
       réglée au séparateur). Sans cette ligne, un `--copilot-width` absent rendrait
       `flex-basis` invalide et le panneau se replierait à zéro. */
    --copilot-width: 400px;
    --copilot-max: max(240px, calc(100vw - 320px));
    /* Une seule propriété de taille animée (flex-basis) : width/max-width décrivaient la
       même boîte et triplaient le travail d'interpolation + diff de style par frame. */
    flex: 0 0 0;
    min-width: 0;
    /* Borne liée à la fenêtre, hors de `transition` : un `vw` dans la flex-basis animée
       relançait le rideau à chaque image d'un redimensionnement de fenêtre. */
    max-width: var(--copilot-max);
    height: 100%;
    display: flex;
    flex-direction: column;
    background: transparent;
    overflow: hidden;
    /* Ni fondu d'opacité, ni translateX : l'un rendait le panneau transparent alors
       qu'il occupait encore sa largeur, l'autre décalait le contenu et ouvrait un
       interstice où le chrome sombre apparaissait (artefact vu en usage réel, 2×).
       Seule la largeur anime : la carte ancrée à droite est révélée/recouverte par un
       rideau opaque — même mécanique que la sidebar gauche, qui n'a jamais eu d'artefact. */
    visibility: hidden;
    pointer-events: none;
    contain: layout paint;
    /* 340 ms, et non les 240 ms d'origine : la courbe sortante place ~80 % de la course
       dans les 40 % premiers, si bien qu'à durée égale l'ouverture PARAÎT bien plus
       rapide qu'avec l'ancienne courbe entrante — le panneau semblait surgir. On garde
       la sortante (c'est la bonne pour une apparition ; l'entrante rendrait le début mou
       et la fin sèche) et on lui donne le temps de se poser.
       Le délai de `visibility` SUIT la durée du rideau : plus court, le panneau
       disparaîtrait avant la fin de sa fermeture. */
    transition:
      flex-grow var(--duration-relaxed) var(--ease-curtain),
      flex-basis var(--duration-curtain) var(--ease-curtain),
      visibility 0s linear var(--duration-curtain);
  }
  .cop-panel.open {
    flex-basis: var(--copilot-width);
    visibility: visible;
    pointer-events: auto;
    transition:
      flex-grow var(--duration-relaxed) var(--ease-curtain),
      flex-basis var(--duration-curtain) var(--ease-curtain),
      visibility 0s;
  }
  .cop-panel.open.expanded {
    flex-grow: 1;
    max-width: none;
  }
  /* Pendant le glisser, aucune transition : le rideau de 340 ms transformerait chaque
     image en interpolation en retard sur le pointeur (le panneau traînerait derrière).
     Même chose aux flèches (.snap) : un geste clavier ne s'anime pas. */
  .cop-panel.resizing,
  .cop-panel.open.resizing,
  .cop-panel.snap,
  .cop-panel.open.snap {
    transition: none;
  }

  /* Séparateur de largeur — même affordance que celui des volets : invisible au repos,
     un filet se pose sur la couture à l'approche. Il recouvre le bord gauche du panneau,
     qui n'est qu'une gouttière (padding de l'en-tête, bordure de la carte). */
  .cop-resize {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    z-index: var(--z-chrome);
    width: 8px;
    cursor: col-resize;
    touch-action: none;
    user-select: none;
  }
  .cop-resize::after {
    content: '';
    position: absolute;
    top: calc(var(--canvas-gap) + var(--sheet-radius));
    bottom: calc(var(--canvas-gap) + var(--sheet-radius));
    left: 0;
    width: 2px;
    border-radius: var(--radius-full);
    background: transparent;
    transition: background-color var(--duration-basic) ease;
  }
  .cop-resize:hover::after,
  .cop-resize:focus-visible::after { background: var(--line-3); }
  .cop-resize:focus-visible { outline: none; }
  .cop-panel.resizing .cop-resize::after { background: var(--line-3); }
  .cop-panel.expanded .cop-resize { display: none; }

  /* Carte flottante (refonte v2 §1) : marge --canvas-gap en haut, à droite et en bas, la
     gauche est l'écart laissé par la feuille du document. La carte suit la largeur EFFECTIVE
     du panneau (bornée par max-width) moins sa marge, et la garde pendant le rideau : elle
     reste ancrée à droite, le panneau la révèle. */
  .cop-shell {
    position: relative;
    flex: 1;
    min-height: 0;
    width: calc(100% - var(--canvas-gap));
    min-width: calc(min(var(--copilot-width), var(--copilot-max)) - var(--canvas-gap));
    align-self: flex-end;
    margin: var(--canvas-gap) var(--canvas-gap) var(--canvas-gap) 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border-radius: var(--sheet-radius);
    background: var(--cream-content);
    box-shadow: var(--panel-shadow);
    container: cop-shell / inline-size;
    transition: margin var(--duration-relaxed) var(--ease-curtain);
  }
  /* Agrandi : la carte prend la place du document, avec la même marge des deux côtés. */
  .cop-panel.expanded .cop-shell { width: calc(100% - 2 * var(--canvas-gap)); margin-left: var(--canvas-gap); }
  .cop-panel.resizing > .cop-shell { min-width: 0; }
  .cop-head, .cop-card { width: 100%; }
  /* Conteneur des unités `cqi` (vue mémoire) porté par la carte et non par le panneau animé. */
  .cop-card { container-type: inline-size; }

  /* En-tête : 48 px, tuile de marque 28 px, titre 13/600 ; actions groupées en capsule
     (Apple 27 toolbar group), contrôles fenêtre à part. */
  .cop-head {
    height: 48px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 6px 0 10px;
    user-select: none;
  }
  .cop-mark {
    flex: 0 0 auto;
    width: var(--control-sm); height: var(--control-sm); display: inline-flex; align-items: center; justify-content: center;
    border-radius: var(--radius-md); background: var(--ink); color: var(--cream-content);
    font-size: 15px;
  }
  .cop-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; font-size: var(--text-sm); font-weight: var(--weight-strong); letter-spacing: var(--tracking-snug); color: var(--ink); white-space: nowrap; }
  .cop-head-spacer { flex: 1; align-self: stretch; min-width: 4px; }
  .cop-cap {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 2px;
    border-radius: var(--radius-full);
    background: rgba(var(--ink-rgb), 0.045);
  }
  .cop-winctl { flex: 0 0 auto; display: flex; align-items: center; gap: 2px; }
  .cop-ic,
  .cop-win {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 0;
    background: transparent;
    color: var(--ink-3);
    font-size: 16px;
    cursor: pointer;
    transition: color var(--duration-basic) ease, background-color var(--duration-basic) ease, transform var(--duration-basic) var(--ease-enter-snappy);
  }
  .cop-ic { width: var(--control-sm); height: var(--control-sm); border-radius: var(--radius-full); }
  .cop-ic .icon { font-size: 15px; }
  .cop-win { width: var(--control-md); height: var(--control-md); border-radius: var(--radius-md); }
  .cop-win-square { font-size: 13px; }
  .cop-ic:hover:not(:disabled),
  .cop-win:hover { background: var(--fill-hover); color: var(--ink); }
  .cop-ic:hover:not(:disabled) { background: var(--track-thumb); box-shadow: var(--shadow-sm), 0 0 0 0.5px var(--elevation-ring); }
  .cop-ic:active:not(:disabled) { transform: scale(0.97); }
  .cop-win:active { background: var(--accent-soft); }
  .cop-ic:disabled { opacity: var(--opacity-disabled); cursor: default; }
  .cop-ic:focus-visible,
  .cop-win:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: -2px; }
  .cop-ic.active { background: var(--track-thumb); color: var(--ink); box-shadow: var(--shadow-sm), 0 0 0 0.5px var(--elevation-ring); }
  .cop-win.close:hover { background: var(--window-close); color: #fff; }
  .cop-win.close:active { background: var(--window-close-active); color: #fff; }
  /* Carte étroite : le titre part d'abord (la tuile garde l'identité), jamais une action. */
  @container cop-shell (max-width: 370px) {
    .cop-title { display: none; }
  }
  /* Plancher (300 px) : l'historique, aussi dans la barre latérale, cède sa place. */
  @container cop-shell (max-width: 320px) {
    .cop-head { gap: 4px; }
    .cop-cap-history { display: none; }
  }

  /* Menus flottants (identité, « + ») : grammaire Kube Menu — surface élevée, rayon 12,
     marge 4, items de rayon 8 ; ouverture au pointeur en échelle 0.95 depuis le
     déclencheur. Largeurs posées en ligne depuis les constantes JS du bornage. */
  .cop-identity-menu {
    position: absolute; z-index: var(--z-popover); padding: 4px;
    border-radius: var(--radius-xl); background: var(--glass-bg);
    -webkit-backdrop-filter: var(--glass-filter); backdrop-filter: var(--glass-filter);
    box-shadow: var(--glass-shadow);
    transform-origin: top right;
    animation: doku-pop-in var(--duration-basic) var(--ease-enter-snappy);
  }
  /* Ouverts au clavier : pas d'entrée animée (voir identityMenuKbd / addMenuKbd). */
  .cop-identity-menu.kbd,
  .cop-add-context-menu.kbd { animation: none; }
  .cop-identity-menu > button {
    width: 100%; min-height: var(--control-md); display: flex; align-items: center; gap: 10px; padding: 4px 8px 4px 6px;
    border: 0; border-radius: var(--radius-md); background: transparent; color: var(--ink-2); text-align: left; cursor: pointer;
    transition: background-color var(--duration-basic) ease, color var(--duration-basic) ease;
  }
  .cop-identity-menu > button:hover,
  .cop-identity-menu > button:focus-visible { background: var(--menu-row-hover); color: var(--ink); }
  .cop-identity-menu > button.active { background: var(--accent-soft); color: var(--ink); }
  .cop-identity-menu > button:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: -2px; }
  .cop-identity-menu-icon {
    width: var(--control-sm); height: var(--control-sm); flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center;
    border-radius: var(--radius-md); background: var(--accent-soft); color: var(--ink-3);
  }
  .cop-identity-menu-icon .icon { font-size: 15px; }
  .cop-identity-menu > button > span:nth-child(2) { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 1px; }
  .cop-identity-menu strong { font: var(--weight-control) var(--text-sm)/18px var(--font-sans); }
  .cop-identity-menu small { overflow: hidden; color: var(--ink-3); font: var(--weight-regular) var(--text-xs)/14px var(--font-sans); white-space: nowrap; text-overflow: ellipsis; }
  .cop-identity-menu > button > .icon { flex: 0 0 auto; color: var(--ink-4); font-size: 14px; }

  /* Corps */
  .cop-card {
    position: relative;
    isolation: isolate;
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .cop-scroll {
    flex: 1; min-height: 0; overflow-y: auto;
    padding: 0 max(18px, calc((100% - 760px) / 2));
    contain: layout paint;
  }
  .cop-msg { margin: 14px 4px; font-size: calc(var(--cop-text) - 1px); color: var(--ink-3); }
  .cop-msg.err { color: var(--err-text); }

  /* Sélecteur unifié « Modèle actif » : le menu flotte au-dessus de la page, mais sa
     silhouette reste soudée au trigger — même largeur, même matière, aucun interstice. */
  /* Vues de gestion (Modèles, Mémoire) : grammaire des Réglages (refonte v2 §5) — grand
     titre, puis des GROUPES encastrés (rayon 12, fond du composeur, filet), rangées ≥ 44 px
     à tuile d'icône teintée, séparateurs en retrait. */
  .cop-view-head { padding: 20px 4px 16px; }
  .cop-view-head h2 { margin: 0; color: var(--ink); font: var(--weight-strong) var(--text-xl)/1.3 var(--font-sans); letter-spacing: var(--tracking-tight); }
  .cop-view-head p { max-width: 44ch; margin: 4px 0 0; color: var(--ink-3); font: var(--weight-regular) var(--text-sm)/1.45 var(--font-sans); text-wrap: pretty; }
  .cop-tile {
    width: var(--control-sm); height: var(--control-sm); flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center;
    border-radius: var(--radius-md); background: var(--tint-ink-bg); color: var(--tint-ink-fg);
  }
  .cop-tile .icon { font-size: 15px; }
  .cop-tile[data-tint='sage'] { background: var(--tint-sage-bg); color: var(--tint-sage-fg); }
  .cop-tile[data-tint='slate'] { background: var(--tint-slate-bg); color: var(--tint-slate-fg); }
  .cop-tile[data-tint='ochre'] { background: var(--tint-ochre-bg); color: var(--tint-ochre-fg); }
  .cop-picker {
    margin: 0 2px 20px;
  }
  .cop-picker-shell {
    position: relative;
    border-radius: var(--radius-xl);
    transition: background-color var(--duration-basic) ease, filter var(--duration-basic) ease;
  }
  .cop-picker-shell.open {
    z-index: var(--z-popover);
    border-radius: var(--radius-xl) var(--radius-xl) 0 0;
    background: var(--composer-bg);
    filter: drop-shadow(0 8px 16px rgba(var(--shadow-rgb), 0.12));
  }
  .cop-picker-trigger {
    width: 100%; min-height: 52px; display: flex; align-items: center; gap: 12px; padding: 8px 12px 8px 10px;
    border: 0; border-radius: var(--radius-xl); background: var(--composer-bg); box-shadow: 0 0 0 1px var(--line-1); color: var(--ink);
    font-family: var(--font-sans); text-align: left; cursor: pointer;
    transition: background-color var(--duration-basic) ease;
  }
  .cop-picker-trigger:hover { background: color-mix(in srgb, var(--composer-bg), var(--ink) 3%); }
  .cop-picker-trigger:active { background: color-mix(in srgb, var(--composer-bg), var(--ink) 6%); }
  .cop-picker-trigger:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 1px; }
  .cop-picker-shell.open .cop-picker-trigger {
    border-radius: var(--radius-xl) var(--radius-xl) 0 0;
    background: transparent;
    box-shadow: none;
  }
  .cop-picker-shell.open .cop-picker-trigger:hover { background: var(--surface-hover); }
  .cop-picker-name { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .cop-picker-name strong {
    overflow: hidden; font-family: var(--font-sans); font-size: var(--text-sm); font-weight: var(--weight-control);
    white-space: nowrap; text-overflow: ellipsis;
  }
  /* La mono est réservée aux TAGS techniques locaux (qwen2.5:1.5b-q4_0) : un nom de
     modèle cloud est un nom de produit → sans. */
  .cop-picker-name strong.sans { font-family: var(--font-sans); font-size: var(--text-sm); font-weight: var(--weight-strong); }
  .cop-picker-name strong.placeholder { font-family: var(--font-sans); font-size: var(--text-sm); color: var(--ink-3); }
  .cop-picker-name small { font-size: var(--text-xs); color: var(--ink-3); }
  .cop-picker-name small.warn { color: var(--warn-text); }
  .cop-picker-chev { transition: transform var(--duration-basic) var(--ease-enter-snappy); }
  .cop-picker-chev.open { transform: rotate(180deg); }
  /* Déploiement attaché en overlay : top: 100% conserve une jonction à 0 px tandis que
     la position absolue empêche le menu d'allonger la page ou de pousser son contenu. */
  .cop-picker-pop {
    position: absolute; top: 100%; left: 0; right: 0;
    max-height: 360px; overflow-x: hidden; overflow-y: auto; padding: 4px;
    border-radius: 0 0 var(--radius-xl) var(--radius-xl); background: var(--composer-bg);
    box-shadow: inset 0 1px 0 var(--line-1);
    animation: cop-picker-expand var(--duration-moderate) var(--ease-enter);
  }
  @keyframes cop-picker-expand {
    from { opacity: 0.72; clip-path: inset(0 0 100% 0); }
    to { opacity: 1; clip-path: inset(0); }
  }
  .cop-picker-sec {
    width: 100%; min-height: var(--control-md); display: flex; align-items: center; gap: 8px; padding: 4px 8px;
    border: 0; border-radius: var(--radius-md); background: transparent; color: var(--ink-2);
    font-family: var(--font-sans); font-size: var(--text-sm); text-align: left; cursor: pointer;
    transition: background-color var(--duration-basic) ease, color var(--duration-basic) ease;
  }
  .cop-picker-sec > .icon { flex: 0 0 auto; font-size: 16px; color: var(--ink-4); }
  .cop-picker-sec:hover { background: var(--menu-row-hover); color: var(--ink); }
  .cop-picker-sec:hover > .icon { color: var(--ink-2); }
  .cop-picker-sec:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: -2px; }
  .cop-picker-sec-name { flex: 1; min-width: 0; white-space: nowrap; font-weight: var(--weight-control); }
  .cop-picker-sec-state { flex: 0 1 auto; overflow: hidden; font-size: var(--text-xs); color: var(--ink-3); white-space: nowrap; text-overflow: ellipsis; }
  .cop-picker-sec-state.ok { color: var(--ok-text); }
  .cop-picker-sec-state.warn { color: var(--warn-text); }
  .cop-picker-sec > .cop-picker-sec-chev { font-size: 14px; transition: transform var(--duration-basic) var(--ease-enter-snappy); }
  .cop-picker-sec.open .cop-picker-sec-chev { transform: rotate(90deg); }
  .cop-picker-fold {
    display: grid; grid-template-rows: 0fr; opacity: 0;
    transition: grid-template-rows var(--duration-moderate) var(--ease-enter-snappy), opacity var(--duration-basic) ease;
  }
  .cop-picker-fold.open { grid-template-rows: 1fr; opacity: 1; }
  .cop-picker-fold:not(.open) { transition-duration: var(--duration-basic); }
  .cop-picker-fold-inner { min-height: 0; overflow: hidden; }
  .cop-picker-sep { height: 1px; margin: 4px 6px; background: var(--line-1); }
  .cop-picker-opt {
    width: 100%; min-height: var(--control-md); display: flex; align-items: center; gap: 8px; padding: 4px 8px 4px 32px;
    border: 0; border-radius: var(--radius-md); background: transparent; color: var(--ink-2);
    font-family: var(--font-sans); font-size: var(--text-sm); font-weight: var(--weight-control); text-align: left; cursor: pointer;
    transition: background-color var(--duration-basic) ease, color var(--duration-basic) ease;
  }
  .cop-picker-opt:hover, .cop-picker-opt:focus-visible { background: var(--menu-row-hover); color: var(--ink); }
  .cop-picker-opt:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: -2px; }
  .cop-picker-opt[aria-checked='true'] { background: var(--accent-soft); color: var(--ink); }
  .cop-picker-opt > .icon { flex: 0 0 auto; font-size: 14px; color: var(--ink-3); }
  .cop-picker-empty { padding: 4px 8px 8px 32px; font-size: var(--text-xs); color: var(--ink-3); }
  .cop-cloud-model { font-size: var(--text-sm); font-weight: var(--weight-control); color: var(--ink); }

  .cop-openai-view { padding: 0 2px 24px; display: flex; flex-direction: column; gap: 16px; }

  /* Mémoire durable : une surface de gestion calme, structurée par lignes plutôt que par
     cartes imbriquées. La seule élévation est la notification transitoire dans le chat. */
  /* L'enveloppe porte le collage (sticky) et la sortie ; la carte porte l'entrée (une
     seule fois) ; seul le filet de vie est remonté à chaque nouveau contenu. */
  .cop-toast-slot { position: sticky; top: 8px; z-index: var(--z-toast); margin: 8px 12px 0; }
  .cop-memory-toast {
    position: relative; min-height: 48px; padding: 8px 8px 8px 12px;
    display: flex; align-items: center; gap: 10px; border-radius: var(--radius-2xl);
    overflow: hidden;
    background: var(--composer-bg); color: var(--ink-2);
    box-shadow: var(--shadow-xl);
    animation: doku-toast-in var(--duration-moderate) var(--ease-enter);
  }
  .cop-memory-toast > .icon { font-size: 16px; color: var(--ink-3); }
  .cop-memory-toast > span:nth-child(2) { min-width: 0; flex: 1; display: flex; flex-direction: column; }
  .cop-memory-toast strong { font-size: var(--text-sm); font-weight: var(--weight-control); }
  .cop-memory-toast small { font-size: var(--text-xs); color: var(--ink-3); }
  .cop-memory-toast button { height: var(--control-sm); padding: 0 10px; border: 0; border-radius: var(--radius-md); background: var(--accent-soft); color: var(--ink-2); font: var(--weight-control) var(--text-sm) var(--font-sans); cursor: pointer; transition: background-color var(--duration-basic) ease, color var(--duration-basic) ease, transform var(--duration-basic) var(--ease-enter-snappy); }
  .cop-memory-toast button:active { transform: scale(0.97); }
  .cop-memory-toast button:hover { background: var(--line-1); color: var(--ink); }
  .cop-memory-toast button:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 1px; }
  .cop-memory-toast button.icon { width: var(--control-sm); padding: 0; display: inline-flex; align-items: center; justify-content: center; background: transparent; }
  .cop-memory-toast button.icon:hover { background: var(--fill-hover); }
  .cop-memory-toast button.icon .icon { font-size: 14px; }
  /* Même filet de vie que le bandeau de l'app : deux notifications de la même app ne
     s'effacent pas selon deux grammaires différentes. */
  .toast-life {
    position: absolute; left: 0; right: 0; bottom: 0; height: 2px;
    background: var(--line-2); transform-origin: left center;
    animation: doku-life linear forwards;
  }
  .cop-memory-toast.error .toast-life { background: color-mix(in srgb, var(--err) 45%, transparent); }
  /* `data-paused` est posé par l'action autoDismiss : le filet s'arrête exactement quand
     le compte à rebours s'arrête (survol ET focus clavier). */
  .cop-memory-toast:global([data-paused]) .toast-life { animation-play-state: paused; }
  @media (prefers-reduced-motion: reduce) {
    .toast-life { animation: none; transform: scaleX(1); opacity: 0.5; }
  }

  .cop-memory-view {
    width: min(760px, 100%); margin-inline: auto;
    padding: clamp(8px, calc(4px + 1cqi), 24px) 16px 28px; color: var(--ink-2);
  }
  .cop-memory-heading { min-height: 56px; display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
  .cop-memory-mark { width: var(--control-lg); height: var(--control-lg); flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; border-radius: var(--radius-lg); background: var(--tint-plum-bg); color: var(--tint-plum-fg); }
  .cop-memory-mark .icon { font-size: 18px; }
  .cop-memory-heading > span:nth-child(2) { min-width: 0; flex: 1; }
  .cop-memory-heading h2 { margin: 0; color: var(--ink); font: var(--weight-strong) var(--text-xl)/1.3 var(--font-sans); letter-spacing: var(--tracking-tight); }
  .cop-memory-heading p { margin: 2px 0 0; overflow: hidden; color: var(--ink-3); font: var(--weight-regular) var(--text-xs)/1.4 var(--font-sans); text-overflow: ellipsis; white-space: nowrap; }
  .cop-memory-sync { display: inline-flex; align-items: center; gap: 6px; color: var(--ink-3); font-size: var(--text-xs); white-space: nowrap; }
  .cop-memory-sync span { width: 6px; height: 6px; border-radius: 50%; background: var(--ok); animation: doku-breathe 1.6s ease-in-out infinite; }
  .cop-memory-control { min-height: 64px; padding: 10px 12px; display: flex; align-items: center; gap: 12px; border-radius: var(--radius-xl); background: var(--composer-bg); box-shadow: 0 0 0 1px var(--line-1); }
  .cop-memory-control > span { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 2px; }
  .cop-memory-control strong { color: var(--ink); font-size: var(--text-sm); font-weight: var(--weight-control); }
  .cop-memory-control small { color: var(--ink-3); font-size: var(--text-xs); line-height: 1.4; }
  .cop-memory-scope { padding: 12px 2px; display: flex; flex-direction: column; gap: 8px; border-bottom: 1px solid var(--line-1); }
  .cop-memory-scope-copy { display: flex; flex-direction: column; gap: 2px; }
  .cop-memory-scope-copy strong { color: var(--ink); font-size: var(--text-sm); font-weight: var(--weight-control); }
  .cop-memory-scope-copy small { color: var(--ink-3); font-size: var(--text-xs); line-height: 1.45; }
  /* Contrôle segmenté Kube : piste --track, cran actif --track-thumb. */
  .cop-memory-scope-options { position: relative; align-self: flex-start; display: flex; gap: 2px; min-width: 0; max-width: 100%; padding: 2px; border-radius: var(--radius-md); background: var(--track); }
  /* Le cran passe d'une option à l'autre en goutte (liquidThumb, src/lib/liquid.ts) : pas de
     transition CSS, l'action pose translate/width et les anime en WAAPI. */
  .cop-memory-scope-thumb {
    position: absolute; top: 2px; bottom: 2px; left: 0; width: 0;
    border-radius: calc(var(--radius-md) - 2px);
    background: var(--track-thumb); box-shadow: var(--shadow-sm), 0 0 0 0.5px var(--elevation-ring);
  }
  .cop-memory-scope-options button { position: relative; min-width: 0; height: calc(var(--control-md) - 4px); padding: 0 12px; display: inline-flex; align-items: center; gap: 6px; border: 0; border-radius: calc(var(--radius-md) - 2px); background: transparent; color: var(--ink-3); font: var(--weight-control) var(--text-sm) var(--font-sans); cursor: pointer; transition: background-color var(--duration-basic) ease, color var(--duration-basic) ease, box-shadow var(--duration-basic) ease; }
  .cop-memory-scope-options button:not(.active):hover:not(:disabled) { background: var(--fill-hover); color: var(--ink); }
  .cop-memory-scope-options button.active { color: var(--ink); }
  .cop-memory-scope-options button:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: -2px; }
  .cop-memory-scope-options button:disabled { opacity: var(--opacity-disabled); cursor: default; }
  .cop-memory-scope-options .icon { flex: 0 0 auto; font-size: 14px; }
  /* Interrupteur Kube 32 × 20 : piste neutre, encre une fois armé, curseur clair. */
  .cop-switch { width: 32px; height: 20px; flex: 0 0 auto; padding: 2px; border: 0; border-radius: var(--radius-full); background: var(--line-2); cursor: pointer; transition: background-color var(--duration-basic) ease; }
  .cop-switch span { display: block; width: 16px; height: 16px; border-radius: 50%; background: var(--cream-content); box-shadow: var(--shadow-sm), 0 0 0 0.5px var(--elevation-ring); transition: transform var(--duration-basic) var(--ease-enter); }
  .cop-switch.on { background: var(--ink); }
  .cop-switch.on span { transform: translateX(12px); }
  .cop-switch:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
  .cop-memory-empty { min-height: 210px; padding: 32px 24px; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
  .cop-memory-empty > .icon { margin-bottom: 12px; color: var(--ink-4); font-size: 24px; }
  .cop-memory-empty strong { color: var(--ink); font-size: var(--text-md); font-weight: var(--weight-strong); text-wrap: balance; }
  .cop-memory-empty p { max-width: 38ch; margin: 6px 0 14px; color: var(--ink-3); font-size: var(--text-xs); line-height: 1.55; text-wrap: pretty; }
  .cop-memory-empty.quiet { min-height: 180px; }
  .cop-memory-loading { padding: 20px 0; display: flex; flex-direction: column; gap: 8px; }
  .cop-memory-loading span { display: block; height: 66px; border-radius: var(--radius-xl); }
  .cop-memory-error { margin-top: 10px; padding: 8px 10px; display: flex; align-items: flex-start; gap: 8px; border-radius: var(--radius-lg); background: color-mix(in srgb, var(--err) 10%, transparent); color: var(--err-text); font-size: var(--text-xs); line-height: 1.45; }
  .cop-memory-error > .icon { font-size: 16px; }
  .cop-memory-error > span:nth-child(2) { flex: 1; }
  .cop-memory-error button { width: var(--control-2xs); height: var(--control-2xs); display: inline-flex; align-items: center; justify-content: center; border: 0; border-radius: var(--radius-md); background: transparent; color: inherit; cursor: pointer; transition: background-color var(--duration-basic) ease, transform var(--duration-basic) var(--ease-enter-snappy); }
  .cop-memory-error button:active { transform: scale(0.97); }
  .cop-memory-error button:hover { background: rgba(var(--ink-rgb), 0.08); }
  .cop-memory-error button .icon { font-size: 14px; }
  .cop-memory-list-head { min-height: 44px; margin-top: 8px; display: flex; align-items: center; justify-content: space-between; gap: 8px; color: var(--ink-3); font-size: var(--text-xs); }
  .cop-memory-list-head button { height: var(--control-sm); display: inline-flex; align-items: center; gap: 6px; padding: 0 10px 0 8px; border: 0; border-radius: var(--radius-md); background: transparent; color: var(--ink-3); font: var(--weight-control) var(--text-sm) var(--font-sans); cursor: pointer; transition: background-color var(--duration-basic) ease, color var(--duration-basic) ease, transform var(--duration-basic) var(--ease-enter-snappy); }
  .cop-memory-list-head button:active { transform: scale(0.97); }
  .cop-memory-list-head button:hover { background: var(--fill-hover); color: var(--ink); }
  .cop-memory-list-head button:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 1px; }
  .cop-memory-list-head button .icon { font-size: 14px; }
  .cop-memory-list { border-top: 1px solid var(--line-1); }
  .cop-memory-item { padding: 12px 2px 16px; border-bottom: 1px solid var(--line-1); }
  .cop-memory-item-head { min-height: var(--control-sm); display: flex; align-items: center; gap: 4px; }
  .cop-memory-type { height: 18px; display: inline-flex; align-items: center; padding: 0 6px; border-radius: var(--radius-xs); background: var(--surface-2); color: var(--ink-3); font-size: var(--text-2xs); font-weight: var(--weight-strong); letter-spacing: var(--tracking-badge); }
  .cop-memory-date { margin-left: auto; color: var(--ink-3); font-size: var(--text-xs); }
  /* Actions de ligne révélées au survol ou au focus (clavier : :focus-within). */
  .cop-memory-item-head button { width: var(--control-sm); height: var(--control-sm); display: inline-flex; align-items: center; justify-content: center; border: 0; border-radius: var(--radius-md); background: transparent; color: var(--ink-4); cursor: pointer; transition: opacity var(--duration-basic) ease, background-color var(--duration-basic) ease, color var(--duration-basic) ease, transform var(--duration-basic) var(--ease-enter-snappy); }
  .cop-memory-item-head button:active { transform: scale(0.97); }
  @media (hover: hover) and (pointer: fine) {
    .cop-memory-item-head button { opacity: 0; }
    .cop-memory-item:hover .cop-memory-item-head button,
    .cop-memory-item:focus-within .cop-memory-item-head button { opacity: 1; }
  }
  .cop-memory-item-head button:hover { background: var(--fill-hover); color: var(--ink); }
  .cop-memory-item-head button:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: -2px; }
  .cop-memory-item-head button .icon { font-size: 14px; }
  .cop-memory-item h3 { margin: 6px 0 2px; color: var(--ink); font: var(--weight-strong) var(--text-md)/1.4 var(--font-sans); letter-spacing: -0.01em; }
  .cop-memory-description { margin: 0; color: var(--ink-3); font-size: var(--text-xs); line-height: 1.45; }
  .cop-memory-content { margin: 8px 0 0; color: var(--ink-2); font-size: var(--text-sm); line-height: 1.55; overflow-wrap: anywhere; }
  .cop-memory-content :global(p) { margin: 0 0 7px; }
  .cop-memory-content :global(p:last-child) { margin-bottom: 0; }
  .cop-memory-form { display: flex; flex-direction: column; gap: 10px; }
  .cop-memory-form label { display: flex; flex-direction: column; gap: 4px; color: var(--ink-3); font-size: var(--text-xs); font-weight: var(--weight-control); }
  .cop-memory-form input, .cop-memory-form select, .cop-memory-form textarea { width: 100%; border: 0; border-radius: var(--radius-lg); background: var(--cream-content); color: var(--ink); font: var(--weight-regular) var(--text-sm)/1.45 var(--font-sans); box-shadow: inset 0 0 0 1px var(--line-1); transition: box-shadow var(--duration-basic) ease; }
  .cop-memory-form input:hover, .cop-memory-form select:hover, .cop-memory-form textarea:hover { box-shadow: inset 0 0 0 1px var(--line-3); }
  .cop-memory-form input, .cop-memory-form select { height: var(--control-md); padding: 0 10px; }
  .cop-memory-form textarea { min-height: 92px; padding: 8px 10px; resize: vertical; }
  .cop-memory-form input:focus, .cop-memory-form select:focus, .cop-memory-form textarea:focus { outline: 2px solid var(--focus-ring); outline-offset: -1px; }
  .cop-memory-form-actions { display: flex; justify-content: flex-end; gap: 6px; }
  .cop-memory-form-actions button, .cop-memory-confirm button { height: var(--control-sm); padding: 0 12px; border: 0; border-radius: var(--radius-md); background: var(--surface-2); color: var(--ink-2); font: var(--weight-control) var(--text-sm) var(--font-sans); cursor: pointer; transition: background-color var(--duration-basic) ease, color var(--duration-basic) ease, transform var(--duration-basic) var(--ease-enter-snappy); }
  .cop-memory-form-actions button:not(:disabled):active, .cop-memory-confirm button:active { transform: scale(0.97); }
  .cop-memory-form-actions button:hover:not(:disabled), .cop-memory-confirm button:hover { background: var(--accent-soft); color: var(--ink); }
  .cop-memory-form-actions button.primary { background: var(--ink); color: var(--cream-content); }
  .cop-memory-form-actions button.primary:hover:not(:disabled) { background: var(--ink-2); color: var(--cream-content); }
  .cop-memory-form-actions button:disabled { opacity: var(--opacity-disabled); cursor: default; }
  .cop-memory-confirm { padding: 6px 4px; }
  .cop-memory-confirm strong { color: var(--ink); font-size: var(--text-sm); font-weight: var(--weight-strong); }
  .cop-memory-confirm p { margin: 4px 0 10px; color: var(--ink-3); font-size: var(--text-xs); }
  .cop-memory-confirm > div { display: flex; justify-content: flex-end; gap: 6px; }
  .cop-memory-confirm button.danger { background: var(--danger-action-text); color: var(--cream-content); }
  .cop-memory-confirm button.danger:hover { background: color-mix(in srgb, var(--danger-action-text) 88%, transparent); color: var(--cream-content); }
  .cop-memory-privacy { margin: 14px 0 0; display: flex; align-items: flex-start; gap: 6px; color: var(--ink-3); font-size: var(--text-xs); line-height: 1.45; }
  .cop-memory-privacy .icon { flex: 0 0 auto; margin-top: 1px; font-size: 14px; }
  .cop-cloud-hero { overflow: hidden; border-radius: var(--radius-xl); background: var(--composer-bg); box-shadow: 0 0 0 1px var(--line-1); }
  .cop-cloud-head { min-height: 56px; display: flex; align-items: center; gap: 12px; padding: 10px 12px 10px 10px; }
  .cop-cloud-name { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .cop-cloud-name strong { overflow: hidden; font-size: var(--text-sm); font-weight: var(--weight-control); color: var(--ink); white-space: nowrap; text-overflow: ellipsis; }
  .cop-cloud-name small { font-size: var(--text-xs); color: var(--ink-3); }
  .cop-cloud-status {
    height: var(--control-2xs); flex: 0 0 auto; display: inline-flex; align-items: center; gap: 6px; padding: 0 10px;
    border-radius: var(--radius-full); background: var(--accent-soft); color: var(--ink-3); font-size: var(--text-xs); font-weight: var(--weight-control);
  }
  .cop-cloud-status.ready { background: color-mix(in srgb, var(--ok) 16%, transparent); color: var(--ok-text); }
  .cop-cloud-status.unavailable { background: color-mix(in srgb, var(--warn) 16%, transparent); color: var(--warn-text); }
  .cop-cloud-status.checking { font-weight: var(--weight-regular); }
  .cop-cloud-status .cop-dot { width: 6px; height: 6px; border: 0; background: var(--ok); }

  .cop-cloud-note { display: flex; align-items: flex-start; gap: 10px; padding: 12px; border-radius: var(--radius-xl); background: var(--composer-bg); box-shadow: 0 0 0 1px var(--line-1); }
  .cop-cloud-privacy { display: flex; align-items: flex-start; gap: 8px; padding: 0 4px; }
  .cop-cloud-note > .icon { flex: 0 0 auto; margin-top: 1px; font-size: 16px; color: var(--ink-3); }
  .cop-cloud-privacy > .icon { flex: 0 0 auto; margin-top: 2px; font-size: 14px; color: var(--ink-4); }
  .cop-cloud-note > span:last-child { display: flex; flex-direction: column; gap: 2px; }
  .cop-cloud-note strong { font-size: var(--text-sm); font-weight: var(--weight-control); color: var(--ink); }
  .cop-cloud-note small { font-size: var(--text-xs); line-height: 1.45; color: var(--ink-3); }
  .cop-cloud-note.ok > .icon { color: var(--ok-text); }
  .cop-cloud-note.warn > .icon { color: var(--warn-text); }
  .cop-cloud-setup { padding: 0; }
  .cop-cloud-setup > h3, .cop-cloud-setup > p { padding-inline: 4px; }
  .cop-cloud-setup h3 { margin: 0 0 6px; font-size: var(--text-md); font-weight: var(--weight-strong); text-wrap: balance; letter-spacing: -0.01em; color: var(--ink); }
  .cop-cloud-setup > p { margin: 0 0 16px; font-size: var(--text-sm); line-height: 1.55; color: var(--ink-3); text-wrap: pretty; }
  .cop-cloud-setup ol { margin: 0 0 16px; padding: 0; list-style: none; display: flex; flex-direction: column; border-radius: var(--radius-xl); background: var(--composer-bg); box-shadow: 0 0 0 1px var(--line-1); }
  .cop-cloud-setup li { position: relative; min-height: 52px; display: flex; align-items: center; gap: 12px; padding: 8px 12px 8px 10px; }
  .cop-cloud-setup li + li::before { content: ''; position: absolute; top: 0; left: 50px; right: 0; height: 1px; background: var(--line-1); }
  .cop-cloud-setup li p { margin: 0; display: flex; flex-direction: column; gap: 2px; }
  .cop-cloud-setup li strong { font-size: var(--text-sm); font-weight: var(--weight-control); color: var(--ink-2); }
  .cop-cloud-setup li small { font-size: var(--text-xs); line-height: 1.4; color: var(--ink-3); }
  .cop-cloud-setup .cop-btn-fill .icon { font-size: 16px; }
  .cop-cloud-setup .cop-btn-fill:disabled { opacity: var(--opacity-disabled); cursor: default; }
  .cop-btn-quiet {
    width: 100%; min-height: var(--control-md); display: inline-flex; align-items: center; justify-content: center; gap: 8px;
    border: 0; border-radius: var(--radius-lg); background: var(--surface-2); color: var(--ink-2);
    font-family: var(--font-sans); font-size: var(--text-sm); font-weight: var(--weight-control); cursor: pointer;
    transition: background-color var(--duration-basic) ease, color var(--duration-basic) ease, transform var(--duration-basic) var(--ease-enter-snappy);
  }
  .cop-btn-quiet:hover { background: var(--accent-soft); color: var(--ink); }
  .cop-btn-quiet:active { transform: scale(0.97); }
  .cop-btn-quiet:focus-visible, .cop-auth-code:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
  .cop-btn-quiet .icon { font-size: 16px; }
  .cop-auth-wait { display: flex; flex-direction: column; align-items: center; text-align: center; }
  .cop-auth-mark {
    width: var(--control-lg); height: var(--control-lg); margin-bottom: 10px; display: inline-flex; align-items: center; justify-content: center;
    border-radius: var(--radius-lg); background: var(--surface-2); color: var(--ink-3);
  }
  .cop-auth-mark .icon { font-size: 18px; }
  .cop-auth-code {
    width: 100%; min-height: 52px; margin: 1px 0 12px; padding: 0 14px; display: flex; align-items: center; justify-content: center; gap: 12px;
    border: 0; border-radius: var(--radius-xl); background: var(--surface-2); color: var(--ink); cursor: pointer;
    transition: background-color var(--duration-basic) ease, transform var(--duration-basic) var(--ease-enter-snappy);
  }
  .cop-auth-code:hover { background: var(--accent-soft); }
  .cop-auth-code:active { transform: scale(0.97); }
  .cop-auth-code > span:first-child { font-family: var(--font-mono); font-size: 20px; font-weight: var(--weight-strong); letter-spacing: 0.12em; }
  .cop-auth-code .icon { font-size: 16px; color: var(--ink-4); }
  .cop-auth-actions { width: 100%; display: grid; grid-template-columns: 1fr auto; gap: 8px; }
  .cop-auth-actions .cop-btn-quiet { width: auto; padding-inline: 12px; }
  .cop-auth-pending { margin-top: 12px; display: inline-flex; align-items: center; gap: 8px; font-size: var(--text-xs); color: var(--ink-3); }
  .cop-auth-pending > span { width: 6px; height: 6px; border-radius: 50%; background: var(--ink-4); animation: doku-breathe 1.6s ease-in-out infinite; }
  .cop-auth-error { margin: 10px 0 0; font-size: var(--text-xs); line-height: 1.45; color: var(--err-text); text-align: left; }
  .cop-cloud-privacy p { margin: 0; font-size: var(--text-xs); line-height: 1.5; color: var(--ink-3); }
  .cop-cloud-privacy strong { color: var(--ink-2); font-weight: var(--weight-strong); }

  .cop-model-tag { font-family: var(--font-sans); font-size: var(--text-sm); color: var(--ink); font-weight: var(--weight-control); }
  .grow { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  /* Onboarding */
  .cop-onboard { padding: 24px 8px; display: flex; flex-direction: column; align-items: center; text-align: center; gap: 16px; }
  .cop-onboard-tile {
    width: 52px; height: 52px; border-radius: var(--radius-2xl);
    background: var(--surface-2); display: flex; align-items: center; justify-content: center; color: var(--ink-3);
  }
  .cop-onboard-title { font-size: var(--text-lg); font-weight: var(--weight-strong); letter-spacing: -0.015em; color: var(--ink); margin-bottom: 6px; text-wrap: balance; }
  .cop-onboard-sub { font-size: var(--text-sm); line-height: 1.6; color: var(--ink-3); text-wrap: pretty; }
  .cop-onboard-sub b { color: var(--ink-2); font-weight: var(--weight-strong); }
  .cop-reco { width: 100%; border-radius: var(--radius-xl); padding: 12px; background: var(--composer-bg); box-shadow: 0 0 0 1px var(--line-1); text-align: left; }
  .cop-reco-head { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
  .cop-badge { height: 18px; display: inline-flex; align-items: center; padding: 0 6px; font-size: var(--text-2xs); font-weight: var(--weight-strong); letter-spacing: var(--tracking-badge); color: var(--ink-3); background: var(--accent-soft); border-radius: var(--radius-xs); }
  .cop-reco-sub { font-size: var(--text-xs); color: var(--ink-3); margin-bottom: 12px; }
  /* Bouton primaire : encre sur crème, un seul par vue. */
  .cop-btn-fill {
    width: 100%; height: var(--control-md); display: inline-flex; align-items: center; justify-content: center; gap: 8px;
    background: var(--ink); color: var(--cream-content); border: 0; border-radius: var(--radius-lg);
    font-family: var(--font-sans); font-size: var(--text-sm); font-weight: var(--weight-control); cursor: pointer;
    transition: background-color var(--duration-basic) ease, transform var(--duration-basic) var(--ease-enter-snappy);
  }
  .cop-btn-fill:hover { background: var(--ink-2); }
  .cop-btn-fill:not(:disabled):active { transform: scale(0.97); }
  .cop-btn-fill:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
  .cop-btn-fill:disabled { opacity: var(--opacity-disabled); cursor: default; }

  /* MiniMax : champ clé */
  .cop-mm-connect { display: flex; flex-direction: column; gap: 8px; }
  .cop-mm-connect input {
    height: var(--control-md); padding: 0 10px; border: 0; border-radius: var(--radius-lg);
    background: var(--cream-content); box-shadow: inset 0 0 0 1px var(--line-1);
    color: var(--ink); font-family: var(--font-mono); font-size: var(--text-sm);
    transition: box-shadow var(--duration-basic) ease;
  }
  .cop-mm-connect input:hover { box-shadow: inset 0 0 0 1px var(--line-3); }
  .cop-mm-connect input:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: -1px; }

  /* Gestion locale : une seule entrée au repos, toutes les fonctions conservées derrière
     un <details> natif. Le sélecteur « Modèle actif » reste le chemin quotidien. */
  .cop-advanced { margin: 10px 2px 24px; }
  .cop-advanced > summary {
    min-height: 52px; display: flex; align-items: center; gap: 12px; padding: 8px 12px 8px 10px;
    list-style: none; border-radius: var(--radius-xl); background: var(--composer-bg); box-shadow: 0 0 0 1px var(--line-1); color: var(--ink-2); cursor: pointer;
    transition: background-color var(--duration-basic) ease, color var(--duration-basic) ease;
  }
  .cop-advanced > summary::-webkit-details-marker { display: none; }
  .cop-advanced > summary:hover { background: color-mix(in srgb, var(--composer-bg), var(--ink) 3%); color: var(--ink); }
  .cop-advanced > summary:active { background: color-mix(in srgb, var(--composer-bg), var(--ink) 6%); }
  .cop-advanced > summary:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 1px; }
  .cop-advanced-icon {
    width: var(--control-sm); height: var(--control-sm); flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center;
    border-radius: var(--radius-md); background: var(--tint-ink-bg); color: var(--tint-ink-fg);
  }
  .cop-advanced-icon .icon { font-size: 15px; }
  .cop-advanced-copy { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 2px; text-align: left; }
  .cop-advanced-copy strong { font-size: var(--text-sm); font-weight: var(--weight-control); color: var(--ink-2); }
  .cop-advanced-copy small { overflow: hidden; font-size: var(--text-xs); color: var(--ink-3); white-space: nowrap; text-overflow: ellipsis; }
  .cop-advanced-chev { flex: 0 0 auto; font-size: 16px; color: var(--ink-4); transition: transform var(--duration-basic) var(--ease-enter-snappy); }
  .cop-advanced[open] .cop-advanced-chev { transform: rotate(180deg); }
  .cop-advanced-body { padding: 14px 0 0; }
  .cop-download-now { margin: 12px 2px; }

  /* Sections modèles */
  .cop-sections { padding: 8px 2px; display: flex; flex-direction: column; gap: 20px; }
  .cop-sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: 0;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  .cop-label { margin: 0 4px 8px; font-size: var(--text-2xs); color: var(--section-label); font-weight: var(--weight-strong); letter-spacing: var(--tracking-badge); }
  .cop-label.row { display: flex; align-items: baseline; justify-content: space-between; }
  .cop-count { font-size: var(--text-xs); font-weight: var(--weight-regular); color: var(--ink-3); white-space: nowrap; font-variant-numeric: tabular-nums; }

  .cop-dot { width: 8px; height: 8px; flex: 0 0 auto; border-radius: 50%; border: 1.5px solid var(--line-3); }
  .cop-dot.breathe { animation: doku-breathe 1.6s ease-in-out infinite; }
  .cop-dot.on { background: var(--ok); border: 0; box-shadow: 0 0 0 3px color-mix(in srgb, var(--ok) 16%, transparent); }

  /* Bibliothèque */
  .cop-lib { display: flex; flex-direction: column; gap: 2px; padding: 4px; border-radius: var(--radius-xl); background: var(--composer-bg); box-shadow: 0 0 0 1px var(--line-1); }
  .cop-row { display: flex; align-items: center; border-radius: var(--radius-lg); transition: background-color var(--duration-basic) ease; }
  .cop-row:hover { background: var(--surface-hover); }
  .cop-row.active { background: var(--row-selected); }
  .cop-row-pick {
    flex: 1; display: flex; align-items: center; gap: 10px; min-width: 0;
    padding: 8px 4px 8px 12px; border: 0; background: none; color: var(--ink); font-size: var(--text-sm); text-align: left; cursor: pointer;
  }
  .cop-row-pick:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: -2px; border-radius: var(--radius-lg); }
  .cop-row-pick:disabled { cursor: default; }
  .cop-size { font-size: var(--text-xs); color: var(--ink-3); white-space: nowrap; flex-shrink: 0; font-variant-numeric: tabular-nums; }
  /* Suppression révélée au survol ou au focus de la ligne, comme les actions de ligne Kube. */
  .cop-del { display: inline-flex; align-items: center; justify-content: center; width: var(--control-sm); height: var(--control-sm); margin-right: 4px; border: 0; border-radius: var(--radius-md); background: none; color: var(--ink-4); font-size: 16px; cursor: pointer; transition: opacity var(--duration-basic) ease, background-color var(--duration-basic) ease, color var(--duration-basic) ease, transform var(--duration-basic) var(--ease-enter-snappy); }
  @media (hover: hover) and (pointer: fine) {
    .cop-row .cop-del { opacity: 0; }
    .cop-row:hover .cop-del, .cop-row:focus-within .cop-del { opacity: 1; }
  }
  .cop-del:hover { background: var(--fill-hover); color: var(--err-text); }
  .cop-del:active { transform: scale(0.97); }
  .cop-del:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: -2px; color: var(--err-text); }

  /* Téléchargement */
  .cop-dl { padding: 12px; border-radius: var(--radius-xl); background: var(--composer-bg); box-shadow: 0 0 0 1px var(--line-1); }
  .cop-dl-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
  .cop-track { height: 4px; background: var(--accent-soft); border-radius: var(--radius-full); overflow: hidden; }
  .orbit { color: var(--ink-4); animation: doku-orbit 1.1s linear infinite; }
  /* Mouvement réduit : la règle globale fige ces boucles, et une attente ne se distinguait
     plus du repos. On garde une pulsation d'opacité seule (ni échelle ni rotation).
     Longhands et non le raccourci : celui-ci réimposerait `animation-play-state` et
     relancerait les boucles du panneau fermé. */
  @media (prefers-reduced-motion: reduce) {
    .cop-memory-sync span,
    .cop-auth-pending > span,
    .cop-dot.breathe,
    .orbit {
      animation-name: cop-wait-pulse;
      animation-timing-function: ease-in-out;
      animation-duration: 1.6s !important;
      animation-iteration-count: infinite !important;
    }
  }
  @keyframes cop-wait-pulse {
    0%, 100% { opacity: 0.45; }
    50% { opacity: 1; }
  }

  .cop-btn-sm {
    height: var(--control-sm); padding: 0 12px; background: var(--ink); color: var(--cream-content); border: 0; border-radius: var(--radius-md);
    font-family: var(--font-sans); font-size: var(--text-sm); font-weight: var(--weight-control); cursor: pointer;
    transition: background-color var(--duration-basic) ease, transform var(--duration-basic) var(--ease-enter);
  }
  .cop-btn-sm:disabled { opacity: var(--opacity-disabled); cursor: default; }
  .cop-btn-sm:not(:disabled):hover { background: var(--ink-2); }
  .cop-btn-sm:not(:disabled):active { transform: scale(0.97); }
  .cop-btn-sm:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
  .cop-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
  .cop-chip {
    display: inline-flex; align-items: center; gap: 4px; height: var(--control-2xs); padding: 0 10px;
    border: 0; border-radius: var(--radius-full); background: var(--surface-2);
    color: var(--ink-3); font-family: var(--font-sans); font-size: var(--text-xs); font-weight: var(--weight-control); cursor: pointer;
    transition: background-color var(--duration-basic) ease, color var(--duration-basic) ease, transform var(--duration-basic) var(--ease-enter-snappy);
  }
  /* Alignement optique : côté icône = côté texte − 2 px. */
  .cop-chip:has(> .icon:first-child) { padding: 0 10px 0 8px; }
  .cop-chip:hover { background: var(--accent-soft); color: var(--ink); }
  .cop-chip:active { transform: scale(0.97); }

  /* Index du dossier (15.2) */
  .cop-rag { padding: 12px; border-radius: var(--radius-xl); background: var(--composer-bg); box-shadow: 0 0 0 1px var(--line-1); }
  .cop-rag-row { display: flex; align-items: center; gap: 8px; font-size: var(--text-sm); }
  .cop-rag-progress { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
  .cop-rag-progress .cop-rag-note { font-variant-numeric: tabular-nums; }
  .cop-rag-note { font-size: var(--text-xs); line-height: 1.55; color: var(--ink-3); margin-top: 8px; }
  .cop-rag-note.err { color: var(--err-text); display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .cop-rag-del {
    border: 0; background: none; padding: 0; margin-left: 4px; cursor: pointer;
    font-family: var(--font-sans); font-size: var(--text-xs); color: var(--ink-3); text-decoration: underline;
    transition: color var(--duration-basic) ease;
  }
  .cop-rag-del:hover { color: var(--err-text); }

  /* Chat — accueil (refonte v2) : salutation éditoriale en Source Serif, ligne sur le
     document courant, puis une grille 2 colonnes de cartes (tuile teintée + libellé +
     sous-libellé). Calé en bas, près du composeur : l'œil n'a qu'un trajet à faire. */
  .cop-chat-empty {
    min-height: 100%;
    padding: 32px 4px 20px;
    display: flex; flex-direction: column;
    justify-content: flex-end;
  }
  .cop-greet {
    margin: 0;
    color: var(--ink);
    font: 500 26px/1.2 var(--font-serif);
    letter-spacing: -0.01em;
  }
  .cop-greet-sub {
    max-width: 34ch; margin: 6px 0 20px; color: var(--ink-3);
    font: var(--weight-regular) var(--text-md)/1.45 var(--font-sans); text-wrap: pretty;
  }
  .cop-greet-sub em { font-style: normal; color: var(--ink); font-weight: var(--weight-control); overflow-wrap: anywhere; }
  .cop-suggest { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
  .cop-suggest-card {
    min-width: 0;
    padding: 12px;
    display: flex; flex-direction: column; align-items: flex-start; gap: 10px;
    border: 0; border-radius: var(--radius-2xl);
    background: var(--surface-2);
    color: var(--ink);
    text-align: left; cursor: pointer;
    transition: background-color var(--duration-basic) ease, box-shadow var(--duration-basic) ease, transform var(--duration-basic) var(--ease-enter-snappy);
  }
  .cop-suggest-tile {
    width: var(--control-sm); height: var(--control-sm); flex: 0 0 auto;
    display: inline-flex; align-items: center; justify-content: center;
    /* Neutre : icône claire sur tuile d'encre, sans teinte par carte. */
    border-radius: var(--radius-md); background: var(--tint-ink-bg); color: var(--tint-ink-fg);
    font-size: 15px;
  }
  .cop-suggest-copy { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .cop-suggest-copy strong { font: var(--weight-control) var(--text-sm)/18px var(--font-sans); }
  .cop-suggest-copy small { color: var(--ink-3); font: var(--weight-regular) var(--text-xs)/16px var(--font-sans); text-wrap: pretty; }
  @media (hover: hover) and (pointer: fine) {
    .cop-suggest-card:hover { background: var(--composer-bg); box-shadow: var(--shadow-lg); }
  }
  .cop-suggest-card:active { transform: scale(0.97); }
  .cop-suggest-card:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
  /* Carte étroite : une colonne, tuile à gauche du texte. */
  @container (max-width: 300px) {
    .cop-suggest { grid-template-columns: minmax(0, 1fr); }
    .cop-suggest-card { flex-direction: row; align-items: center; }
  }

  /* Chat — conversation (Kube Thread) : 12 px entre tours, 28 px quand le locuteur change. */
  .cop-conv { padding: 16px 0 24px; display: flex; flex-direction: column; gap: 12px; }
  .cop-conv > * + .cop-user,
  .cop-conv > .cop-user + * { margin-top: 16px; }
  /* Entrée d'un tour ajouté (Kube Message) ; jamais à l'ouverture d'une conversation, ni pour
     le tour de l'utilisateur (il vient de l'envoyer, souvent par Entrée). */
  .cop-conv > .enter { animation: cop-turn-enter var(--duration-relaxed) var(--ease-enter-snappy) both; }
  @keyframes cop-turn-enter { from { opacity: 0; transform: translateY(8px); } }
  .cop-history-window { display: flex; align-items: center; gap: 6px; margin: 0 8px; color: var(--ink-4); font-size: var(--text-xs); line-height: 1.4; }
  .cop-history-window .icon { flex: 0 0 auto; font-size: 14px; }
  .cop-user { display: flex; justify-content: flex-end; }
  /* Bulle utilisateur : rayon 18, 6 en bas à droite (la « queue » côté locuteur), ≤ 85 %. */
  .cop-user-bubble {
    max-width: 85%; background: var(--surface-2); border: 0; border-radius: 18px 18px 6px 18px;
    padding: 0.6em 1em; font-size: var(--cop-text); line-height: 1.5; color: var(--ink); white-space: pre-wrap; overflow-wrap: anywhere;
  }
  /* Le contenu de la conversation doit être COPIABLE (le body global est en user-select:none) :
     sans ça, une question échouée ne peut même pas être re-copiée pour la retaper. */
  .cop-user-bubble, .cop-md, .cop-md-plain, .cop-err-msg { user-select: text; }
  .cop-asst { padding-right: 4px; }
  /* Signature : marque 18 px, nom, heure — une ligne de 20 px au-dessus de la prose. */
  .cop-asst-head { height: 20px; display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
  .cop-asst-mark {
    width: 18px; height: 18px; flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center;
    border-radius: 5px; background: var(--ink); color: var(--cream-content); font-size: 11px;
  }
  .cop-asst-name { font-size: var(--text-xs); color: var(--ink); font-weight: var(--weight-strong); }
  .cop-asst-time { font-size: var(--text-xs); color: var(--ink-4); font-variant-numeric: tabular-nums; }
  /* Rangée d'actions (Kube Message) : toujours dans le DOM (atteignable au clavier),
     révélée au survol du tour, au focus, pendant une confirmation, et toujours au doigt.
     Retrait de 6 px : la première icône s'aligne sur le texte. */
  .cop-msg-actions { display: flex; gap: 2px; margin: 6px 0 0 -6px; opacity: 0; transition: opacity var(--duration-basic) ease; }
  .cop-msg-actions:focus-within,
  .cop-msg-actions:has(.done),
  .cop-asst.last > .cop-msg-actions { opacity: 1; }
  @media (hover: hover) and (pointer: fine) {
    .cop-asst:hover > .cop-msg-actions { opacity: 1; }
  }
  @media (hover: none) {
    .cop-msg-actions { opacity: 1; }
  }
  /* Au doigt, boutons de 40 px : retrait recalé pour garder l'icône sur le bord du texte. */
  :global(:where(:root[data-input='touch'])) .cop-msg-actions { opacity: 1; margin-left: -12px; }
  .cop-copy { display: inline-flex; align-items: center; justify-content: center; width: var(--control-sm); height: var(--control-sm); border: 0; border-radius: var(--radius-sm); background: transparent; color: var(--ink-4); font-size: 16px; cursor: pointer; transition: background-color var(--duration-basic) ease, color var(--duration-basic) ease, transform var(--duration-basic) var(--ease-enter-snappy); }
  .cop-copy:hover { background: var(--fill-hover); color: var(--ink); }
  .cop-copy.done { color: var(--ok-text); }
  .cop-copy:active { transform: scale(0.97); }
  /* Échange d'icône (copier → coche) : les deux tracés superposés se relaient en fondu,
     échelle et léger flou — un seul objet qui change, pas deux qui se croisent. */
  .cop-swap { display: inline-grid; place-items: center; }
  .cop-swap > .icon {
    grid-area: 1 / 1;
    transition: opacity var(--duration-relaxed) var(--ease-icon), transform var(--duration-relaxed) var(--ease-icon), filter var(--duration-relaxed) var(--ease-icon);
  }
  .cop-swap > .icon:last-child,
  .cop-swap.on > .icon:first-child { opacity: 0; transform: scale(0.25); filter: blur(4px); }
  .cop-swap.on > .icon:last-child { opacity: 1; transform: none; filter: none; }
  .cop-copy:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 1px; }
  /* Étape en cours (draft-agent) : spinner fin de 14 px + libellé balayé, sur la ligne qui
     suit la signature — aucune bulle vide. */
  .cop-status { display: flex; align-items: center; gap: 10px; font-size: calc(var(--cop-text) - 0.5px); color: var(--ink-3); min-height: 22px; }
  .cop-spinner {
    width: 14px; height: 14px; flex: none; border-radius: 50%;
    border: 1.5px solid var(--line-2); border-top-color: var(--ink-2);
    animation: doku-orbit 0.9s linear infinite;
  }
  @media (prefers-reduced-motion: no-preference) {
    /* Variante forte de Kube : le libellé porte l'information (statut réel de l'outil). */
    /* Composité seul : un masque trois fois plus large que le libellé glisse en transform,
       le texte glisse en sens inverse et reste immobile à l'écran. Le masque atténue
       l'encre hors de la bande (≈ --ink-3) ; aucun texte transparent. */
    .cop-shimmer { display: inline-block; min-width: 0; max-width: 100%; overflow: clip; color: var(--ink); }
    .cop-shimmer-mask {
      display: block;
      width: 300%;
      -webkit-mask-image: linear-gradient(90deg, rgb(0 0 0 / 0.5) 0%, rgb(0 0 0 / 0.5) 38%, #000 50%, rgb(0 0 0 / 0.5) 62%, rgb(0 0 0 / 0.5) 100%);
      mask-image: linear-gradient(90deg, rgb(0 0 0 / 0.5) 0%, rgb(0 0 0 / 0.5) 38%, #000 50%, rgb(0 0 0 / 0.5) 62%, rgb(0 0 0 / 0.5) 100%);
      animation: cop-shimmer-mask 2s linear infinite;
      will-change: transform;
    }
    .cop-shimmer-text {
      display: inline-block;
      max-width: calc(100% / 3);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      vertical-align: top;
      animation: cop-shimmer-text 2s linear infinite;
      will-change: transform;
    }
  }
  /* Mouvement réduit : la pulsation d'opacité commune du panneau, décalée d'un point à
     l'autre — l'attente se distingue du repos sans aucun déplacement. La règle globale
     (app.css) force une itération de 0,01 ms en !important. */
  /* Mouvement réduit : pulsation d'opacité (la règle globale force une itération de
     0,01 ms en !important) — l'attente se distingue du repos sans rotation. */
  @media (prefers-reduced-motion: reduce) {
    .cop-spinner {
      border-top-color: var(--line-2);
      background: var(--line-2);
      animation-name: cop-wait-pulse;
      animation-timing-function: ease-in-out;
      animation-duration: 1.6s !important;
      animation-iteration-count: infinite !important;
    }
  }
  @keyframes cop-shimmer-mask { from { transform: translateX(calc(-200% / 3)); } 70%, to { transform: translateX(0); } }
  @keyframes cop-shimmer-text { from { transform: translateX(200%); } 70%, to { transform: translateX(0); } }
  .cop-md-plain { font-size: var(--cop-text); line-height: 1.625; color: var(--ink-2); white-space: pre-wrap; overflow-wrap: anywhere; }
  /* Caret de flux (Kube Message) : point de 7 px à 13,5 px, en `em` pour suivre --cop-text.
     Mouvement réduit : la règle globale le fige (point plein, le texte qui s'écrit suffit). */
  .cop-md-plain.streaming::after {
    content: '';
    display: inline-block;
    width: 0.52em;
    height: 0.52em;
    margin-left: 0.3em;
    border-radius: var(--radius-full);
    background: var(--ink);
    vertical-align: middle;
    animation: cop-caret 1s ease-in-out infinite;
  }
  @keyframes cop-caret { 50% { opacity: 0.3; transform: scale(0.8); } }
  /* Lettres nouvelles du flux (copilot-stream-reveal.ts, quelques-unes par image) : elles sortent
     d'un léger flou. En ligne (un paquet peut contenir un blanc) : opacité et flou seulement.
     Mouvement réduit : fondu seul. */
  .cop-md-plain.streaming :global(.cop-reveal) { animation: cop-reveal 200ms ease-out both; }
  @keyframes cop-reveal { from { opacity: 0; filter: blur(2px); } }
  @keyframes cop-reveal-fade { from { opacity: 0; } }
  @media (prefers-reduced-motion: reduce) {
    .cop-md-plain.streaming :global(.cop-reveal) { animation-name: cop-reveal-fade; animation-duration: 180ms !important; }
  }

  /* Rendu Markdown assaini (Kube Prose ; contenu injecté via {@html} → styles :global).
     Tout dérive de --cop-text : interligne × 1,625, unité --u = taille / 4, petit texte
     (tables, code) = 87,5 % sans descendre sous 12 px. */
  .cop-md {
    --u: calc(var(--cop-text) / 4);
    --lead: calc(var(--cop-text) * 1.625);
    --small: max(12px, calc(var(--cop-text) * 0.875));
    font-size: var(--cop-text); line-height: var(--lead); color: var(--ink-2); overflow-wrap: anywhere;
  }
  .cop-md :global(> :first-child) { margin-top: 0; }
  .cop-md :global(> :last-child) { margin-bottom: 0; }
  .cop-md :global(p) { margin: 0 0 calc(var(--u) * 4); text-wrap: pretty; }
  .cop-md :global(:is(strong, b)) { font-weight: var(--weight-strong); }
  .cop-md :global(:is(h1, h2, h3, h4, h5, h6)) { color: var(--ink); font-weight: var(--weight-strong); letter-spacing: normal; text-wrap: balance; }
  .cop-md :global(h1) { margin: calc(var(--u) * 4) 0 calc(var(--u) * 2); font-size: calc(var(--cop-text) * 1.5); line-height: calc(var(--u) * 8); }
  .cop-md :global(h2) { margin: calc(var(--u) * 4) 0 var(--u); font-size: calc(var(--cop-text) * 1.25); line-height: calc(var(--u) * 7); }
  .cop-md :global(h3) { margin: calc(var(--u) * 4) 0 var(--u); font-size: calc(var(--cop-text) * 1.125); line-height: calc(var(--u) * 7); }
  .cop-md :global(h4) { margin: calc(var(--u) * 4) 0 0; font-size: var(--cop-text); line-height: calc(var(--u) * 6); }
  .cop-md :global(:is(h5, h6)) { margin: 0; font-size: var(--cop-text); line-height: var(--lead); }
  /* Les liens externes arrivent sans href (sanitize) : seul un vrai lien réagit au survol. */
  .cop-md :global(a) {
    color: var(--ink); font-weight: var(--weight-control);
    text-decoration: underline 1px color-mix(in srgb, currentColor 35%, transparent); text-underline-offset: 2px;
    transition: text-decoration-color var(--duration-basic) ease;
  }
  .cop-md :global(a[href]:hover) { text-decoration-color: currentColor; }
  /* Listes : retrait d'un interligne, puces disc > circle > square. */
  .cop-md :global(:is(ul, ol)) { margin: 0 0 calc(var(--u) * 4); padding-inline-start: var(--lead); }
  .cop-md :global(ul) { list-style-type: disc; }
  .cop-md :global(:is(ul, ol) ul) { list-style-type: circle; }
  .cop-md :global(:is(ul, ol) :is(ul, ol) ul) { list-style-type: square; }
  .cop-md :global(li) { padding-inline-start: calc(var(--u) * 1.5); }
  .cop-md :global(li + li) { margin-top: calc(var(--u) * 1.5); }
  .cop-md :global(li::marker) { color: var(--ink); font-weight: var(--weight-strong); }
  .cop-md :global(li > p) { margin: 0; }
  .cop-md :global(li > :is(ul, ol)) { margin: calc(var(--u) * 1.5) 0 0; }
  /* Cases de tâches : sans puce, la case pend dans la gouttière de la puce. Une liste
     « espacée » (lignes vides entre items) emballe la case dans un <p>. Une liste qui
     mêle tâches et puces garde l'alignement de ses puces. */
  .cop-md :global(li:has(> input[type='checkbox'], > p:first-child > input[type='checkbox'])) { list-style: none; }
  .cop-md :global(:is(li, li > p:first-child) > input[type='checkbox']:first-child) {
    width: 1em;
    height: 1em;
    margin: 0 calc(var(--u) * 2) 0 calc(-1em - var(--u) * 2);
    vertical-align: -0.125em;
    accent-color: var(--ink);
  }
  /* Citation : filet de 2 px --line-3 comme dans l'éditeur (DESIGN.md), retrait Kube. */
  .cop-md :global(blockquote) { position: relative; margin: 0 0 calc(var(--u) * 4); padding: calc(var(--u) * 2) 0 calc(var(--u) * 2) calc(var(--u) * 6); color: var(--ink-3); }
  .cop-md :global(blockquote::after) {
    content: ''; position: absolute; left: 0; top: calc(var(--u) * 2); bottom: calc(var(--u) * 2);
    width: 2px; border-radius: 1px; background: var(--line-3);
  }
  .cop-md :global(blockquote > :last-child) { margin-bottom: 0; }
  .cop-md :global(hr) { height: 0; margin: calc(var(--u) * 7) 0; border: 0; border-top: 1px solid var(--line-2); }
  .cop-md :global(:not(pre) > code) {
    padding: 0.07em 0.4em; border-radius: var(--radius-sm); background: var(--code-bg);
    font-family: var(--font-mono); font-size: 0.92em;
    -webkit-box-decoration-break: clone; box-decoration-break: clone;
  }
  /* Bloc de code (Kube CodeBlock, markup de chat-blocks.ts) : surface creusée, en-tête
     discret langage + Copier, défilement horizontal propre au bloc. */
  .cop-md :global(.cop-code) {
    margin: calc(var(--u) * 5) 0; border: 1px solid var(--line-1); border-radius: var(--radius-xl);
    background: var(--code-bg); contain: inline-size; overflow: clip;
  }
  .cop-md :global(.cop-code-head) {
    display: flex; align-items: center; gap: 8px; min-height: var(--control-lg);
    padding: 0 4px 0 calc(var(--u) * 4); user-select: none;
  }
  .cop-md :global(.cop-code-lang) {
    flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
    font: var(--weight-control) var(--text-xs) / 1.5 var(--font-sans); color: var(--ink-3);
  }
  .cop-md :global(.cop-code-copy) {
    display: inline-grid; place-items: center; flex: none; width: var(--control-sm); height: var(--control-sm);
    border: 0; border-radius: var(--radius-md); background: transparent; color: var(--ink-3); font-size: 16px; cursor: pointer;
    transition: background-color var(--duration-basic) ease, color var(--duration-basic) ease, transform var(--duration-basic) var(--ease-enter-snappy);
  }
  .cop-md :global(.cop-code-copy:hover) { background: var(--fill-hover); color: var(--ink); }
  .cop-md :global(.cop-code-copy:active) { transform: scale(0.97); }
  .cop-md :global(.cop-code-copy:focus-visible) { outline: 2px solid var(--focus-ring); outline-offset: -2px; }
  .cop-md :global(.cop-code-copy > .icon) { grid-area: 1 / 1; }
  /* Copier → coche sans fondu (Kube) ; un clic pendant la confirmation est ignoré. */
  .cop-md :global(.cop-code-copy > .icon:last-child),
  .cop-md :global(.cop-code-copy[data-copied] > .icon:first-child) { visibility: hidden; }
  .cop-md :global(.cop-code-copy[data-copied] > .icon:last-child) { visibility: visible; }
  .cop-md :global(.cop-code-copy[data-copied]) { color: var(--ok-text); cursor: default; }
  .cop-md :global(.cop-code pre) {
    margin: 0; padding: 0 calc(var(--u) * 4) calc(var(--u) * 3);
    font-family: var(--font-mono); font-size: var(--small); line-height: calc(var(--u) * 5);
    white-space: pre; tab-size: 4; overflow-x: auto; overflow-wrap: normal;
  }
  .cop-md :global(.cop-code pre:focus-visible) { outline: 2px solid var(--focus-ring); outline-offset: -2px; }
  .cop-md :global(pre code) { font: inherit; background: none; padding: 0; }
  /* Tables : chacune défile dans son conteneur ; le texte se replie d'abord, la table ne
     défile que si ses colonnes ne peuvent plus rétrécir. Filets seuls, sans boîte. */
  .cop-md :global(.cop-table-scroll) { margin: calc(var(--u) * 4) 0; overflow-x: auto; overscroll-behavior-x: contain; }
  .cop-md :global(table) {
    width: fit-content; min-width: 100%; border-collapse: separate; border-spacing: 0;
    font-size: var(--small); line-height: var(--lead); font-variant-numeric: tabular-nums;
  }
  /* `anywhere` (hérité de .cop-md) coupait les en-têtes en « Colon/ne ». */
  .cop-md :global(:is(th, td)) {
    padding: calc(var(--u) * 2.5) calc(var(--u) * 6) calc(var(--u) * 2.5) 0;
    vertical-align: top; text-align: start; overflow-wrap: normal;
  }
  .cop-md :global(th) { padding-block: calc(var(--u) * 2); border-bottom: 1px solid var(--line-3); color: var(--ink); font-weight: var(--weight-strong); line-height: calc(var(--u) * 4); }
  .cop-md :global(:is(th, td):last-child) { padding-inline-end: 0; }
  .cop-md :global(tr:not(:last-child) > td) { border-bottom: 1px solid var(--line-1); }
  .cop-md :global(:is(th, td)[align='center']) { text-align: center; }
  .cop-md :global(:is(th, td)[align='right']) { text-align: right; }
  /* Bords du défilement (Kube ScrollFade --x) : chaque bord s'estompe tant qu'il reste du
     contenu au-delà. CSS pur là où les animations pilotées par le défilement existent
     (WebView2) ; ailleurs la table défile simplement, sans fondu. */
  @supports (animation-timeline: scroll()) {
    .cop-md :global(.cop-table-scroll) {
      -webkit-mask-image: linear-gradient(to right, transparent, #000 var(--cop-edge-start), #000 calc(100% - var(--cop-edge-end)), transparent);
      mask-image: linear-gradient(to right, transparent, #000 var(--cop-edge-start), #000 calc(100% - var(--cop-edge-end)), transparent);
      animation-name: cop-edge-start, cop-edge-end;
      animation-duration: auto;
      animation-timing-function: linear;
      animation-fill-mode: both;
      animation-timeline: scroll(self inline), scroll(self inline);
      animation-range: 0 24px, calc(100% - 24px) 100%;
    }
  }
  @property --cop-edge-start { syntax: '<length>'; inherits: false; initial-value: 0px; }
  @property --cop-edge-end { syntax: '<length>'; inherits: false; initial-value: 0px; }
  @keyframes cop-edge-start { from { --cop-edge-start: 0px; } to { --cop-edge-start: 24px; } }
  @keyframes cop-edge-end { from { --cop-edge-end: 24px; } to { --cop-edge-end: 0px; } }

  /* « Aller au dernier message » (Kube Thread) : disque sticky au-dessus du fondu du dock. */
  .cop-jump-dock { position: sticky; bottom: 24px; height: 0; display: flex; align-items: flex-end; justify-content: center; pointer-events: none; }
  .cop-jump {
    display: inline-flex; align-items: center; justify-content: center; flex: none;
    width: var(--control-md); height: var(--control-md);
    border: 1px solid var(--line-1); border-radius: var(--radius-full);
    background: var(--composer-bg); background-clip: padding-box; box-shadow: var(--shadow-md);
    color: var(--ink-3); font-size: 16px; cursor: pointer;
    opacity: 0; translate: 0 4px; pointer-events: none;
    transition: opacity var(--duration-basic) ease, translate var(--duration-basic) var(--ease-enter-snappy), color var(--duration-basic) ease, transform var(--duration-basic) var(--ease-enter-snappy);
  }
  /* Entrée (200 ms) plus lente que la sortie (150 ms). */
  .cop-jump.shown { opacity: 1; translate: 0 0; pointer-events: auto; transition-duration: var(--duration-moderate); }
  .cop-jump:hover { color: var(--ink); }
  .cop-jump:active { transform: scale(0.97); }
  .cop-jump:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
  :global(:where(:root[data-input='touch'])) .cop-jump { width: 40px; height: 40px; }

  /* Carte d'erreur (génération échouée) */
  .cop-err-card { display: flex; gap: 12px; padding: 12px; border-radius: var(--radius-xl); background: var(--surface-2); }
  .cop-err-icon { flex: none; font-size: 18px; color: var(--ink-3); }
  .cop-err-icon.failed { color: var(--err-text); }
  .cop-err-title { font-size: calc(var(--cop-text) - 0.5px); font-weight: 600; color: var(--ink); margin-bottom: 3px; }
  .cop-err-msg { font-size: calc(var(--cop-text) - 1.5px); line-height: 1.5; color: var(--ink-3); margin: 0 0 12px; text-wrap: pretty; }
  .cop-err-acts { display: flex; gap: 6px; }
  .cop-err-btn { height: var(--control-sm); padding: 0 12px; background: var(--cream-content); color: var(--ink-2); border: 0; border-radius: var(--radius-md); font-family: var(--font-sans); font-size: var(--text-sm); font-weight: var(--weight-control); cursor: pointer; transition: background-color var(--duration-basic) ease, color var(--duration-basic) ease, filter var(--duration-basic) ease, transform var(--duration-basic) var(--ease-enter-snappy); }
  .cop-err-btn:hover { background: var(--accent-soft); color: var(--ink); }
  .cop-err-btn:active { transform: scale(0.97); }
  .cop-err-btn:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
  .cop-err-btn.primary { background: var(--ink); color: var(--cream-content); border-color: var(--ink); }
  .cop-err-btn.primary:hover { background: var(--ink-2); }
  .cop-err-btn.danger { background: var(--danger-action-text); color: var(--cream-content); border-color: var(--danger-action-text); }
  .cop-err-btn.danger:hover { background: color-mix(in srgb, var(--danger-action-text) 88%, transparent); color: var(--cream-content); }

  /* Confirmation inline de suppression (remplace le confirm() natif) */
  .cop-row.confirm { flex-direction: column; align-items: stretch; gap: 8px; padding: 12px; border-radius: var(--radius-xl); background: var(--surface-2); }
  .cop-confirm-txt { font-size: 13px; line-height: 1.5; color: var(--ink-2); overflow-wrap: anywhere; text-wrap: pretty; }
  .cop-confirm-acts { display: flex; gap: 6px; justify-content: flex-end; }

  /* Bannière d'erreur (vue modèles) avec dismiss */
  .cop-msg.row { display: flex; align-items: flex-start; gap: 8px; }
  .grow-wrap { flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .cop-dismiss { display: inline-flex; align-items: center; justify-content: center; width: var(--control-sm); height: var(--control-sm); flex: 0 0 auto; border: 0; border-radius: var(--radius-md); background: transparent; color: var(--ink-4); font-size: 14px; cursor: pointer; transition: background-color var(--duration-basic) ease, color var(--duration-basic) ease, transform var(--duration-basic) var(--ease-enter-snappy); }
  .cop-dismiss:hover { background: var(--fill-hover); color: var(--ink); }
  .cop-dismiss:active { transform: scale(0.97); }
  .cop-dismiss:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: -2px; }

  /* Dock de saisie : la pile tiroir + composeur, sous un fondu de 24 px (en phase avec
     `bottom: 24px` du bouton « Aller au dernier message »). */
  .cop-input-wrap {
    position: relative;
    z-index: 2;
    flex-shrink: 0;
    padding: 8px max(16px, calc((100% - 760px) / 2)) 10px;
    background: var(--cream-content);
    container: cop-input / inline-size;
  }
  .cop-input-wrap::before {
    content: '';
    position: absolute;
    z-index: -1;
    left: 0;
    right: 0;
    top: -24px;
    height: 24px;
    background: linear-gradient(180deg, transparent, var(--cream-content));
    pointer-events: none;
  }


  /* Voile juste sous la couche des popovers : le tiroir et son bouton restent au-dessus. */
  .cop-activity-backdrop {
    position: absolute;
    z-index: calc(var(--z-popover) - 1);
    inset: 0;
    border: 0;
    background: transparent;
    cursor: default;
  }
  .cop-activity-drawer {
    position: absolute;
    z-index: var(--z-popover);
    top: 4px;
    right: 12px;
    width: min(380px, calc(100% - 24px));
    max-height: min(72%, 620px);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border: 0;
    border-radius: var(--radius-2xl);
    background: var(--surface);
    box-shadow: var(--shadow-xl);
    color: var(--ink);
    transform-origin: top right;
    animation: doku-pop-in var(--duration-basic) var(--ease-enter-snappy);
  }
  .cop-activity-drawer > header {
    min-height: 52px;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px 8px 14px;
    border-bottom: 1px solid var(--line-1);
  }
  .cop-activity-drawer > header > .icon { color: var(--ink-3); font-size: 16px; }
  .cop-activity-drawer > header > div { min-width: 0; flex: 1; display: flex; flex-direction: column; }
  .cop-activity-drawer > header strong { font: var(--weight-strong) var(--text-sm)/var(--leading-snug) var(--font-sans); }
  .cop-activity-drawer > header small { color: var(--ink-3); font: var(--weight-regular) var(--text-xs)/var(--leading-tight) var(--font-sans); }
  .cop-activity-turns { min-height: 0; overflow-y: auto; padding: 6px 12px 18px; }
  .cop-activity-turn { padding: 10px 0 12px; }
  .cop-activity-turn + .cop-activity-turn { border-top: 1px solid var(--line-1); }
  .cop-activity-turn > p {
    margin: 0 8px 4px;
    overflow: hidden;
    color: var(--ink-2);
    font: var(--weight-control) var(--text-sm)/1.45 var(--font-sans);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Composeur unifié (refonte v2 §4) : une seule carte, rayon 22, ombre composer. Ses
     couches se révèlent EN HAUTEUR au-dessus des puces (grille 0fr → 1fr, 150 ms) : la
     saisie reste ancrée en bas pendant que la carte grandit vers le haut. */
  .cop-composer {
    position: relative;
    min-width: 0;
    display: flex;
    flex-direction: column;
    border-radius: var(--radius-composer);
    background: var(--composer-bg);
    box-shadow: var(--shadow-composer);
    container: cop-composer / inline-size;
    transition: box-shadow var(--duration-basic) ease;
  }
  .cop-composer:focus-within { box-shadow: var(--shadow-composer), 0 0 0 1px var(--line-2); }
  .cop-reveal {
    display: grid;
    grid-template-rows: 0fr;
    min-width: 0;
    transition: grid-template-rows var(--duration-basic) var(--ease-enter-snappy);
  }
  .cop-reveal.open { grid-template-rows: 1fr; }
  .cop-reveal:not(.open) { pointer-events: none; }
  .cop-reveal-content {
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    opacity: 0;
    transition: opacity var(--duration-basic) var(--ease-enter-snappy);
  }
  .cop-reveal.open .cop-reveal-content { opacity: 1; }
  /* Filet sous la couche ouverte : elle se lit comme un étage de la carte, pas un menu. */
  .cop-reveal.open + .cop-reveal:not(.open) ~ .cop-ctx-row,
  .cop-reveal.open ~ .cop-ctx-row { border-top: 1px solid var(--line-1); }
  .cop-composer.kbd .cop-reveal,
  .cop-composer.kbd .cop-reveal-content,
  .cop-composer.kbd .cop-ctx-chev { transition: none; }
  @media (prefers-reduced-motion: reduce) {
    .cop-reveal,
    .cop-reveal-content { transition: none; }
  }

  /* Rangées de la liste du contexte : 32 px, icône 16, texte ellipsé, actions de 20 px. */
  .cop-context-row {
    min-width: 0;
    min-height: var(--control-md);
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 2px 6px 2px 8px;
    border: 0;
    border-radius: var(--radius-lg);
    background: transparent;
    color: var(--ink-3);
    font: var(--weight-regular) var(--text-sm)/20px var(--font-sans);
    text-align: left;
    transition: background-color var(--duration-basic) ease, color var(--duration-basic) ease;
  }
  button.cop-context-row { cursor: pointer; }
  .cop-context-row.sel { background: var(--row-selected); color: var(--ink); }
  @media (hover: hover) and (pointer: fine) {
    button.cop-context-row:not(.sel):hover { background: var(--surface-hover); color: var(--ink); }
  }
  button.cop-context-row:active { background: var(--fill-pressed); }
  button.cop-context-row:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: -2px; }
  .cop-drawer-icon { flex: 0 0 auto; font-size: 16px; color: var(--ink-3); }
  .cop-drawer-text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cop-drawer-text strong { color: var(--ink-2); font-weight: var(--weight-control); }
  .cop-drawer-text small { color: var(--ink-3); font-size: var(--text-xs); }
  .cop-drawer-action {
    width: 20px; height: 20px; flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center;
    color: var(--ink-4); font-size: 16px;
  }
  .cop-drawer-btn {
    width: 20px; height: 20px; flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center;
    border: 0; border-radius: var(--radius-full); background: transparent; color: var(--ink-4); font-size: 14px; cursor: pointer;
    transition: background-color var(--duration-basic) ease, color var(--duration-basic) ease, transform var(--duration-basic) var(--ease-enter-snappy);
  }
  @media (hover: hover) and (pointer: fine) {
    .cop-drawer-btn:hover { background: var(--fill-hover); color: var(--ink); }
  }
  .cop-drawer-btn:active { transform: scale(0.97); }
  .cop-drawer-btn:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 0; }
  /* La liste défile au-delà de huit rangées environ : la carte reste courte. Rayon
     concentrique : 22 px de carte moins 6 px de retrait = 16, rangées à 10. */
  .cop-context-list {
    max-height: min(40vh, 264px);
    padding: 6px 6px 4px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  .cop-context-state {
    flex: 0 1 auto; max-width: 50%; height: 20px; padding: 0 8px;
    overflow: hidden; border-radius: var(--radius-full); background: var(--accent-soft); color: var(--ink-3);
    font: var(--weight-regular) var(--text-xs)/20px var(--font-sans); text-overflow: ellipsis; white-space: nowrap;
  }
  .cop-context-state.warn { background: color-mix(in srgb, var(--warn) 16%, transparent); color: var(--warn-text); }
  .cop-context-state .icon { margin-right: 4px; font-size: 12px; vertical-align: -2px; }
  .cop-context-note { margin: 2px 8px; color: var(--ink-3); font: var(--weight-regular) var(--text-xs)/1.35 var(--font-sans); text-wrap: pretty; }
  .cop-context-destination { display: flex; align-items: center; gap: 6px; }
  .cop-context-destination .icon { flex: 0 0 auto; font-size: 14px; }
  .cop-context-error { color: var(--err-text); }
  .cop-context-error-inline { margin: 0 14px 10px; font: var(--weight-regular) var(--text-xs)/1.35 var(--font-sans); }

  /* Tray des commandes « / » : premier étage de la carte. Aucune transition sur la
     sélection : elle suit le clavier sans traîner. */
  .cop-tray-list,
  .cop-tray-empty { margin: 6px 6px 4px; }
  .cop-tray-list { position: relative; max-height: 161px; overflow-y: auto; overscroll-behavior: contain; }
  .cop-tray-option {
    min-height: var(--control-md);
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    border-radius: 16px;
    color: var(--ink);
    font: var(--weight-regular) var(--text-sm)/18px var(--font-sans);
    cursor: pointer;
    user-select: none;
  }
  .cop-tray-option .icon { flex: 0 0 auto; font-size: 16px; color: var(--ink-3); }
  .cop-tray-option[aria-selected='true'] { background: var(--menu-row-hover); }
  .cop-tray-option[aria-selected='true'] .icon { color: var(--ink-2); }
  .cop-tray-name { flex: 0 0 auto; color: var(--ink-3); }
  .cop-tray-name b { color: var(--ink); font-weight: var(--weight-strong); }
  .cop-tray-hint {
    min-width: 0; margin-left: auto; padding-left: 8px; overflow: hidden;
    color: var(--ink-3); font-size: var(--text-xs); text-overflow: ellipsis; white-space: nowrap;
  }
  .cop-tray-empty { padding: 6px 10px; color: var(--ink-3); font: var(--weight-regular) var(--text-sm)/18px var(--font-sans); }

  /* Puces de contexte : 24 px, rayon plein, lavis neutre ; la première porte la portée et
     déplie le détail (chevron), les autres se retirent par leur croix. */
  .cop-ctx-row {
    min-width: 0;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    padding: 10px 10px 0;
  }
  .cop-ctx-chip {
    min-width: 0;
    max-width: 100%;
    height: var(--control-2xs);
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 0 8px;
    border: 0;
    border-radius: var(--radius-full);
    background: var(--accent-soft);
    color: var(--ink-2);
    font: var(--weight-control) var(--text-xs)/1 var(--font-sans);
    white-space: nowrap;
  }
  .cop-ctx-chip > .icon { flex: 0 0 auto; font-size: 13px; color: var(--ink-3); }
  .cop-ctx-name { min-width: 0; max-width: 168px; overflow: hidden; text-overflow: ellipsis; }
  .cop-ctx-chip.lead { cursor: pointer; transition: background-color var(--duration-basic) ease, color var(--duration-basic) ease; }
  @media (hover: hover) and (pointer: fine) {
    .cop-ctx-chip.lead:hover { background: var(--fill-pressed); color: var(--ink); }
  }
  .cop-ctx-chip.lead[aria-expanded='true'] { background: var(--ink); color: var(--cream-content); }
  .cop-ctx-chip.lead[aria-expanded='true'] > .icon { color: inherit; }
  .cop-ctx-chip.lead:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 1px; }
  .cop-ctx-warn { color: var(--warn-text) !important; }
  .cop-ctx-more { color: var(--ink-4); font-variant-numeric: tabular-nums; }
  .cop-ctx-chip.lead[aria-expanded='true'] .cop-ctx-more { color: inherit; opacity: 0.7; }
  .cop-ctx-chev { flex: 0 0 auto; margin-right: -2px; font-size: 12px; color: var(--ink-4); transition: rotate var(--duration-basic) var(--ease-move); }
  .cop-ctx-chip.lead[aria-expanded='true'] .cop-ctx-chev { rotate: 180deg; color: inherit; }
  .cop-ctx-chip > button {
    width: 18px; height: 18px; margin-right: -4px; flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center;
    border: 0; border-radius: var(--radius-full); background: transparent; color: var(--ink-4); font-size: 12px; cursor: pointer;
    transition: background-color var(--duration-basic) ease, color var(--duration-basic) ease;
  }
  .cop-ctx-chip > button:hover { background: var(--fill-hover); color: var(--ink); }
  .cop-ctx-chip > button:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 0; }
  .cop-ctx-add {
    width: var(--control-2xs); height: var(--control-2xs); flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center;
    border: 0; border-radius: var(--radius-full); background: transparent; color: var(--ink-3); font-size: 14px; cursor: pointer;
    box-shadow: inset 0 0 0 1px var(--line-2);
    transition: background-color var(--duration-basic) ease, color var(--duration-basic) ease, box-shadow var(--duration-basic) ease;
  }
  .cop-ctx-add:hover, .cop-ctx-add.open { background: var(--fill-hover); color: var(--ink); box-shadow: inset 0 0 0 1px var(--line-3); }
  .cop-ctx-add:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 1px; }
  .cop-ctx-add:disabled { opacity: var(--opacity-disabled); cursor: wait; }

  .cop-input-ta {
    display: block;
    width: 100%; min-width: 0; min-height: 44px; border: 0; background: transparent; outline: none; resize: none;
    font-family: var(--font-sans); font-size: var(--cop-text); line-height: 1.45; letter-spacing: -0.15px; color: var(--ink);
    padding: 10px 14px 4px; max-height: 160px;
    scroll-padding-block: 6px;
    field-sizing: content; /* auto-grow : les lignes Shift+Entrée restent visibles (WebView2 OK) */
  }
  .cop-input-ta::placeholder { color: var(--ink-4); }

  /* Barre d'outils : boutons de 28 px à 8 px des bords (rayon 22 − 8 = 14 ≈ plein). */
  .cop-toolbar {
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px 8px;
  }
  .cop-input-attach {
    flex: 0 0 auto;
    width: var(--control-sm); height: var(--control-sm); display: inline-flex; align-items: center; justify-content: center;
    background: transparent; border: 0; border-radius: var(--radius-full); color: var(--ink-3); font-size: 16px; cursor: pointer;
    transition: background-color var(--duration-basic) ease, color var(--duration-basic) ease, scale var(--duration-basic) var(--ease-enter-snappy);
  }
  .cop-input-attach:hover, .cop-input-attach.open { background: var(--fill-hover); color: var(--ink); }
  .cop-input-attach:not(:disabled):active { scale: 0.97; }
  .cop-input-attach:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 0; }
  .cop-input-attach:disabled { opacity: var(--opacity-disabled); cursor: wait; }
  /* Capsule modèle compacte : point d'état, nom court, chevron. Elle cède en premier. */
  .cop-model-cap {
    min-width: 0;
    flex: 0 1 auto;
    height: var(--control-sm);
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 0 8px 0 10px;
    border: 0;
    border-radius: var(--radius-full);
    background: transparent;
    color: var(--ink-3);
    font: var(--weight-control) var(--text-xs)/1 var(--font-sans);
    white-space: nowrap;
    cursor: pointer;
    transition: background-color var(--duration-basic) ease, color var(--duration-basic) ease;
  }
  .cop-model-cap:hover { background: var(--fill-hover); color: var(--ink); }
  .cop-model-cap:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: -2px; }
  .cop-model-cap > .icon { flex: 0 0 auto; font-size: 12px; color: var(--ink-4); }
  .cop-model-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .cop-state-dot { width: 6px; height: 6px; flex: 0 0 auto; border-radius: 50%; background: var(--line-3); }
  .cop-state-dot[data-state='ok'] { background: var(--ok); }
  .cop-state-dot[data-state='warn'] { background: var(--warn); }
  .cop-state-dot[data-state='busy'] { background: var(--ink-4); animation: doku-breathe 1.6s ease-in-out infinite; }

  /* Micro : bouton fantôme rond ; allumé (accent) tant que la conversation vocale tourne. */
  .cop-mic {
    flex: 0 0 auto; width: var(--control-md); height: var(--control-md); display: inline-flex; align-items: center; justify-content: center;
    padding: 0; border: 0; border-radius: var(--radius-full); background: transparent; color: var(--ink-3); font-size: 16px; cursor: pointer;
    transition: background-color var(--duration-basic) ease, color var(--duration-basic) ease, transform var(--duration-basic) var(--ease-enter-snappy);
  }
  .cop-mic:hover { background: var(--fill-hover); color: var(--ink); }
  .cop-mic:active { transform: scale(0.94); }
  .cop-mic:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: -2px; }
  .cop-mic.on { background: var(--accent-soft); color: var(--ink); }
  .cop-voice-error { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .cop-voice-error > span { flex: 1 1 auto; min-width: 0; }

  /* Envoyer / arrêter : disque d'encre de 32 px (le seul primaire de la vue). Pendant la
     génération il s'étire en pilule « Arrêter » sur le ressort liquide (la largeur dépasse un
     peu puis se pose) et refond en disque à la fin ; les deux contenus se croisent en fondu. */
  .cop-input-send {
    position: relative; overflow: hidden; flex: 0 0 auto; width: var(--control-md); height: var(--control-md);
    display: inline-flex; align-items: center; justify-content: center; padding: 0;
    background: var(--ink); border: 0; border-radius: var(--radius-full); color: var(--cream-content); font-size: 16px; cursor: pointer;
    transition: width var(--duration-liquid) var(--ease-spring-liquid), background-color var(--duration-basic) ease, opacity var(--duration-basic) ease, transform var(--duration-basic) var(--ease-enter-snappy);
  }
  .cop-input-send[aria-busy='true'] { width: 88px; }
  .cop-input-send:hover { background: var(--ink-2); }
  .cop-send-arrow { translate: 0 0.5px; transition: opacity 160ms ease 120ms, scale 220ms var(--ease-enter-snappy) 120ms; }
  .cop-send-stop {
    position: absolute; inset: 0; display: inline-flex; align-items: center; justify-content: center; gap: 6px;
    font: var(--weight-control) var(--text-xs)/1 var(--font-sans); white-space: nowrap;
    opacity: 0; scale: 0.8; transition: opacity 140ms ease, scale 220ms var(--ease-enter-snappy);
  }
  .cop-input-send[aria-busy='true'] .cop-send-arrow { opacity: 0; scale: 0.6; transition-delay: 0ms; }
  .cop-input-send[aria-busy='true'] .cop-send-stop { opacity: 1; scale: 1; transition-delay: 90ms; }
  .cop-stop-glyph { font-size: 10px; fill: currentColor; }
  .cop-input-send:not(:disabled):active { transform: scale(0.97); }
  .cop-input-send:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
  .cop-input-send:disabled { opacity: 0.25; cursor: default; }
  @media (prefers-reduced-motion: reduce) {
    .cop-input-send { transition: background-color var(--duration-basic) ease, opacity var(--duration-basic) ease; }
    .cop-send-arrow, .cop-send-stop { scale: 1; }
  }

  /* Sections dépliables du menu du « + » : en-tête cliquable, corps indenté. */
  .cop-sec {
    width: 100%; min-height: var(--control-md); display: flex; align-items: center; gap: 10px; padding: 4px 8px 4px 6px;
    border: 0; border-radius: var(--radius-md); background: transparent; color: var(--ink);
    font-family: var(--font-sans); text-align: left; cursor: pointer;
    transition: background-color var(--duration-basic) ease;
  }
  .cop-sec:hover, .cop-sec:focus-visible { background: var(--menu-row-hover); }
  .cop-sec:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: -2px; }
  .cop-sec-ic {
    width: var(--control-sm); height: var(--control-sm); flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center;
    border-radius: var(--radius-md); background: var(--accent-soft); color: var(--ink-3);
    transition: background-color var(--duration-basic) ease, color var(--duration-basic) ease;
  }
  .cop-sec.open .cop-sec-ic { background: var(--line-1); color: var(--ink); }
  .cop-sec-ic .icon { font-size: 15px; }
  .cop-sec-copy { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
  .cop-sec-copy strong { font: var(--weight-control) var(--text-sm)/18px var(--font-sans); }
  .cop-sec-copy small {
    font: var(--weight-regular) var(--text-xs)/14px var(--font-sans); color: var(--ink-3);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .cop-sec-chev {
    flex: 0 0 auto; font-size: 14px; color: var(--ink-4);
    transition: transform var(--duration-basic) var(--ease-enter-snappy);
  }
  .cop-sec.open .cop-sec-chev { transform: rotate(180deg); }
  .cop-sec-body { padding: 0 0 4px 8px; }
  /* Pastille du livrable armé, dans la barre d'outils : bouton de composeur Kube (28 px,
     croix de 20 px). */
  .cop-mode-pill {
    display: inline-flex; align-items: center; gap: 4px; height: var(--control-sm); padding: 0 4px 0 10px;
    border-radius: var(--radius-full); background: var(--ink); color: var(--cream-content);
    font: var(--weight-control) var(--text-sm) var(--font-sans); white-space: nowrap;
    transform-origin: left center;
    animation: doku-pop-in var(--duration-basic) var(--ease-enter-snappy);
  }
  /* Choix au clavier (menu « / », Entrée dans le menu Outils) : pas d'entrée animée. */
  .cop-mode-pill.kbd { animation: none; }
  .cop-mode-pill > .icon { font-size: 14px; }
  .cop-mode-pill button {
    width: 20px; height: 20px; display: inline-flex; align-items: center; justify-content: center;
    border: 0; border-radius: var(--radius-full); background: transparent; color: inherit; cursor: pointer; opacity: 0.7;
    transition: opacity var(--duration-basic) ease, background-color var(--duration-basic) ease, transform var(--duration-basic) var(--ease-enter-snappy);
  }
  .cop-mode-pill button:active { transform: scale(0.97); }
  .cop-mode-pill button:hover { opacity: 1; background: color-mix(in srgb, var(--cream-content) 16%, transparent); }
  .cop-mode-pill button:focus-visible { opacity: 1; outline: 2px solid var(--cream-content); outline-offset: 0; }
  .cop-mode-pill button .icon { font-size: 12px; }
  .cop-think-toggle {
    flex: 0 0 auto; display: inline-flex; align-items: center; gap: 4px; height: var(--control-sm); padding: 0 10px 0 8px;
    border: 0; border-radius: var(--radius-full); background: transparent; color: var(--ink-3);
    box-shadow: inset 0 0 0 1px var(--line-2);
    font: var(--weight-control) var(--text-xs) var(--font-sans); white-space: nowrap; cursor: pointer;
    transition: background-color var(--duration-basic) ease, color var(--duration-basic) ease, box-shadow var(--duration-basic) ease, transform var(--duration-basic) var(--ease-enter-snappy);
  }
  .cop-think-toggle:not([aria-disabled='true']):active { transform: scale(0.97); }
  .cop-think-toggle .icon { font-size: 14px; }
  .cop-think-toggle:hover:not([aria-disabled='true']) { background: var(--fill-hover); color: var(--ink); box-shadow: inset 0 0 0 1px var(--line-3); }
  .cop-think-toggle.on { background: var(--ink); color: var(--cream-content); box-shadow: none; }
  .cop-think-toggle.on:hover:not([aria-disabled='true']) { background: var(--ink-2); color: var(--cream-content); box-shadow: none; }
  .cop-think-toggle[aria-disabled='true'] { cursor: default; opacity: var(--opacity-disabled); }
  /* .cop-compose-options coupe ce qui déborde : l'anneau se dessine à l'intérieur. */
  .cop-think-toggle:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: -2px; }
  .cop-target-pill { min-width: 0; }
  .cop-target-text { min-width: 0; max-width: 160px; overflow: hidden; text-overflow: ellipsis; }
  .cop-compose-options {
    flex: 0 1 auto;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 4px;
    overflow: hidden;
  }
  .cop-compose-options:empty { display: none; }
  /* Barre responsive (Kube Composer, libellés `data-collapse`) : l'extrait de la cible part
     d'abord, puis les libellés courts, puis le nom du modèle (le point d'état reste). Les noms
     accessibles restent (aria-label, title). */
  @container cop-composer (max-width: 440px) {
    .cop-target-text { display: none; }
    .cop-target-pill { padding-left: 8px; }
  }
  @container cop-composer (max-width: 330px) {
    .cop-think-label,
    .cop-mode-label { display: none; }
    .cop-think-toggle { padding: 0 7px; }
    .cop-mode-pill { padding-left: 8px; }
  }
  @container cop-composer (max-width: 230px) {
    .cop-model-name { display: none; }
    .cop-input-send[aria-busy='true'] { width: var(--control-md); }
    .cop-send-stop-label { display: none; }
  }
  /* Curseur à 3 crans (essai façon « effort ») : piste pleine jusqu'au pouce, ticks.
     Pas d'en-tête : le libellé courant sous le curseur dit déjà tout. */
  .cop-verb-sliderwrap { position: relative; padding: 6px 4px 2px; }
  .cop-verb-ticks {
    position: absolute; inset: 6px 17px 2px; display: flex; align-items: center; justify-content: space-between;
    pointer-events: none;
  }
  .cop-verb-ticks span { width: 4px; height: 4px; border-radius: 50%; background: var(--line-2); }
  /* Sous le remplissage (fond = ink) : ton inverse translucide, lisible dans les 2 thèmes. */
  .cop-verb-ticks span.lit { background: var(--cream-content); opacity: 0.7; }
  .cop-verb-ticks span.under-thumb { opacity: 0; }
  .cop-verb-slider {
    -webkit-appearance: none; appearance: none; display: block; width: 100%; height: 26px;
    margin: 0; background: transparent; cursor: pointer;
  }
  .cop-verb-slider:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 3px; border-radius: var(--radius-full); }
  .cop-verb-slider::-webkit-slider-runnable-track {
    height: 18px; border-radius: var(--radius-full);
    background: linear-gradient(to right, var(--ink) 0 var(--fill), var(--surface-2) var(--fill) 100%);
    /* Liseré intérieur : l'étendue TOTALE de la course reste lisible même à vide. */
    box-shadow: inset 0 0 0 1px var(--line-1);
  }
  /* Même pouce que le contrôle segmenté (`--track-thumb`), ombre de la palette. */
  .cop-verb-slider::-webkit-slider-thumb {
    -webkit-appearance: none; appearance: none;
    width: 24px; height: 24px; margin-top: -3px; border: 0; border-radius: 50%;
    background: var(--track-thumb);
    box-shadow: var(--shadow-lg);
  }
  .cop-disclaimer { text-align: center; font-size: var(--text-2xs); line-height: 1.35; color: var(--ink-4); margin-top: 8px; text-wrap: balance; }

  /* Largeur posée en ligne depuis ADD_MENU_W (source unique avec le bornage), origine de
     l'échelle posée sur le « + ». */
  .cop-add-context-menu {
    position: absolute; z-index: var(--z-popover); padding: 4px;
    border-radius: var(--radius-xl); background: var(--glass-bg);
    -webkit-backdrop-filter: var(--glass-filter); backdrop-filter: var(--glass-filter);
    box-shadow: var(--glass-shadow);
    transform-origin: bottom left;
    animation: doku-pop-in var(--duration-basic) var(--ease-enter-snappy);
  }
  .cop-add-context-action {
    width: 100%; min-height: var(--control-md); display: flex; align-items: center; gap: 10px; padding: 4px 8px 4px 6px;
    border: 0; border-radius: var(--radius-md); background: transparent; color: var(--ink); text-align: left; cursor: pointer;
    transition: background-color var(--duration-basic) ease;
  }
  .cop-add-context-action:hover, .cop-add-context-action:focus-visible { background: var(--menu-row-hover); }
  .cop-add-context-action:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: -2px; }
  .cop-add-context-action.active { background: var(--accent-soft); }
  .cop-add-context-action:disabled { opacity: var(--opacity-disabled); cursor: default; background: transparent; }
  /* Tuile sans wrapper : le padding du <svg> ramène le tracé à 15 px dans 28 px. */
  .cop-add-context-action > .icon {
    width: var(--control-sm); height: var(--control-sm); flex: 0 0 auto; padding: 6.5px;
    border-radius: var(--radius-md); background: var(--accent-soft); color: var(--ink-3);
  }
  .cop-add-context-action > span:nth-child(2) { min-width: 0; display: flex; flex: 1; flex-direction: column; gap: 1px; }
  .cop-add-context-action > .cop-add-context-check {
    width: 15px; height: 15px; padding: 0; margin-left: auto; background: transparent; color: var(--ink-3);
  }
  .cop-add-context-action strong { font: var(--weight-control) var(--text-sm)/18px var(--font-sans); }
  .cop-add-context-action small { font: var(--weight-regular) var(--text-xs)/14px var(--font-sans); color: var(--ink-3); }
  .cop-hidden-file { display: none; }

  .cop-md :global(.cop-web-cite) {
    min-width: 18px; height: 18px; margin: 0 2px; padding: 0 5px; border: 0; border-radius: var(--radius-full);
    background: var(--accent-soft); color: var(--ink-2); font: var(--weight-strong) var(--text-2xs) var(--font-sans); font-variant-numeric: tabular-nums;
    cursor: pointer; vertical-align: 0.08em;
    transition: background-color var(--duration-basic) ease, color var(--duration-basic) ease, transform var(--duration-basic) var(--ease-enter-snappy);
  }
  .cop-md :global(.cop-web-cite:active) { transform: scale(0.97); }
  .cop-md :global(.cop-web-cite:hover) { background: var(--line-1); color: var(--ink); }
  .cop-md :global(.cop-web-cite:focus-visible) { outline: 2px solid var(--focus-ring); outline-offset: 1px; }
  /* Puces de citation [n] inline (21.x) — injectées via {@html} après sanitize. */
  .cop-md :global(.cop-cite) {
    display: inline-flex; align-items: center; justify-content: center;
    /* Gabarit en `em` de SA propre taille : la puce grandit avec le texte qu'elle ponctue.
       Les facteurs sont les valeurs d'origine rapportées à ses 10 px (16/10, 15/10, …). */
    min-width: 1.6em; height: 1.5em; margin: 0 0.2em; padding: 0 0.4em; border: 0; border-radius: 0.5em;
    background: var(--accent-soft); color: var(--ink-3);
    font-family: var(--font-sans); font-size: 0.74em; font-weight: var(--weight-strong); line-height: 1;
    font-variant-numeric: tabular-nums;
    vertical-align: 0.2em; cursor: pointer;
    transition: background-color var(--duration-basic) ease, color var(--duration-basic) ease, transform var(--duration-basic) var(--ease-enter-snappy);
  }
  .cop-md :global(.cop-cite:hover) { background: var(--ink); color: var(--cream-content); }
  .cop-md :global(.cop-cite:active) { transform: scale(0.97); }
  .cop-md :global(.cop-cite:focus-visible) { outline: 2px solid var(--focus-ring); outline-offset: 2px; }

  /* Carte de survol (aperçu de citation, info-bulle Réfléchir) : couche supérieure
     (`popover`), placée en JS par placeHoverCard, elle grandit depuis son déclencheur.
     La largeur ne vit qu'ici (la carte est mesurée une fois montée). pointer-events: none :
     elle ne vole jamais la souris, aucun piège de survol possible. */
  .cop-hover-card {
    position: fixed;
    z-index: var(--z-overlay);
    inset: auto;
    width: min(300px, calc(100vw - 16px));
    margin: 0;
    padding: 12px 12px 10px;
    overflow: hidden;
    border: 0;
    border-radius: var(--radius-xl);
    background: var(--glass-bg);
    -webkit-backdrop-filter: var(--glass-filter);
    backdrop-filter: var(--glass-filter);
    color: var(--ink);
    box-shadow: var(--glass-shadow);
    pointer-events: none;
    animation: doku-pop-in var(--duration-basic) var(--ease-enter-snappy);
  }
  .cop-hover-card.cop-think-tip { width: min(260px, calc(100vw - 16px)); }
  .cop-hover-card-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
  .cop-think-tip .cop-hover-card-head .icon { font-size: 14px; color: var(--ink-3); }
  /* Numéro du passage : même lavis que la puce [n] qu'il prolonge. */
  .cop-source-num {
    display: inline-flex; flex: none; align-items: center; justify-content: center;
    min-width: 18px; height: 18px; padding: 0 5px; border-radius: var(--radius-sm);
    background: var(--accent-soft); color: var(--ink-2);
    font: var(--weight-strong) var(--text-2xs) / 1 var(--font-sans); font-variant-numeric: tabular-nums;
  }
  .cop-hover-card-name {
    overflow: hidden; font-size: var(--text-xs); font-weight: var(--weight-strong); color: var(--ink-2);
    white-space: nowrap; text-overflow: ellipsis;
  }
  .cop-hover-card-text {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 7;
    line-clamp: 7;
    overflow: hidden;
    margin: 0;
    font-size: var(--text-sm);
    line-height: 1.55;
    color: var(--ink-2);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .cop-hover-card-hint {
    margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--line-1);
    font-size: var(--text-xs); color: var(--ink-3);
  }

  /* Doigt : tout changement VISIBLE se pose sous `data-input='touch'` (dernier pointerdown
     au doigt ou au stylet, main.ts). `(any-pointer: coarse)` reste vrai à la souris sur la
     Surface : n'y vivent que des zones de clic invisibles qui ne chevauchent aucun voisin. */
  :global(:root[data-input='touch']) .cop-copy { width: 40px; height: 40px; }
  /* Actions révélées au survol : toujours visibles là où le doigt vise. */
  :global(:root[data-input='touch']) .cop-row .cop-del,
  :global(:root[data-input='touch']) .cop-memory-item .cop-memory-item-head button { opacity: 1; }
  :global(:root[data-input='touch']) .cop-picker-sec,
  :global(:root[data-input='touch']) .cop-picker-opt { min-height: 40px; }
  :global(:root[data-input='touch']) .cop-ic,
  :global(:root[data-input='touch']) .cop-del,
  :global(:root[data-input='touch']) .cop-dismiss,
  :global(:root[data-input='touch']) .cop-memory-item-head button,
  :global(:root[data-input='touch']) .cop-memory-toast button.icon { width: 40px; height: 40px; }
  /* Composeur, tiroir, tray et menus au doigt (`:where` : la cascade reste celle du fichier). */
  :global(:where(:root[data-input='touch'])) .cop-input-attach,
  :global(:where(:root[data-input='touch'])) .cop-input-send,
  :global(:where(:root[data-input='touch'])) .cop-drawer-btn { width: 40px; height: 40px; }
  /* Boutons de 40 + retrait de 8 : rayon du composeur concentrique (40 / 2 + 8). */
  :global(:where(:root[data-input='touch'])) .cop-composer { --radius-composer: 28px; }
  :global(:where(:root[data-input='touch'])) .cop-model-cap,
  :global(:where(:root[data-input='touch'])) .cop-ctx-chip,
  :global(:where(:root[data-input='touch'])) .cop-ctx-add { height: 32px; }
  :global(:where(:root[data-input='touch'])) .cop-ctx-add { width: 32px; }
  :global(:where(:root[data-input='touch'])) .cop-context-row,
  :global(:where(:root[data-input='touch'])) .cop-tray-option,
  :global(:where(:root[data-input='touch'])) .cop-sec,
  :global(:where(:root[data-input='touch'])) .cop-add-context-action,
  :global(:where(:root[data-input='touch'])) .cop-identity-menu > button { min-height: 40px; }
  :global(:where(:root[data-input='touch'])) .cop-think-toggle { height: 40px; padding: 0 14px 0 12px; }
  /* Pastille à la hauteur du pied (40), croix de 28 centrée à 6 px du bord : concentrique. */
  :global(:where(:root[data-input='touch'])) .cop-mode-pill { height: 40px; padding: 0 6px 0 14px; }
  :global(:where(:root[data-input='touch'])) .cop-mode-pill button { width: 28px; height: 28px; }
  /* Les variantes étroites du pied, redites après les tailles au doigt qu'elles affinent. */
  @container cop-composer (max-width: 440px) {
    :global(:where(:root[data-input='touch'])) .cop-target-pill { padding-left: 10px; }
  }
  @container cop-composer (max-width: 330px) {
    :global(:where(:root[data-input='touch'])) .cop-mode-pill { padding-left: 10px; }
    :global(:where(:root[data-input='touch'])) .cop-think-toggle { padding: 0 12px; }
  }
  /* Poignée plus large au doigt, mais sous la barre de titre : l'identité reste touchable. */
  :global(:root[data-input='touch']) .cop-resize { width: 20px; top: 56px; }
  :global(:root[data-input='touch']) .cop-resize::after { top: 0; }

  @media (any-pointer: coarse) {
    /* 24 + 2 × 8 = 40 : l'extension s'arrête aux bords intérieurs de l'encart d'erreur
       (padding 8/10, bouton calé en haut), le texte voisin n'est pas interactif. */
    .cop-memory-error button { position: relative; }
    .cop-memory-error button::after { content: ''; position: absolute; inset: -8px; }
    /* Puces de citation : élargies de leur seule marge, donc bord à bord avec une voisine
       sans la chevaucher ; rien en vertical (à 12,5 px l'interligne laisse < 3 px entre
       deux puces superposées). */
    .cop-md :global(.cop-cite),
    .cop-md :global(.cop-web-cite) { position: relative; }
    .cop-md :global(.cop-cite)::after { content: ''; position: absolute; inset: 0 -0.2em; }
    .cop-md :global(.cop-web-cite)::after { content: ''; position: absolute; inset: 0 -2px; }
  }

  /* Panneau fermé (visibility: hidden) : les boucles tournaient encore et recalculaient
     le style à chaque image. Le filet de vie du toast n'en fait pas partie : il mesure
     un vrai compte à rebours. */
  .cop-panel:not(.open) .cop-spinner,
  .cop-panel:not(.open) .cop-state-dot,
  .cop-panel:not(.open) .cop-shimmer-mask,
  .cop-panel:not(.open) .cop-shimmer-text,
  .cop-panel:not(.open) .cop-md-plain.streaming::after,
  .cop-panel:not(.open) .doku-skel::after,
  .cop-panel:not(.open) .cop-dot.breathe,
  .cop-panel:not(.open) .orbit,
  .cop-panel:not(.open) .cop-memory-sync span,
  .cop-panel:not(.open) .cop-auth-pending > span { animation-play-state: paused; }
</style>
