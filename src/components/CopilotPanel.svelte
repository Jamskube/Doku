<script lang="ts">
  import { tick, untrack } from 'svelte'
  import { activeTab, app, editorSel, isCloudProvider, openPath, type CopilotProvider } from '../lib/stores.svelte'
  import { closeWindow, fileSizeAt, isTauri, minimizeWindow, openContextFilesDialog, openFolderDialog, readFileBytes, readTextFileAt, toggleMaximizeWindow } from '../lib/tauri'
  import { formatBytes } from '../lib/ollama'
  import { addCopilotContext, beginOpenAiAuth, cancelOpenAiConnection, cancelPull, connectMinimax, copilot, disconnectMinimaxKey, disconnectOpenAiAccount, ensureCopilotReady, isEmbedModel, jumpToCitation, newChat as clearChat, pullModel, refreshMinimaxStatus, refreshModels, refreshOpenAiStatus, removeCopilotContext, removeModel, retryGeneration, saveMessageAsNote, sendChat, setActiveModel, setCopilotContextFolder, setCopilotMemoryFolder, setCopilotProvider, stopChat, summarizeDoc, type ChatMsg } from '../lib/copilot.svelte'
  import { MINIMAX_DEFAULT_MODEL } from '../lib/compat'
  import { DEFAULT_EMBED_MODEL, FALLBACK_EMBED_MODEL, noteTitle } from '../lib/rag'
  import { cancelRagIndexing, deleteRagIndex, ragState, refreshRagIndex } from '../lib/rag-index.svelte'
  import { baseName, parentPath } from '../lib/explorer'
  import { MAX_DOC_CHARS, MAX_DOC_CHARS_CLOUD, type SummaryMode } from '../lib/copilot-service'
  import { openOpenAiAuthPage, OPENAI_MODEL } from '../lib/openai'
  import { renderChatMarkdown } from '../lib/export/render-md'
  import { annotateCitations, type CitedPassage } from '../lib/citations'
  import { cleanContextLabel, contextItemId, MAX_CONTEXT_ITEMS, MAX_CONTEXT_LOAD_CONCURRENCY, MAX_CONTEXT_PDF_BYTES, MAX_CONTEXT_TEXT_BYTES, pathBelongsToFolder, truncateContextItem, type CopilotContextItem } from '../lib/copilot-context'
  import { cloudMemory, deleteCloudMemoryRecord, loadCloudMemory, memoryWorkspace, undoCloudMemory, updateCloudMemoryRecord, type MemoryWorkspace } from '../lib/copilot-memory.svelte'
  import type { CloudMemoryProvider, MemoryRecord, MemoryType } from '../lib/copilot-memory'

  // Rendu d'une réponse : Markdown assaini PUIS puces de citation (l'annotation opère
  // après DOMPurify — seul notre markup de puce est injecté). Sans sources (petit doc,
  // refus honnête), les marqueurs [n] éventuels sont retirés (count = 0).
  function renderAnswer(m: ChatMsg): string {
    return annotateCitations(renderChatMarkdown(m.content), m.sources?.length ?? 0)
  }

  // Clic délégué sur les puces [n] injectées via {@html} (pas de handlers Svelte dedans).
  function onAnswerClick(e: MouseEvent, m: ChatMsg) {
    const chip = (e.target as HTMLElement).closest?.('.cop-cite')
    if (!chip) return
    dismissCitePreview()
    const n = Number.parseInt(chip.getAttribute('data-cite') ?? '', 10)
    const passage = m.sources?.find((s) => s.n === n)
    if (passage) void revealCitation(passage)
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
  let citePreview = $state<{ n: number; name: string | null; text: string; x: number; y: number; below: boolean } | null>(null)
  let citePreviewTimer: ReturnType<typeof setTimeout> | undefined

  function showCitePreview(chip: HTMLElement, m: ChatMsg) {
    const n = Number.parseInt(chip.getAttribute('data-cite') ?? '', 10)
    const passage = m.sources?.find((s) => s.n === n)
    if (!passage || !panelEl || !chip.isConnected) return
    const r = chip.getBoundingClientRect()
    const a = panelEl.getBoundingClientRect()
    // contain: layout paint sur .cop-panel = bloc conteneur ET boîte de clip : la carte
    // se positionne en absolu RELATIF au panneau, x serré pour rester dedans.
    const half = 150
    const x = Math.min(Math.max(r.left + r.width / 2 - a.left, half + 8), a.width - half - 8)
    const below = r.top - a.top < 240
    citePreview = {
      n,
      name: passage.name,
      text: passage.text,
      x,
      y: below ? r.bottom - a.top + 7 : r.top - a.top - 7,
      below,
    }
  }
  function onAnswerCiteOver(e: Event, m: ChatMsg) {
    const chip = (e.target as HTMLElement).closest?.('.cop-cite') as HTMLElement | null
    if (!chip) return
    clearTimeout(citePreviewTimer)
    citePreviewTimer = setTimeout(() => showCitePreview(chip, m), 160)
  }
  function onAnswerCiteOut(e: Event) {
    if (!(e.target as HTMLElement).closest?.('.cop-cite')) return
    dismissCitePreview()
  }
  function dismissCitePreview() {
    clearTimeout(citePreviewTimer)
    if (citePreview) citePreview = null
  }

  // Modèle conseillé (carte d'onboarding) + suggestions. Toujours des tags -q4_0 explicites
  // (repacking ARM). Dans l'onboarding, le conseillé est déjà en carte → chips sans lui.
  const RECO_MODEL = 'qwen2.5:1.5b-instruct-q4_0'
  const SUGGESTIONS = [RECO_MODEL, 'qwen2.5:3b-instruct-q4_0', 'hf.co/LiquidAI/LFM2-2.6B-GGUF:Q4_0']
  const ALT_SUGGESTIONS = SUGGESTIONS.filter((s) => s !== RECO_MODEL)
  // Chips de la bibliothèque : masquer les modèles déjà installés (cliquer re-téléchargerait).
  const installableSuggestions = $derived(
    SUGGESTIONS.filter((s) => !copilot.models.some((m) => m.name === s || m.name === `${s}:latest`)),
  )

  // Vue Modèles : liste à l'ouverture (intention explicite). L'effet ne track QUE la vue —
  // `refreshModels` (lit ET écrit copilot.*) est `untrack`é pour ne pas s'auto-re-déclencher.
  // La vue « chat » ne démarre JAMAIS le moteur (coquille statique) → aucun spawn au boot.
  let pullName = $state('')
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
  // les onglets. Matériau flottant volontairement LOCAL : sémantique listbox (choix d'une
  // valeur) ≠ menus TitleBar/Sidebar (commandes) — l'extraction d'un matériau partagé
  // reste une dette notée, pas aggravée à l'aveugle ici.
  let pickerOpen = $state(false)
  let pickerRootEl = $state<HTMLElement | null>(null)
  let pickerTriggerEl = $state<HTMLButtonElement | null>(null)
  let pickerListEl = $state<HTMLElement | null>(null)

  // Les modèles d'embedding restent gérables dans BIBLIOTHÈQUE mais ne sont jamais
  // proposés comme modèle de chat (même prédicat que l'auto-activation post-pull).
  const chatModels = $derived(copilot.models.filter((m) => !isEmbedModel(m.name)))

  // « jamais de fonctionnalité qui ment » : le trigger et les en-têtes de groupe reprennent
  // la MÊME machine d'états que les cartes fournisseur (checking / connecté / Luna
  // indisponible / clé refusée / à connecter), jamais un binaire connecté-ou-pas.
  type PickerState = { label: string; kind: 'ok' | 'warn' | 'off' | 'busy' }
  const openAiState = $derived.by((): PickerState => {
    if (copilot.openAiChecking) return { label: 'vérification…', kind: 'busy' }
    if (copilot.openAiAuthenticated && copilot.openAiPreferredAvailable === false)
      return { label: 'Luna indisponible', kind: 'warn' }
    if (copilot.openAiAuthenticated) return { label: 'connecté', kind: 'ok' }
    return { label: 'à connecter', kind: 'off' }
  })
  const minimaxState = $derived.by((): PickerState => {
    if (copilot.minimaxChecking || copilot.minimaxConnecting) return { label: 'vérification…', kind: 'busy' }
    if (copilot.minimaxStatus?.keyRejected) return { label: 'clé refusée', kind: 'warn' }
    if (copilot.minimaxStatus?.connected) return { label: 'connecté', kind: 'ok' }
    return { label: 'à connecter', kind: 'off' }
  })
  // Un modèle actif supprimé hors app (CLI ollama) laisserait le trigger afficher un
  // fantôme — signalé seulement quand la liste a réellement été lue (modelsLoaded),
  // jamais sur une liste vide parce que le moteur n'a pas démarré.
  const localModelMissing = $derived(
    !!app.activeModel && copilot.modelsLoaded && !copilot.models.some((m) => m.name === app.activeModel),
  )
  // Repli identique à resolveRuntime : un statut connecté avec catalogue vide (erreur
  // partielle) propose quand même la valeur qui répondrait réellement aux questions.
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
  function pickOpenAi() {
    setCopilotProvider('openai')
    closePicker(true)
  }
  function pickMinimax(model: string) {
    app.minimaxModel = model
    setCopilotProvider('minimax')
    closePicker(true)
  }
  function pickManageLocal() {
    setCopilotProvider('ollama')
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

  function startPull(name?: string) {
    const model = (name ?? pullName).trim()
    if (!model) return
    pullName = ''
    void pullModel(model)
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
  const EMBED_CHOICES = [DEFAULT_EMBED_MODEL, FALLBACK_EMBED_MODEL]
  const ragDir = $derived(copilot.contextFolder?.path ?? app.explorerDir ?? parentPath(activeTab()?.path ?? null))
  // '' = réglage effacé (modèle supprimé du disque) : on repropose le défaut.
  const embedModelName = $derived(app.embedModel || DEFAULT_EMBED_MODEL)
  const embedInstalled = $derived(copilot.models.some((m) => m.name === embedModelName || m.name === `${embedModelName}:latest`))
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
    if (copilot.models.some((m) => m.name === name || m.name === `${name}:latest`)) await indexFolder()
  }

  // --- Portée des questions (15.3) : document courant ou dossier entier ---
  // Le mode « document entier (index) » n'existe qu'en local : un utilisateur OpenAI
  // garde la troncature 14.3 (pas de spawn du sidecar en douce) — badge et comportement
  // lisent le MÊME prédicat (copilot.models).
  const docIndexAvailable = $derived(app.copilotProvider === 'ollama' && embedInstalled)
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
  let composerFace = $state<'question' | 'context'>('question')
  let atBottom = true // ne pas voler le scroll si l'utilisateur est remonté relire

  const numberFormatter = new Intl.NumberFormat('fr-FR')

  // Budget de contexte du fournisseur COURANT (21.x) : 12k local (num_ctx), 240k cloud.
  // Badge et comportement (prepareDocMessages) lisent le MÊME prédicat isCloudProvider.
  const docBudget = $derived(isCloudProvider(app.copilotProvider) ? MAX_DOC_CHARS_CLOUD : MAX_DOC_CHARS)

  // Doc courant tronqué en Q&A (14.3) : signal DÉTERMINISTE à l'utilisateur (ne dépend pas du
  // modèle) — un « je ne trouve pas » peut alors venir de la partie non lue, pas d'une absence.
  const docTruncated = $derived.by(() => {
    const t = activeTab()
    return !!t && t.kind !== 'pdf' && t.content.length > docBudget
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
    const readableChars = Math.min(t.content.length, docBudget)
    return {
      count: 1,
      name: t.name,
      // « Document entier (index) » (15.3) : le doc dépasse la fenêtre mais l'index
      // éphémère le couvre EN ENTIER — le badge d'avertissement 14.3 ne reste que
      // lorsqu'aucun modèle d'embedding local n'est disponible. La méta suit : afficher
      // « 12 000 caractères transmis » à côté de « Document entier » serait contradictoire.
      meta:
        docTruncated && docIndexAvailable
          ? `${format} · ${numberFormatter.format(t.content.length)} caractères couverts par l'index`
          : `${format} · ${numberFormatter.format(readableChars)} caractères transmis`,
      state: docTruncated ? (docIndexAvailable ? 'Document entier (index)' : 'Lecture partielle') : 'Document entier',
    }
  })
  const contextCount = $derived((copilot.scope === 'folder' ? (ragDir ? 1 : 0) : contextDetails.count) + copilot.contextItems.length)
  const contextSummary = $derived(
    copilot.scope === 'folder'
      ? `${ragDir ? '1 dossier' : 'Aucun dossier'}${copilot.contextItems.length ? ` + ${copilot.contextItems.length}` : ''}`
      : `${contextCount} source${contextCount === 1 ? '' : 's'}`,
  )
  const cloudDestination = $derived(
    app.copilotProvider === 'openai' ? 'OpenAI' : app.copilotProvider === 'minimax' ? 'MiniMax' : null,
  )
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

  function showComposerFace(face: 'question' | 'context', focus = false) {
    composerFace = face
    if (!focus) return
    requestAnimationFrame(() => {
      if (face === 'question') promptEl?.focus()
      else document.getElementById('cop-context-tab')?.focus()
    })
  }

  function startNewChat() {
    clearChat()
    draft = ''
    composerFace = 'question'
    verbMenuOpen = false
    requestAnimationFrame(() => promptEl?.focus())
  }

  function onComposerTabKey(e: KeyboardEvent, face: 'question' | 'context') {
    const switchKey = e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight'
    if (switchKey) {
      e.preventDefault()
      const next = face === 'question' ? 'context' : 'question'
      composerFace = next
      requestAnimationFrame(() => document.getElementById(next === 'question' ? 'cop-question-tab' : 'cop-context-tab')?.focus())
    } else if (e.key === 'Escape' && face === 'context') {
      e.preventDefault()
      showComposerFace('question', true)
    }
  }

  function onAdvancedSummaryKey(e: KeyboardEvent) {
    if (e.key !== 'Enter' && e.key !== ' ') return
    e.preventDefault()
    const details = (e.currentTarget as HTMLElement).parentElement as HTMLDetailsElement | null
    if (details) details.open = !details.open
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

  // --- Ajouter du contexte -------------------------------------------------------------
  // Le pop vit à la racine de .cop-panel (contain: layout paint), comme les autres surfaces
  // flottantes. Les lectures sont bornées AVANT chargement et limitées à deux en parallèle.
  let addMenuOpen = $state(false)
  let addMenuEl = $state<HTMLElement | null>(null)
  let addButtonEl = $state<HTMLButtonElement | null>(null)
  let browserFilesEl = $state<HTMLInputElement | null>(null)
  let browserFolderEl = $state<HTMLInputElement | null>(null)
  let contextLoading = $state(false)
  let addMenuPos = $state<{ left: number; bottom: number } | null>(null)
  const ADD_MENU_W = 276
  const selectionAvailable = $derived(!!editorSel.text.trim() && activeTab()?.kind !== 'pdf')

  function closeAddMenu(restoreFocus = false) {
    addMenuOpen = false
    if (restoreFocus) addButtonEl?.focus()
  }

  function toggleAddMenu() {
    addMenuOpen = !addMenuOpen
    copilot.contextError = ''
    if (!addMenuOpen || !addButtonEl || !panelEl) return
    const r = addButtonEl.getBoundingClientRect()
    const a = panelEl.getBoundingClientRect()
    const left = Math.min(Math.max(Math.round(r.left - a.left), 8), Math.round(a.width - ADD_MENU_W - 8))
    addMenuPos = { left, bottom: Math.round(a.bottom - r.top) + 8 }
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
    const options = Array.from(addMenuEl?.querySelectorAll<HTMLButtonElement>('.cop-add-context-action:not(:disabled)') ?? [])
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

  function contextItem(kind: CopilotContextItem['kind'], label: string, text: string, path?: string | null, signature?: string): CopilotContextItem | null {
    if (!text.trim()) return null
    const bounded = truncateContextItem(text)
    const owner = activeTab()?.path ?? activeTab()?.id
    const id = contextItemId({ kind, path, owner: owner == null ? null : String(owner), from: editorSel.from, to: editorSel.to, text: bounded.text })
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
    const item = contextItem('selection', `Sélection · ${tab?.name ?? 'document'}`, editorSel.text)
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
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  // Style des réponses (verbosité) : puce compacte DANS la rangée de saisie — clic =
  // petit menu vers le haut (même famille que le sélecteur de modèle des chats connus).
  const VERBOSITY_CHOICES = [
    { value: 'brief', label: 'Bref', hint: "Droit à l'essentiel", icon: 'short_text' },
    { value: 'balanced', label: 'Équilibré', hint: 'Longueur naturelle', icon: 'subject' },
    { value: 'detailed', label: 'Détaillé', hint: 'Développé et structuré', icon: 'notes' },
  ] as const
  const verbosityLabel = $derived(VERBOSITY_CHOICES.find((c) => c.value === app.copilotVerbosity)?.label ?? 'Équilibré')
  let verbMenuOpen = $state(false)
  let verbMenuRootEl = $state<HTMLElement | null>(null)
  let verbMenuEl = $state<HTMLElement | null>(null)
  let verbChipEl = $state<HTMLButtonElement | null>(null)
  // Position du menu dans le repère du PANNEAU (contain: layout = bloc conteneur du
  // fixed) : en absolu il serait clippé par les overflow du composer (vécu — seule la
  // dernière entrée émergeait) ; en fixed, les clips intermédiaires ne s'appliquent pas.
  let verbMenuPos = $state<{ left: number; bottom: number } | null>(null)
  const VERB_MENU_W = 216

  function toggleVerbMenu() {
    verbMenuOpen = !verbMenuOpen
    if (verbMenuOpen && verbChipEl && panelEl) {
      const r = verbChipEl.getBoundingClientRect()
      const a = panelEl.getBoundingClientRect()
      // Ancré au bord gauche du chip, serré dans le panneau (contain: paint clippe à ses bords).
      const left = Math.min(Math.max(Math.round(r.left - a.left), 8), Math.round(a.width - VERB_MENU_W - 8))
      verbMenuPos = { left, bottom: Math.round(a.bottom - r.top) + 8 }
      // Le curseur prend le focus : flèches immédiatement opérantes au clavier.
      void tick().then(() => verbMenuEl?.querySelector<HTMLInputElement>('.cop-verb-slider')?.focus())
    }
  }

  // Les flèches restent au <input type="range"> (gauche/droite ET haut/bas natifs) —
  // seuls Échap et Tab ferment.
  function onVerbMenuKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      verbMenuOpen = false
      verbChipEl?.focus()
    } else if (e.key === 'Tab') {
      verbMenuOpen = false
    }
  }
  // Fermeture au clic extérieur : partagée avec le dropdown Modèle (un seul svelte:window).
  function onGlobalPointerDown(e: PointerEvent) {
    const t = e.target as Node | null
    if (pickerOpen && !pickerRootEl?.contains(t)) pickerOpen = false
    // Le menu vit hors du root du chip (racine du panneau) : les deux comptent comme « dedans ».
    if (verbMenuOpen && !verbMenuRootEl?.contains(t) && !verbMenuEl?.contains(t)) verbMenuOpen = false
    if (addMenuOpen && !addButtonEl?.contains(t) && !addMenuEl?.contains(t)) addMenuOpen = false
  }

  // Actions rapides de la vue vide — trois LIVRABLES distincts du même pipeline de résumé
  // (14.2, citations single-fenêtre) : prose, points clés, actions à faire. Pas d'action
  // « Poser une question » : le composer est juste en dessous, elle ne faisait que le focus.
  function quickAction(mode: SummaryMode) {
    const t = activeTab()
    void summarizeDoc({ name: t?.name ?? null, text: t?.content ?? '', kind: t?.kind ?? 'md', path: t?.path ?? null }, mode)
  }

  async function copyMessage(text: string) {
    try {
      await navigator.clipboard.writeText(text)
    } catch (e) {
      console.error('[copilot] copy', e)
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

  function onScroll() {
    if (scroller) atBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 40
    // Un aperçu de citation OUVERT devient mensonger au scroll (position figée) → fermé.
    // Le timer d'ouverture en attente survit : il lira la position FRAÎCHE de la puce au
    // moment d'afficher (sinon l'inertie d'un trackpad avale l'aperçu à chaque fois).
    if (citePreview) citePreview = null
  }

  // Suit le bas pendant le streaming, mais seulement si l'utilisateur y était déjà.
  // Coalescé en rAF : lire scrollHeight force un layout synchrone — à 30-60 tokens/s,
  // un reflow par token concurrençait le rendu du texte. Un recalage par frame suffit.
  let scrollFollowScheduled = false
  $effect(() => {
    const n = copilot.messages.length
    const tail = copilot.messages[n - 1]?.content
    void n
    void tail
    if (!atBottom || scrollFollowScheduled) return
    scrollFollowScheduled = true
    requestAnimationFrame(() => {
      scrollFollowScheduled = false
      if (atBottom && scroller) scroller.scrollTop = scroller.scrollHeight
    })
  })
</script>

<!-- Section « Ajouter un modèle » : rendue dans la bibliothèque ET dès l'onboarding
     (l'utilisateur ne doit jamais être captif de la seule recommandation). -->
{#snippet addSection(chips: string[])}
  <section>
    <div class="cop-label">Ajouter</div>
    <div class="cop-add">
      <span class="msr" style="font-size:18px;color:var(--ink-4)">search</span>
      <input
        class="cop-add-input"
        type="text"
        placeholder="nom du modèle…"
        aria-label="Nom du modèle à télécharger"
        bind:value={pullName}
        onkeydown={(e) => { if (e.key === 'Enter') startPull() }}
      />
      <button class="cop-btn-sm" onclick={() => startPull()} disabled={!pullName.trim()}>Télécharger</button>
    </div>
    {#if chips.length > 0}
      <div class="cop-chips">
        {#each chips as s (s)}
          <button class="cop-chip" onclick={() => startPull(s)}>
            <span class="msr" style="font-size:14px;color:var(--ink-4)">add</span>{s}
          </button>
        {/each}
      </div>
    {/if}
  </section>
{/snippet}

{#snippet verbMenuCard()}
  {#if verbMenuOpen && verbMenuPos}
    {@const vIdx = Math.max(VERBOSITY_CHOICES.findIndex((c) => c.value === app.copilotVerbosity), 0)}
    {@const vCur = VERBOSITY_CHOICES[vIdx]}
    <!-- Rendu à la racine du panneau : dans le composer, le flip des faces (transform)
         devient bloc conteneur et clippe/déplace le menu (vécu). Ici, repère = panneau. -->
    <div
      class="cop-verb-menu"
      style="left:{verbMenuPos.left}px; bottom:{verbMenuPos.bottom}px"
      role="menu"
      tabindex="-1"
      aria-label="Style des réponses"
      bind:this={verbMenuEl}
      onkeydown={onVerbMenuKeydown}
    >
      <div class="cop-verb-sliderwrap">
        <!-- Ticks au-dessus de la piste, en ton inverse quand le remplissage les couvre :
             les crans déjà parcourus restent visibles À TRAVERS la barre. -->
        <div class="cop-verb-ticks" aria-hidden="true">
          {#each VERBOSITY_CHOICES as c, i (c.value)}
            <!-- Cran courant : masqué (le pouce est dessus) ; crans parcourus : ton
                 inverse à travers le remplissage ; crans restants : discrets. -->
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
      <div class="cop-verb-current">
        <span class="cop-verb-item-ic"><span class="msr">{vCur.icon}</span></span>
        <span class="cop-verb-item-copy">
          <strong>{vCur.label}</strong>
          <small>{vCur.hint}</small>
        </span>
      </div>
    </div>
  {/if}
{/snippet}

{#snippet addContextMenu()}
  {#if addMenuOpen && addMenuPos}
    <div
      class="cop-add-context-menu"
      style="left:{addMenuPos.left}px; bottom:{addMenuPos.bottom}px"
      role="menu"
      tabindex="-1"
      aria-label="Ajouter du contexte"
      bind:this={addMenuEl}
      onkeydown={onAddMenuKeydown}
    >
      <div class="cop-add-context-head">
        <strong>Ajouter du contexte</strong>
        {#if cloudDestination}<small>Sera envoyé à {cloudDestination}</small>{:else}<small>Reste sur cet appareil</small>{/if}
      </div>
      <button class="cop-add-context-action" role="menuitem" disabled={!selectionAvailable || contextLoading} onclick={addSelection}>
        <span class="msr">notes</span><span><strong>Sélection actuelle</strong><small>Capturer le texte sélectionné</small></span>
      </button>
      <button class="cop-add-context-action" role="menuitem" disabled={contextLoading} onclick={() => void addFiles()}>
        <span class="msr">description</span><span><strong>Fichiers…</strong><small>Markdown, texte, HTML ou PDF</small></span>
      </button>
      <button class="cop-add-context-action" role="menuitem" disabled={contextLoading} onclick={() => void addFolder()}>
        <span class="msr">folder</span><span><strong>Dossier de notes…</strong><small>Utiliser son index sémantique</small></span>
      </button>
      <button class="cop-add-context-action" role="menuitem" disabled={contextLoading} onclick={() => void addClipboard()}>
        <span class="msr">content_paste</span><span><strong>Texte du presse-papiers</strong><small>Créer un instantané temporaire</small></span>
      </button>
    </div>
  {/if}
{/snippet}

{#snippet citePreviewCard()}
  {#if citePreview}
    <div
      class="cop-cite-preview"
      class:below={citePreview.below}
      style="left:{citePreview.x}px; top:{citePreview.y}px"
      role="tooltip"
    >
      <div class="cop-cite-preview-head">
        <span class="cop-source-num">{citePreview.n}</span>
        <span class="cop-cite-preview-name">{citePreview.name ?? 'Passage cité'}</span>
      </div>
      <p class="cop-cite-preview-text">{citePreview.text}</p>
      <div class="cop-cite-preview-hint">Cliquer sur la puce ouvre le passage dans le document</div>
    </div>
  {/if}
{/snippet}

<!-- Échap est géré sur les triggers/pops eux-mêmes (focus toujours dedans quand ouvert)
     avec stopPropagation ; ici seul le clic extérieur, partagé par les deux menus. -->
<svelte:window onpointerdowncapture={pickerOpen || verbMenuOpen || addMenuOpen ? onGlobalPointerDown : undefined} />

<aside
  class="cop-panel"
  class:open={app.copilotOpen}
  class:expanded={app.copilotExpanded}
  aria-hidden={!app.copilotOpen}
  inert={!app.copilotOpen}
  bind:this={panelEl}
>
  <!-- En-tête : contrôles panneau + contrôles fenêtre (draggable, motif TitleBar) -->
  <header class="cop-head" data-tauri-drag-region>
    <div class="cop-identity" data-tauri-drag-region>
      <span class="cop-mark" data-tauri-drag-region>
        <span class="msr" style="font-size:15px" data-tauri-drag-region>spa</span>
      </span>
      <span class="cop-title" data-tauri-drag-region>Doku-San</span>
      <span class="cop-local" class:cloud={isCloudProvider(app.copilotProvider)} data-tauri-drag-region>
        {isCloudProvider(app.copilotProvider) ? 'cloud' : 'local'}
      </span>
    </div>
    <div class="cop-head-spacer" data-tauri-drag-region></div>
    <button
      class="cop-ic"
      class:active={app.copilotExpanded}
      title={app.copilotExpanded ? 'Réduire le chat' : 'Agrandir le chat'}
      aria-label={app.copilotExpanded ? 'Réduire le chat' : 'Agrandir le chat'}
      aria-pressed={app.copilotExpanded}
      onclick={() => (app.copilotExpanded = !app.copilotExpanded)}
    >
      <span class="msr" style="font-size:17px">{app.copilotExpanded ? 'close_fullscreen' : 'open_in_full'}</span>
    </button>
    {#if app.copilotView === 'models' || app.copilotView === 'memory'}
      <button class="cop-ic" title="Retour au chat" aria-label="Retour au chat" onclick={() => (app.copilotView = 'chat')}>
        <span class="msr" style="font-size:19px">arrow_back</span>
      </button>
    {:else}
      {#if copilot.messages.length > 0}
        <button class="cop-ic" title="Nouvelle conversation" aria-label="Nouvelle conversation" onclick={startNewChat}>
          <!-- Icône de trait (famille Lucide « square-pen ») : inline plutôt que dans le
               subset Material Symbols — le geste « nouvelle conversation » mérite le dessin
               au trait, plus léger que le glyphe plein. currentColor = suit l'état du bouton. -->
          <svg class="cop-ic-line" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M12 3H7a4 4 0 0 0-4 4v10a4 4 0 0 0 4 4h10a4 4 0 0 0 4-4v-5" />
            <path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z" />
          </svg>
        </button>
      {/if}
      {#if isCloudProvider(app.copilotProvider)}
        <button class="cop-ic" title="Mémoire du travail" aria-label="Mémoire du travail" onclick={openMemoryView}>
          <span class="msr" style="font-size:18px">database</span>
        </button>
      {/if}
      <button class="cop-ic" title="Gérer les modèles" aria-label="Gérer les modèles" onclick={() => (app.copilotView = 'models')}>
        <span class="msr" style="font-size:19px">layers</span>
      </button>
    {/if}
    <div class="cop-sep"></div>
    <button class="cop-win" title="Réduire" aria-label="Réduire" onclick={minimizeWindow}>
      <span class="msr" style="font-size:18px">remove</span>
    </button>
    <button class="cop-win" title="Agrandir" aria-label="Agrandir" onclick={toggleMaximizeWindow}>
      <span class="msr" style="font-size:15px">crop_square</span>
    </button>
    <button class="cop-win close" title="Fermer" aria-label="Fermer" onclick={closeWindow}>
      <span class="msr" style="font-size:18px">close</span>
    </button>
  </header>

  <!-- Corps : carte arrondie qui démarre sous l'en-tête -->
  <div class="cop-card">
    <div class="cop-scroll" bind:this={scroller} onscroll={onScroll}>
      {#if app.copilotView === 'chat' && cloudMemory.lastBatch}
        <div class="cop-memory-toast" role="status">
          <span class="msr" aria-hidden="true">database</span>
          <span><strong>Mémoire mise à jour</strong><small>{memoryBatchLabel()}</small></span>
          {#if shownMemoryWorkspace ?? cloudMemory.workspace}
            <button onclick={() => void undoCloudMemory((shownMemoryWorkspace ?? cloudMemory.workspace)!)}>Annuler</button>
          {/if}
          <button class="icon" title="Masquer" aria-label="Masquer la notification" onclick={() => (cloudMemory.lastBatch = null)}><span class="msr">close</span></button>
        </div>
      {/if}
      {#if app.copilotView === 'chat' && cloudMemory.error}
        <div class="cop-memory-toast error" role="alert">
          <span class="msr" aria-hidden="true">warning</span>
          <span><strong>Mémoire indisponible</strong><small>{cloudMemory.error}</small></span>
          <button onclick={openMemoryView}>Vérifier</button>
          <button class="icon" title="Masquer" aria-label="Masquer l’erreur mémoire" onclick={() => (cloudMemory.error = '')}><span class="msr">close</span></button>
        </div>
      {/if}
      {#if app.copilotView === 'models'}
        <div class="cop-picker" bind:this={pickerRootEl}>
          <div class="cop-label" id="cop-picker-label">Modèle actif</div>
          <div class="cop-picker-shell" class:open={pickerOpen}>
            <button
              class="cop-picker-trigger"
              id="cop-picker-trigger"
              bind:this={pickerTriggerEl}
              aria-haspopup="listbox"
              aria-expanded={pickerOpen}
              aria-labelledby="cop-picker-label cop-picker-trigger"
              onclick={togglePicker}
              onkeydown={onTriggerKeydown}
            >
              <span class="msr">{app.copilotProvider === 'ollama' ? 'memory' : 'cloud'}</span>
              <span class="cop-picker-name">
                {#if app.copilotProvider === 'openai'}
                  <strong class="sans">{OPENAI_MODEL}</strong>
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
              <span class="msr cop-picker-chev" class:open={pickerOpen}>expand_more</span>
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
                class:open={pickerSection === 'ollama'}
                role="menuitem"
                aria-haspopup="true"
                aria-expanded={pickerSection === 'ollama'}
                onclick={() => toggleSection('ollama')}
              >
                <span class="msr">memory</span>
                <span class="cop-picker-sec-name">Sur cet appareil</span>
                <span class="cop-picker-sec-state">privé</span>
                <span class="msr cop-picker-sec-chev">chevron_right</span>
              </button>
              <div
                class="cop-picker-fold"
                class:open={pickerSection === 'ollama'}
                role="group"
                aria-label="Modèles locaux"
                aria-hidden={pickerSection !== 'ollama'}
                inert={pickerSection !== 'ollama'}
              >
                <div class="cop-picker-fold-inner">
                  {#if copilot.loading}
                    <div class="cop-picker-empty">Démarrage du moteur IA…</div>
                  {:else if chatModels.length > 0}
                    {#each chatModels as m (m.name)}
                      {@const selected = app.copilotProvider === 'ollama' && m.name === app.activeModel}
                      <button class="cop-picker-opt" role="menuitemradio" aria-checked={selected} onclick={() => pickLocal(m.name)}>
                        <span class="cop-dot" class:on={selected}></span>
                        <span class="cop-mono grow">{m.name}</span>
                        <span class="cop-size">{formatBytes(m.size)}</span>
                      </button>
                    {/each}
                    <!-- Accès à la carte locale (bibliothèque, index du dossier, ajouter)
                         SANS changer le modèle actif — l'ancien onglet « Sur cet appareil »
                         offrait ce chemin, le dropdown doit le garder. -->
                    <button class="cop-picker-opt" role="menuitem" onclick={pickManageLocal}>
                      <span class="msr">tune</span>
                      <span class="grow">Gérer modèles et index…</span>
                    </button>
                  {:else if !copilot.modelsLoaded}
                    <!-- Liste jamais lue (moteur pas démarré / indisponible) : ne JAMAIS
                         affirmer « aucun modèle installé » sans avoir regardé. -->
                    <button class="cop-picker-opt" role="menuitem" onclick={pickManageLocal}>
                      <span class="msr">warning</span>
                      <span class="grow">Moteur IA indisponible — voir ci-dessous</span>
                    </button>
                  {:else}
                    <!-- Entrée-action (pas un choix de valeur) : bascule sur la section
                         locale où vivent onboarding et téléchargement. -->
                    <button class="cop-picker-opt" role="menuitem" onclick={pickManageLocal}>
                      <span class="msr">download</span>
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
                <span class="msr">cloud</span>
                <span class="cop-picker-sec-name">OpenAI</span>
                <span class="cop-picker-sec-state" class:ok={openAiState.kind === 'ok'} class:warn={openAiState.kind === 'warn'}>
                  {openAiState.label}
                </span>
                <span class="msr cop-picker-sec-chev">chevron_right</span>
              </button>
              <div
                class="cop-picker-fold"
                class:open={pickerSection === 'openai'}
                role="group"
                aria-label="Modèle OpenAI"
                aria-hidden={pickerSection !== 'openai'}
                inert={pickerSection !== 'openai'}
              >
                <div class="cop-picker-fold-inner">
                  <button
                    class="cop-picker-opt"
                    role="menuitemradio"
                    aria-checked={app.copilotProvider === 'openai'}
                    onclick={pickOpenAi}
                  >
                    <span class="cop-dot" class:on={app.copilotProvider === 'openai'}></span>
                    <span class="cop-cloud-model grow">{OPENAI_MODEL}</span>
                  </button>
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
                <span class="msr">cloud</span>
                <span class="cop-picker-sec-name">MiniMax</span>
                <span class="cop-picker-sec-state" class:ok={minimaxState.kind === 'ok'} class:warn={minimaxState.kind === 'warn'}>
                  {minimaxState.label}
                </span>
                <span class="msr cop-picker-sec-chev">chevron_right</span>
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
                <span class="cop-cloud-icon"><span class="msr">cloud</span></span>
                <span class="cop-cloud-name">
                  <strong>{OPENAI_MODEL}</strong>
                  <small>GPT‑5.6 Luna · raisonnement faible</small>
                </span>
                {#if copilot.openAiChecking}
                  <span class="cop-cloud-status checking">Vérification…</span>
                {:else if copilot.openAiAuthenticated && copilot.openAiPreferredAvailable === false}
                  <span class="cop-cloud-status unavailable">Luna indisponible</span>
                {:else if copilot.openAiAuthenticated}
                  <span class="cop-cloud-status ready"><span class="cop-dot breathe"></span>Connecté</span>
                {:else if copilot.openAiAuthPhase === 'waiting'}
                  <span class="cop-cloud-status checking">En attente…</span>
                {:else}
                  <span class="cop-cloud-status">À connecter</span>
                {/if}
              </div>
              <div class="cop-cloud-foot">
                <span><b>GPT‑5.6</b><small>LUNA</small></span>
                <i></i>
                <span><b>OpenAI</b><small>FOURNISSEUR</small></span>
              </div>
            </div>

            {#if copilot.openAiAuthenticated}
              <div class:warn={copilot.openAiPreferredAvailable === false} class="cop-cloud-note ok" role="status">
                <span class="msr">{copilot.openAiPreferredAvailable === false ? 'warning' : 'verified_user'}</span>
                <span>
                  <strong>{copilot.openAiPreferredAvailable === false ? 'GPT‑5.6 Luna n’est pas disponible' : 'Compte OpenAI connecté'}</strong>
                  <small>
                    {copilot.openAiPreferredAvailable === false
                      ? 'Cet abonnement ne propose pas Luna dans Codex. Doku ne lancera aucune génération avec un autre modèle à votre insu.'
                      : 'La session est protégée par Windows. Aucune clé API n’est demandée ni enregistrée.'}
                  </small>
                </span>
              </div>
              {#if copilot.openAiStatusError}
                <p class="cop-auth-error" role="status">{copilot.openAiStatusError}</p>
              {/if}
              <button class="cop-btn-quiet" onclick={() => void disconnectOpenAiAccount()}>
                <span class="msr">logout</span>Déconnecter le compte
              </button>
            {:else if copilot.openAiAuthPhase === 'waiting' && copilot.openAiAuth}
              <section class="cop-cloud-setup cop-auth-wait" aria-live="polite">
                <span class="cop-auth-mark"><span class="msr">open_in_browser</span></span>
                <h3>Validez dans votre navigateur</h3>
                <p>Connectez-vous à OpenAI, puis saisissez ce code sur la page officielle.</p>
                <button class="cop-auth-code" title="Copier le code" onclick={() => void copyOpenAiCode()}>
                  <span>{copilot.openAiAuth.userCode}</span>
                  <span class="msr">{authCodeCopied ? 'check' : 'content_copy'}</span>
                </button>
                <div class="cop-auth-actions">
                  <button class="cop-btn-fill" onclick={() => void openOpenAiAuthPage(copilot.openAiAuth!.verificationUrl)}>
                    <span class="msr">open_in_new</span>Ouvrir OpenAI
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
                  <li><span class="msr">key_off</span><p><strong>Aucune clé API</strong><small>Doku ne vous demandera jamais d’en créer une.</small></p></li>
                  <li><span class="msr">verified_user</span><p><strong>Validation par OpenAI</strong><small>Votre mot de passe ne transite jamais par Doku.</small></p></li>
                  <li><span class="msr">lock</span><p><strong>Session protégée</strong><small>Les jetons restent dans le coffre Windows.</small></p></li>
                </ol>
                <button class="cop-btn-fill" onclick={() => void beginOpenAiAuth()} disabled={copilot.openAiAuthPhase === 'starting'}>
                  <span class="msr">login</span>{copilot.openAiAuthPhase === 'starting' ? 'Connexion…' : 'Se connecter avec OpenAI'}
                </button>
                {#if copilot.openAiAuthError}<p class="cop-auth-error" role="status">{copilot.openAiAuthError}</p>{/if}
              </section>
            {/if}

            <div class="cop-cloud-privacy">
              <span class="msr">info</span>
              <p><strong>Envoi volontaire vers le cloud.</strong> Quand OpenAI est actif, la question et le contexte affiché sont transmis au service Codex. Le mode Ollama reste entièrement local.</p>
            </div>
          </div>
        {:else if app.copilotProvider === 'minimax'}
          <div class="cop-openai-view">
            <div class="cop-cloud-hero">
              <div class="cop-cloud-head">
                <span class="cop-cloud-icon"><span class="msr">cloud</span></span>
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
              <div class="cop-cloud-foot">
                <span><b>M-series</b><small>MODÈLES</small></span>
                <i></i>
                <span><b>MiniMax</b><small>FOURNISSEUR</small></span>
              </div>
            </div>

            {#if copilot.minimaxStatus?.connected && !copilot.minimaxStatus.keyRejected}
              <div class="cop-cloud-note ok" role="status">
                <span class="msr">verified_user</span>
                <span>
                  <strong>Clé MiniMax connectée</strong>
                  <small>La clé est protégée par Windows — elle n'apparaît jamais dans les réglages ni dans les fichiers de Doku.</small>
                </span>
              </div>
              {#if copilot.minimaxStatus.error}
                <p class="cop-auth-error" role="status">{copilot.minimaxStatus.error}</p>
              {/if}
              <button class="cop-btn-quiet" onclick={() => void disconnectMinimaxKey()}>
                <span class="msr">logout</span>Déconnecter la clé
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
                  <li><span class="msr">verified_user</span><p><strong>Vérifiée avant stockage</strong><small>Clé invalide ou réseau en panne : rien n’est enregistré.</small></p></li>
                  <li><span class="msr">lock</span><p><strong>Protégée par Windows</strong><small>La clé vit dans le coffre Windows, jamais dans les fichiers de Doku.</small></p></li>
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
                    <span class="msr">login</span>{copilot.minimaxConnecting ? 'Vérification…' : 'Connecter'}
                  </button>
                </form>
                {#if copilot.minimaxConnectError}<p class="cop-auth-error" role="status">{copilot.minimaxConnectError}</p>{/if}
              </section>
            {/if}

            <div class="cop-cloud-privacy">
              <span class="msr">info</span>
              <p><strong>Envoi volontaire vers le cloud.</strong> Quand MiniMax est actif, la question et le contexte affiché sont transmis à api.minimax.io. Le mode Ollama reste entièrement local.</p>
            </div>
          </div>
        {:else}
        {#if copilot.error}
          <div class="cop-msg err row">
            <span class="grow-wrap">{copilot.error}</span>
            <button class="cop-dismiss" title="Masquer" aria-label="Masquer l'erreur" onclick={() => (copilot.error = '')}>
              <span class="msr" style="font-size:15px">close</span>
            </button>
          </div>
        {/if}

        {#if copilot.loading}
          <p class="cop-msg">Démarrage du moteur IA…</p>
        {:else if copilot.models.length === 0 && !copilot.pulling}
          <!-- Onboarding : aucun modèle installé -->
          <div class="cop-onboard">
            <div class="cop-onboard-tile"><span class="msr" style="font-size:28px">spa</span></div>
            <div>
              <div class="cop-onboard-title">Activez votre copilote</div>
              <p class="cop-onboard-sub">
                Il tourne <b>entièrement sur votre machine</b>. Téléchargez un modèle pour commencer — rien ne quitte votre ordinateur.
              </p>
            </div>
            <div class="cop-reco">
              <div class="cop-reco-head">
                <span class="cop-mono">qwen2.5:1.5b · Q4_0</span>
                <span class="cop-badge">conseillé</span>
              </div>
              <div class="cop-reco-sub">935 Mo · ultra-léger, discret, optimisé ARM</div>
              <button class="cop-btn-fill" onclick={() => startPull(RECO_MODEL)}>
                <span class="msr" style="font-size:17px">download</span>Télécharger ce modèle
              </button>
            </div>
          </div>
          <!-- L'alternative reste disponible sans concurrencer le modèle conseillé :
               progressive disclosure, pas de voie unique cachée. -->
          <details class="cop-advanced cop-onboard-more">
            <summary onkeydown={onAdvancedSummaryKey}>
              <span class="cop-advanced-icon"><span class="msr">tune</span></span>
              <span class="cop-advanced-copy">
                <strong>Voir d’autres modèles</strong>
                <small>Autres tailles ou modèle personnalisé</small>
              </span>
              <span class="msr cop-advanced-chev">expand_more</span>
            </summary>
            <div class="cop-sections cop-advanced-body">
              {@render addSection(ALT_SUGGESTIONS)}
            </div>
          </details>
        {:else}
          <!-- Une progression est un état système, jamais un réglage avancé : elle reste
               visible même lorsque la gestion locale est repliée. -->
          {#if copilot.pulling}
            <section class="cop-download-now">
              <div class="cop-label">Téléchargement</div>
              <div class="cop-dl">
                <div class="cop-dl-head">
                  <span class="msr orbit" style="font-size:18px">progress_activity</span>
                  <span class="cop-mono grow" title={copilot.pulling.name}>{copilot.pulling.name}</span>
                  <span class="cop-size">
                    {copilot.pulling.total > 0 ? `${formatBytes(copilot.pulling.done)} / ${formatBytes(copilot.pulling.total)}` : '…'}
                  </span>
                  <button class="cop-del" title="Annuler" aria-label="Annuler le téléchargement" onclick={cancelPull}>
                    <span class="msr" style="font-size:16px">close</span>
                  </button>
                </div>
                <div class="cop-track"><div class="doku-skel" style="width:{copilot.pulling.pct}%;height:100%;border-radius:3px"></div></div>
              </div>
            </section>
          {/if}

          <details class="cop-advanced">
            <summary onkeydown={onAdvancedSummaryKey}>
              <span class="cop-advanced-icon"><span class="msr">tune</span></span>
              <span class="cop-advanced-copy">
                <strong>Gérer les modèles locaux</strong>
                <small>{copilot.models.length} installé{copilot.models.length > 1 ? 's' : ''} · {formatBytes(libraryTotal)} · index du dossier</small>
              </span>
              <span class="msr cop-advanced-chev">expand_more</span>
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
                    {@const embed = isEmbedModel(m.name)}
                    <div class="cop-row" class:active={isActive}>
                      <!-- Un modèle d'embedding ne sait pas générer : pick désactivé (même
                           prédicat que le dropdown), icône database au lieu de la pastille. -->
                      <button
                        class="cop-row-pick"
                        title={embed ? "Modèle d'embedding — réservé à l'index du dossier" : 'Choisir comme modèle actif'}
                        aria-pressed={isActive}
                        disabled={embed}
                        onclick={() => setActiveModel(m.name)}
                      >
                        {#if embed}
                          <span class="msr" style="font-size:15px;color:var(--ink-4)">database</span>
                        {:else}
                          <span class="cop-dot" class:on={isActive}></span>
                        {/if}
                        <span class="cop-mono grow">{m.name}</span>
                        <span class="cop-size">{formatBytes(m.size)}</span>
                      </button>
                      <button class="cop-del" title="Supprimer" aria-label={'Supprimer ' + m.name} onclick={() => (confirmDelete = m.name)}>
                        <span class="msr" style="font-size:17px">delete</span>
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
                  <span class="msr" style="font-size:18px;color:var(--ink-4)">database</span>
                  <span class="cop-mono grow" title="Modèle d'embedding — réglage distinct du modèle de chat">{embedModelName}</span>
                  {#if !embedInstalled}
                    <button class="cop-btn-sm" onclick={() => startPull(embedModelName)} disabled={!!copilot.pulling}>Télécharger</button>
                  {:else if ragIndexing}
                    <button class="cop-del" title="Annuler l'indexation" aria-label="Annuler l'indexation" onclick={cancelRagIndexing}>
                      <span class="msr" style="font-size:16px">close</span>
                    </button>
                  {:else}
                    <!-- Désactivé aussi quand un AUTRE dossier s'indexe (une seule indexation à la fois). -->
                    <button class="cop-btn-sm" onclick={indexFolder} disabled={!ragDir || ragState.phase === 'indexing'} title={ragDir ?? 'Ouvrir un document ou un dossier d’abord'}>Indexer</button>
                  {/if}
                </div>
                <div class="cop-chips" style="margin-top:8px">
                  {#each EMBED_CHOICES as c (c)}
                    <button class="cop-chip" class:sel={embedModelName === c} title="Choisir ce modèle d'embedding" aria-pressed={embedModelName === c} onclick={() => (app.embedModel = c)}>
                      {c}<span class="cop-chip-tag">{c === DEFAULT_EMBED_MODEL ? 'défaut' : 'repli'}</span>
                    </button>
                  {/each}
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

            <!-- Ajouter -->
            {@render addSection(installableSuggestions)}
            </div>
          </details>
        {/if}
        {/if}
      {:else if app.copilotView === 'memory'}
        <section class="cop-memory-view" aria-labelledby="cop-memory-title">
          <div class="cop-memory-heading">
            <span class="cop-memory-mark" aria-hidden="true"><span class="msr">database</span></span>
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
            <div class="cop-memory-scope-options">
              <button
                class:active={!effectiveMemoryFolder}
                disabled={!memoryDocument}
                aria-pressed={!effectiveMemoryFolder}
                onclick={useDocumentMemory}
              ><span class="msr">description</span>Cette note</button>
              <button
                class:active={!!effectiveMemoryFolder}
                disabled={!memoryFolderCandidate}
                aria-pressed={!!effectiveMemoryFolder}
                title={memoryFolderCandidate ? `Partager la mémoire avec le dossier ${memoryFolderCandidate.label}` : 'Aucun dossier disponible'}
                onclick={useFolderMemory}
              ><span class="msr">folder</span>{memoryFolderCandidate ? memoryFolderCandidate.label : 'Dossier'}</button>
            </div>
          </div>

          {#if !isCloudProvider(app.copilotProvider)}
            <div class="cop-memory-empty">
              <span class="msr">cloud_off</span>
              <strong>La mémoire est réservée aux modèles cloud</strong>
              <p>Choisissez OpenAI ou MiniMax pour la rappeler et la faire évoluer automatiquement.</p>
              <button class="cop-btn-quiet" onclick={() => (app.copilotView = 'models')}>Choisir un fournisseur</button>
            </div>
          {:else if !memoryTarget}
            <div class="cop-memory-empty">
              <span class="msr">description</span>
              <strong>Aucun travail à mémoriser</strong>
              <p>Enregistrez cette note pour lui donner sa propre mémoire, ou choisissez explicitement un dossier à partager.</p>
            </div>
          {:else if cloudMemory.loading}
            <div class="cop-memory-loading" role="status"><span class="doku-skel"></span><span class="doku-skel"></span><span class="doku-skel"></span></div>
          {:else}
            {#if cloudMemory.error}
              <div class="cop-memory-error" role="alert">
                <span class="msr">warning</span><span>{cloudMemory.error}</span>
                <button title="Masquer" aria-label="Masquer l'erreur" onclick={() => (cloudMemory.error = '')}><span class="msr">close</span></button>
              </div>
            {/if}
            <div class="cop-memory-list-head">
              <span>{cloudMemory.records.length} souvenir{cloudMemory.records.length === 1 ? '' : 's'}</span>
              {#if cloudMemory.undoAvailable && shownMemoryWorkspace}
                <button onclick={() => void undoCloudMemory(shownMemoryWorkspace!)}><span class="msr">history</span>Annuler la dernière modification</button>
              {/if}
            </div>
            {#if cloudMemory.records.length === 0}
              <div class="cop-memory-empty quiet">
                <span class="msr">auto_stories</span>
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
                        <button data-memory-id={record.id} data-memory-action="edit" title="Modifier" aria-label={`Modifier ${record.name}`} onclick={() => void editMemory(record)}><span class="msr">edit_note</span></button>
                        <button data-memory-id={record.id} data-memory-action="delete" title="Oublier" aria-label={`Oublier ${record.name}`} onclick={() => void askMemoryDelete(record.id)}><span class="msr">delete</span></button>
                      </div>
                      <h3>{record.name}</h3>
                      <p class="cop-memory-description">{record.description}</p>
                      <div class="cop-memory-content">{@html renderChatMarkdown(record.content)}</div>
                    {/if}
                  </article>
                {/each}
              </div>
            {/if}
            <p class="cop-memory-privacy"><span class="msr">lock</span> {memoryTarget?.kind === 'folder' ? 'Mémoire partagée avec ce dossier' : 'Mémoire propre à cette note'}, stockée localement dans AppData. Seuls les souvenirs retenus rejoignent ensuite la question cloud.</p>
          {/if}
        </section>
      {:else if copilot.messages.length === 0}
        <!-- Conversation vide : un vrai point de départ, pas une liste de commandes.
             Les cartes conservent les trois livrables documentaires existants. -->
        <div class="cop-chat-empty">
          <div class="cop-empty-mark" aria-hidden="true"><span class="msr">spa</span></div>
          <h2 class="cop-empty-title">Comment puis-je aider&nbsp;?</h2>
          <div class="cop-actions">
            <button class="cop-action" onclick={() => quickAction('summary')}>
              <span class="msr cop-action-icon" aria-hidden="true">summarize</span>
              <strong>Résume le document</strong>
            </button>
            <button class="cop-action" onclick={() => quickAction('todos')}>
              <span class="msr cop-action-icon" aria-hidden="true">checklist</span>
              <strong>Repère les actions à suivre</strong>
            </button>
            <button class="cop-action" onclick={() => quickAction('keypoints')}>
              <span class="msr cop-action-icon" aria-hidden="true">key</span>
              <strong>Extrais les points clés</strong>
            </button>
          </div>
        </div>
      {:else}
        <!-- Conversation -->
        <div class="cop-conv">
          {#each copilot.messages as m, i (i)}
            {#if m.role === 'user'}
              <div class="cop-user"><div class="cop-user-bubble">{m.content}</div></div>
            {:else if m.config}
              <!-- État de CONFIG (aucun modèle actif) : carte neutre, pas une erreur — rien n'a
                   échoué. Le bouton fait le travail (pas de « icône calques » à traduire). -->
              <div class="cop-err-card" role="status">
                <span class="msr" style="font-size:20px;color:var(--ink-3);flex:0 0 auto">
                  {m.config === 'openai' || m.config === 'minimax' ? 'cloud_off' : m.config === 'embed' ? 'database' : 'layers'}
                </span>
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
              <div class="cop-err-card" role="alert">
                <span class="msr" style="font-size:20px;color:var(--err);flex:0 0 auto">error</span>
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
              <!-- Attente = AVANT le 1er token : les points chorégraphiés remplacent l'en-tête
                   (le nom revient au-dessus du texte dès qu'il s'écrit). -->
              {@const waiting = m.streaming && m.content === ''}
              <div class="cop-asst">
                {#if waiting}
                  <!-- role=status : la ligne (statut réel ou « réfléchit ») est annoncée au
                       lecteur d'écran. Le shimmer est purement décoratif. -->
                  <div class="cop-status" role="status">
                    <span class="cop-think" aria-hidden="true"><i></i><i></i><i></i></span>
                    <span class="cop-shimmer">{m.status ?? 'Doku-San réfléchit'}</span>
                  </div>
                {:else}
                <div class="cop-asst-head">
                  <span class="msr" style="font-size:16px;color:var(--ink-4)">spa</span>
                  <span class="cop-asst-name">Doku-San</span>
                  <div class="grow"></div>
                  {#if !m.streaming}
                    {#if isTauri && !m.notice && m.content}
                      <!-- Sauver en note (21.x) : la réponse devient un fichier .md du dossier
                           courant — indexable, citable. Feedback succès (check) ET échec
                           (bannière) : jamais de bouton muet (règle Epic 19). -->
                      <button
                        class="cop-copy"
                        title="Sauver en note"
                        aria-label="Sauver la réponse en note"
                        disabled={copilot.savingNote}
                        onclick={() => void saveNote(i)}
                      >
                        <span class="msr" style="font-size:15px">{noteSavedIdx === i ? 'check' : 'save'}</span>
                      </button>
                    {/if}
                    <button class="cop-copy" title="Copier" aria-label="Copier la réponse" onclick={() => copyMessage(m.content)}>
                      <span class="msr" style="font-size:15px">content_copy</span>
                    </button>
                  {/if}
                </div>
                {#if m.streaming}
                  <!-- Streaming : texte brut (aucun parse par token) — rendu Markdown à la fin.
                       ::after = curseur doux qui pulse au fil de l'écriture. -->
                  <div class="cop-md-plain streaming">{m.content}</div>
                {:else}
                  <!-- Réponse terminée : Markdown assaini (allowlist, 0 réseau) + puces [n].
                       svelte-ignore : clic et survol sont délégués aux <button> injectés
                       (focusables — focusin/focusout portent l'équivalent clavier du survol),
                       le wrapper n'est pas lui-même interactif. -->
                  <!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events, a11y_mouse_events_have_key_events -->
                  <div
                    class="cop-md"
                    onclick={(e) => onAnswerClick(e, m)}
                    onmouseover={(e) => onAnswerCiteOver(e, m)}
                    onmouseout={onAnswerCiteOut}
                    onfocusin={(e) => onAnswerCiteOver(e, m)}
                    onfocusout={onAnswerCiteOut}
                  >{@html renderAnswer(m)}</div>
                {/if}
                {/if}
                {#if m.sources?.length && !m.streaming}
                  <!-- Citations DÉTERMINISTES (15.3, ancrées 21.x) : les passages réellement
                       fournis au modèle — pas ce qu'il prétend avoir lu. Le clic saute au
                       passage exact (flash). Mode « document complet » (citedOnly) : seuls
                       les extraits que la réponse cite — la liste entière = tout le doc. -->
                  {@const shown = m.citedOnly ? m.sources.filter((s) => m.cited?.includes(s.n)) : m.sources}
                  {#if shown.length}
                    <div class="cop-sources">
                      <span class="cop-sources-lbl">{m.citedOnly ? 'Passages cités' : 'Passages consultés'}</span>
                      {#each shown as s (s.n)}
                        <button class="cop-source-chip" class:bare={!s.name} title={s.path ?? undefined} onclick={() => void revealCitation(s)}>
                          <span class="cop-source-num">{s.n}</span>{#if s.name}{s.name}{/if}
                        </button>
                      {/each}
                    </div>
                  {/if}
                {/if}
                {#if m.contextSources?.length && !m.streaming}
                  <div class="cop-sources cop-context-sources">
                    <span class="cop-sources-lbl">Contexte transmis</span>
                    {#each m.contextSources as source (source.id)}
                      <span class="cop-source-chip static" title={source.truncatedAtLoad || source.truncatedForRequest ? 'Source transmise partiellement' : 'Source transmise en entier'}>
                        <span class="msr">{source.kind === 'clipboard' ? 'content_paste' : source.kind === 'selection' ? 'notes' : 'description'}</span>
                        {source.label}{#if source.truncatedAtLoad || source.truncatedForRequest}<em>partiel</em>{/if}
                      </span>
                    {/each}
                  </div>
                {/if}
                {#if m.memorySources?.length && !m.streaming}
                  <div class="cop-sources cop-memory-sources">
                    <span class="cop-sources-lbl">Mémoire utilisée</span>
                    {#each m.memorySources as memory (memory.id)}
                      <button class="cop-source-chip" title={memory.content} onclick={openMemoryView}>
                        <span class="msr">database</span>{memory.name}
                      </button>
                    {/each}
                  </div>
                {/if}
              </div>
            {/if}
          {/each}
        </div>
      {/if}
    </div>

    <!-- Zone de saisie « imbriquée » (chat réel, 14.1) -->
    {#if app.copilotView === 'chat'}
      <div class="cop-input-wrap">
        <div class="cop-composer-shell" role="tablist" aria-label="Question et contexte" aria-orientation="vertical">
          {#if composerFace === 'question'}
            <button
              id="cop-context-tab"
              class="cop-composer-back"
              type="button"
              role="tab"
              aria-selected="false"
              aria-controls="cop-context-panel"
              tabindex="-1"
              onclick={() => showComposerFace('context')}
              onkeydown={(e) => onComposerTabKey(e, 'context')}
            >
              <span class="cop-composer-back-icon"><span class="msr">layers</span></span>
              <span class="cop-composer-back-label">Contexte</span>
              <span class="cop-composer-note">{contextSummary}</span>
              <span class="msr cop-composer-switch">swap_vert</span>
            </button>
          {:else}
            <button
              id="cop-question-tab"
              class="cop-composer-back"
              type="button"
              role="tab"
              aria-selected="false"
              aria-controls="cop-question-panel"
              tabindex="-1"
              onclick={() => showComposerFace('question', true)}
              onkeydown={(e) => onComposerTabKey(e, 'question')}
            >
              <span class="cop-composer-back-icon"><span class="msr">chat_bubble</span></span>
              <span class="cop-composer-back-label">Question</span>
              {#if draft.trim()}<span class="cop-composer-note">Brouillon conservé</span>{/if}
              <span class="msr cop-composer-switch">swap_vert</span>
            </button>
          {/if}

          {#key composerFace}
            <section class="cop-composer-front">
              {#if composerFace === 'question'}
                <button
                  id="cop-question-tab"
                  class="cop-composer-active-label"
                  type="button"
                  role="tab"
                  aria-selected="true"
                  aria-controls="cop-question-panel"
                  tabindex="0"
                  onclick={() => promptEl?.focus()}
                  onkeydown={(e) => onComposerTabKey(e, 'question')}
                >
                  Question
                </button>
              {:else}
                <button
                  id="cop-context-tab"
                  class="cop-composer-front-tab"
                  type="button"
                  role="tab"
                  aria-selected="true"
                  aria-controls="cop-context-panel"
                  tabindex="0"
                  onclick={() => showComposerFace('context')}
                  onkeydown={(e) => onComposerTabKey(e, 'context')}
                >
                  <span class="msr">layers</span>
                  <span>Contexte</span>
                  <span class="cop-composer-note">{contextSummary}</span>
                </button>
              {/if}

              <div class="cop-composer-panels">
                <div
                  id="cop-question-panel"
                  class="cop-composer-panel cop-question-drawer"
                  class:active={composerFace === 'question'}
                  role="tabpanel"
                  aria-labelledby="cop-question-tab"
                  aria-hidden={composerFace !== 'question'}
                  inert={composerFace !== 'question'}
                >
                  <button
                    class="cop-input-attach"
                    class:open={addMenuOpen}
                    bind:this={addButtonEl}
                    disabled={contextLoading}
                    title="Ajouter du contexte"
                    aria-label="Ajouter du contexte"
                    aria-haspopup="menu"
                    aria-expanded={addMenuOpen}
                    onclick={toggleAddMenu}
                  ><span class="msr" style="font-size:20px">add</span></button>
                  <textarea
                    class="cop-input-ta"
                    bind:this={promptEl}
                    bind:value={draft}
                    rows="1"
                    placeholder={copilot.scope === 'folder' ? 'Demandez à vos notes…' : 'Demandez à Doku-San…'}
                    aria-label={copilot.scope === 'folder' ? 'Poser une question sur le dossier de notes' : 'Poser une question sur ce document'}
                    onkeydown={onPromptKey}
                  ></textarea>
                  <!-- Style des réponses : puce compacte, menu vers le haut. -->
                  <div class="cop-verb-root" bind:this={verbMenuRootEl}>
                    <button
                      class="cop-verb-chip"
                      class:open={verbMenuOpen}
                      bind:this={verbChipEl}
                      title="Style des réponses"
                      aria-haspopup="menu"
                      aria-expanded={verbMenuOpen}
                      aria-label={`Style des réponses : ${verbosityLabel}`}
                      onclick={toggleVerbMenu}
                      onkeydown={(e) => {
                        if (e.key === 'Escape' && verbMenuOpen) {
                          e.stopPropagation()
                          verbMenuOpen = false
                        }
                      }}
                    >
                      <span>{verbosityLabel}</span>
                      <span class="msr">expand_more</span>
                    </button>
                  </div>
                  {#if copilot.generating}
                    <button class="cop-input-send" title="Arrêter" aria-label="Arrêter la génération" onclick={stopChat}>
                      <span class="msr" style="font-size:17px;font-variation-settings:'FILL' 1">stop</span>
                    </button>
                  {:else}
                    <button class="cop-input-send" title="Envoyer" aria-label="Envoyer" disabled={!draft.trim()} onclick={send}>
                      <span class="msr" style="font-size:19px">arrow_upward</span>
                    </button>
                  {/if}
                </div>

                <div
                  id="cop-context-panel"
                  class="cop-composer-panel cop-context-drawer"
                  class:active={composerFace === 'context'}
                  role="tabpanel"
                  aria-labelledby="cop-context-tab"
                  aria-hidden={composerFace !== 'context'}
                  inert={composerFace !== 'context'}
                >
                  <!-- Portée des questions (15.3) — le câblage des puces « + Contexte » :
                       document courant OU dossier entier (réponses citant les notes). -->
                  <button
                    class="cop-scope"
                    class:sel={copilot.scope === 'doc'}
                    aria-pressed={copilot.scope === 'doc'}
                    onclick={() => (copilot.scope = 'doc')}
                  >
                    <span class="cop-context-icon" aria-hidden="true"><span class="msr">description</span></span>
                    <span class="cop-context-copy">
                      <strong>{contextDetails.name}</strong>
                      <small>{contextDetails.meta}</small>
                    </span>
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
                      {#if docTruncated && !docIndexAvailable}<span class="msr">warning</span>{/if}
                      {contextDetails.state}
                    </span>
                  </button>
                  <button
                    class="cop-scope"
                    class:sel={copilot.scope === 'folder'}
                    aria-pressed={copilot.scope === 'folder'}
                    onclick={() => (copilot.scope = 'folder')}
                  >
                    <span class="cop-context-icon" aria-hidden="true"><span class="msr">folder</span></span>
                    <span class="cop-context-copy">
                      <strong>Dossier{ragDir ? ` « ${baseName(ragDir)} »` : ''}</strong>
                      <small>{folderMeta}</small>
                    </span>
                    <span class="cop-context-state">{copilot.scope === 'folder' ? 'Actif' : 'Choisir'}</span>
                  </button>
                  {#if copilot.contextFolder}
                    <div class="cop-context-extra folder">
                      <span class="msr" aria-hidden="true">folder</span>
                      <span class="cop-context-extra-copy">
                        <strong>{copilot.contextFolder.label}</strong>
                        <small>Dossier choisi pour les questions et l’index</small>
                      </span>
                      <button title="Retirer ce dossier" aria-label={`Retirer le dossier ${copilot.contextFolder.label}`} onclick={() => setCopilotContextFolder(null)}>
                        <span class="msr">close</span>
                      </button>
                    </div>
                  {/if}
                  {#each copilot.contextItems as item (item.id)}
                    <div class="cop-context-extra">
                      <span class="msr" aria-hidden="true">{item.kind === 'clipboard' ? 'content_paste' : item.kind === 'selection' ? 'notes' : 'description'}</span>
                      <span class="cop-context-extra-copy">
                        <strong>{item.label}</strong>
                        <small>{numberFormatter.format(item.charCount)} caractères{item.truncatedAtLoad ? ' · partiel à l’ajout' : ''}</small>
                      </span>
                      <button title="Retirer cette source" aria-label={`Retirer ${item.label}`} onclick={() => removeCopilotContext(item.id)}>
                        <span class="msr">close</span>
                      </button>
                    </div>
                  {/each}
                  {#if cloudDestination}
                    <button class="cop-context-memory" onclick={openMemoryView}>
                      <span class="msr" aria-hidden="true">database</span>
                      <span><strong>Mémoire du travail</strong><small>{app.cloudMemoryEnabled ? (effectiveMemoryFolder ? `Automatique · dossier ${effectiveMemoryFolder.label}` : 'Automatique · cette note seulement') : 'Désactivée'}</small></span>
                      <span class="msr">chevron_right</span>
                    </button>
                  {/if}
                  {#if cloudDestination && (copilot.contextItems.length || copilot.contextFolder)}
                    <p class="cop-context-destination"><span class="msr">cloud</span> Sera envoyé à {cloudDestination} avec votre question.</p>
                  {/if}
                  {#if copilot.contextError}<p class="cop-context-error" role="alert">{copilot.contextError}</p>{/if}
                  {#if copilot.messages.length && (copilot.contextItems.length || copilot.contextFolder)}
                    <p class="cop-context-history">Retirer une source agit sur les prochains envois. Nouvelle conversation purge aussi l’historique.</p>
                  {/if}
                </div>
              </div>
            </section>
          {/key}
        </div>
        <div class="cop-disclaimer">
          {app.copilotProvider === 'openai'
            ? 'OpenAI · contexte envoyé au cloud'
            : app.copilotProvider === 'minimax'
              ? 'MiniMax · contexte envoyé au cloud'
              : 'Local · rien ne quitte cet appareil'}
          <span>·</span> Doku peut se tromper.
        </div>
      </div>
    {/if}
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
  {@render verbMenuCard()}
  {@render addContextMenu()}
</aside>

<style>
  .cop-panel {
    --copilot-width: min(400px, calc(100vw - 40px));
    /* Une seule propriété de taille animée (flex-basis) : width/max-width décrivaient la
       même boîte et triplaient le travail d'interpolation + diff de style par frame. */
    flex: 0 0 0;
    min-width: 0;
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
    container-type: inline-size;
    transition:
      flex-grow 300ms cubic-bezier(0.22, 1, 0.36, 1),
      flex-basis 240ms cubic-bezier(0.22, 1, 0.36, 1),
      visibility 0s linear 240ms;
  }
  .cop-panel.open {
    flex-basis: var(--copilot-width);
    visibility: visible;
    pointer-events: auto;
    transition:
      flex-grow 300ms cubic-bezier(0.22, 1, 0.36, 1),
      flex-basis 240ms cubic-bezier(0.22, 1, 0.36, 1),
      visibility 0s;
  }
  .cop-panel.open.expanded {
    flex-grow: 1;
  }
  .cop-panel > .cop-head,
  .cop-panel > .cop-card {
    width: 100%;
    min-width: var(--copilot-width);
    align-self: flex-end;
  }

  /* En-tête */
  .cop-head {
    height: var(--chrome-titlebar-height);
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 0 2px 0 10px;
    background: transparent;
    -webkit-backdrop-filter: blur(24px) saturate(145%);
    backdrop-filter: blur(24px) saturate(145%);
    box-shadow: inset 0 1px 0 var(--chrome-material-filet);
    user-select: none;
  }
  .cop-identity { display: flex; align-items: center; gap: 7px; min-width: 0; }
  .cop-mark {
    width: 24px; height: 24px; display: inline-flex; align-items: center; justify-content: center;
    border-radius: 8px; background: var(--cream-content); color: var(--ink-3);
  }
  .cop-title { font-size: 12.5px; font-weight: 600; color: var(--ink-2); white-space: nowrap; }
  .cop-local {
    height: 18px; display: inline-flex; align-items: center; padding: 0 6px;
    border-radius: 999px; background: var(--accent-soft); color: var(--ink-4);
    font-size: 9.5px; font-weight: 500; letter-spacing: 0.02em;
  }
  .cop-local.cloud { background: rgba(82, 119, 178, 0.14); color: var(--ink-3); }
  .cop-head-spacer { flex: 1; align-self: stretch; }
  .cop-sep { width: 1px; height: 16px; background: var(--line-2); margin: 0 4px; }
  .cop-ic,
  .cop-win {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 32px;
    border: 0;
    background: transparent;
    color: var(--ink-3);
    cursor: pointer;
    transition: color 140ms ease, background 140ms ease, transform 100ms ease;
  }
  .cop-ic { width: 28px; height: 28px; border-radius: 7px; color: var(--ink-4); }
  /* Icône de trait inline : 18px pour peser comme les glyphes Material voisins (19px pleins). */
  .cop-ic-line { width: 18px; height: 18px; display: block; }
  .cop-win { width: 38px; border-radius: 7px; }
  .cop-win.close { width: 40px; }
  .cop-ic:hover,
  .cop-win:hover { background: var(--surface-hover); color: var(--ink); }
  .cop-ic:active,
  .cop-win:active { background: var(--accent-soft); transform: translateY(1px); }
  .cop-ic:focus-visible,
  .cop-win:focus-visible { outline: 1px solid var(--line-3); outline-offset: -2px; background: var(--surface-hover); }
  .cop-ic.active { background: var(--accent-soft); color: var(--ink); }
  .cop-win.close:hover { background: var(--window-close); color: #fff; }
  .cop-win.close:active { background: var(--window-close-active); color: #fff; }

  /* Corps */
  .cop-card {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    background: var(--cream-content);
    border-left: 1px solid var(--line-1);
    /* En vue partagée, le coin gauche rejoint la page sans fente de chrome. Pendant
       l'agrandissement, il s'arrondit progressivement jusqu'aux 14 px du plein écran. */
    border-radius: clamp(0px, calc((100cqi - 400px) * 0.024), 14px) 14px 0 0;
    overflow: hidden;
  }
  .cop-scroll {
    flex: 1; min-height: 0; overflow-y: auto;
    padding: 0 max(18px, calc((100% - 760px) / 2));
    contain: layout paint;
  }
  .cop-msg { margin: 14px 4px; font-size: 12.5px; color: var(--ink-4); }
  .cop-msg.err { color: var(--err-text); }

  /* Sélecteur unifié « Modèle actif » : le menu flotte au-dessus de la page, mais sa
     silhouette reste soudée au trigger — même largeur, même matière, aucun interstice. */
  .cop-picker {
    margin: 14px 2px 16px;
  }
  .cop-picker-shell {
    position: relative;
    border-radius: 14px;
    transition: background 140ms ease, filter 140ms ease;
  }
  .cop-picker-shell.open {
    z-index: 30;
    border-radius: 14px 14px 0 0;
    background: var(--surface-2);
    filter: drop-shadow(0 12px 22px rgba(var(--shadow-rgb), 0.14));
  }
  .cop-picker-trigger {
    width: 100%; min-height: 48px; display: flex; align-items: center; gap: 10px; padding: 8px 12px;
    border: 0; border-radius: 13px; background: var(--surface-2); color: var(--ink);
    font-family: var(--font-sans); text-align: left; cursor: pointer;
    transition: background 140ms ease;
  }
  .cop-picker-trigger:hover { background: var(--surface-hover); }
  .cop-picker-trigger:active { background: var(--accent-soft); }
  .cop-picker-trigger:focus-visible { outline: 2px solid var(--line-3); outline-offset: 1px; }
  .cop-picker-shell.open .cop-picker-trigger {
    border-radius: 14px 14px 0 0;
    background: transparent;
  }
  .cop-picker-shell.open .cop-picker-trigger:hover { background: var(--surface-hover); }
  .cop-picker-trigger > .msr { flex: 0 0 auto; font-size: 18px; color: var(--ink-3); }
  .cop-picker-name { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .cop-picker-name strong {
    overflow: hidden; font-family: var(--font-mono); font-size: 12.5px; font-weight: 500;
    white-space: nowrap; text-overflow: ellipsis;
  }
  /* La mono est réservée aux TAGS techniques locaux (qwen2.5:1.5b-q4_0) : un nom de
     modèle cloud est un nom de produit → sans. */
  .cop-picker-name strong.sans { font-family: var(--font-sans); font-weight: 600; }
  .cop-picker-name strong.placeholder { font-family: var(--font-sans); color: var(--ink-4); }
  .cop-picker-name small { font-size: 10px; color: var(--ink-4); }
  .cop-picker-name small.warn { color: var(--warn-text); }
  .cop-picker-chev { transition: transform 140ms ease; }
  .cop-picker-chev.open { transform: rotate(180deg); }
  /* Déploiement attaché en overlay : top: 100% conserve une jonction à 0 px tandis que
     la position absolue empêche le menu d'allonger la page ou de pousser son contenu. */
  .cop-picker-pop {
    position: absolute; top: 100%; left: 0; right: 0;
    max-height: 360px; overflow-x: hidden; overflow-y: auto; padding: 6px;
    border-radius: 0 0 14px 14px; background: var(--surface-2);
    box-shadow: inset 0 1px 0 var(--line-1);
    animation: cop-picker-expand 180ms cubic-bezier(0.22, 1, 0.36, 1);
  }
  @keyframes cop-picker-expand {
    from { opacity: 0.72; clip-path: inset(0 0 100% 0); }
    to { opacity: 1; clip-path: inset(0); }
  }
  @keyframes cop-picker-in {
    from { opacity: 0; transform: translateY(4px) scale(0.98); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }
  .cop-picker-sec {
    width: 100%; height: 40px; display: flex; align-items: center; gap: 9px; padding: 0 9px;
    border: 0; border-radius: 9px; background: transparent; color: var(--ink-2);
    font-family: var(--font-sans); font-size: 12.5px; text-align: left; cursor: pointer;
    transition: background 140ms ease, color 140ms ease;
  }
  .cop-picker-sec > .msr { width: 19px; flex: 0 0 auto; font-size: 17px; color: var(--ink-4); }
  .cop-picker-sec:hover { background: var(--surface-hover); color: var(--ink); }
  .cop-picker-sec:hover > .msr { color: var(--ink-2); }
  .cop-picker-sec:focus-visible { outline: 2px solid var(--line-3); outline-offset: -2px; }
  .cop-picker-sec-name { flex: 1; min-width: 0; white-space: nowrap; font-weight: 500; }
  .cop-picker-sec-state { flex: 0 1 auto; overflow: hidden; font-size: 10.5px; color: var(--ink-4); white-space: nowrap; text-overflow: ellipsis; }
  .cop-picker-sec-state.ok { color: var(--ok-text); }
  .cop-picker-sec-state.warn { color: var(--warn-text); }
  .cop-picker-sec-chev { width: 16px !important; font-size: 16px !important; transition: transform 180ms cubic-bezier(0.2, 0, 0, 1); }
  .cop-picker-sec.open .cop-picker-sec-chev { transform: rotate(90deg); }
  .cop-picker-fold {
    display: grid; grid-template-rows: 0fr; opacity: 0;
    transition: grid-template-rows 190ms cubic-bezier(0.2, 0, 0, 1), opacity 130ms ease-in;
  }
  .cop-picker-fold.open { grid-template-rows: 1fr; opacity: 1; }
  .cop-picker-fold-inner { min-height: 0; overflow: hidden; }
  .cop-picker-sep { height: 1px; margin: 4px 6px; background: var(--line-1); }
  .cop-picker-opt {
    width: 100%; min-height: 34px; display: flex; align-items: center; gap: 9px; padding: 5px 9px 5px 22px;
    border: 0; border-radius: 8px; background: transparent; color: var(--ink-2);
    font-family: var(--font-sans); font-size: 11.5px; text-align: left; cursor: pointer;
    transition: background 140ms ease, color 140ms ease;
  }
  .cop-picker-opt:hover, .cop-picker-opt:focus-visible { background: var(--surface-hover); color: var(--ink); }
  .cop-picker-opt:focus-visible { outline: 2px solid var(--line-3); outline-offset: -2px; }
  .cop-picker-opt[aria-checked='true'] { background: var(--accent-soft); color: var(--ink); }
  .cop-picker-opt > .msr { flex: 0 0 auto; font-size: 16px; color: var(--ink-3); }
  .cop-picker-empty { padding: 5px 9px 9px 22px; font-size: 11px; color: var(--ink-4); }
  .cop-cloud-model { font-size: 12px; font-weight: 500; color: var(--ink); }
  @media (prefers-reduced-motion: reduce) {
    .cop-picker-pop { animation: none; }
    .cop-picker-shell, .cop-picker-trigger, .cop-picker-fold, .cop-picker-sec-chev, .cop-picker-chev { transition: none; }
  }

  .cop-openai-view { padding: 0 2px 24px; display: flex; flex-direction: column; gap: 16px; }

  /* Mémoire durable : une surface de gestion calme, structurée par lignes plutôt que par
     cartes imbriquées. La seule élévation est la notification transitoire dans le chat. */
  .cop-memory-toast {
    position: sticky; top: 8px; z-index: 6; margin: 8px 12px 0; min-height: 48px; padding: 7px 7px 7px 11px;
    display: flex; align-items: center; gap: 9px; border-radius: 14px;
    background: var(--cream-tint); color: var(--ink-2);
    box-shadow: 0 0 0 1px var(--elevation-ring-soft), 0 12px 30px rgba(var(--shadow-rgb), 0.14);
  }
  .cop-memory-toast > .msr { font-size: 17px; color: var(--ink-3); }
  .cop-memory-toast > span:nth-child(2) { min-width: 0; flex: 1; display: flex; flex-direction: column; }
  .cop-memory-toast strong { font-size: 11.5px; font-weight: 600; }
  .cop-memory-toast small { font-size: 10.5px; color: var(--ink-4); }
  .cop-memory-toast button { height: 28px; padding: 0 9px; border: 0; border-radius: 999px; background: var(--surface-2); color: var(--ink-3); font: 500 11px var(--font-sans); cursor: pointer; }
  .cop-memory-toast button:hover { background: var(--surface-hover); color: var(--ink); }
  .cop-memory-toast button:focus-visible { outline: 2px solid var(--line-3); outline-offset: 1px; }
  .cop-memory-toast button.icon { width: 28px; padding: 0; display: inline-flex; align-items: center; justify-content: center; background: transparent; }
  .cop-memory-toast button.icon .msr { font-size: 15px; }

  .cop-memory-view {
    width: min(760px, 100%); margin-inline: auto;
    padding: clamp(8px, calc(4px + 1cqi), 24px) 16px 28px; color: var(--ink-2);
  }
  .cop-memory-heading { min-height: 56px; display: flex; align-items: center; gap: 11px; margin-bottom: 14px; }
  .cop-memory-mark { width: 38px; height: 38px; flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; border-radius: 12px; background: var(--surface-2); color: var(--ink-3); }
  .cop-memory-mark .msr { font-size: 19px; }
  .cop-memory-heading > span:nth-child(2) { min-width: 0; flex: 1; }
  .cop-memory-heading h2 { margin: 0; color: var(--ink); font: 650 16px/1.3 var(--font-sans); }
  .cop-memory-heading p { margin: 2px 0 0; overflow: hidden; color: var(--ink-4); font: 400 11.5px/1.4 var(--font-sans); text-overflow: ellipsis; white-space: nowrap; }
  .cop-memory-sync { display: inline-flex; align-items: center; gap: 6px; color: var(--ink-4); font-size: 10.5px; white-space: nowrap; }
  .cop-memory-sync span { width: 6px; height: 6px; border-radius: 50%; background: var(--ok); animation: breathe 1.6s ease-in-out infinite; }
  .cop-memory-control { min-height: 64px; padding: 10px 12px; display: flex; align-items: center; gap: 12px; border-radius: 14px; background: var(--surface-2); }
  .cop-memory-control > span { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 2px; }
  .cop-memory-control strong { color: var(--ink); font-size: 12px; font-weight: 600; }
  .cop-memory-control small { color: var(--ink-4); font-size: 10.5px; line-height: 1.4; }
  .cop-memory-scope { padding: 12px 2px 11px; display: flex; flex-direction: column; gap: 9px; border-bottom: 1px solid var(--line); }
  .cop-memory-scope-copy { display: flex; flex-direction: column; gap: 2px; }
  .cop-memory-scope-copy strong { color: var(--ink); font-size: 11.5px; font-weight: 600; }
  .cop-memory-scope-copy small { color: var(--ink-4); font-size: 10.5px; line-height: 1.45; }
  .cop-memory-scope-options { display: flex; gap: 6px; min-width: 0; }
  .cop-memory-scope-options button { min-width: 0; height: 30px; padding: 0 10px; display: inline-flex; align-items: center; gap: 6px; border: 0; border-radius: 999px; background: transparent; color: var(--ink-3); font: 550 10.5px var(--font-sans); cursor: pointer; }
  .cop-memory-scope-options button:hover:not(:disabled) { background: var(--surface-hover); color: var(--ink); }
  .cop-memory-scope-options button.active { background: var(--surface-3); color: var(--ink); }
  .cop-memory-scope-options button:focus-visible { outline: 2px solid var(--line-3); outline-offset: 1px; }
  .cop-memory-scope-options button:disabled { opacity: .42; cursor: default; }
  .cop-memory-scope-options .msr { flex: 0 0 auto; font-size: 15px; }
  .cop-switch { width: 38px; height: 22px; flex: 0 0 auto; padding: 2px; border: 0; border-radius: 999px; background: var(--line-3); cursor: pointer; transition: background 160ms ease; }
  .cop-switch span { display: block; width: 18px; height: 18px; border-radius: 50%; background: var(--cream-content); box-shadow: 0 1px 4px rgba(var(--shadow-rgb), 0.16); transition: transform 180ms cubic-bezier(0.22, 1, 0.36, 1); }
  .cop-switch.on { background: var(--ink); }
  .cop-switch.on span { transform: translateX(16px); }
  .cop-switch:focus-visible { outline: 2px solid var(--line-3); outline-offset: 2px; }
  .cop-memory-empty { min-height: 210px; padding: 34px 22px; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
  .cop-memory-empty > .msr { margin-bottom: 10px; color: var(--ink-4); font-size: 25px; }
  .cop-memory-empty strong { color: var(--ink); font-size: 13px; font-weight: 600; }
  .cop-memory-empty p { max-width: 38ch; margin: 6px 0 13px; color: var(--ink-4); font-size: 11.5px; line-height: 1.55; }
  .cop-memory-empty.quiet { min-height: 180px; }
  .cop-memory-loading { padding: 20px 0; display: flex; flex-direction: column; gap: 9px; }
  .cop-memory-loading span { display: block; height: 66px; border-radius: 12px; }
  .cop-memory-error { margin-top: 10px; padding: 9px 10px; display: flex; align-items: flex-start; gap: 8px; border-radius: 11px; background: color-mix(in srgb, var(--err) 10%, transparent); color: var(--err-text); font-size: 11px; line-height: 1.45; }
  .cop-memory-error > .msr { font-size: 16px; }
  .cop-memory-error > span:nth-child(2) { flex: 1; }
  .cop-memory-error button { width: 26px; height: 26px; border: 0; border-radius: 7px; background: transparent; color: inherit; cursor: pointer; }
  .cop-memory-error button:hover { background: rgba(var(--ink-rgb), 0.08); }
  .cop-memory-error button .msr { font-size: 15px; }
  .cop-memory-list-head { min-height: 44px; margin-top: 8px; display: flex; align-items: center; justify-content: space-between; gap: 8px; color: var(--ink-4); font-size: 10.5px; }
  .cop-memory-list-head button { height: 28px; display: inline-flex; align-items: center; gap: 5px; padding: 0 9px; border: 0; border-radius: 999px; background: transparent; color: var(--ink-3); font: 500 10.5px var(--font-sans); cursor: pointer; }
  .cop-memory-list-head button:hover { background: var(--surface-hover); color: var(--ink); }
  .cop-memory-list-head button:focus-visible { outline: 2px solid var(--line-3); outline-offset: 1px; }
  .cop-memory-list-head button .msr { font-size: 14px; }
  .cop-memory-list { border-top: 1px solid var(--line-1); }
  .cop-memory-item { padding: 13px 2px 14px; border-bottom: 1px solid var(--line-1); }
  .cop-memory-item-head { min-height: 26px; display: flex; align-items: center; gap: 5px; }
  .cop-memory-type { padding: 3px 7px; border-radius: 999px; background: var(--surface-2); color: var(--ink-3); font-size: 9.5px; font-weight: 550; }
  .cop-memory-date { margin-left: auto; color: var(--ink-4); font-size: 9.5px; }
  .cop-memory-item-head button { width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center; border: 0; border-radius: 8px; background: transparent; color: var(--ink-4); cursor: pointer; }
  .cop-memory-item-head button:hover { background: var(--surface-hover); color: var(--ink); }
  .cop-memory-item-head button:focus-visible { outline: 2px solid var(--line-3); outline-offset: -2px; }
  .cop-memory-item-head button .msr { font-size: 15px; }
  .cop-memory-item h3 { margin: 6px 0 2px; color: var(--ink); font: 600 12.5px/1.4 var(--font-sans); }
  .cop-memory-description { margin: 0; color: var(--ink-4); font-size: 10.5px; line-height: 1.45; }
  .cop-memory-content { margin: 8px 0 0; color: var(--ink-2); font-size: 11.5px; line-height: 1.55; overflow-wrap: anywhere; }
  .cop-memory-content :global(p) { margin: 0 0 7px; }
  .cop-memory-content :global(p:last-child) { margin-bottom: 0; }
  .cop-memory-form { display: flex; flex-direction: column; gap: 9px; }
  .cop-memory-form label { display: flex; flex-direction: column; gap: 4px; color: var(--ink-4); font-size: 10px; }
  .cop-memory-form input, .cop-memory-form select, .cop-memory-form textarea { width: 100%; border: 0; border-radius: 8px; background: var(--cream-content); color: var(--ink); font: 400 11.5px/1.45 var(--font-sans); box-shadow: inset 0 0 0 1px var(--line-1); }
  .cop-memory-form input, .cop-memory-form select { height: 32px; padding: 0 9px; }
  .cop-memory-form textarea { min-height: 92px; padding: 8px 9px; resize: vertical; }
  .cop-memory-form input:focus, .cop-memory-form select:focus, .cop-memory-form textarea:focus { outline: 2px solid var(--line-3); outline-offset: 1px; }
  .cop-memory-form-actions { display: flex; justify-content: flex-end; gap: 6px; }
  .cop-memory-form-actions button, .cop-memory-confirm button { height: 30px; padding: 0 12px; border: 0; border-radius: 999px; background: var(--surface-2); color: var(--ink-3); font: 500 11px var(--font-sans); cursor: pointer; }
  .cop-memory-form-actions button.primary { background: var(--ink); color: var(--cream-content); }
  .cop-memory-form-actions button:disabled { opacity: 0.4; cursor: default; }
  .cop-memory-confirm { padding: 6px 4px; }
  .cop-memory-confirm strong { color: var(--ink); font-size: 12px; }
  .cop-memory-confirm p { margin: 4px 0 10px; color: var(--ink-4); font-size: 10.5px; }
  .cop-memory-confirm > div { display: flex; justify-content: flex-end; gap: 6px; }
  .cop-memory-confirm button.danger { background: var(--err); color: #fff; }
  .cop-memory-privacy { margin: 14px 0 0; display: flex; align-items: flex-start; gap: 6px; color: var(--ink-4); font-size: 10px; line-height: 1.45; }
  .cop-memory-privacy .msr { font-size: 14px; }
  /* Deux tons pleins (tête surface-2, pied accent-soft par-dessus) : la carte se
     découpe du fond sans aucun contour. */
  .cop-cloud-hero { overflow: hidden; border-radius: 18px; background: var(--surface-2); }
  .cop-cloud-head { display: flex; align-items: center; gap: 11px; padding: 14px 14px 28px; }
  .cop-cloud-icon {
    width: 42px; height: 42px; flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center;
    border-radius: 12px; background: var(--accent-soft); color: var(--ink-2);
  }
  .cop-cloud-icon .msr { font-size: 21px; }
  .cop-cloud-name { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
  .cop-cloud-name strong { overflow: hidden; font-size: 13px; font-weight: 600; color: var(--ink); white-space: nowrap; text-overflow: ellipsis; }
  .cop-cloud-name small { font-size: 10.5px; color: var(--ink-4); }
  .cop-cloud-status {
    height: 23px; flex: 0 0 auto; display: inline-flex; align-items: center; gap: 5px; padding: 0 9px;
    border-radius: 999px; background: var(--surface-2); color: var(--ink-4); font-size: 10.5px; font-weight: 600;
  }
  .cop-cloud-status.ready { background: rgba(107, 164, 123, 0.16); color: var(--ok-text); }
  .cop-cloud-status.unavailable { background: rgba(180, 130, 60, 0.12); color: var(--warn-text); }
  .cop-cloud-status.checking { font-weight: 500; }
  .cop-cloud-status .cop-dot { width: 6px; height: 6px; border: 0; background: var(--ok); }
  .cop-cloud-foot { margin-top: -16px; display: flex; align-items: stretch; padding: 14px; border-radius: 16px 16px 0 0; background: var(--accent-soft); }
  .cop-cloud-foot > span { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 3px; }
  .cop-cloud-foot b { font-size: 13px; font-weight: 600; color: var(--ink); }
  .cop-cloud-foot small { font-size: 9.5px; color: var(--ink-4); letter-spacing: 0.04em; }
  .cop-cloud-foot i { width: 1px; background: var(--line-2); }

  .cop-cloud-note, .cop-cloud-privacy { display: flex; align-items: flex-start; gap: 10px; padding: 11px 12px; border-radius: 11px; background: var(--surface-2); }
  .cop-cloud-note > .msr, .cop-cloud-privacy > .msr { flex: 0 0 auto; margin-top: 1px; font-size: 17px; color: var(--ink-3); }
  .cop-cloud-note > span:last-child { display: flex; flex-direction: column; gap: 3px; }
  .cop-cloud-note strong { font-size: 12px; color: var(--ink); }
  .cop-cloud-note small { font-size: 10.5px; line-height: 1.45; color: var(--ink-4); }
  .cop-cloud-note.ok > .msr { color: var(--ok-text); }
  .cop-cloud-note.warn > .msr { color: var(--warn-text); }
  .cop-cloud-setup { padding: 2px 4px 0; }
  .cop-cloud-setup h3 { margin: 0 0 6px; font-size: 14px; font-weight: 600; color: var(--ink); }
  .cop-cloud-setup > p { margin: 0 0 15px; font-size: 11.5px; line-height: 1.55; color: var(--ink-4); }
  .cop-cloud-setup ol { margin: 0 0 14px; padding: 0; list-style: none; display: flex; flex-direction: column; }
  .cop-cloud-setup li { display: flex; gap: 10px; padding: 9px 0; border-top: 1px solid var(--line-1); }
  .cop-cloud-setup li > span { width: 22px; height: 22px; flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; border-radius: 7px; background: var(--surface-2); font-family: var(--font-mono); font-size: 10px; color: var(--ink-3); }
  .cop-cloud-setup li > span.msr { font-family: 'Material Symbols Rounded'; font-size: 15px; }
  .cop-cloud-setup li p { margin: 0; display: flex; flex-direction: column; gap: 2px; }
  .cop-cloud-setup li strong { font-size: 11.5px; font-weight: 600; color: var(--ink-2); }
  .cop-cloud-setup li small { font-size: 10.5px; line-height: 1.4; color: var(--ink-4); }
  .cop-cloud-setup .cop-btn-fill .msr { font-size: 16px; }
  .cop-cloud-setup .cop-btn-fill:disabled { opacity: 0.55; cursor: default; }
  .cop-btn-quiet {
    width: 100%; min-height: 34px; display: inline-flex; align-items: center; justify-content: center; gap: 7px;
    border: 0; border-radius: 9px; background: var(--surface-2); color: var(--ink-3);
    font-family: var(--font-sans); font-size: 11.5px; cursor: pointer;
    transition: background 140ms ease, color 140ms ease, transform 100ms ease;
  }
  .cop-btn-quiet:hover { background: var(--accent-soft); color: var(--ink); }
  .cop-btn-quiet:active { transform: scale(0.98); }
  .cop-btn-quiet:focus-visible, .cop-auth-code:focus-visible { outline: 2px solid var(--line-3); outline-offset: 2px; }
  .cop-btn-quiet .msr { font-size: 15px; }
  .cop-auth-wait { display: flex; flex-direction: column; align-items: center; text-align: center; }
  .cop-auth-mark {
    width: 38px; height: 38px; margin-bottom: 10px; display: inline-flex; align-items: center; justify-content: center;
    border-radius: 11px; background: var(--surface-2); color: var(--ink-3);
  }
  .cop-auth-mark .msr { font-size: 20px; }
  .cop-auth-code {
    width: 100%; min-height: 52px; margin: 1px 0 12px; padding: 0 14px; display: flex; align-items: center; justify-content: center; gap: 12px;
    border: 0; border-radius: 12px; background: var(--surface-2); color: var(--ink); cursor: pointer;
  }
  .cop-auth-code > span:first-child { font-family: var(--font-mono); font-size: 20px; font-weight: 600; letter-spacing: 0.12em; }
  .cop-auth-code .msr { font-size: 16px; color: var(--ink-4); }
  .cop-auth-actions { width: 100%; display: grid; grid-template-columns: 1fr auto; gap: 7px; }
  .cop-auth-actions .cop-btn-quiet { width: auto; padding-inline: 13px; }
  .cop-auth-pending { margin-top: 12px; display: inline-flex; align-items: center; gap: 7px; font-size: 10.5px; color: var(--ink-4); }
  .cop-auth-pending > span { width: 6px; height: 6px; border-radius: 50%; background: var(--ink-4); animation: doku-breathe 1.6s ease-in-out infinite; }
  .cop-auth-error { margin: 10px 0 0; font-size: 10.5px; line-height: 1.45; color: var(--err-text); text-align: left; }
  .cop-cloud-privacy p { margin: 0; font-size: 10.5px; line-height: 1.5; color: var(--ink-4); }
  .cop-cloud-privacy strong { color: var(--ink-3); font-weight: 600; }

  .cop-mono { font-family: var(--font-mono); font-size: 12.5px; color: var(--ink); font-weight: 500; }
  .grow { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  /* Onboarding */
  .cop-onboard { padding: 26px 8px; display: flex; flex-direction: column; align-items: center; text-align: center; gap: 16px; }
  .cop-onboard-tile {
    width: 54px; height: 54px; border-radius: 15px;
    background: var(--surface-2); display: flex; align-items: center; justify-content: center; color: var(--ink-3);
  }
  .cop-onboard-title { font-size: 15.5px; font-weight: 600; color: var(--ink); margin-bottom: 7px; }
  .cop-onboard-sub { font-size: 12.5px; line-height: 1.6; color: var(--ink-4); }
  .cop-onboard-sub b { color: var(--ink-3); font-weight: 600; }
  .cop-reco { width: 100%; border-radius: 13px; padding: 13px; background: var(--surface-2); text-align: left; }
  .cop-reco-head { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
  .cop-badge { font-size: 10px; color: var(--ink-4); background: var(--accent-soft); border-radius: 5px; padding: 2px 6px; }
  .cop-reco-sub { font-size: 11.5px; color: var(--ink-4); margin-bottom: 11px; }
  .cop-btn-fill {
    width: 100%; height: 34px; display: inline-flex; align-items: center; justify-content: center; gap: 7px;
    background: var(--ink); color: var(--cream-content); border: 0; border-radius: 9px;
    font-family: var(--font-sans); font-size: 12.5px; font-weight: 500; cursor: pointer;
    transition: background 140ms ease, transform 100ms ease;
  }
  .cop-btn-fill:hover { background: var(--ink-2); }
  .cop-btn-fill:not(:disabled):active { transform: scale(0.98); }
  .cop-btn-fill:focus-visible { outline: 2px solid var(--line-3); outline-offset: 2px; }
  .cop-btn-fill:disabled { opacity: 0.55; cursor: default; }

  /* MiniMax : champ clé */
  .cop-mm-connect { display: flex; flex-direction: column; gap: 8px; }
  .cop-mm-connect input {
    height: 34px; padding: 0 11px; border: 0; border-radius: 9px;
    background: var(--surface-2); color: var(--ink); font-family: var(--font-mono); font-size: 12px;
  }
  .cop-mm-connect input:focus-visible { outline: 2px solid var(--line-3); outline-offset: -1px; }

  /* Gestion locale : une seule entrée au repos, toutes les fonctions conservées derrière
     un <details> natif. Le sélecteur « Modèle actif » reste le chemin quotidien. */
  .cop-advanced { margin: 10px 2px 24px; }
  .cop-onboard-more { width: 100%; margin-top: -4px; }
  .cop-advanced > summary {
    min-height: 48px; display: flex; align-items: center; gap: 10px; padding: 6px 10px;
    list-style: none; border-radius: 12px; color: var(--ink-2); cursor: pointer;
    transition: background 140ms ease, color 140ms ease;
  }
  .cop-advanced > summary::-webkit-details-marker { display: none; }
  .cop-advanced > summary:hover { background: var(--surface-hover); color: var(--ink); }
  .cop-advanced > summary:active { background: var(--accent-soft); }
  .cop-advanced > summary:focus-visible { outline: 2px solid var(--line-3); outline-offset: 1px; }
  .cop-advanced-icon {
    width: 32px; height: 32px; flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center;
    border-radius: 10px; background: var(--surface-2); color: var(--ink-3);
  }
  .cop-advanced-icon .msr { font-size: 17px; }
  .cop-advanced-copy { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 2px; text-align: left; }
  .cop-advanced-copy strong { font-size: 12.5px; font-weight: 600; color: var(--ink-2); }
  .cop-advanced-copy small { overflow: hidden; font-size: 10.5px; color: var(--ink-4); white-space: nowrap; text-overflow: ellipsis; }
  .cop-advanced-chev { flex: 0 0 auto; font-size: 17px; color: var(--ink-4); transition: transform 180ms cubic-bezier(0.22, 1, 0.36, 1); }
  .cop-advanced[open] .cop-advanced-chev { transform: rotate(180deg); }
  .cop-advanced-body { padding: 14px 0 0; }
  .cop-download-now { margin: 12px 2px; }

  /* Sections modèles */
  .cop-sections { padding: 8px 2px; display: flex; flex-direction: column; gap: 20px; }
  .cop-label { font-size: 10.5px; color: var(--ink-4); font-weight: 600; letter-spacing: 0.06em; margin-bottom: 9px; }
  .cop-label.row { display: flex; align-items: baseline; justify-content: space-between; }
  .cop-count { font-size: 11px; color: var(--ink-4); white-space: nowrap; letter-spacing: 0; }

  .cop-dot { width: 8px; height: 8px; flex: 0 0 auto; border-radius: 50%; border: 1.5px solid var(--line-3); }
  .cop-dot.breathe { animation: doku-breathe 2s ease-in-out infinite; }
  .cop-dot.on { background: var(--ok); border: 0; box-shadow: 0 0 0 3px rgba(107, 164, 123, 0.18); }

  /* Bibliothèque */
  .cop-lib { display: flex; flex-direction: column; gap: 5px; }
  .cop-row { display: flex; align-items: center; border-radius: 12px; }
  .cop-row:hover { background: var(--surface-hover); }
  .cop-row.active { background: var(--accent-soft); }
  .cop-row-pick {
    flex: 1; display: flex; align-items: center; gap: 10px; min-width: 0;
    padding: 9px 4px 9px 11px; border: 0; background: none; color: var(--ink); text-align: left; cursor: pointer;
  }
  .cop-row-pick:focus-visible { outline: 2px solid var(--line-3); outline-offset: -2px; border-radius: 10px; }
  .cop-row-pick:disabled { cursor: default; }
  .cop-size { font-size: 11px; color: var(--ink-4); white-space: nowrap; flex-shrink: 0; }
  .cop-del { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 38px; border: 0; border-radius: 8px; background: none; color: var(--ink-4); cursor: pointer; transition: background 120ms ease, color 120ms ease, transform 100ms ease; }
  .cop-del:hover { color: var(--err); }
  .cop-del:active { background: var(--surface-hover); transform: scale(0.94); }
  .cop-del:focus-visible { outline: 2px solid var(--line-3); outline-offset: -2px; color: var(--err-text); }

  /* Téléchargement */
  .cop-dl { padding: 11px 12px; border-radius: 12px; background: var(--surface-2); }
  .cop-dl-head { display: flex; align-items: center; gap: 9px; margin-bottom: 9px; }
  .cop-track { height: 5px; background: var(--accent-soft); border-radius: 3px; overflow: hidden; }
  .orbit { color: var(--ink-4); animation: doku-orbit 1.4s linear infinite; }

  /* Ajouter */
  .cop-add {
    display: flex; align-items: center; gap: 7px; height: 38px; padding: 0 6px 0 12px;
    border-radius: 11px; background: var(--surface-2);
  }
  .cop-add-input {
    flex: 1; min-width: 0; border: 0; background: transparent; outline: none;
    font-family: var(--font-mono); font-size: 12.5px; color: var(--ink);
  }
  .cop-add-input::placeholder { color: var(--ink-4); }
  .cop-add:focus-within { outline: 2px solid var(--line-3); outline-offset: -2px; }
  .cop-btn-sm {
    height: 28px; padding: 0 13px; background: var(--ink); color: var(--cream-content); border: 0; border-radius: 8px;
    font-family: var(--font-sans); font-size: 12px; font-weight: 500; cursor: pointer;
    transition: background 140ms ease, transform 100ms ease;
  }
  .cop-btn-sm:disabled { opacity: 0.45; cursor: default; }
  .cop-btn-sm:not(:disabled):hover { background: var(--ink-2); }
  .cop-btn-sm:not(:disabled):active { transform: scale(0.97); }
  .cop-btn-sm:focus-visible { outline: 2px solid var(--line-3); outline-offset: 2px; }
  .cop-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 9px; }
  .cop-chip {
    display: inline-flex; align-items: center; gap: 4px; height: 26px; padding: 0 10px;
    border: 0; border-radius: 999px; background: var(--surface-2);
    color: var(--ink-3); font-family: var(--font-mono); font-size: 11.5px; cursor: pointer;
  }
  .cop-chip:hover { color: var(--ink); }
  /* Dans une carte déjà surface-2 (index du dossier), les chips passent en clair. */
  .cop-rag .cop-chip { background: var(--cream-content); }
  .cop-rag .cop-chip.sel { background: var(--accent-soft); }

  /* Index du dossier (15.2) */
  .cop-rag { padding: 11px 12px; border-radius: 12px; background: var(--surface-2); }
  .cop-rag-row { display: flex; align-items: center; gap: 9px; }
  .cop-rag-progress { display: flex; align-items: center; gap: 9px; margin-top: 9px; }
  .cop-rag-note { font-size: 11.5px; line-height: 1.55; color: var(--ink-4); margin-top: 8px; }
  .cop-rag-note.err { color: var(--err-text); display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .cop-chip.sel { background: var(--accent-soft); color: var(--ink); }
  .cop-chip-tag { margin-left: 5px; font-family: var(--font-sans); font-size: 10px; color: var(--ink-4); letter-spacing: 0.03em; }
  .cop-rag-del {
    border: 0; background: none; padding: 0; margin-left: 4px; cursor: pointer;
    font-family: var(--font-sans); font-size: 11.5px; color: var(--ink-4); text-decoration: underline;
  }
  .cop-rag-del:hover { color: var(--err); }

  /* Chat — accueil */
  .cop-chat-empty {
    min-height: 100%;
    padding: clamp(44px, calc(34px + 2.5cqi), 64px) 0 clamp(82px, calc(67px + 3.75cqi), 112px);
    display: flex; flex-direction: column;
    justify-content: center; align-items: center; text-align: center;
  }
  .cop-empty-mark {
    width: clamp(46px, calc(42px + 1cqi), 54px); height: clamp(46px, calc(42px + 1cqi), 54px);
    display: flex; align-items: center; justify-content: center;
    margin-bottom: clamp(24px, calc(20px + 1cqi), 32px);
    border-radius: clamp(15px, calc(13.5px + 0.375cqi), 18px);
    background: transparent; color: var(--ink-4);
    box-shadow: inset 0 0 0 1px var(--line-2);
  }
  .cop-empty-mark .msr { font-size: clamp(23px, calc(21px + 0.5cqi), 27px); }
  .cop-empty-title {
    max-width: 30ch; margin: 0 0 clamp(38px, calc(30px + 2cqi), 54px); color: var(--ink);
    font: 500 clamp(23px, calc(15.5px + 1.875cqi), 38px)/1.25 var(--font-sans);
    letter-spacing: -0.022em; text-wrap: balance;
  }
  .cop-actions {
    width: 100%; max-width: 920px; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: clamp(9px, calc(5.5px + 0.875cqi), 16px);
    text-align: left;
  }
  .cop-action {
    min-width: 0; min-height: clamp(132px, calc(106px + 6.5cqi), 184px);
    padding: clamp(16px, calc(12px + 1cqi), 24px) clamp(14px, calc(8px + 1.5cqi), 26px);
    display: flex; flex-direction: column; align-items: flex-start; justify-content: space-between;
    gap: clamp(24px, calc(19px + 1.25cqi), 34px);
    border: 1px solid var(--line-1);
    border-radius: clamp(17px, calc(14.5px + 0.625cqi), 22px);
    background: transparent; color: var(--ink-2);
    box-shadow: none;
    font-family: var(--font-sans); text-align: left; cursor: pointer;
    transition: background 160ms ease, color 160ms ease, box-shadow 160ms ease, transform 100ms ease;
  }
  .cop-action:hover {
    background: var(--surface-hover); border-color: var(--line-2); color: var(--ink);
    box-shadow: none;
  }
  .cop-action:active { background: var(--surface-2); transform: scale(0.985); }
  .cop-action:focus-visible { outline: 2px solid var(--line-3); outline-offset: 2px; }
  .cop-action-icon {
    flex: 0 0 auto; color: var(--ink-3);
    font-size: clamp(21px, calc(19px + 0.5cqi), 25px);
    transition: color 160ms ease, transform 160ms cubic-bezier(0.22, 1, 0.36, 1);
  }
  .cop-action:hover .cop-action-icon { color: var(--ink); transform: translateY(-1px); }
  .cop-action strong {
    max-width: 17ch; color: inherit;
    font-size: clamp(12px, calc(9.5px + 0.625cqi), 17px);
    line-height: 1.45; font-weight: 600; text-wrap: pretty;
  }

  /* Chat — conversation */
  .cop-conv { padding: 20px 2px 18px; display: flex; flex-direction: column; gap: 26px; }
  .cop-user { display: flex; justify-content: flex-end; padding-left: 44px; }
  .cop-user-bubble {
    max-width: 100%; background: var(--surface-2); border: 0; border-radius: 17px 17px 5px 17px;
    padding: 9px 13px; font-size: 13px; line-height: 1.55; color: var(--ink); white-space: pre-wrap; overflow-wrap: anywhere;
  }
  /* Le contenu de la conversation doit être COPIABLE (le body global est en user-select:none) :
     sans ça, une question échouée ne peut même pas être re-copiée pour la retaper. */
  .cop-user-bubble, .cop-md, .cop-md-plain, .cop-err-msg { user-select: text; }
  .cop-asst { padding-right: 4px; }
  .cop-asst-head { display: flex; align-items: center; gap: 7px; margin-bottom: 10px; }
  .cop-asst-head > .msr {
    width: 24px; height: 24px; display: inline-flex; align-items: center; justify-content: center;
    border-radius: 8px; background: var(--surface-2);
  }
  .cop-asst-name { font-size: 11.5px; color: var(--ink-3); font-weight: 550; }
  .cop-copy { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border: 0; border-radius: 8px; background: transparent; color: var(--ink-4); cursor: pointer; opacity: 0.72; transition: background 120ms ease, color 120ms ease, opacity 120ms ease, transform 100ms ease; }
  .cop-copy:hover { background: var(--surface-hover); color: var(--ink); }
  .cop-copy:hover, .cop-copy:focus-visible { opacity: 1; }
  .cop-copy:active { transform: scale(0.92); }
  .cop-copy:focus-visible { outline: 2px solid var(--line-3); outline-offset: 1px; }
  .cop-status { display: flex; align-items: center; gap: 9px; font-size: 12.5px; color: var(--ink-4); padding-top: 2px; min-height: 20px; }
  /* Texte d'attente : balayage de lumière en boucle. Le shimmer est un ENRICHISSEMENT posé
     sous `no-preference` — jamais un override à défaire : le texte transparent (clip) ne
     peut donc pas survivre à un cas où la règle de repli ne s'appliquerait pas. */
  @media (prefers-reduced-motion: no-preference) {
    .cop-shimmer {
      background: linear-gradient(
        100deg,
        var(--ink-4) 0%,
        var(--ink-4) 38%,
        var(--ink) 50%,
        var(--ink-4) 62%,
        var(--ink-4) 100%
      );
      background-size: 220% 100%;
      -webkit-background-clip: text;
      background-clip: text;
      -webkit-text-fill-color: transparent;
      animation: cop-shimmer 2.4s linear infinite;
    }
  }
  @keyframes cop-shimmer {
    from { background-position: 140% 0; }
    to { background-position: -40% 0; }
  }
  .cop-md-plain { font-size: 13.5px; line-height: 1.65; color: var(--ink-2); white-space: pre-wrap; overflow-wrap: anywhere; }
  /* Curseur de streaming : pulse doux au bout du texte qui s'écrit (retiré au rendu final). */
  .cop-md-plain.streaming::after {
    content: '';
    display: inline-block;
    width: 3px;
    height: 13px;
    margin-left: 3px;
    border-radius: 2px;
    background: var(--ink-3);
    vertical-align: -2px;
    animation: cop-caret 1s ease-in-out infinite;
  }
  @keyframes cop-caret {
    0%, 100% { opacity: 0.85; }
    50% { opacity: 0.15; }
  }

  /* Points chorégraphiés (attente/réflexion) : une boucle de 7,5 s enchaîne quatre figures —
     vague (2 rebonds décalés) → regroupement au centre → ORBITE (le wrapper tourne 2 tours
     pendant que les points tiennent un triangle) → retour en ligne → pulse en cascade.
     Le wrapper finit à 720° ≡ 0° : la boucle reprend sans saut visible. Transform/opacity
     uniquement (composité GPU). */
  .cop-think {
    position: relative;
    width: 26px;
    height: 14px;
    flex: 0 0 auto;
    animation: cop-think-spin 7.5s linear infinite;
  }
  .cop-think i {
    position: absolute;
    left: 50%;
    top: 50%;
    width: 4.5px;
    height: 4.5px;
    margin: -2.25px;
    border-radius: 50%;
    background: var(--ink-4);
    animation-duration: 7.5s;
    animation-timing-function: ease-in-out;
    animation-iteration-count: infinite;
  }
  .cop-think i:nth-child(1) { animation-name: cop-think-a; }
  .cop-think i:nth-child(2) { animation-name: cop-think-b; }
  .cop-think i:nth-child(3) { animation-name: cop-think-c; }
  @keyframes cop-think-spin {
    0%, 36% { transform: rotate(0deg); }
    64%, 100% { transform: rotate(720deg); }
  }
  /* Repères partagés : 0-24 vague · 28-34 regroupement · 36-62 triangle (l'orbite vient du
     wrapper) · 66 regroupement · 72 retour en ligne · 76-92 pulse en cascade · 100 boucle. */
  @keyframes cop-think-a {
    0% { transform: translate(-8px, 0); }
    4% { transform: translate(-8px, -4.5px); }
    9% { transform: translate(-8px, 0); }
    13% { transform: translate(-8px, -4.5px); }
    18%, 28% { transform: translate(-8px, 0); }
    34% { transform: translate(0, 0) scale(0.7); }
    38%, 62% { transform: translate(0, -5px) scale(1); }
    66% { transform: translate(0, 0) scale(0.7); }
    72% { transform: translate(-8px, 0) scale(1); }
    78% { transform: translate(-8px, 0) scale(1.4); }
    84%, 100% { transform: translate(-8px, 0) scale(1); }
  }
  @keyframes cop-think-b {
    0%, 3% { transform: translate(0, 0); }
    7% { transform: translate(0, -4.5px); }
    12% { transform: translate(0, 0); }
    16% { transform: translate(0, -4.5px); }
    21%, 28% { transform: translate(0, 0); }
    34% { transform: translate(0, 0) scale(0.7); }
    38%, 62% { transform: translate(-4.3px, 2.6px) scale(1); }
    66% { transform: translate(0, 0) scale(0.7); }
    72%, 81% { transform: translate(0, 0) scale(1); }
    87% { transform: translate(0, 0) scale(1.4); }
    93%, 100% { transform: translate(0, 0) scale(1); }
  }
  @keyframes cop-think-c {
    0%, 6% { transform: translate(8px, 0); }
    10% { transform: translate(8px, -4.5px); }
    15% { transform: translate(8px, 0); }
    19% { transform: translate(8px, -4.5px); }
    24%, 28% { transform: translate(8px, 0); }
    34% { transform: translate(0, 0) scale(0.7); }
    38%, 62% { transform: translate(4.3px, 2.6px) scale(1); }
    66% { transform: translate(0, 0) scale(0.7); }
    72%, 84% { transform: translate(8px, 0) scale(1); }
    90% { transform: translate(8px, 0) scale(1.4); }
    96%, 100% { transform: translate(8px, 0) scale(1); }
  }
  /* Mouvement réduit : plus de trajectoires — fondu d'opacité décalé, points en ligne.
     nth-child (même spécificité que les règles chorégraphiées, source postérieure). */
  @media (prefers-reduced-motion: reduce) {
    .cop-think { animation: none; }
    .cop-think i:nth-child(1) { animation: cop-think-fade 1.6s ease-in-out infinite; transform: translate(-8px, 0); }
    .cop-think i:nth-child(2) { animation: cop-think-fade 1.6s ease-in-out 0.25s infinite; transform: none; }
    .cop-think i:nth-child(3) { animation: cop-think-fade 1.6s ease-in-out 0.5s infinite; transform: translate(8px, 0); }
    .cop-md-plain.streaming::after { animation-duration: 1.6s; }
  }
  @keyframes cop-think-fade {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.25; }
  }

  /* Rendu Markdown assaini (contenu injecté via {@html} → styles :global) */
  .cop-md { font-size: 13.5px; line-height: 1.65; color: var(--ink-2); overflow-wrap: anywhere; }
  .cop-md :global(p) { margin: 0 0 10px; }
  .cop-md :global(> *:last-child) { margin-bottom: 0; }
  .cop-md :global(ul), .cop-md :global(ol) { padding-left: 18px; margin: 0 0 12px; display: flex; flex-direction: column; gap: 5px; }
  .cop-md :global(h1), .cop-md :global(h2), .cop-md :global(h3) { font-size: 14px; font-weight: 600; color: var(--ink); margin: 12px 0 6px; }
  .cop-md :global(a) { color: var(--ink); text-decoration: underline; }
  .cop-md :global(code) { background: var(--code-bg); border-radius: 4px; padding: 1px 4px; font-family: var(--font-mono); font-size: 11.5px; }
  .cop-md :global(pre) { background: var(--code-bg); border-radius: 8px; padding: 10px 12px; overflow-x: auto; margin: 0 0 10px; }
  .cop-md :global(pre code) { background: none; padding: 0; }
  .cop-md :global(blockquote) { padding: 9px 11px; border-radius: 8px; background: var(--surface-2); color: var(--ink-3); margin: 0 0 10px; }
  /* border-collapse ignore border-radius → separate + spacing 0 (mêmes hairlines, coins ronds réels) */
  .cop-md :global(table) { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 12px; border: 1px solid var(--line-1); border-radius: 8px; overflow: hidden; margin: 0 0 10px; }
  .cop-md :global(tr:last-child td) { border-bottom: 0; }
  .cop-md :global(th) { background: var(--surface-2); text-align: left; padding: 5px 9px; color: var(--ink); font-weight: 600; border-bottom: 1px solid var(--line-1); }
  .cop-md :global(td) { padding: 5px 9px; color: var(--ink-2); border-bottom: 1px solid var(--line-1); }

  /* Carte d'erreur (génération échouée) */
  .cop-err-card { display: flex; gap: 11px; padding: 13px; border-radius: 12px; background: var(--surface-2); }
  .cop-err-title { font-size: 13px; font-weight: 600; color: var(--ink); margin-bottom: 3px; }
  .cop-err-msg { font-size: 12px; line-height: 1.5; color: var(--ink-4); margin: 0 0 11px; }
  .cop-err-acts { display: flex; gap: 7px; }
  .cop-err-btn { height: 30px; padding: 0 12px; background: var(--cream-content); color: var(--ink-3); border: 0; border-radius: 8px; font-family: var(--font-sans); font-size: 12px; cursor: pointer; transition: background 120ms ease, color 120ms ease, filter 120ms ease, transform 100ms ease; }
  .cop-err-btn:hover { background: var(--surface-hover); color: var(--ink); }
  .cop-err-btn:active { transform: scale(0.97); }
  .cop-err-btn:focus-visible { outline: 2px solid var(--line-3); outline-offset: 2px; }
  .cop-err-btn.primary { background: var(--ink); color: var(--cream-content); border-color: var(--ink); }
  .cop-err-btn.primary:hover { background: var(--ink-2); }
  .cop-err-btn.danger { background: var(--err); color: #fff; border-color: var(--err); }
  .cop-err-btn.danger:hover { filter: brightness(0.92); }

  /* Confirmation inline de suppression (remplace le confirm() natif) */
  .cop-row.confirm { flex-direction: column; align-items: stretch; gap: 9px; padding: 11px 12px; background: var(--surface-2); }
  .cop-confirm-txt { font-size: 12px; line-height: 1.5; color: var(--ink-2); overflow-wrap: anywhere; }
  .cop-confirm-acts { display: flex; gap: 6px; justify-content: flex-end; }

  /* Bannière d'erreur (vue modèles) avec dismiss */
  .cop-msg.row { display: flex; align-items: flex-start; gap: 8px; }
  .grow-wrap { flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .cop-dismiss { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; flex: 0 0 auto; border: 0; border-radius: 7px; background: transparent; color: var(--ink-4); cursor: pointer; transition: background 120ms ease, color 120ms ease, transform 100ms ease; }
  .cop-dismiss:hover { background: var(--surface-hover); color: var(--ink); }
  .cop-dismiss:active { transform: scale(0.92); }
  .cop-dismiss:focus-visible { outline: 2px solid var(--line-3); outline-offset: -2px; }

  /* Composeur à deux plans : Question et Contexte permutent leur profondeur. */
  .cop-input-wrap {
    flex-shrink: 0;
    padding: 8px max(16px, calc((100% - 760px) / 2)) 10px;
    background: var(--cream-content);
    container-type: inline-size;
  }
  .cop-composer-shell {
    overflow: visible;
  }
  .cop-composer-shell:focus-within .cop-composer-front {
    box-shadow: 0 10px 28px rgba(var(--shadow-rgb), 0.09);
  }
  .cop-composer-back {
    width: calc(100% - 28px);
    height: 58px;
    margin-inline: 14px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px 16px;
    border: 0;
    border-radius: 16px;
    background: color-mix(in srgb, var(--cream-tint) 78%, var(--cream-content));
    box-shadow: 0 5px 18px rgba(var(--shadow-rgb), 0.04);
    color: var(--ink-3);
    font-family: var(--font-sans);
    text-align: left;
    cursor: pointer;
    transition: background 160ms ease, color 160ms ease;
  }
  :global([data-theme='dark']) .cop-composer-back { background: var(--cream-soft); }
  .cop-composer-back:hover { background: var(--surface-hover); color: var(--ink); }
  .cop-composer-back:active { background: var(--accent-soft); }
  .cop-composer-back:focus-visible { outline: 2px solid var(--line-3); outline-offset: -3px; border-radius: 16px; }
  .cop-composer-back-icon {
    width: 28px; height: 28px; flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center;
    border: 0; border-radius: 9px; background: var(--cream-content); color: var(--ink-3);
  }
  :global([data-theme='dark']) .cop-composer-back-icon { background: var(--surface-2); }
  .cop-composer-back-icon .msr { font-size: 16px; }
  .cop-composer-back-label { font-size: 12px; font-weight: 600; }
  .cop-composer-note {
    margin-left: auto;
    min-width: 0;
    overflow: hidden;
    color: var(--ink-4);
    font-size: 10.5px;
    font-weight: 450;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .cop-composer-switch { flex: 0 0 auto; font-size: 15px; color: var(--ink-4); transition: transform 240ms cubic-bezier(0.22, 1, 0.36, 1); }
  .cop-composer-back:hover .cop-composer-switch { transform: rotate(180deg); }
  .cop-composer-front {
    position: relative;
    z-index: 1;
    min-width: 0;
    margin-top: -16px;
    overflow: hidden;
    border: 0;
    border-radius: 16px;
    background: var(--composer-bg);
    box-shadow: 0 8px 26px rgba(var(--shadow-rgb), 0.07);
    animation: cop-composer-drawer-in 240ms cubic-bezier(0.22, 1, 0.36, 1);
  }
  .cop-composer-front-tab {
    width: 100%; height: 38px; display: flex; align-items: center; gap: 8px; padding: 0 12px;
    border: 0; background: transparent; color: var(--ink-2);
    font-family: var(--font-sans); font-size: 12px; font-weight: 600; text-align: left; cursor: default;
  }
  .cop-composer-front-tab .msr { font-size: 16px; color: var(--ink-3); }
  .cop-composer-front-tab:focus-visible { outline: 2px solid var(--line-3); outline-offset: -3px; border-radius: 14px; }
  .cop-composer-active-label {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    border: 0;
    background: transparent;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  .cop-composer-front:has(.cop-composer-active-label:focus-visible) {
    outline: 2px solid var(--line-3);
    outline-offset: -3px;
  }
  .cop-composer-panels { display: grid; min-width: 0; }
  .cop-composer-panel {
    grid-area: 1 / 1;
    min-width: 0;
    visibility: hidden;
    opacity: 0;
    pointer-events: none;
    transform: translateY(4px);
    transition: opacity 160ms ease, transform 220ms cubic-bezier(0.22, 1, 0.36, 1);
  }
  .cop-composer-panel:not(.active) { display: none; }
  .cop-composer-panel.active { visibility: visible; opacity: 1; pointer-events: auto; transform: translateY(0); }
  .cop-question-drawer {
    min-height: 94px;
    padding: 10px 8px 8px;
    display: grid;
    grid-template-columns: 36px minmax(0, 1fr) 36px;
    grid-template-rows: minmax(34px, auto) 36px;
    column-gap: 8px;
  }
  .cop-input-attach {
    grid-column: 1; grid-row: 2;
    width: 36px; height: 36px; display: inline-flex; align-items: center; justify-content: center;
    background: transparent; border: 0; border-radius: 10px; color: var(--ink-4); cursor: pointer;
    transition: background 120ms ease, color 120ms ease, transform 140ms cubic-bezier(0.22, 1, 0.36, 1);
  }
  .cop-input-attach:hover, .cop-input-attach.open { background: var(--surface-hover); color: var(--ink); }
  .cop-input-attach.open { transform: rotate(45deg); }
  .cop-input-attach:focus-visible { outline: 2px solid var(--line-3); outline-offset: -2px; }
  .cop-input-attach:disabled { opacity: 0.45; cursor: wait; }
  .cop-input-ta {
    grid-column: 1 / -1; grid-row: 1; align-self: start;
    width: 100%; min-width: 0; border: 0; background: transparent; outline: none; resize: none;
    font-family: var(--font-sans); font-size: 13.5px; line-height: 1.45; color: var(--ink); padding: 2px 4px 7px; max-height: 120px;
    field-sizing: content; /* auto-grow : les lignes Shift+Entrée restent visibles (WebView2 OK) */
  }
  .cop-input-ta::placeholder { color: var(--ink-4); }
  .cop-input-send { grid-column: 3; grid-row: 2; width: 36px; height: 36px; display: inline-flex; align-items: center; justify-content: center; background: var(--ink); border: 0; border-radius: 50%; color: var(--cream-content); cursor: pointer; transition: background 140ms ease, opacity 140ms ease, transform 100ms ease; }
  .cop-input-send:hover { background: var(--ink-2); }
  .cop-input-send:not(:disabled):active { transform: scale(0.94); }
  .cop-input-send:focus-visible { outline: 2px solid var(--line-3); outline-offset: 2px; }
  .cop-input-send:disabled { opacity: 0.4; cursor: default; }
  .cop-context-drawer {
    min-height: 56px;
    padding: 6px;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 4px;
  }
  /* Portée (15.3) : deux lignes sélectionnables — document courant / dossier entier. */
  .cop-scope {
    display: flex; align-items: center; gap: 8px; padding: 5px 8px; min-width: 0;
    border: 0; border-radius: 11px; background: none; color: var(--ink);
    text-align: left; cursor: pointer; transition: background 120ms ease;
  }
  .cop-scope:hover { background: var(--surface-hover); }
  .cop-scope:active { background: var(--accent-soft); }
  .cop-scope:focus-visible { outline: 2px solid var(--line-3); outline-offset: -2px; }
  .cop-scope.sel { background: var(--accent-soft); }

  /* Style des réponses : puce compacte dans la rangée de saisie + menu vers le haut. */
  .cop-verb-root { position: relative; flex: 0 0 auto; align-self: flex-end; margin-bottom: 3px; }
  .cop-verb-chip {
    display: inline-flex; align-items: center; gap: 3px; height: 26px; padding: 0 4px 0 9px;
    border: 0; border-radius: 999px; background: var(--surface-2); color: var(--ink-3);
    font-family: var(--font-sans); font-size: 11px; font-weight: 500; cursor: pointer;
    transition: background 120ms ease, color 120ms ease, transform 100ms ease;
  }
  .cop-verb-chip:hover, .cop-verb-chip.open { background: var(--accent-soft); color: var(--ink); }
  .cop-verb-chip:active { transform: scale(0.97); }
  .cop-verb-chip:focus-visible { outline: 2px solid var(--line-3); outline-offset: 1px; }
  .cop-verb-chip .msr { font-size: 15px; color: var(--ink-4); }
  .cop-verb-menu {
    position: absolute; z-index: 40;
    width: 236px; padding: 6px;
    border-radius: 14px; background: var(--cream-tint);
    box-shadow:
      0 0 0 1px var(--elevation-ring-soft),
      0 12px 30px rgba(var(--shadow-rgb), 0.16);
    animation: cop-picker-in 140ms cubic-bezier(0.22, 1, 0.36, 1);
  }
  /* Curseur à 3 crans (essai façon « effort ») : piste pleine jusqu'au pouce, ticks.
     Pas d'en-tête : le libellé courant sous le curseur dit déjà tout. */
  .cop-verb-sliderwrap { position: relative; padding: 6px 4px 2px; }
  .cop-verb-ticks {
    position: absolute; inset: 6px 17px 2px; display: flex; align-items: center; justify-content: space-between;
    pointer-events: none;
  }
  .cop-verb-ticks span { width: 4px; height: 4px; border-radius: 50%; background: rgba(var(--ink-rgb), 0.22); }
  /* Sous le remplissage (fond = ink) : ton inverse translucide, lisible dans les 2 thèmes. */
  .cop-verb-ticks span.lit { background: var(--cream-content); opacity: 0.7; }
  .cop-verb-ticks span.under-thumb { opacity: 0; }
  .cop-verb-slider {
    -webkit-appearance: none; appearance: none; display: block; width: 100%; height: 26px;
    margin: 0; background: transparent; cursor: pointer;
  }
  .cop-verb-slider:focus-visible { outline: 2px solid var(--line-3); outline-offset: 3px; border-radius: 999px; }
  .cop-verb-slider::-webkit-slider-runnable-track {
    height: 18px; border-radius: 999px;
    background: linear-gradient(to right, var(--ink) 0 var(--fill), var(--surface-2) var(--fill) 100%);
    /* Liseré intérieur : l'étendue TOTALE de la course reste lisible même à vide. */
    box-shadow: inset 0 0 0 1px rgba(var(--ink-rgb), 0.14);
  }
  .cop-verb-slider::-webkit-slider-thumb {
    -webkit-appearance: none; appearance: none;
    width: 24px; height: 24px; margin-top: -3px; border: 0; border-radius: 50%;
    background: #fff;
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.08), 0 2px 6px rgba(0, 0, 0, 0.25);
  }
  .cop-verb-current { display: flex; align-items: center; gap: 10px; padding: 8px 6px 4px; }
  .cop-verb-item-ic {
    width: 28px; height: 28px; flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center;
    border-radius: 8px; background: var(--surface-2); color: var(--ink-3);
  }
  .cop-verb-item-ic .msr { font-size: 16px; }
  .cop-verb-item-copy { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
  .cop-verb-item-copy strong { font-size: 12px; font-weight: 600; color: var(--ink); }
  .cop-verb-item-copy small { font-size: 10.5px; color: var(--ink-4); }
  .cop-context-icon {
    width: 36px; height: 36px; flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center;
    border-radius: 10px; background: var(--surface-2); color: var(--ink-3);
  }
  .cop-context-icon .msr { font-size: 18px; }
  .cop-context-copy { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .cop-context-copy strong { overflow: hidden; color: var(--ink-2); font-size: 11.5px; font-weight: 550; white-space: nowrap; text-overflow: ellipsis; }
  .cop-context-copy small { overflow: hidden; color: var(--ink-4); font-size: 10.5px; line-height: 1.3; white-space: nowrap; text-overflow: ellipsis; }
  .cop-context-state {
    height: 24px; flex: 0 0 auto; display: inline-flex; align-items: center; gap: 4px; padding: 0 8px;
    border-radius: 999px; background: var(--surface-2); color: var(--ink-4); font-size: 10px; white-space: nowrap;
  }
  .cop-context-state.warn { background: rgba(180, 130, 60, 0.12); color: var(--warn-text); }
  .cop-context-state .msr { font-size: 13px; }
  .cop-context-extra {
    display: flex; align-items: center; gap: 9px; min-width: 0; padding: 6px 8px;
    border-radius: 11px; background: var(--surface-2); color: var(--ink-3);
  }
  .cop-context-extra > .msr { flex: 0 0 auto; font-size: 17px; color: var(--ink-4); }
  .cop-context-extra-copy { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 1px; }
  .cop-context-extra-copy strong { overflow: hidden; font-size: 11.5px; font-weight: 550; color: var(--ink-2); text-overflow: ellipsis; white-space: nowrap; }
  .cop-context-extra-copy small { font-size: 10px; color: var(--ink-4); }
  .cop-context-extra > button {
    width: 28px; height: 28px; flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center;
    border: 0; border-radius: 999px; background: transparent; color: var(--ink-4); cursor: pointer;
  }
  .cop-context-extra > button:hover { background: var(--surface-hover); color: var(--ink); }
  .cop-context-extra > button:focus-visible { outline: 2px solid var(--line-3); outline-offset: -2px; }
  .cop-context-extra > button .msr { font-size: 16px; }
  .cop-context-memory { min-height: 46px; padding: 6px 8px; display: flex; align-items: center; gap: 8px; border: 0; border-radius: 11px; background: transparent; color: var(--ink-2); text-align: left; cursor: pointer; }
  .cop-context-memory:hover { background: var(--surface-hover); }
  .cop-context-memory:focus-visible { outline: 2px solid var(--line-3); outline-offset: -2px; }
  .cop-context-memory > .msr:first-child { font-size: 17px; color: var(--ink-4); }
  .cop-context-memory > span:nth-child(2) { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 1px; }
  .cop-context-memory strong { font-size: 11.5px; font-weight: 550; }
  .cop-context-memory small { font-size: 10px; color: var(--ink-4); }
  .cop-context-memory > .msr:last-child { font-size: 15px; color: var(--ink-4); }
  .cop-context-destination, .cop-context-history, .cop-context-error {
    margin: 2px 8px; font-size: 10px; line-height: 1.35; color: var(--ink-4);
  }
  .cop-context-destination { display: flex; align-items: center; gap: 5px; }
  .cop-context-destination .msr { font-size: 14px; }
  .cop-context-error { color: var(--danger-text); }
  .cop-disclaimer { text-align: center; font-size: 10.5px; line-height: 1.35; color: var(--ink-4); margin-top: 8px; }

  .cop-add-context-menu {
    position: absolute; z-index: 45; width: 276px; padding: 6px;
    border-radius: 14px; background: var(--cream-tint);
    box-shadow: 0 0 0 1px var(--elevation-ring-soft), 0 14px 34px rgba(var(--shadow-rgb), 0.18);
    animation: cop-picker-in 140ms cubic-bezier(0.22, 1, 0.36, 1);
  }
  .cop-add-context-head { display: flex; flex-direction: column; gap: 2px; padding: 8px 10px 7px; }
  .cop-add-context-head strong { font-size: 12px; font-weight: 650; color: var(--ink); }
  .cop-add-context-head small { font-size: 10px; color: var(--ink-4); }
  .cop-add-context-action {
    width: 100%; min-height: 48px; display: flex; align-items: center; gap: 10px; padding: 7px 9px;
    border: 0; border-radius: 10px; background: transparent; color: var(--ink); text-align: left; cursor: pointer;
  }
  .cop-add-context-action:hover, .cop-add-context-action:focus-visible { background: var(--surface-hover); outline: none; }
  .cop-add-context-action:disabled { opacity: 0.38; cursor: default; background: transparent; }
  .cop-add-context-action > .msr {
    width: 30px; height: 30px; flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center;
    border-radius: 9px; background: var(--surface-2); color: var(--ink-3); font-size: 17px;
  }
  .cop-add-context-action > span:last-child { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
  .cop-add-context-action strong { font-size: 11.5px; font-weight: 600; }
  .cop-add-context-action small { font-size: 10px; color: var(--ink-4); }
  .cop-hidden-file { display: none; }

  /* Passages consultés (15.3) */
  .cop-sources { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 10px; }
  .cop-sources-lbl { font-size: 10.5px; color: var(--ink-4); letter-spacing: 0.02em; }
  .cop-source-chip {
    display: inline-flex; align-items: center; gap: 5px; height: 24px; padding: 0 9px 0 4px;
    border: 0; border-radius: 999px; background: var(--surface-2);
    color: var(--ink-3); font-family: var(--font-sans); font-size: 11px; cursor: pointer;
    transition: background 120ms ease, color 120ms ease, transform 100ms ease;
  }
  .cop-source-chip:hover { background: var(--accent-soft); color: var(--ink); }
  .cop-source-chip:active { transform: scale(0.96); }
  .cop-source-chip:focus-visible { outline: 2px solid var(--line-3); outline-offset: 1px; }
  /* Sans nom de note (extraits du document courant) : la puce est juste le numéro. */
  .cop-source-chip.bare { padding: 0 4px; }
  .cop-source-chip.static { cursor: default; padding-left: 7px; }
  .cop-source-chip.static:hover { background: var(--surface-2); color: var(--ink-3); }
  .cop-source-chip.static > .msr { font-size: 13px; }
  .cop-source-chip.static em { font-size: 9px; font-style: normal; color: var(--warn-text); }
  /* Tag arrondi-carré plutôt que cercle : le padding horizontal laisse respirer les
     numéros à 2 chiffres qu'un cercle de 16px écrasait. */
  .cop-source-num {
    display: inline-flex; align-items: center; justify-content: center;
    min-width: 16px; height: 15px; padding: 0 4px; border-radius: 5px;
    background: var(--accent-soft); color: var(--ink-3);
    /* Inter (pas la mono) : un numéro de citation est un repère de lecture, pas un tag
       technique. tabular-nums = colonnes stables entre [1] et [11]. */
    font-family: var(--font-sans); font-size: 10px; font-weight: 600; line-height: 1;
    font-variant-numeric: tabular-nums;
  }

  /* Puces de citation [n] inline (21.x) — injectées via {@html} après sanitize, d'où le
     :global. Même vocabulaire visuel que .cop-source-num : la puce inline et le pied
     désignent le même passage. */
  .cop-md :global(.cop-cite) {
    display: inline-flex; align-items: center; justify-content: center;
    min-width: 16px; height: 15px; margin: 0 2px; padding: 0 4px; border: 0; border-radius: 5px;
    background: var(--accent-soft); color: var(--ink-3);
    font-family: var(--font-sans); font-size: 10px; font-weight: 600; line-height: 1;
    font-variant-numeric: tabular-nums;
    vertical-align: 2px; cursor: pointer;
    transition: background 120ms ease, color 120ms ease, transform 100ms ease;
  }
  .cop-md :global(.cop-cite:hover) { background: var(--ink); color: var(--cream-content); }
  .cop-md :global(.cop-cite:active) { transform: scale(0.9); }
  .cop-md :global(.cop-cite:focus-visible) { outline: 2px solid var(--line-3); outline-offset: 2px; }

  /* Aperçu flottant du passage cité — même matériau que les menus flottants.
     pointer-events: none : la carte ne vole jamais la souris (elle disparaît en
     quittant la puce, aucun piège de survol possible). */
  .cop-cite-preview {
    position: absolute;
    z-index: 50;
    width: 300px;
    padding: 11px 12px 9px;
    border-radius: 12px;
    background: var(--cream-tint);
    box-shadow:
      0 0 0 1px var(--elevation-ring-soft),
      0 12px 30px rgba(var(--shadow-rgb), 0.18);
    transform: translate(-50%, -100%);
    pointer-events: none;
    animation: cop-cite-preview-in 130ms cubic-bezier(0.22, 1, 0.36, 1);
  }
  .cop-cite-preview.below { transform: translate(-50%, 0); }
  @keyframes cop-cite-preview-in {
    from { opacity: 0; translate: 0 3px; }
    to { opacity: 1; translate: 0 0; }
  }
  .cop-cite-preview-head { display: flex; align-items: center; gap: 7px; margin-bottom: 7px; }
  .cop-cite-preview-name {
    overflow: hidden; font-size: 11px; font-weight: 600; color: var(--ink-2);
    white-space: nowrap; text-overflow: ellipsis;
  }
  .cop-cite-preview-text {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 7;
    line-clamp: 7;
    overflow: hidden;
    margin: 0;
    font-size: 11.5px;
    line-height: 1.55;
    color: var(--ink-2);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .cop-cite-preview-hint {
    margin-top: 8px; padding-top: 7px; border-top: 1px solid var(--line-1);
    font-size: 10px; color: var(--ink-4);
  }
  @media (prefers-reduced-motion: reduce) {
    .cop-cite-preview { animation: none; }
  }

  :global([data-theme='dark']) .cop-composer-back {
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.12);
  }
  :global([data-theme='dark']) .cop-composer-front,
  :global([data-theme='dark']) .cop-composer-shell:focus-within .cop-composer-front {
    box-shadow: 0 8px 22px rgba(0, 0, 0, 0.2);
  }

  @container (max-width: 330px) {
    .cop-composer-note { display: none; }
    .cop-context-state { max-width: 86px; overflow: hidden; text-overflow: ellipsis; }
  }

  @media (pointer: coarse) {
    .cop-copy { width: 40px; height: 40px; }
    .cop-question-drawer {
      grid-template-columns: 40px minmax(0, 1fr) 40px;
      grid-template-rows: minmax(34px, auto) 40px;
    }
    .cop-input-attach,
    .cop-input-send { width: 40px; height: 40px; }
    .cop-verb-chip { min-height: 40px; padding-inline: 11px 7px; }
  }

  @keyframes cop-composer-drawer-in {
    from { opacity: 0.82; transform: translateY(8px) scale(0.992); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }

  @media (prefers-reduced-motion: reduce) {
    .cop-composer-front { animation: none; }
    .cop-panel,
    .cop-composer-panel,
    .cop-composer-switch,
    .cop-advanced-chev,
    .cop-picker-trigger,
    .cop-btn-quiet,
    .cop-btn-fill,
    .cop-btn-sm,
    .cop-del,
    .cop-copy,
    .cop-err-btn,
    .cop-dismiss,
    .cop-input-send,
    .cop-verb-chip,
    .cop-source-chip { transition-duration: 0.01ms; }
  }
</style>
