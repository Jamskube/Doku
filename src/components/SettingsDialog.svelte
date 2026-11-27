<script lang="ts">
  import { app, closeSettings, COPILOT_TEXT_PX, setBackgroundModeSetting, setColumnWidth, setCopilotTextSize, setTheme } from '../lib/stores.svelte'
  import { deleteAllRagIndexes } from '../lib/rag-index.svelte'
  import { autostartEnabled, isTauri, purgeSnapshotsHard, setAutostart } from '../lib/tauri'
  import { version } from '../../package.json'
  import DokuMark from '../lib/DokuMark.svelte'
  import { tooltip } from '../lib/tooltip'
  import { MediaQuery } from 'svelte/reactivity'
  import { closeDialog, reopenDialog } from '../lib/dialog-close'
  import { revealOrigin } from '../lib/theme-reveal'
  import { fold } from '../lib/command-palette'
  import { liquidThumb, moveLiquid } from '../lib/liquid'
  import type { ThemeMode } from '../lib/stores.svelte'

  type SettingsSection = 'appearance' | 'system' | 'shortcuts' | 'data' | 'about'
  type Job = 'snapshots' | 'rag' | 'conversations'

  let dlg = $state<HTMLDialogElement | null>(null)
  let paneEl = $state<HTMLElement | null>(null)
  // Filet sous l'en-tête : seulement quand du contenu passe dessous.
  let scrolled = $state(false)
  let activeSection = $state<SettingsSection>('appearance')
  // La section n'entre en mouvement qu'au clic souris dans la nav : pas au premier montage
  // (la fenêtre s'anime déjà), pas au clavier (Entrée/Espace = `detail === 0`).
  let paneAnimated = $state(false)
  let confirming = $state<Job | null>(null)
  let running = $state<Job | null>(null)
  let done = $state<string | null>(null)
  // Posé au déplacement au clavier, retiré au premier geste de pointeur : le choix suit la
  // touche sans fondu de couleur ni goutte, la souris retrouve le mouvement.
  let segmentedKbd = $state(false)
  let query = $state('')
  let searchEl = $state<HTMLInputElement | null>(null)
  // Même seuil que le @media qui réduit la colonne à ses tuiles : la bulle ne double pas un libellé visible.
  const navIconsOnly = new MediaQuery('max-width: 640px')

  // Tuiles neutres (encre) : icônes sobres, sans repère de couleur par section.
  const NAV_ITEMS = [
    { key: 'appearance' as const, label: 'Apparence', icon: 'palette', title: 'Apparence', intro: 'Adaptez l’interface à votre façon de lire et d’écrire.' },
    { key: 'system' as const, label: 'Système', icon: 'monitor', title: 'Système', intro: 'Gardez Doku à portée de main, dès l’ouverture de votre session.' },
    { key: 'shortcuts' as const, label: 'Raccourcis', icon: 'keyboard', title: 'Raccourcis clavier', intro: '' },
    { key: 'data' as const, label: 'Données', icon: 'database', title: 'Données locales', intro: 'Gérez uniquement les fichiers créés par Doku. Vos documents ne sont jamais concernés.' },
    { key: 'about' as const, label: 'À propos', icon: 'info', title: 'À propos', intro: '' },
  ]
  const THEMES = [
    { key: 'light' as const, label: 'Clair' },
    { key: 'dark' as const, label: 'Sombre' },
    { key: 'system' as const, label: 'Système' },
  ]
  const WIDTHS = [
    { key: 'narrow' as const, label: 'Étroit', icon: 'fold-horizontal' },
    { key: 'wide' as const, label: 'Confortable', icon: 'unfold-horizontal' },
    { key: 'full' as const, label: 'Pleine largeur', icon: 'move-horizontal' },
  ]
  // Sans icône, contrairement aux deux réglages voisins : l'échantillon rendu à sa propre
  // taille dit mieux que n'importe quel pictogramme ce que chaque choix produit.
  const COPILOT_TEXT_SIZES = [
    { key: 'small' as const, label: 'Petit' },
    { key: 'normal' as const, label: 'Normal' },
    { key: 'large' as const, label: 'Grand' },
    { key: 'xlarge' as const, label: 'Très grand' },
  ]
  const DATA_JOBS: { key: Job; label: string; help: string; icon: string }[] = [
    { key: 'snapshots', label: 'Historique des versions', help: 'Instantanés créés à chaque enregistrement et purgés automatiquement.', icon: 'rotate-ccw-clock' },
    { key: 'rag', label: 'Index sémantique', help: 'Vecteurs utilisés par Doku-San pour rechercher dans un dossier.', icon: 'box' },
    { key: 'conversations', label: 'Discussions Doku-San', help: 'Conversations, contexte associé et espace de documents à reprendre.', icon: 'message-circle' },
  ]

  // Relevés dans les keymaps réels : App.svelte (fenêtre), editor/format-commands.ts et
  // l'historique CodeMirror (édition), le composer du copilote. Une touche par puce.
  const SHORTCUTS: { group: string; items: { label: string; keys: string[] }[] }[] = [
    { group: 'Fichier', items: [
      { label: 'Ouvrir un fichier', keys: ['Ctrl+O'] },
      { label: 'Enregistrer', keys: ['Ctrl+S'] },
      { label: 'Imprimer ou exporter en PDF', keys: ['Ctrl+P'] },
      { label: 'Fermer l’onglet', keys: ['Ctrl+W'] },
      { label: 'Onglet suivant / précédent', keys: ['Ctrl+Tab', 'Ctrl+Maj+Tab'] },
      { label: 'Nouvelle fenêtre', keys: ['Ctrl+Maj+N'] },
    ] },
    { group: 'Édition', items: [
      { label: 'Gras', keys: ['Ctrl+B'] },
      { label: 'Italique', keys: ['Ctrl+I'] },
      { label: 'Lien', keys: ['Ctrl+K'] },
      { label: 'Rechercher dans le document', keys: ['Ctrl+F'] },
      { label: 'Annuler / Rétablir', keys: ['Ctrl+Z', 'Ctrl+Y'] },
      { label: 'Révéler la syntaxe du bloc', keys: ['Tab'] },
    ] },
    { group: 'Affichage', items: [
      { label: 'Palette de commandes', keys: ['Ctrl+Maj+A'] },
      { label: 'Mode source', keys: ['Ctrl+/'] },
      { label: 'Mode focus', keys: ['F9'] },
      { label: 'Fichiers du dossier', keys: ['Ctrl+Maj+E'] },
      { label: 'Rechercher dans le dossier', keys: ['Ctrl+Maj+F'] },
      { label: 'Plan du document', keys: ['Ctrl+Maj+P'] },
      { label: 'Historique des versions', keys: ['Ctrl+Maj+H'] },
      { label: 'Agrandir / réduire / rétablir le texte', keys: ['Ctrl+=', 'Ctrl+-', 'Ctrl+0'] },
      { label: 'Passer à l’autre volet', keys: ['F6'] },
      { label: 'Toujours au-dessus', keys: ['Ctrl+Maj+T'] },
    ] },
    { group: 'Copilote', items: [
      { label: 'Demander à Doku-San (îlot)', keys: ['Ctrl+Espace'] },
      { label: 'Envoyer', keys: ['Entrée'] },
      { label: 'Aller à la ligne', keys: ['Maj+Entrée'] },
      { label: 'Commandes du copilote', keys: ['/'] },
      { label: 'Réduire le chat agrandi', keys: ['Échap'] },
    ] },
  ]
  // « Ctrl+= » → Ctrl, = ; le « + » final d'une touche reste une touche.
  const keysOf = (combo: string) => combo.split(/\+(?=.)/)

  // Recherche de la colonne : le texte cherchable de chaque rangée, par section. Une section
  // dont le NOM correspond montre toutes ses rangées ; sinon seules les rangées trouvées.
  const ROW_TERMS: Record<SettingsSection, string[]> = {
    appearance: ['Thème apparence clair sombre système nuit', 'Largeur du document étroit confortable pleine largeur colonne', 'Taille du texte du copilote police'],
    system: ['Ouvrir Doku au démarrage session lancement', 'Rester en veille à la fermeture zone de notification'],
    shortcuts: SHORTCUTS.flatMap((group) => group.items.map((item) => `${group.group} ${item.label} ${item.keys.join(' ')}`)),
    data: [...DATA_JOBS.map((job) => `${job.label} supprimer effacer purger`), 'Modèles IA'],
    about: ['Doku version formats hors-ligne fichiers'],
  }
  const needle = $derived(fold(query.trim()))
  const sectionNamed = (key: SettingsSection) => {
    const item = NAV_ITEMS.find((nav) => nav.key === key)!
    return fold(`${item.label} ${item.title}`).includes(needle)
  }
  /** La rangée `text` de `section` reste-t-elle affichée sous la recherche en cours ? */
  const shown = (section: SettingsSection, text: string) => !needle || sectionNamed(section) || fold(text).includes(needle)
  const visibleNav = $derived(NAV_ITEMS.filter((item) => !needle || sectionNamed(item.key) || ROW_TERMS[item.key].some((text) => fold(text).includes(needle))))
  const current = $derived(NAV_ITEMS.find((item) => item.key === activeSection)!)
  const shortcutGroups = $derived(SHORTCUTS
    .map((group) => ({ group: group.group, items: group.items.filter((item) => shown('shortcuts', `${group.group} ${item.label} ${item.keys.join(' ')}`)) }))
    .filter((group) => group.items.length > 0))

  function onSearch() {
    // La section affichée suit la recherche : sans résultat dans la section courante, on
    // passe à la première qui en a (comme le champ des Réglages Système).
    if (visibleNav.length && !visibleNav.some((item) => item.key === activeSection)) selectSection(visibleNav[0].key, false)
  }

  function onSearchKey(event: KeyboardEvent) {
    // Échap vide d'abord le champ ; un second Échap ferme la fenêtre.
    if (event.key === 'Escape' && query) {
      event.preventDefault()
      event.stopPropagation()
      query = ''
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      dlg?.querySelector<HTMLElement>('.side-items button')?.focus()
    }
  }

  // Perle de la section courante, verticale (horizontale quand la colonne devient une rangée
  // de tuiles). liquidThumb ne lit que aria-pressed/selected/checked, pas aria-current : même
  // mécanique, à la main. Première pose et redimensionnement : secs (modale mesurée fermée = 0).
  function navBead(node: HTMLElement) {
    let ready = false
    const place = (animate: boolean) => {
      const thumb = node.querySelector<HTMLElement>('[data-liquid-thumb]')
      const active = node.querySelector<HTMLElement>('[aria-current="page"]')
      if (!thumb) return
      thumb.style.opacity = active ? '' : '0'
      if (!active || active.offsetWidth === 0) return
      const axis = navIconsOnly.current ? 'x' : 'y'
      thumb.style[axis === 'x' ? 'height' : 'width'] = ''
      const to = axis === 'x' ? { x: active.offsetLeft, w: active.offsetWidth } : { x: active.offsetTop, w: active.offsetHeight }
      moveLiquid(thumb, to, { axis, animate: false })
      ready = true
    }
    place(false)
    const resize = new ResizeObserver(() => place(false))
    resize.observe(node)
    const mutation = new MutationObserver(() => place(true))
    mutation.observe(node, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-current'] })
    return {
      destroy() {
        resize.disconnect()
        mutation.disconnect()
      },
    }
  }

  function chooseTheme(event: MouseEvent, key: ThemeMode) {
    setTheme(key, revealOrigin(event))
  }

  function close() {
    closeDialog(dlg)
  }

  // Contrat radiogroup : un seul arrêt Tab (le choix courant) ; flèches et Home/End
  // déplacent ET sélectionnent (chaque choix s'applique sans risque), sans boucler.
  function onSegmentedKey(event: KeyboardEvent) {
    const radio = event.currentTarget as HTMLButtonElement
    const radios = [...radio.parentElement!.querySelectorAll<HTMLButtonElement>('[role="radio"]')]
    const from = radios.indexOf(radio)
    const last = radios.length - 1
    const to = ({ ArrowLeft: from - 1, ArrowUp: from - 1, ArrowRight: from + 1, ArrowDown: from + 1, Home: 0, End: last } as Record<string, number>)[event.key]
    if (to === undefined) return
    event.preventDefault()
    const next = radios[Math.max(0, Math.min(last, to))]
    segmentedKbd = true
    next.focus()
    next.click()
  }

  $effect(() => {
    const el = dlg
    if (!el) return
    if (app.settingsOpen && !el.open) {
      activeSection = app.settingsFocus ?? 'appearance'
      confirming = null
      done = null
      query = ''
      el.showModal()
    } else if (app.settingsOpen) {
      reopenDialog(el)
    } else if (el.open) {
      el.close()
    }
  })

  $effect(() => {
    const focus = app.settingsFocus
    if (app.settingsOpen && focus) {
      paneAnimated = false
      activeSection = focus
    }
  })

  // Lancement avec la session : relu au système à chaque ouverture de la section (il peut
  // avoir été coupé hors de Doku, dans le Gestionnaire des tâches).
  let autostart = $state<boolean | null>(null)
  let autostartBusy = $state(false)
  let autostartError = $state('')
  $effect(() => {
    if (activeSection !== 'system' || !app.settingsOpen || !isTauri) return
    autostartEnabled()
      .then((enabled) => { autostart = enabled; autostartError = '' })
      .catch(() => { autostart = null; autostartError = 'Réglage du système illisible.' })
  })

  async function toggleAutostart() {
    if (autostart === null || autostartBusy) return
    autostartBusy = true
    try {
      await setAutostart(!autostart)
      autostart = await autostartEnabled()
      autostartError = ''
    } catch {
      autostartError = 'Le système a refusé de modifier le démarrage automatique.'
    } finally {
      autostartBusy = false
    }
  }

  function selectSection(section: SettingsSection, animate: boolean) {
    // Seulement si la section change : sur la section affichée, la classe relancerait l'entrée.
    if (section !== activeSection) {
      paneAnimated = animate
      if (paneEl) paneEl.scrollTop = 0
      scrolled = false
    }
    activeSection = section
    confirming = null
    done = null
  }

  async function purge(job: Job) {
    if (running) return
    running = job
    done = null
    try {
      if (job === 'snapshots') {
        const count = await purgeSnapshotsHard()
        done = count === 0
          ? 'Aucun historique à supprimer.'
          : `Historique supprimé (${count} fichier${count > 1 ? 's' : ''}).`
      } else if (job === 'rag') {
        await deleteAllRagIndexes()
        done = 'Index sémantique supprimé.'
      } else {
        const { purgeCopilotConversations } = await import('../lib/copilot.svelte')
        await purgeCopilotConversations()
        done = 'Discussions Doku-San supprimées.'
      }
    } catch {
      done = 'Suppression impossible. Un fichier est peut-être verrouillé.'
    } finally {
      running = null
      confirming = null
    }
  }
</script>

<dialog
  bind:this={dlg}
  class="doku-modal settings"
  aria-label="Paramètres"
  onclose={closeSettings}
  onpointerdown={() => (segmentedKbd = false)}
  oncancel={(event) => {
    event.preventDefault()
    close()
  }}
  onclick={(event) => {
    if (event.target === dlg) close()
  }}
>
  <div class="doku-window settings-window">
    <!-- Colonne des sections, façon Réglages Système : recherche en capsule, tuiles teintées. -->
    <nav class="side" aria-label="Catégories des paramètres">
      <label class="search">
        <svg class="icon" aria-hidden="true"><use href="#i-search" /></svg>
        <input
          type="search"
          placeholder="Rechercher"
          aria-label="Rechercher un réglage"
          spellcheck="false"
          autocomplete="off"
          bind:this={searchEl}
          bind:value={query}
          oninput={onSearch}
          onkeydown={onSearchKey}
        />
        {#if query}
          <button class="search-clear" aria-label="Effacer la recherche" onclick={() => { query = ''; searchEl?.focus() }}>
            <svg class="icon" aria-hidden="true"><use href="#i-x" /></svg>
          </button>
        {/if}
      </label>

      <div class="side-items" use:navBead>
        <span class="nav-bead" data-liquid-thumb aria-hidden="true"></span>
        {#each visibleNav as item (item.key)}
          <button
            class:active={activeSection === item.key}
            aria-current={activeSection === item.key ? 'page' : undefined}
            aria-label={item.label}
            use:tooltip={navIconsOnly.current ? item.label : ''}
            onclick={(e) => selectSection(item.key, e.detail !== 0)}
          >
            <span class="doku-tile tint-ink" aria-hidden="true"><svg class="icon" aria-hidden="true"><use href="#i-{item.icon}" /></svg></span>
            <span class="side-label">{item.label}</span>
          </button>
        {:else}
          <p class="side-empty">Aucun réglage</p>
        {/each}
      </div>

      <div class="auto-save-note">
        <svg class="icon" aria-hidden="true"><use href="#i-circle-check" /></svg>
        <span>Les réglages s’appliquent automatiquement.</span>
      </div>
    </nav>

    <main>
      <header class="pane-head" class:scrolled>
        <div class="pane-heading">
          <h2 id="settings-section-title">{current.title}</h2>
          {#if activeSection === 'shortcuts'}
            <p>Toutes les commandes sont aussi dans la palette <span class="combo"><kbd class="key">Ctrl</kbd><kbd class="key">Maj</kbd><kbd class="key">A</kbd></span></p>
          {:else if current.intro}
            <p>{current.intro}</p>
          {/if}
        </div>
        <button class="doku-window-close" use:tooltip={{ label: 'Fermer', kbd: 'Échap' }} aria-label="Fermer" onclick={close}>
          <svg class="icon" aria-hidden="true"><use href="#i-x" /></svg>
        </button>
      </header>

      <div class="pane-scroll" class:pane-animated={paneAnimated} bind:this={paneEl} onscroll={() => (scrolled = (paneEl?.scrollTop ?? 0) > 0)}>
        {#if !visibleNav.length}
          <p class="empty" role="status">Aucun réglage ne correspond à « {query.trim()} ».</p>
        {:else if activeSection === 'appearance'}
          <section class="pane" aria-labelledby="settings-section-title">
            {#if shown('appearance', ROW_TERMS.appearance[0])}
              <div class="doku-inset-group">
                <div class="doku-inset-row theme-row">
                  <div class="doku-inset-copy">
                    <span class="doku-inset-label">Thème</span>
                    <span class="doku-inset-help">« Système » suit le mode clair ou sombre de Windows.</span>
                  </div>
                  <!-- Aperçus de fenêtre plutôt qu'icônes : on choisit une ambiance en la voyant. -->
                  <div class="theme-cards" role="radiogroup" aria-label="Thème" use:liquidThumb={{ instant: () => true }}>
                    <span class="theme-ring" data-liquid-thumb aria-hidden="true"></span>
                    {#each THEMES as theme (theme.key)}
                      <button
                        class="theme-card"
                        role="radio"
                        aria-checked={app.themeMode === theme.key}
                        tabindex={app.themeMode === theme.key ? 0 : -1}
                        onkeydown={onSegmentedKey}
                        onclick={(event) => chooseTheme(event, theme.key)}
                      >
                        <span class="preview {theme.key}" aria-hidden="true">
                          <span class="mini light-ui"><i class="mini-side"></i><i class="mini-line l1"></i><i class="mini-line l2"></i><i class="mini-line l3"></i></span>
                          {#if theme.key !== 'light'}<span class="mini dark-ui"><i class="mini-side"></i><i class="mini-line l1"></i><i class="mini-line l2"></i><i class="mini-line l3"></i></span>{/if}
                        </span>
                        <span class="theme-name">{theme.label}</span>
                      </button>
                    {/each}
                  </div>
                </div>
              </div>
            {/if}

            {#if shown('appearance', ROW_TERMS.appearance[1]) || shown('appearance', ROW_TERMS.appearance[2])}
              <h3 class="doku-group-title">Lecture</h3>
              <div class="doku-inset-group">
                {#if shown('appearance', ROW_TERMS.appearance[1])}
                  <div class="doku-inset-row wrap">
                    <div class="doku-inset-copy">
                      <span class="doku-inset-label">Largeur du document</span>
                      <span class="doku-inset-help">Espace accordé au texte dans la page.</span>
                    </div>
                    <div class="segmented" class:kbd={segmentedKbd} role="radiogroup" aria-label="Largeur du document" use:liquidThumb={{ instant: () => true }}>
                      <span class="thumb" data-liquid-thumb aria-hidden="true"></span>
                      {#each WIDTHS as width (width.key)}
                        <button
                          role="radio"
                          aria-checked={app.columnWidth === width.key}
                          tabindex={app.columnWidth === width.key ? 0 : -1}
                          onkeydown={onSegmentedKey}
                          class:active={app.columnWidth === width.key}
                          onclick={() => setColumnWidth(width.key)}
                        >
                          <svg class="icon" aria-hidden="true"><use href="#i-{width.icon}" /></svg>{width.label}
                        </button>
                      {/each}
                    </div>
                  </div>
                {/if}
                {#if shown('appearance', ROW_TERMS.appearance[2])}
                  <div class="doku-inset-row wrap">
                    <div class="doku-inset-copy">
                      <span class="doku-inset-label">Texte du copilote</span>
                      <span class="doku-inset-help">Réponses, questions et saisie. Les commandes du panneau gardent leur taille.</span>
                    </div>
                    <div class="segmented text-sizes" class:kbd={segmentedKbd} role="radiogroup" aria-label="Taille du texte du copilote" use:liquidThumb={{ instant: () => true }}>
                      <span class="thumb" data-liquid-thumb aria-hidden="true"></span>
                      {#each COPILOT_TEXT_SIZES as size (size.key)}
                        <button
                          role="radio"
                          aria-checked={app.copilotTextSize === size.key}
                          aria-label={size.label}
                          use:tooltip={size.label}
                          tabindex={app.copilotTextSize === size.key ? 0 : -1}
                          onkeydown={onSegmentedKey}
                          class:active={app.copilotTextSize === size.key}
                          onclick={() => setCopilotTextSize(size.key)}
                        >
                          <span class="text-sample" style:font-size={COPILOT_TEXT_PX[size.key]} aria-hidden="true">Aa</span>
                        </button>
                      {/each}
                    </div>
                  </div>
                {/if}
              </div>
            {/if}
          </section>
        {:else if activeSection === 'system'}
          <section class="pane" aria-labelledby="settings-section-title">
            <div class="doku-inset-group">
              {#if shown('system', ROW_TERMS.system[0])}
                <div class="doku-inset-row">
                  <div class="doku-inset-copy">
                    <span class="doku-inset-label">Ouvrir Doku au démarrage</span>
                    <span class="doku-inset-help">
                      {app.backgroundMode
                        ? 'Doku se lance avec votre session et attend en veille, sans ouvrir de fenêtre.'
                        : 'Doku se lance et s’ouvre avec votre session.'}
                    </span>
                    {#if autostartError}<span class="doku-inset-help switch-error" role="alert">{autostartError}</span>{/if}
                  </div>
                  <button
                    class="doku-switch"
                    role="switch"
                    aria-checked={autostart === true}
                    aria-label="Ouvrir Doku au démarrage"
                    disabled={!isTauri || autostart === null || autostartBusy}
                    onclick={() => void toggleAutostart()}
                  ></button>
                </div>
              {/if}
              {#if shown('system', ROW_TERMS.system[1])}
                <div class="doku-inset-row">
                  <div class="doku-inset-copy">
                    <span class="doku-inset-label">Rester en veille à la fermeture</span>
                    <span class="doku-inset-help">Fermer la fenêtre la masque : Doku reste prêt dans la zone de notification, près de l’horloge. Pour quitter, clic droit sur son icône puis « Quitter Doku ».</span>
                  </div>
                  <button
                    class="doku-switch"
                    role="switch"
                    aria-checked={app.backgroundMode}
                    aria-label="Rester en veille à la fermeture"
                    disabled={!isTauri}
                    onclick={() => void setBackgroundModeSetting(!app.backgroundMode)}
                  ></button>
                </div>
              {/if}
            </div>
            {#if !isTauri}<p class="group-foot">Ces réglages n’existent que dans l’application installée.</p>{/if}
          </section>
        {:else if activeSection === 'shortcuts'}
          <section class="pane" aria-labelledby="settings-section-title">
            {#each shortcutGroups as section (section.group)}
              <h3 class="doku-group-title">{section.group}</h3>
              <dl class="doku-inset-group">
                {#each section.items as item (item.label)}
                  <div class="doku-inset-row shortcut">
                    <dt>{item.label}</dt>
                    <dd>
                      {#each item.keys as combo, i (combo)}
                        {#if i > 0}<span class="key-sep" aria-hidden="true">/</span>{/if}
                        <span class="combo">{#each keysOf(combo) as key, k (k)}<kbd class="key">{key}</kbd>{/each}</span>
                      {/each}
                    </dd>
                  </div>
                {/each}
              </dl>
            {/each}
          </section>
        {:else if activeSection === 'data'}
          <section class="pane" aria-labelledby="settings-section-title">
            <div class="privacy-note">
              <span class="doku-tile tint-ink" aria-hidden="true"><svg class="icon" aria-hidden="true"><use href="#i-shield" /></svg></span>
              <span>Tout reste sur cet appareil. Les suppressions ci-dessous sont définitives.</span>
            </div>

            <div class="doku-inset-group">
              {#each DATA_JOBS as job (job.key)}
                {#if shown('data', `${job.label} supprimer effacer purger`)}
                  <div class="doku-inset-row data-row" class:confirming={confirming === job.key}>
                    <span class="doku-tile tint-ink row-tile" aria-hidden="true"><svg class="icon" aria-hidden="true"><use href="#i-{job.icon}" /></svg></span>
                    <div class="doku-inset-copy">
                      <span class="doku-inset-label">{job.label}</span>
                      <span class="doku-inset-help">{confirming === job.key ? 'Supprimer définitivement ?' : job.help}</span>
                    </div>
                    <div class="doku-inset-control">
                      {#if confirming === job.key}
                        <button class="doku-btn" disabled={!!running} onclick={() => (confirming = null)}>Annuler</button>
                        <button class="doku-btn is-danger-solid" disabled={!!running} onclick={() => purge(job.key)}>
                          {running === job.key ? 'Suppression…' : 'Supprimer'}
                        </button>
                      {:else}
                        <button class="doku-btn is-danger" disabled={!isTauri || !!running} onclick={() => (confirming = job.key)}>Supprimer…</button>
                      {/if}
                    </div>
                  </div>
                {/if}
              {/each}
            </div>

            {#if done}<p class="done" role="status"><svg class="icon" aria-hidden="true"><use href="#i-circle-check" /></svg>{done}</p>{/if}

            {#if shown('data', 'Modèles IA')}
              <p class="group-foot"><svg class="icon" aria-hidden="true"><use href="#i-bot" /></svg>Les modèles IA se gèrent depuis l’onglet Modèles du copilote.</p>
            {/if}
          </section>
        {:else}
          <section class="pane about-pane" aria-labelledby="settings-section-title">
            <div class="brand-lockup">
              <div class="mark"><DokuMark size={48} /></div>
              <div class="product-name"><span class="name">Doku</span><span class="version">Version {version}</span></div>
              <p>Un lecteur-éditeur local pensé pour laisser toute la place à vos documents.</p>
            </div>

            <div class="doku-inset-group">
              <div class="doku-inset-row about-row">
                <span class="doku-tile tint-ink row-tile" aria-hidden="true"><svg class="icon" aria-hidden="true"><use href="#i-file-text" /></svg></span>
                <div class="doku-inset-copy"><span class="doku-inset-label">Formats essentiels</span><span class="doku-inset-help">Markdown, HTML, texte et PDF dans une seule application.</span></div>
              </div>
              <div class="doku-inset-row about-row">
                <span class="doku-tile tint-ink row-tile" aria-hidden="true"><svg class="icon" aria-hidden="true"><use href="#i-lock" /></svg></span>
                <div class="doku-inset-copy"><span class="doku-inset-label">100 % hors-ligne</span><span class="doku-inset-help">Aucun document ne quitte cette machine.</span></div>
              </div>
              <div class="doku-inset-row about-row">
                <span class="doku-tile tint-ink row-tile" aria-hidden="true"><svg class="icon" aria-hidden="true"><use href="#i-badge-check" /></svg></span>
                <div class="doku-inset-copy"><span class="doku-inset-label">Vos fichiers restent intacts</span><span class="doku-inset-help">Doku préserve leur contenu et leur format d’origine.</span></div>
              </div>
            </div>
          </section>
        {/if}
      </div>
    </main>
  </div>
</dialog>

<style>
  .settings { width: min(880px, calc(100vw - 32px)); }
  .settings-window {
    height: min(620px, calc(100vh - 48px));
    min-height: 420px;
    flex-direction: row;
  }

  /* ── Colonne des sections ─────────────────────────────────────────────── */
  .side {
    width: 224px;
    flex: 0 0 auto;
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 14px 10px 12px;
    background: var(--surface-2);
    box-shadow: inset -1px 0 0 var(--line-1);
  }
  .search {
    height: 30px;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 10px;
    border-radius: var(--radius-full);
    background: rgba(var(--ink-rgb), 0.055);
    color: var(--ink-4);
    cursor: text;
    transition: background-color var(--duration-basic) ease, box-shadow var(--duration-basic) ease;
  }
  .search:focus-within { background: var(--cream-content); box-shadow: 0 0 0 1px var(--line-2), 0 0 0 3px rgba(var(--ink-rgb), 0.06); }
  .search .icon { font-size: 14px; }
  .search input {
    flex: 1;
    min-width: 0;
    height: 100%;
    border: 0;
    outline: none;
    background: transparent;
    color: var(--ink);
    font: inherit;
    font-size: var(--text-sm);
  }
  .search input::placeholder { color: var(--ink-4); }
  .search input::-webkit-search-cancel-button { display: none; }
  .search-clear {
    width: 16px;
    height: 16px;
    display: grid;
    place-items: center;
    margin-right: -4px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: var(--ink-5);
    color: var(--surface);
    cursor: pointer;
  }
  .search-clear .icon { font-size: 10px; stroke-width: 3; }
  .search-clear:hover { background: var(--ink-3); }

  .side-items { position: relative; display: flex; flex-direction: column; gap: 2px; }
  /* Fond de la rangée choisie, porté par une perle qui coule d'une section à l'autre (navBead). */
  .nav-bead {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 34px;
    border-radius: var(--radius-md);
    background: var(--row-selected);
    pointer-events: none;
  }
  .side-items button {
    position: relative;
    height: 34px;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 8px 0 6px;
    border: 0;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--ink-2);
    font: inherit;
    font-size: var(--text-sm);
    font-weight: var(--weight-regular);
    text-align: left;
    cursor: pointer;
    transition: background-color var(--duration-basic) ease;
  }
  .side-items .doku-tile { --tile-size: 22px; border-radius: 6px; font-size: 13px; }
  .side-items button:hover { background: var(--surface-hover); }
  .side-items button.active { color: var(--ink); font-weight: var(--weight-control); }
  .side-items button.active:hover { background: transparent; }
  .side-items button:focus-visible { outline-offset: -2px; }
  .side-empty { padding: 8px; font-size: var(--text-xs); color: var(--ink-4); }
  .auto-save-note {
    margin-top: auto;
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 0 8px 2px;
    font-size: var(--text-2xs);
    line-height: var(--leading-snug);
    color: var(--ink-4);
  }
  .auto-save-note .icon { margin-top: 1px; font-size: 13px; color: var(--ok-text); }

  /* ── Volet droit ───────────────────────────────────────────────────────── */
  main { min-width: 0; flex: 1; display: flex; flex-direction: column; }
  .pane-head {
    flex: 0 0 auto;
    display: flex;
    align-items: flex-start;
    gap: 16px;
    padding: 22px 16px 16px 32px;
    border-bottom: 1px solid transparent;
    transition: border-color var(--duration-basic) ease;
  }
  .pane-head.scrolled { border-bottom-color: var(--line-1); }
  .pane-heading { flex: 1; min-width: 0; padding-top: 2px; }
  .pane-heading h2 {
    margin: 0;
    font-size: 22px;
    line-height: 1.2;
    font-weight: var(--weight-strong);
    letter-spacing: -0.02em;
    text-wrap: balance;
  }
  .pane-heading p { margin: 6px 0 0; max-width: 56ch; font-size: var(--text-sm); line-height: var(--leading-normal); color: var(--ink-3); text-wrap: pretty; }
  .pane-scroll { min-height: 0; flex: 1; overflow-y: auto; scrollbar-gutter: stable; }
  .pane { padding: 4px 23px 32px 32px; }
  .pane-animated > .pane { animation: pane-in var(--duration-basic) var(--ease-enter); }
  .empty { padding: 48px 32px; font-size: var(--text-sm); color: var(--ink-3); text-align: center; }
  .group-foot {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    margin: 10px 0 0;
    padding-inline: 4px;
    font-size: var(--text-xs);
    line-height: var(--leading-snug);
    color: var(--ink-3);
  }
  .group-foot .icon { margin-top: 1px; font-size: 13px; color: var(--ink-4); }
  /* Les rangées à contrôle large passent sous le texte quand la place manque. */
  .doku-inset-row.wrap { flex-wrap: wrap; }
  .doku-inset-row.wrap .doku-inset-copy { flex-basis: 200px; }
  .switch-error { color: var(--err-text); }
  .row-tile { --tile-size: 28px; border-radius: 8px; font-size: 14px; }
  .data-row, .about-row { --row-inset: 58px; }

  /* Aperçus de thème : mini-fenêtres dessinées aux couleurs fixes de chaque thème. */
  .theme-row { align-items: center; }
  .theme-cards { position: relative; display: flex; gap: 12px; }
  /* Anneau du thème choisi : une perle (liquidThumb) qui s'étire d'un aperçu à l'autre.
     4 px hors de l'aperçu de chaque côté (left -4 px + padding en content-box : la largeur
     posée par l'action reste celle de la carte). */
  .theme-ring {
    position: absolute;
    top: -4px;
    left: -4px;
    z-index: 1;
    box-sizing: content-box;
    height: 58px;
    padding-inline: 4px;
    border-radius: 12px;
    box-shadow: inset 0 0 0 2px var(--ink);
    pointer-events: none;
  }
  .theme-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--ink-3);
    font: inherit;
    font-size: var(--text-xs);
    cursor: pointer;
  }
  .preview {
    position: relative;
    width: 76px;
    height: 50px;
    border-radius: 8px;
    overflow: hidden;
    box-shadow: 0 0 0 1px var(--line-1), 0 1px 2px rgba(var(--shadow-rgb), 0.08);
    transition: box-shadow var(--duration-basic) ease;
  }
  .theme-card:hover .preview { box-shadow: 0 0 0 1px var(--line-3), 0 1px 2px rgba(var(--shadow-rgb), 0.08); }
  .theme-card[aria-checked='true'] .theme-name { color: var(--ink); font-weight: var(--weight-control); }
  .theme-card:focus-visible { outline: none; }
  .theme-card:focus-visible .preview { outline: 2px solid var(--focus-ring); outline-offset: 5px; }
  .mini { position: absolute; inset: 0; display: block; background: #FDFBF5; --mini-side: #EFEAE0; --mini-line: rgba(28, 26, 22, 0.22); }
  .mini.dark-ui { background: #202020; --mini-side: #151515; --mini-line: rgba(235, 237, 241, 0.28); }
  .preview.system .dark-ui { clip-path: polygon(62% 0, 100% 0, 100% 100%, 38% 100%); }
  .mini-side { position: absolute; left: 0; top: 0; bottom: 0; width: 22px; background: var(--mini-side); }
  .mini-line { position: absolute; left: 30px; height: 4px; border-radius: 2px; background: var(--mini-line); }
  .mini-line.l1 { top: 10px; width: 30px; height: 5px; }
  .mini-line.l2 { top: 21px; width: 38px; }
  .mini-line.l3 { top: 30px; width: 26px; }

  /* Contrôle segmenté : piste enfoncée, le choix courant porte le curseur en relief. */
  .segmented {
    position: relative;
    width: fit-content;
    max-width: 100%;
    display: flex;
    gap: 2px;
    padding: 2px;
    border-radius: var(--radius-full);
    background: var(--track);
    box-shadow: inset 0 0 0 0.5px var(--line-1);
  }
  .segmented button {
    height: 26px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 0 12px;
    border: 0;
    border-radius: var(--radius-full);
    background: transparent;
    color: var(--ink-3);
    font: inherit;
    font-size: var(--text-sm);
    font-weight: var(--weight-control);
    white-space: nowrap;
    cursor: pointer;
    position: relative;
    transition: background-color var(--duration-basic) ease, color var(--duration-basic) ease;
  }
  .segmented.kbd button { transition: none; }
  /* Le relief du choix courant est porté par ce curseur, qui glisse d'un choix à l'autre. */
  .thumb {
    position: absolute;
    top: 2px;
    bottom: 2px;
    left: 0;
    border-radius: var(--radius-full);
    background: var(--track-thumb);
    box-shadow: var(--shadow-sm), 0 0 0 0.5px var(--elevation-ring);
    pointer-events: none;
  }
  .segmented button .icon { font-size: 15px; }
  .segmented button:not(.active):hover { color: var(--ink); }
  .segmented button.active { color: var(--ink); }
  .segmented button:focus-visible { outline-offset: -2px; }
  .text-sizes button { min-width: 44px; padding: 0 10px; }
  /* Échantillon rendu à la taille qu'il propose : le bouton montre son effet au lieu
     de le nommer. Hauteur de ligne à 1 pour que « Très grand » ne creuse pas la piste. */
  .text-sample { font-weight: 600; line-height: 1; }

  /* Raccourcis : libellé à gauche, touches en relief à droite. */
  .shortcut { min-height: 40px; justify-content: space-between; padding-block: 6px; }
  .shortcut dt { min-width: 0; font-size: var(--text-sm); }
  .shortcut dd { margin: 0; flex: none; display: flex; align-items: center; gap: 6px; }
  .combo { display: inline-flex; gap: 3px; white-space: nowrap; vertical-align: middle; }
  .key {
    min-width: 22px;
    height: 22px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0 6px;
    border-radius: var(--radius-sm);
    background: var(--surface);
    box-shadow: 0 0 0 0.5px var(--elevation-ring), 0 1px 0 var(--line-2);
    color: var(--ink-2);
    font: var(--weight-control) var(--text-2xs) var(--font-mono);
    white-space: nowrap;
  }
  .key-sep { color: var(--ink-4); font-size: var(--text-xs); }

  .privacy-note {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 16px;
    padding: 10px 12px;
    border-radius: var(--radius-xl);
    background: color-mix(in srgb, var(--tint-sage-bg) 45%, transparent);
    color: var(--ink-2);
    font-size: var(--text-xs);
    line-height: var(--leading-snug);
  }
  .privacy-note .doku-tile { --tile-size: 24px; border-radius: 7px; font-size: 13px; }
  .data-row.confirming .doku-inset-help { color: var(--danger-action-text); font-weight: var(--weight-control); }
  .done { display: flex; align-items: center; gap: 6px; margin: 10px 0 0; padding-inline: 4px; font-size: var(--text-xs); color: var(--ok-text); }
  .done .icon { font-size: 13px; }

  .about-pane { padding-top: 8px; }
  .brand-lockup { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 8px 0 24px; text-align: center; }
  .mark {
    width: 72px;
    height: 72px;
    display: grid;
    place-items: center;
    margin-bottom: 8px;
    border-radius: 18px;
    background: var(--cream-content);
    box-shadow: var(--shadow-card);
  }
  .product-name { display: flex; flex-direction: column; align-items: center; gap: 2px; }
  .product-name .name { font-size: 22px; line-height: 1.2; font-weight: var(--weight-strong); letter-spacing: -0.02em; }
  .product-name .version { font-size: var(--text-xs); color: var(--ink-4); font-variant-numeric: tabular-nums; }
  .brand-lockup p { max-width: 40ch; margin-top: 4px; font-size: var(--text-sm); line-height: var(--leading-normal); color: var(--ink-3); text-wrap: pretty; }

  @keyframes pane-in {
    from { opacity: 0; transform: translateY(4px); }
  }

  /* Fenêtre étroite : la colonne devient une rangée de tuiles au-dessus du volet. */
  @media (max-width: 640px) {
    .settings-window { flex-direction: column; height: min(620px, calc(100vh - 24px)); }
    .side { width: auto; flex-direction: row; align-items: center; padding: 10px; box-shadow: inset 0 -1px 0 var(--line-1); }
    .search, .auto-save-note { display: none; }
    .side-items { flex: 1; flex-direction: row; justify-content: space-around; }
    .side-items button { padding: 0 6px; }
    .side-label { display: none; }
    .pane-head { padding: 16px 12px 12px 20px; }
    .pane { padding: 4px 11px 24px 20px; }
    .theme-row { flex-wrap: wrap; }
  }
</style>
