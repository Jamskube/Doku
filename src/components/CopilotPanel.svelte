<script lang="ts">
  import { untrack } from 'svelte'
  import { activeTab, app } from '../lib/stores.svelte'
  import { closeWindow, minimizeWindow, toggleMaximizeWindow } from '../lib/tauri'
  import { formatBytes } from '../lib/ollama'
  import { acceptRephrase, beginOpenAiAuth, cancelOpenAiConnection, cancelPull, copilot, disconnectOpenAiAccount, newChat, pullModel, refreshModels, refreshOpenAiStatus, rejectRephrase, removeModel, retryGeneration, sendChat, setActiveModel, setCopilotProvider, stopChat, summarizeDoc } from '../lib/copilot.svelte'
  import { MAX_DOC_CHARS } from '../lib/copilot-service'
  import { openOpenAiAuthPage, OPENAI_MODEL } from '../lib/openai'
  import { renderChatMarkdown } from '../lib/export/render-md'

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
      else untrack(() => void refreshModels())
    }
  })

  const activeInstalled = $derived(copilot.models.find((m) => m.name === app.activeModel) ?? null)
  const libraryTotal = $derived(copilot.models.reduce((sum, m) => sum + m.size, 0))

  // Paramètres dérivés du nom (ex. « qwen2.5:3b » → « 3B ») quand le tag les encode ;
  // null sinon (ex. « phi3:mini ») — on n'affiche jamais un chiffre inventé.
  function deriveParams(name: string): string | null {
    const m = name.match(/(\d+(?:\.\d+)?)b(?![a-z])/i)
    return m ? m[1].toUpperCase() + 'B' : null
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

  // --- Chat (14.1) ---
  let draft = $state('')
  let promptEl = $state<HTMLTextAreaElement | null>(null)
  let scroller = $state<HTMLElement | null>(null)
  let composerFace = $state<'question' | 'context'>('question')
  let atBottom = true // ne pas voler le scroll si l'utilisateur est remonté relire

  const numberFormatter = new Intl.NumberFormat('fr-FR')

  // Doc courant tronqué en Q&A (14.3) : signal DÉTERMINISTE à l'utilisateur (ne dépend pas du
  // modèle) — un « je ne trouve pas » peut alors venir de la partie non lue, pas d'une absence.
  const docTruncated = $derived.by(() => {
    const t = activeTab()
    return !!t && t.kind !== 'pdf' && t.content.length > MAX_DOC_CHARS
  })

  const contextDetails = $derived.by(() => {
    const t = activeTab()
    if (!t) return { count: 0, name: 'Aucun document actif', meta: 'Le chat ne reçoit aucun contenu.', state: 'Vide' }
    if (t.kind === 'pdf') {
      return { count: 1, name: t.name, meta: 'PDF · texte non extractible pour l’instant', state: 'Métadonnées' }
    }
    const format = t.kind === 'md' ? 'Markdown' : t.kind === 'html' ? 'HTML' : 'Texte'
    const readableChars = Math.min(t.content.length, MAX_DOC_CHARS)
    return {
      count: 1,
      name: t.name,
      meta: `${format} · ${numberFormatter.format(readableChars)} caractères transmis`,
      state: docTruncated ? 'Lecture partielle' : 'Document entier',
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
    void sendChat(q, { name: t?.name ?? null, text: t?.content ?? '', kind: t?.kind ?? 'md' })
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
    void summarizeDoc({ name: t?.name ?? null, text: t?.content ?? '', kind: t?.kind ?? 'md' }, kind === 'keypoints' ? 'keypoints' : 'summary')
  }

  async function copyMessage(text: string) {
    try {
      await navigator.clipboard.writeText(text)
    } catch (e) {
      console.error('[copilot] copy', e)
    }
  }

  function onScroll() {
    if (scroller) atBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 40
  }

  // Suit le bas pendant le streaming, mais seulement si l'utilisateur y était déjà.
  $effect(() => {
    const n = copilot.messages.length
    const tail = copilot.messages[n - 1]?.content
    void n
    void tail
    if (atBottom && scroller) scroller.scrollTop = scroller.scrollHeight
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

<aside
  class="cop-panel"
  class:open={app.copilotOpen}
  class:expanded={app.copilotExpanded}
  aria-hidden={!app.copilotOpen}
  inert={!app.copilotOpen}
>
  <!-- En-tête : contrôles panneau + contrôles fenêtre (draggable, motif TitleBar) -->
  <header class="cop-head" data-tauri-drag-region>
    <div class="cop-identity" data-tauri-drag-region>
      <span class="cop-mark" data-tauri-drag-region>
        <span class="msr" style="font-size:15px" data-tauri-drag-region>spa</span>
      </span>
      <span class="cop-title" data-tauri-drag-region>Doku-San</span>
      <span class="cop-local" class:cloud={app.copilotProvider === 'openai'} data-tauri-drag-region>
        {app.copilotProvider === 'openai' ? 'cloud' : 'local'}
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
        <div class="cop-provider-switch" role="tablist" aria-label="Fournisseur de Doku-San">
          <button
            class:active={app.copilotProvider === 'ollama'}
            role="tab"
            aria-selected={app.copilotProvider === 'ollama'}
            onclick={() => setCopilotProvider('ollama')}
          >
            <span class="msr">memory</span>
            <span><strong>Sur cet appareil</strong><small>Ollama · privé</small></span>
          </button>
          <button
            class:active={app.copilotProvider === 'openai'}
            role="tab"
            aria-selected={app.copilotProvider === 'openai'}
            onclick={() => setCopilotProvider('openai')}
          >
            <span class="msr">cloud</span>
            <span><strong>OpenAI</strong><small>Compte ChatGPT · cloud</small></span>
          </button>
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
            <!-- Modèle actif : carte héro « imbriquée » -->
            {#if activeInstalled}
              {@const params = deriveParams(activeInstalled.name)}
              <section>
                <div class="cop-label">MODÈLE ACTIF</div>
                <div class="cop-hero">
                  <div class="cop-hero-head">
                    <div class="cop-hero-icon"><span class="msr" style="font-size:23px">layers</span></div>
                    <!-- Pas de tag « Modèle actif » sous le nom : le label de section + la
                         pastille le disent déjà (« actif » 3× dans une carte = bruit). -->
                    <div class="cop-hero-name">
                      <div class="cop-mono lg">{activeInstalled.name}</div>
                    </div>
                    <span class="cop-pill"><span class="cop-dot breathe"></span>Actif</span>
                  </div>
                  <div class="cop-hero-stats">
                    {#if params}
                      <div class="cop-stat">
                        <div class="cop-mono">{params}</div>
                        <div class="cop-stat-lbl">PARAMÈTRES</div>
                      </div>
                      <div class="cop-stat-sep"></div>
                    {/if}
                    <div class="cop-stat">
                      <div class="cop-mono">{formatBytes(activeInstalled.size)}</div>
                      <div class="cop-stat-lbl">DISQUE</div>
                    </div>
                  </div>
                </div>
              </section>
            {/if}

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
                    <div class="cop-row" class:active={isActive}>
                      <button class="cop-row-pick" title="Choisir comme modèle actif" aria-pressed={isActive} onclick={() => setActiveModel(m.name)}>
                        <span class="cop-dot" class:on={isActive}></span>
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
                <span class="msr" style="font-size:20px;color:var(--ink-3);flex:0 0 auto">{m.config === 'openai' ? 'cloud_off' : 'layers'}</span>
                <div>
                  <div class="cop-err-title">{m.config === 'openai' ? 'Compte OpenAI non connecté' : 'Aucun modèle actif'}</div>
                  <p class="cop-err-msg">{m.content}</p>
                  <button class="cop-err-btn" onclick={() => (app.copilotView = 'models')}>
                    {m.config === 'openai' ? 'Connecter OpenAI' : 'Choisir un modèle'}
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
                  <span class="msr" class:breathe={m.streaming} style="font-size:16px;color:var(--ink-4)">{m.rephrase ? 'edit_note' : 'spa'}</span>
                  <span class="cop-asst-name">{m.rephrase ? 'Proposition' : 'Doku-San'}</span>
                  <div class="grow"></div>
                  {#if !m.streaming}
                    <button class="cop-copy" title="Copier" aria-label="Copier la réponse" onclick={() => copyMessage(m.content)}>
                      <span class="msr" style="font-size:15px">content_copy</span>
                    </button>
                  {/if}
                </div>
                {#if m.rephrase}
                  <!-- Reformulation (16.1) : le texte proposé remplacera la sélection → affiché tel
                       quel (pas de rendu Markdown) pour montrer exactement ce qui sera inséré. -->
                  {#if m.streaming && m.content === ''}
                    <div class="cop-skel-wrap">
                      <div class="doku-skel" style="height:11px;width:88%"></div>
                      <div class="doku-skel" style="height:11px;width:96%;animation-delay:0.15s"></div>
                    </div>
                  {:else}
                    <div class="cop-proposal">{m.content}</div>
                    {#if m.rephrase.state === 'pending' && !m.streaming}
                      <div class="cop-prop-acts">
                        <button class="cop-prop-btn accept" onclick={() => acceptRephrase(i)}>
                          <span class="msr" style="font-size:15px">check</span>Accepter
                        </button>
                        <button class="cop-prop-btn" onclick={() => rejectRephrase(i)}>
                          <span class="msr" style="font-size:15px">close</span>Refuser
                        </button>
                      </div>
                    {:else if m.rephrase.state === 'applied'}
                      <div class="cop-prop-note ok" role="status"><span class="msr" style="font-size:14px">check_circle</span>Appliqué au document.</div>
                    {:else if m.rephrase.state === 'rejected'}
                      <div class="cop-prop-note" role="status"><span class="msr" style="font-size:14px">do_not_disturb_on</span>Refusé — texte d'origine conservé.</div>
                    {:else if m.rephrase.state === 'stale'}
                      <div class="cop-prop-note warn" role="status"><span class="msr" style="font-size:14px">warning</span>Le document a changé — remplacement annulé (texte d'origine intact).</div>
                    {/if}
                  {/if}
                {:else if m.streaming && m.status}
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
                  <!-- Réponse terminée : Markdown assaini (allowlist, 0 réseau). -->
                  <div class="cop-md">{@html renderChatMarkdown(m.content)}</div>
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
              <span class="cop-composer-note">{contextDetails.count} document{contextDetails.count === 1 ? '' : 's'}</span>
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
                  <span class="cop-composer-note">{contextDetails.count} document{contextDetails.count === 1 ? '' : 's'}</span>
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
                    placeholder="Demandez à Doku-San…"
                    aria-label="Poser une question sur ce document"
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
                  <span class="cop-context-icon" aria-hidden="true"><span class="msr">description</span></span>
                  <span class="cop-context-copy">
                    <strong>{contextDetails.name}</strong>
                    <small>{contextDetails.meta}</small>
                  </span>
                  <span
                    class="cop-context-state"
                    class:warn={docTruncated}
                    role={docTruncated ? 'note' : undefined}
                    title={docTruncated ? 'Document trop long : seul son début est transmis au copilote.' : contextDetails.state}
                  >
                    {#if docTruncated}<span class="msr">warning</span>{/if}
                    {contextDetails.state}
                  </span>
                  <button class="cop-context-add" disabled title="Contexte multi-documents — à venir" aria-label="Ajouter un document au contexte, bientôt disponible">
                    <span class="msr">add</span>
                  </button>
                </div>
              </div>
            </section>
          {/key}
        </div>
        <div class="cop-disclaimer">
          {app.copilotProvider === 'openai' ? 'OpenAI · contexte envoyé au cloud' : 'Local · rien ne quitte cet appareil'}
          <span>·</span> Doku peut se tromper.
        </div>
      </div>
    {/if}
  </div>
</aside>

<style>
  .cop-panel {
    --copilot-width: min(400px, calc(100vw - 40px));
    flex: 0 0 0;
    width: 0;
    max-width: 0;
    min-width: 0;
    height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--cream-base);
    overflow: hidden;
    opacity: 0;
    transform: translateX(22px);
    visibility: hidden;
    pointer-events: none;
    contain: layout paint;
    transition:
      flex-grow 240ms cubic-bezier(0.4, 0, 1, 1),
      flex-basis 240ms cubic-bezier(0.4, 0, 1, 1),
      width 240ms cubic-bezier(0.4, 0, 1, 1),
      max-width 240ms cubic-bezier(0.4, 0, 1, 1),
      opacity 130ms ease-in,
      transform 200ms cubic-bezier(0.4, 0, 1, 1),
      visibility 0s linear 240ms;
  }
  .cop-panel.open {
    flex-basis: var(--copilot-width);
    width: var(--copilot-width);
    max-width: var(--copilot-width);
    opacity: 1;
    transform: translateX(0);
    visibility: visible;
    pointer-events: auto;
    transition:
      flex-grow 240ms cubic-bezier(0.4, 0, 1, 1),
      flex-basis 240ms cubic-bezier(0.4, 0, 1, 1),
      width 240ms cubic-bezier(0.4, 0, 1, 1),
      max-width 240ms cubic-bezier(0.4, 0, 1, 1),
      opacity 130ms ease-in,
      transform 200ms cubic-bezier(0.4, 0, 1, 1),
      visibility 0s;
  }
  .cop-panel.open.expanded {
    flex-grow: 1;
    width: auto;
    max-width: none;
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
    height: 40px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 0 2px 0 10px;
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
  .cop-scroll { flex: 1; min-height: 0; overflow-y: auto; padding: 0 18px; }
  .cop-panel.expanded .cop-scroll {
    padding-inline: max(24px, calc((100% - 760px) / 2));
  }
  .cop-msg { margin: 14px 4px; font-size: 12.5px; color: var(--ink-4); }
  .cop-msg.err { color: var(--err-text); }

  /* Fournisseur : un choix binaire familier, distinct de la bibliothèque de modèles. */
  .cop-provider-switch {
    display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin: 12px 2px 16px; padding: 4px;
    border-radius: 13px; background: var(--surface-2);
  }
  .cop-provider-switch button {
    min-width: 0; min-height: 48px; display: flex; align-items: center; gap: 9px; padding: 7px 10px;
    border: 1px solid transparent; border-radius: 10px; background: transparent; color: var(--ink-4);
    font-family: var(--font-sans); text-align: left; cursor: pointer;
  }
  .cop-provider-switch button:hover { color: var(--ink); background: var(--surface-hover); }
  .cop-provider-switch button.active { border-color: var(--line-1); background: var(--cream-content); color: var(--ink); }
  .cop-provider-switch button:focus-visible { outline: 2px solid var(--line-3); outline-offset: 1px; }
  .cop-provider-switch .msr { flex: 0 0 auto; font-size: 18px; }
  .cop-provider-switch button > span:last-child { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .cop-provider-switch strong { overflow: hidden; font-size: 11.5px; font-weight: 600; white-space: nowrap; text-overflow: ellipsis; }
  .cop-provider-switch small { font-size: 9.5px; color: var(--ink-4); white-space: nowrap; }

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
  .cop-mono.lg { font-size: 15px; line-height: 1.2; }
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

  /* Sections modèles */
  .cop-sections { padding: 8px 2px; display: flex; flex-direction: column; gap: 20px; }
  .cop-label { font-size: 10.5px; color: var(--ink-4); font-weight: 600; letter-spacing: 0.06em; margin-bottom: 9px; }
  .cop-label.row { display: flex; align-items: baseline; justify-content: space-between; }
  .cop-count { font-size: 11px; color: var(--ink-4); white-space: nowrap; letter-spacing: 0; }

  /* Carte héro */
  .cop-hero { border-radius: 18px; overflow: hidden; border: 1px solid var(--line-2); }
  .cop-hero-head { background: var(--cream-content); padding: 14px 15px 26px; display: flex; align-items: center; gap: 12px; }
  .cop-hero-icon {
    width: 42px; height: 42px; flex: 0 0 auto; border-radius: 12px;
    background: var(--surface-2); border: 1px solid var(--line-2); display: flex; align-items: center; justify-content: center; color: var(--ink);
  }
  .cop-hero-name { min-width: 0; flex: 1; }
  .cop-hero-stats { margin-top: -16px; background: var(--surface-2); border-radius: 16px 16px 0 0; padding: 15px 16px; display: flex; }
  .cop-stat { flex: 1; text-align: center; }
  .cop-stat .cop-mono { font-size: 15px; }
  .cop-stat-lbl { font-size: 10px; color: var(--ink-4); letter-spacing: 0.04em; margin-top: 3px; }
  .cop-stat-sep { width: 1px; background: var(--line-2); }
  .cop-pill {
    display: inline-flex; align-items: center; gap: 5px; height: 23px; padding: 0 9px 0 8px; border-radius: 999px;
    background: rgba(107, 164, 123, 0.16); color: var(--ok-text); font-size: 11px; font-weight: 600;
  }
  .cop-dot { width: 8px; height: 8px; flex: 0 0 auto; border-radius: 50%; border: 1.5px solid var(--line-3); }
  .cop-pill .cop-dot { width: 6px; height: 6px; background: var(--ok); border: 0; }
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
  .cop-user-bubble, .cop-md, .cop-md-plain, .cop-proposal, .cop-err-msg { user-select: text; }
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
    padding: 8px;
    display: flex;
    align-items: center;
    gap: 8px;
  }
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
  .cop-context-add {
    width: 36px; height: 36px; flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center;
    border: 1px dashed var(--line-3); border-radius: 10px; background: transparent; color: var(--ink-4); opacity: 0.55;
  }
  .cop-context-add .msr { font-size: 17px; }
  .cop-disclaimer { text-align: center; font-size: 10.5px; line-height: 1.35; color: var(--ink-4); margin-top: 8px; }

  :global([data-theme='dark']) .cop-composer-back {
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.12);
  }
  :global([data-theme='dark']) .cop-composer-front,
  :global([data-theme='dark']) .cop-composer-shell:focus-within .cop-composer-front {
    box-shadow: 0 8px 22px rgba(0, 0, 0, 0.2);
  }

  @container (max-width: 330px) {
    .cop-composer-note,
    .cop-context-add { display: none; }
    .cop-context-state { max-width: 86px; overflow: hidden; text-overflow: ellipsis; }
  }

  /* Reformuler — carte proposition (16.1) */
  .cop-proposal {
    font-size: 13px; line-height: 1.6; color: var(--ink); white-space: pre-wrap; overflow-wrap: anywhere;
    padding: 10px 12px; background: var(--surface-2); border: 1px solid var(--line-2); border-radius: 10px;
  }
  .cop-prop-acts { display: flex; gap: 7px; margin-top: 9px; }
  .cop-prop-btn {
    display: inline-flex; align-items: center; gap: 5px; height: 30px; padding: 0 13px;
    border: 1px solid var(--line-2); border-radius: 9px; background: var(--cream-content); color: var(--ink-2);
    font-family: var(--font-sans); font-size: 12px; font-weight: 500; cursor: pointer;
  }
  .cop-prop-btn:hover { background: var(--surface-hover); color: var(--ink); }
  .cop-prop-btn.accept { background: var(--ink); color: var(--cream-content); border-color: var(--ink); }
  .cop-prop-btn.accept:hover { background: var(--ink-2); }
  .cop-prop-note { display: inline-flex; align-items: center; gap: 6px; margin-top: 9px; font-size: 12px; color: var(--ink-4); }
  .cop-prop-note.ok { color: var(--ok-text); }
  .cop-prop-note.warn { color: var(--warn-text); }

  @keyframes cop-composer-drawer-in {
    from { opacity: 0.82; transform: translateY(8px) scale(0.992); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }

  @media (prefers-reduced-motion: reduce) {
    .cop-composer-front { animation: none; }
    .cop-composer-panel,
    .cop-composer-switch { transition-duration: 0.01ms; }
  }
</style>
