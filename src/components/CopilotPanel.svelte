<script lang="ts">
  import { tick, untrack } from 'svelte'
  import { activeTab, app, isCloudProvider, openPath, type CopilotProvider } from '../lib/stores.svelte'
  import { closeWindow, isTauri, minimizeWindow, toggleMaximizeWindow } from '../lib/tauri'
  import { formatBytes } from '../lib/ollama'
  import { beginOpenAiAuth, cancelOpenAiConnection, cancelPull, connectMinimax, copilot, disconnectMinimaxKey, disconnectOpenAiAccount, ensureCopilotReady, isEmbedModel, jumpToCitation, newChat, pullModel, refreshMinimaxStatus, refreshModels, refreshOpenAiStatus, removeModel, retryGeneration, saveMessageAsNote, sendChat, setActiveModel, setCopilotProvider, stopChat, summarizeDoc, type ChatMsg } from '../lib/copilot.svelte'
  import { MINIMAX_DEFAULT_MODEL } from '../lib/compat'
  import { DEFAULT_EMBED_MODEL, FALLBACK_EMBED_MODEL, noteTitle } from '../lib/rag'
  import { cancelRagIndexing, deleteRagIndex, ragState, refreshRagIndex } from '../lib/rag-index.svelte'
  import { baseName, parentPath } from '../lib/explorer'
  import { MAX_DOC_CHARS, MAX_DOC_CHARS_CLOUD } from '../lib/copilot-service'
  import { openOpenAiAuthPage, OPENAI_MODEL } from '../lib/openai'
  import { renderChatMarkdown } from '../lib/export/render-md'
  import { annotateCitations } from '../lib/citations'

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
    if (passage) void jumpToCitation(passage)
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
  // pointerdown en capture : un clic sur une zone de drag Tauri peut ne jamais livrer de
  // `click` (drag intercepté au mousedown) — le dropdown doit se fermer quand même.
  function onPickerWindowPointerDown(e: PointerEvent) {
    if (!pickerRootEl?.contains(e.target as Node | null)) pickerOpen = false
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
  const ragDir = $derived(app.explorerDir ?? parentPath(activeTab()?.path ?? null))
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

  function showComposerFace(face: 'question' | 'context', focus = false) {
    composerFace = face
    if (!focus) return
    requestAnimationFrame(() => {
      if (face === 'question') promptEl?.focus()
      else document.getElementById('cop-context-tab')?.focus()
    })
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

  // Envoie le brouillon ; capture un SNAPSHOT du doc courant (le contexte ne change pas si
  // l'utilisateur change d'onglet pendant la génération).
  function send() {
    const q = draft.trim()
    if (!q || copilot.generating) return
    draft = ''
    const t = activeTab()
    void sendChat(q, { name: t?.name ?? null, text: t?.content ?? '', kind: t?.kind ?? 'md', path: t?.path ?? null }, copilot.scope)
  }

  function onPromptKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  // Actions rapides de la vue vide : « Résumer »/« Points clés » passent par le pipeline de
  // résumé (14.2, segmentation map-reduce des longs docs) ; « Question » donne juste le focus.
  function quickAction(kind: 'summary' | 'question' | 'keypoints') {
    if (kind === 'question') {
      promptEl?.focus()
      return
    }
    const t = activeTab()
    void summarizeDoc({ name: t?.name ?? null, text: t?.content ?? '', kind: t?.kind ?? 'md', path: t?.path ?? null }, kind === 'keypoints' ? 'keypoints' : 'summary')
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
    <div class="cop-label">AJOUTER</div>
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

<!-- Échap est géré sur le trigger et le pop (focus toujours dans l'un des deux quand
     ouvert) avec stopPropagation ; ici seul le clic extérieur. -->
<svelte:window onpointerdowncapture={pickerOpen ? onPickerWindowPointerDown : undefined} />

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
    {#if app.copilotView === 'models'}
      <button class="cop-ic" title="Retour au chat" aria-label="Retour au chat" onclick={() => (app.copilotView = 'chat')}>
        <span class="msr" style="font-size:19px">arrow_back</span>
      </button>
    {:else}
      {#if copilot.messages.length > 0}
        <button class="cop-ic" title="Nouvelle conversation" aria-label="Nouvelle conversation" onclick={newChat}>
          <span class="msr" style="font-size:19px">add_comment</span>
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
      {#if app.copilotView === 'models'}
        <div class="cop-picker" bind:this={pickerRootEl}>
          <div class="cop-label" id="cop-picker-label">MODÈLE ACTIF</div>
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
                <strong>{OPENAI_MODEL}</strong>
                <small class:warn={openAiState.kind === 'warn'}>OpenAI · {openAiState.label}</small>
              {:else if app.copilotProvider === 'minimax'}
                <strong>{app.minimaxModel || MINIMAX_DEFAULT_MODEL}</strong>
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
                    <span class="cop-mono grow">{OPENAI_MODEL}</span>
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
                      <span class="cop-mono grow">{m}</span>
                    </button>
                  {/each}
                </div>
              </div>
            </div>
          {/if}
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
          <!-- Jordan (onboarding) ne doit pas être captif de la seule reco : la section Ajouter
               est disponible dès le premier écran (chips sans le conseillé, déjà en carte). -->
          <div class="cop-sections">
            {@render addSection(ALT_SUGGESTIONS)}
          </div>
        {:else}
          <div class="cop-sections">
            <!-- Le modèle actif vit désormais dans le dropdown « MODÈLE ACTIF » en tête de
                 vue (l'ancienne carte héro faisait doublon) ; la bibliothèque garde la
                 gestion disque (activer/supprimer/tailles). -->
            <!-- Bibliothèque -->
            <section>
              <div class="cop-label row">
                <span>BIBLIOTHÈQUE</span>
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
                <span>INDEX DU DOSSIER</span>
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

            <!-- Téléchargement en cours -->
            {#if copilot.pulling}
              <section>
                <div class="cop-label">TÉLÉCHARGEMENT</div>
                <div class="cop-dl">
                  <div class="cop-dl-head">
                    <span class="msr orbit" style="font-size:18px">progress_activity</span>
                    <span class="cop-mono grow" title={copilot.pulling.name}>{copilot.pulling.name}</span>
                    <!-- Octets + % : sur un pull multi-Go, « 395 Mo / 935 Mo » distingue une
                         progression réelle d'un blocage. -->
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

            <!-- Ajouter -->
            {@render addSection(installableSuggestions)}
          </div>
        {/if}
        {/if}
      {:else if copilot.messages.length === 0}
        <!-- Conversation vide : accueil + actions rapides sur le document courant -->
        <div class="cop-chat-empty">
          <div class="cop-empty-mark" aria-hidden="true"><span class="msr">spa</span></div>
          <div class="cop-empty-title">Bonjour, que puis-je faire&nbsp;?</div>
          <p class="cop-empty-sub">Discutez avec votre document ou partez d’une suggestion.</p>
          <div class="cop-actions">
            <button class="cop-action" onclick={() => quickAction('summary')}>
              <span class="cop-action-icon"><span class="msr">summarize</span></span>
              <span class="cop-action-copy"><strong>Résumer le document</strong><small>Obtenir l’essentiel en quelques points</small></span>
              <span class="msr cop-action-arrow">arrow_forward</span>
            </button>
            <button class="cop-action" onclick={() => quickAction('question')}>
              <span class="cop-action-icon"><span class="msr">chat_bubble</span></span>
              <span class="cop-action-copy"><strong>Poser une question</strong><small>Interroger le contenu du document</small></span>
              <span class="msr cop-action-arrow">arrow_forward</span>
            </button>
            <button class="cop-action" onclick={() => quickAction('keypoints')}>
              <span class="cop-action-icon"><span class="msr">key</span></span>
              <span class="cop-action-copy"><strong>Extraire les points clés</strong><small>Repérer les idées et décisions importantes</small></span>
              <span class="msr cop-action-arrow">arrow_forward</span>
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
              <div class="cop-asst">
                <div class="cop-asst-head">
                  <span class="msr" class:breathe={m.streaming} style="font-size:16px;color:var(--ink-4)">spa</span>
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
                {#if m.streaming && m.status}
                  <!-- Progression (prefill/map) — role=status : annoncée au lecteur d'écran. -->
                  <div class="cop-status" role="status">
                    <span class="msr breathe" style="font-size:16px;color:var(--ink-4)">auto_stories</span>{m.status}
                  </div>
                {:else if m.streaming && m.content === ''}
                  <div class="cop-skel-wrap">
                    <div class="doku-skel" style="height:11px;width:92%"></div>
                    <div class="doku-skel" style="height:11px;width:100%;animation-delay:0.15s"></div>
                    <div class="doku-skel" style="height:11px;width:78%;animation-delay:0.3s"></div>
                  </div>
                {:else if m.streaming}
                  <!-- Streaming : texte brut (aucun parse par token) — rendu Markdown à la fin. -->
                  <div class="cop-md-plain">{m.content}</div>
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
                        <button class="cop-source-chip" class:bare={!s.name} title={s.path ?? undefined} onclick={() => void jumpToCitation(s)}>
                          <span class="cop-source-num">{s.n}</span>{#if s.name}{s.name}{/if}
                        </button>
                      {/each}
                    </div>
                  {/if}
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
              <span class="cop-composer-note">{copilot.scope === 'folder' ? 'Dossier entier' : `${contextDetails.count} document${contextDetails.count === 1 ? '' : 's'}`}</span>
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
                <span
                  id="cop-question-tab"
                  class="cop-composer-active-label"
                  role="tab"
                  aria-selected="true"
                  aria-controls="cop-question-panel"
                >
                  Question
                </span>
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
                  <span class="cop-composer-note">{copilot.scope === 'folder' ? 'Dossier entier' : `${contextDetails.count} document${contextDetails.count === 1 ? '' : 's'}`}</span>
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
                  <button class="cop-input-attach" disabled aria-label="Joindre"><span class="msr" style="font-size:20px">add</span></button>
                  <textarea
                    class="cop-input-ta"
                    bind:this={promptEl}
                    bind:value={draft}
                    rows="1"
                    placeholder={copilot.scope === 'folder' ? 'Demandez à vos notes…' : 'Demandez à Doku-San…'}
                    aria-label={copilot.scope === 'folder' ? 'Poser une question sur le dossier de notes' : 'Poser une question sur ce document'}
                    onkeydown={onPromptKey}
                  ></textarea>
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
  <!-- Hors de .cop-card (overflow hidden) : la carte d'aperçu se positionne dans le
       repère du panneau (contain: layout) au-dessus de tout le contenu. -->
  {@render citePreviewCard()}
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
    transition:
      flex-grow 240ms cubic-bezier(0.4, 0, 1, 1),
      flex-basis 240ms cubic-bezier(0.4, 0, 1, 1),
      visibility 0s linear 240ms;
  }
  .cop-panel.open {
    flex-basis: var(--copilot-width);
    visibility: visible;
    pointer-events: auto;
    transition:
      flex-grow 240ms cubic-bezier(0.4, 0, 1, 1),
      flex-basis 240ms cubic-bezier(0.4, 0, 1, 1),
      visibility 0s;
  }
  .cop-panel.open.expanded {
    flex-grow: 1;
  }
  .cop-panel > .cop-head,
  .cop-panel > .cop-card {
    width: var(--copilot-width);
    min-width: var(--copilot-width);
    align-self: flex-end;
  }
  .cop-panel.expanded > .cop-head,
  .cop-panel.expanded > .cop-card {
    width: 100%;
    min-width: 0;
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
    border: 1px solid var(--line-1); border-radius: 8px; background: var(--cream-content); color: var(--ink-3);
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
    border-radius: 0 14px 0 0;
    overflow: hidden;
  }
  .cop-panel.expanded .cop-card { border-radius: 14px 14px 0 0; }
  .cop-scroll { flex: 1; min-height: 0; overflow-y: auto; padding: 0 18px; contain: layout paint; }
  .cop-panel.expanded .cop-scroll {
    padding-inline: max(24px, calc((100% - 760px) / 2));
  }
  .cop-msg { margin: 14px 4px; font-size: 12.5px; color: var(--ink-4); }
  .cop-msg.err { color: var(--err-text); }

  /* Sélecteur unifié « Modèle actif » : trigger + listbox flottant groupé par fournisseur. */
  .cop-picker { position: relative; margin: 14px 2px 16px; }
  .cop-picker-trigger {
    width: 100%; min-height: 48px; display: flex; align-items: center; gap: 10px; padding: 8px 12px;
    border: 1px solid var(--line-2); border-radius: 13px; background: var(--surface-2); color: var(--ink);
    font-family: var(--font-sans); text-align: left; cursor: pointer;
  }
  .cop-picker-trigger:hover { background: var(--surface-hover); }
  .cop-picker-trigger:focus-visible { outline: 2px solid var(--line-3); outline-offset: 1px; }
  .cop-picker-trigger > .msr { flex: 0 0 auto; font-size: 18px; color: var(--ink-3); }
  .cop-picker-name { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .cop-picker-name strong {
    overflow: hidden; font-family: var(--font-mono); font-size: 12.5px; font-weight: 500;
    white-space: nowrap; text-overflow: ellipsis;
  }
  .cop-picker-name strong.placeholder { font-family: var(--font-sans); color: var(--ink-4); }
  .cop-picker-name small { font-size: 10px; color: var(--ink-4); }
  .cop-picker-name small.warn { color: var(--warn-text); }
  .cop-picker-chev { transition: transform 140ms ease; }
  .cop-picker-chev.open { transform: rotate(180deg); }
  /* Pop : même matériau que le menu flottant de sélection (DocumentView), sections
     repliables façon tiroirs « Titres & blocs ». */
  .cop-picker-pop {
    position: absolute; top: calc(100% + 5px); left: 0; right: 0; z-index: 30;
    max-height: 360px; overflow-y: auto; padding: 6px;
    border: 1px solid var(--line-2); border-radius: 14px; background: var(--cream-tint);
    box-shadow:
      0 0 0 1px var(--elevation-ring-soft),
      0 12px 30px rgba(var(--shadow-rgb), 0.16);
    animation: cop-picker-in 160ms cubic-bezier(0.22, 1, 0.36, 1);
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
  @media (prefers-reduced-motion: reduce) {
    .cop-picker-pop { animation: none; }
    .cop-picker-fold, .cop-picker-sec-chev, .cop-picker-chev { transition: none; }
  }

  .cop-openai-view { padding: 0 2px 24px; display: flex; flex-direction: column; gap: 16px; }
  .cop-cloud-hero { overflow: hidden; border: 1px solid var(--line-2); border-radius: 18px; }
  .cop-cloud-head { display: flex; align-items: center; gap: 11px; padding: 14px 14px 28px; background: var(--cream-content); }
  .cop-cloud-icon {
    width: 42px; height: 42px; flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center;
    border: 1px solid var(--line-2); border-radius: 12px; background: var(--surface-2); color: var(--ink-2);
  }
  .cop-cloud-icon .msr { font-size: 21px; }
  .cop-cloud-name { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
  .cop-cloud-name strong { overflow: hidden; font-family: var(--font-mono); font-size: 13px; color: var(--ink); white-space: nowrap; text-overflow: ellipsis; }
  .cop-cloud-name small { font-size: 10.5px; color: var(--ink-4); }
  .cop-cloud-status {
    height: 23px; flex: 0 0 auto; display: inline-flex; align-items: center; gap: 5px; padding: 0 9px;
    border-radius: 999px; background: var(--surface-2); color: var(--ink-4); font-size: 10.5px; font-weight: 600;
  }
  .cop-cloud-status.ready { background: rgba(107, 164, 123, 0.16); color: var(--ok-text); }
  .cop-cloud-status.unavailable { background: rgba(180, 130, 60, 0.12); color: var(--warn-text); }
  .cop-cloud-status.checking { font-weight: 500; }
  .cop-cloud-status .cop-dot { width: 6px; height: 6px; border: 0; background: var(--ok); }
  .cop-cloud-foot { margin-top: -16px; display: flex; align-items: stretch; padding: 14px; border-radius: 16px 16px 0 0; background: var(--surface-2); }
  .cop-cloud-foot > span { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 3px; }
  .cop-cloud-foot b { font-family: var(--font-mono); font-size: 13px; font-weight: 600; color: var(--ink); }
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
    border: 1px solid var(--line-2); border-radius: 9px; background: transparent; color: var(--ink-3);
    font-family: var(--font-sans); font-size: 11.5px; cursor: pointer;
  }
  .cop-btn-quiet:hover { background: var(--surface-hover); color: var(--ink); }
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
    border: 1px solid var(--line-2); border-radius: 12px; background: var(--cream-content); color: var(--ink); cursor: pointer;
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
  .cop-reco { width: 100%; border: 1px solid var(--line-2); border-radius: 13px; padding: 13px; text-align: left; }
  .cop-reco-head { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
  .cop-badge { font-size: 10px; color: var(--ink-4); border: 1px solid var(--line-2); border-radius: 5px; padding: 1px 6px; }
  .cop-reco-sub { font-size: 11.5px; color: var(--ink-4); margin-bottom: 11px; }
  .cop-btn-fill {
    width: 100%; height: 34px; display: inline-flex; align-items: center; justify-content: center; gap: 7px;
    background: var(--ink); color: var(--cream-content); border: 0; border-radius: 9px;
    font-family: var(--font-sans); font-size: 12.5px; font-weight: 500; cursor: pointer;
  }
  .cop-btn-fill:hover { background: var(--ink-2); }
  .cop-btn-fill:disabled { opacity: 0.55; cursor: default; }

  /* MiniMax : champ clé */
  .cop-mm-connect { display: flex; flex-direction: column; gap: 8px; }
  .cop-mm-connect input {
    height: 34px; padding: 0 11px; border: 1px solid var(--line-2); border-radius: 9px;
    background: var(--cream-content); color: var(--ink); font-family: var(--font-mono); font-size: 12px;
  }
  .cop-mm-connect input:focus-visible { outline: 2px solid var(--line-3); outline-offset: -1px; }

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
  .cop-row { display: flex; align-items: center; border-radius: 12px; border: 1px solid var(--line-1); }
  .cop-row:hover { border-color: var(--line-2); background: var(--surface-hover); }
  .cop-row.active { background: var(--accent-soft); border-color: var(--line-2); }
  .cop-row-pick {
    flex: 1; display: flex; align-items: center; gap: 10px; min-width: 0;
    padding: 9px 4px 9px 11px; border: 0; background: none; color: var(--ink); text-align: left; cursor: pointer;
  }
  .cop-row-pick:disabled { cursor: default; }
  .cop-size { font-size: 11px; color: var(--ink-4); white-space: nowrap; flex-shrink: 0; }
  .cop-del { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 38px; border: 0; background: none; color: var(--ink-4); cursor: pointer; }
  .cop-del:hover { color: var(--err); }

  /* Téléchargement */
  .cop-dl { padding: 11px 12px; border: 1px solid var(--line-1); border-radius: 12px; }
  .cop-dl-head { display: flex; align-items: center; gap: 9px; margin-bottom: 9px; }
  .cop-track { height: 5px; background: var(--surface-2); border-radius: 3px; overflow: hidden; }
  .orbit { color: var(--ink-4); animation: doku-orbit 1.4s linear infinite; }

  /* Ajouter */
  .cop-add {
    display: flex; align-items: center; gap: 7px; height: 38px; padding: 0 6px 0 12px;
    border: 1px solid var(--line-2); border-radius: 11px; background: var(--cream-content);
  }
  .cop-add-input {
    flex: 1; min-width: 0; border: 0; background: transparent; outline: none;
    font-family: var(--font-mono); font-size: 12.5px; color: var(--ink);
  }
  .cop-add-input::placeholder { color: var(--ink-4); }
  .cop-add:focus-within { border-color: var(--line-3); }
  .cop-btn-sm {
    height: 28px; padding: 0 13px; background: var(--ink); color: var(--cream-content); border: 0; border-radius: 8px;
    font-family: var(--font-sans); font-size: 12px; font-weight: 500; cursor: pointer;
  }
  .cop-btn-sm:disabled { opacity: 0.45; cursor: default; }
  .cop-btn-sm:not(:disabled):hover { background: var(--ink-2); }
  .cop-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 9px; }
  .cop-chip {
    display: inline-flex; align-items: center; gap: 4px; height: 26px; padding: 0 10px;
    border: 1px solid var(--line-2); border-radius: 999px; background: transparent;
    color: var(--ink-3); font-family: var(--font-mono); font-size: 11.5px; cursor: pointer;
  }
  .cop-chip:hover { background: var(--surface-hover); color: var(--ink); }

  /* Index du dossier (15.2) */
  .cop-rag { padding: 11px 12px; border: 1px solid var(--line-1); border-radius: 12px; }
  .cop-rag-row { display: flex; align-items: center; gap: 9px; }
  .cop-rag-progress { display: flex; align-items: center; gap: 9px; margin-top: 9px; }
  .cop-rag-note { font-size: 11.5px; line-height: 1.55; color: var(--ink-4); margin-top: 8px; }
  .cop-rag-note.err { color: var(--err-text); display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .cop-chip.sel { border-color: var(--line-3); background: var(--accent-soft); color: var(--ink); }
  .cop-chip-tag { margin-left: 5px; font-family: var(--font-sans); font-size: 10px; color: var(--ink-4); letter-spacing: 0.03em; }
  .cop-rag-del {
    border: 0; background: none; padding: 0; margin-left: 4px; cursor: pointer;
    font-family: var(--font-sans); font-size: 11.5px; color: var(--ink-4); text-decoration: underline;
  }
  .cop-rag-del:hover { color: var(--err); }

  /* Chat — accueil */
  .cop-chat-empty {
    min-height: 100%; padding: 32px 2px 68px; display: flex; flex-direction: column;
    justify-content: center; align-items: center; text-align: center;
  }
  .cop-empty-mark {
    width: 42px; height: 42px; display: flex; align-items: center; justify-content: center;
    margin-bottom: 17px; border-radius: 14px; background: var(--ink); color: var(--cream-content);
    box-shadow: 0 8px 22px rgba(var(--shadow-rgb), 0.12);
  }
  .cop-empty-mark .msr { font-size: 21px; }
  .cop-empty-title { font-size: 17px; line-height: 1.3; font-weight: 600; color: var(--ink); margin-bottom: 6px; text-wrap: balance; }
  .cop-empty-sub { max-width: 31ch; font-size: 12.5px; line-height: 1.55; color: var(--ink-4); margin-bottom: 23px; text-wrap: pretty; }
  .cop-actions {
    width: 100%; display: flex; flex-direction: column; overflow: hidden;
    border: 1px solid var(--line-1); border-radius: 15px; background: var(--cream-content); text-align: left;
  }
  .cop-action {
    display: flex; align-items: center; gap: 11px; width: 100%; min-height: 60px; padding: 9px 12px;
    background: transparent; border: 0; color: var(--ink-2); font-family: var(--font-sans); text-align: left; cursor: pointer;
    transition: background 160ms ease, color 160ms ease;
  }
  .cop-action + .cop-action { border-top: 1px solid var(--line-1); }
  .cop-action:hover { background: var(--surface-hover); color: var(--ink); }
  .cop-action-icon {
    width: 32px; height: 32px; flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center;
    border-radius: 10px; background: var(--surface-2); color: var(--ink-3);
  }
  .cop-action-icon .msr { font-size: 17px; }
  .cop-action-copy { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .cop-action-copy strong { font-size: 12.5px; line-height: 1.3; font-weight: 550; color: var(--ink-2); }
  .cop-action-copy small { font-size: 10.5px; line-height: 1.35; color: var(--ink-4); }
  .cop-action-arrow { flex: 0 0 auto; font-size: 16px; color: var(--ink-5); transition: transform 160ms ease, color 160ms ease; }
  .cop-action:hover .cop-action-arrow { transform: translateX(2px); color: var(--ink-3); }

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
  .msr.breathe { animation: doku-breathe 1.8s ease-in-out infinite; }
  .cop-copy { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border: 0; border-radius: 8px; background: transparent; color: var(--ink-4); cursor: pointer; opacity: 0.72; }
  .cop-copy:hover { background: var(--surface-hover); color: var(--ink); }
  .cop-skel-wrap { display: flex; flex-direction: column; gap: 8px; padding-top: 2px; }
  .cop-status { display: flex; align-items: center; gap: 7px; font-size: 12.5px; color: var(--ink-4); padding-top: 2px; }
  .cop-md-plain { font-size: 13.5px; line-height: 1.65; color: var(--ink-2); white-space: pre-wrap; overflow-wrap: anywhere; }

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
  .cop-err-card { display: flex; gap: 11px; padding: 13px; border: 1px solid var(--line-2); border-radius: 12px; background: var(--cream-content); }
  .cop-err-title { font-size: 13px; font-weight: 600; color: var(--ink); margin-bottom: 3px; }
  .cop-err-msg { font-size: 12px; line-height: 1.5; color: var(--ink-4); margin: 0 0 11px; }
  .cop-err-acts { display: flex; gap: 7px; }
  .cop-err-btn { height: 30px; padding: 0 12px; background: transparent; color: var(--ink-3); border: 1px solid var(--line-2); border-radius: 8px; font-family: var(--font-sans); font-size: 12px; cursor: pointer; }
  .cop-err-btn:hover { background: var(--surface-hover); color: var(--ink); }
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
  .cop-dismiss { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; flex: 0 0 auto; border: 0; border-radius: 7px; background: transparent; color: var(--ink-4); cursor: pointer; }
  .cop-dismiss:hover { background: var(--surface-hover); color: var(--ink); }

  /* Composeur à deux plans : Question et Contexte permutent leur profondeur. */
  .cop-input-wrap {
    flex-shrink: 0;
    padding: 8px 16px 10px;
    background: var(--cream-content);
    container-type: inline-size;
  }
  .cop-panel.expanded .cop-input-wrap {
    padding-inline: max(24px, calc((100% - 760px) / 2));
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
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
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
    background: transparent; border: 0; border-radius: 10px; color: var(--ink-5); cursor: default;
  }
  .cop-input-ta {
    grid-column: 1 / -1; grid-row: 1; align-self: start;
    width: 100%; min-width: 0; border: 0; background: transparent; outline: none; resize: none;
    font-family: var(--font-sans); font-size: 13.5px; line-height: 1.45; color: var(--ink); padding: 2px 4px 7px; max-height: 120px;
    field-sizing: content; /* auto-grow : les lignes Shift+Entrée restent visibles (WebView2 OK) */
  }
  .cop-input-ta::placeholder { color: var(--ink-4); }
  .cop-input-send { grid-column: 3; grid-row: 2; width: 36px; height: 36px; display: inline-flex; align-items: center; justify-content: center; background: var(--ink); border: 0; border-radius: 50%; color: var(--cream-content); cursor: pointer; }
  .cop-input-send:hover { background: var(--ink-2); }
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
    border: 1px solid transparent; border-radius: 11px; background: none; color: var(--ink);
    text-align: left; cursor: pointer;
  }
  .cop-scope:hover { background: var(--surface-hover); }
  .cop-scope.sel { border-color: var(--line-2); background: var(--accent-soft); }
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
  .cop-disclaimer { text-align: center; font-size: 10.5px; line-height: 1.35; color: var(--ink-4); margin-top: 8px; }

  /* Passages consultés (15.3) */
  .cop-sources { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 10px; }
  .cop-sources-lbl { font-size: 10.5px; color: var(--ink-4); letter-spacing: 0.02em; }
  .cop-source-chip {
    display: inline-flex; align-items: center; gap: 5px; height: 24px; padding: 0 9px 0 4px;
    border: 1px solid var(--line-2); border-radius: 999px; background: transparent;
    color: var(--ink-3); font-family: var(--font-sans); font-size: 11px; cursor: pointer;
  }
  .cop-source-chip:hover { background: var(--surface-hover); color: var(--ink); }
  /* Sans nom de note (extraits du document courant) : la puce est juste le numéro. */
  .cop-source-chip.bare { padding: 0 4px; }
  /* Tag arrondi-carré plutôt que cercle : le padding horizontal laisse respirer les
     numéros à 2 chiffres qu'un cercle de 16px écrasait. */
  .cop-source-num {
    display: inline-flex; align-items: center; justify-content: center;
    min-width: 16px; height: 15px; padding: 0 4px; border-radius: 5px;
    background: var(--accent-soft); color: var(--ink-3);
    font-family: var(--font-mono); font-size: 9.5px; font-weight: 600; line-height: 1;
  }

  /* Puces de citation [n] inline (21.x) — injectées via {@html} après sanitize, d'où le
     :global. Même vocabulaire visuel que .cop-source-num : la puce inline et le pied
     désignent le même passage. */
  .cop-md :global(.cop-cite) {
    display: inline-flex; align-items: center; justify-content: center;
    min-width: 16px; height: 15px; margin: 0 2px; padding: 0 4px; border: 0; border-radius: 5px;
    background: var(--accent-soft); color: var(--ink-3);
    font-family: var(--font-mono); font-size: 9.5px; font-weight: 600; line-height: 1;
    vertical-align: 2px; cursor: pointer;
    transition: background 120ms ease, color 120ms ease, transform 100ms ease;
  }
  .cop-md :global(.cop-cite:hover) { background: var(--ink); color: var(--cream-content); }
  .cop-md :global(.cop-cite:active) { transform: scale(0.9); }

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

  @keyframes cop-composer-drawer-in {
    from { opacity: 0.82; transform: translateY(8px) scale(0.992); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }

  @media (prefers-reduced-motion: reduce) {
    .cop-composer-front { animation: none; }
    .cop-panel,
    .cop-composer-panel,
    .cop-composer-switch { transition-duration: 0.01ms; }
  }
</style>
