<script lang="ts">
  import { app, closeSettings, COPILOT_TEXT_PX, setBackgroundModeSetting, setColumnWidth, setCopilotTextSize, setTheme } from '../lib/stores.svelte'
  import { deleteAllRagIndexes } from '../lib/rag-index.svelte'
  import { autostartEnabled, isTauri, purgeSnapshotsHard, setAutostart } from '../lib/tauri'
  import { version } from '../../package.json'
  import DokuMark from '../lib/DokuMark.svelte'
  import { tooltip } from '../lib/tooltip'
  import { MediaQuery } from 'svelte/reactivity'

  type SettingsSection = 'appearance' | 'system' | 'data' | 'about'
  type Job = 'snapshots' | 'rag' | 'conversations'

  let dlg = $state<HTMLDialogElement | null>(null)
  let activeSection = $state<SettingsSection>('appearance')
  // La section n'entre en mouvement qu'au clic souris dans la nav : pas au premier montage
  // (la fenêtre s'anime déjà), pas au clavier (Entrée/Espace = `detail === 0`).
  let paneAnimated = $state(false)
  let confirming = $state<Job | null>(null)
  let running = $state<Job | null>(null)
  let done = $state<string | null>(null)
  // Posé au premier déplacement au clavier, jamais retiré : le choix suit la touche sans
  // fondu de couleur.
  let segmentedKbd = $state(false)
  // Même seuil que le @media qui masque les libellés de la nav : la bulle ne double pas un libellé visible.
  const navIconsOnly = new MediaQuery('max-width: 520px')

  const NAV_ITEMS = [
    { key: 'appearance' as const, label: 'Apparence', icon: 'palette' },
    { key: 'system' as const, label: 'Système', icon: 'monitor' },
    { key: 'data' as const, label: 'Données', icon: 'database' },
    { key: 'about' as const, label: 'À propos', icon: 'info' },
  ]
  const THEMES = [
    { key: 'light' as const, label: 'Clair', icon: 'sun' },
    { key: 'dark' as const, label: 'Sombre', icon: 'moon' },
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
      activeSection = app.settingsFocus === 'about' ? 'about' : 'appearance'
      confirming = null
      done = null
      el.showModal()
    } else if (!app.settingsOpen && el.open) {
      el.close()
    }
  })

  $effect(() => {
    if (app.settingsOpen && app.settingsFocus === 'about') {
      paneAnimated = false
      activeSection = 'about'
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
    if (section !== activeSection) paneAnimated = animate
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
  class="settings"
  aria-labelledby="settings-title"
  onclose={closeSettings}
  onclick={(event) => {
    if (event.target === dlg) closeSettings()
  }}
>
  <div class="window">
    <header>
      <div class="title-icon" aria-hidden="true"><svg class="icon" aria-hidden="true"><use href="#i-sliders-horizontal" /></svg></div>
      <div class="title-copy">
        <h2 id="settings-title">Paramètres</h2>
        <p>Personnalisez votre espace Doku</p>
      </div>
      <button class="close" use:tooltip={{ label: 'Fermer', kbd: 'Échap' }} aria-label="Fermer" onclick={closeSettings}>
        <svg class="icon" aria-hidden="true"><use href="#i-x" /></svg>
      </button>
    </header>

    <div class="layout">
      <nav aria-label="Catégories des paramètres">
        <div class="nav-items">
          {#each NAV_ITEMS as item (item.key)}
            <button
              class:active={activeSection === item.key}
              aria-current={activeSection === item.key ? 'page' : undefined}
              aria-label={item.label}
              use:tooltip={navIconsOnly.current ? item.label : ''}
              onclick={(e) => selectSection(item.key, e.detail !== 0)}
            >
              <svg class="icon" aria-hidden="true"><use href="#i-{item.icon}" /></svg>
              <span>{item.label}</span>
            </button>
          {/each}
        </div>

        <div class="auto-save-note">
          <svg class="icon" aria-hidden="true"><use href="#i-circle-check" /></svg>
          <span>Les réglages sont appliqués automatiquement.</span>
        </div>
      </nav>

      <main class:pane-animated={paneAnimated}>
        {#if activeSection === 'appearance'}
          <section class="pane" aria-labelledby="appearance-title">
            <div class="pane-heading">
              <h3 id="appearance-title">Apparence</h3>
              <p>Adaptez l’interface à votre façon de lire et d’écrire.</p>
            </div>

            <div class="preference-list">
              <div class="preference">
                <div class="preference-copy">
                  <svg class="icon preference-icon" aria-hidden="true"><use href="#i-contrast" /></svg>
                  <div>
                    <strong>Thème</strong>
                    <small>Choisissez l’ambiance générale de la fenêtre.</small>
                  </div>
                </div>
                <div class="segmented" class:kbd={segmentedKbd} role="radiogroup" aria-label="Thème">
                  {#each THEMES as theme (theme.key)}
                    <button
                      role="radio"
                      aria-checked={app.theme === theme.key}
                      tabindex={app.theme === theme.key ? 0 : -1}
                      onkeydown={onSegmentedKey}
                      class:active={app.theme === theme.key}
                      onclick={() => setTheme(theme.key)}
                    >
                      <svg class="icon" aria-hidden="true"><use href="#i-{theme.icon}" /></svg>{theme.label}
                    </button>
                  {/each}
                </div>
              </div>

              <div class="preference">
                <div class="preference-copy">
                  <svg class="icon preference-icon" aria-hidden="true"><use href="#i-columns-2" /></svg>
                  <div>
                    <strong>Largeur du document</strong>
                    <small>Réglez l’espace accordé au contenu dans la page.</small>
                  </div>
                </div>
                <div class="segmented widths" class:kbd={segmentedKbd} role="radiogroup" aria-label="Largeur du document">
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

              <div class="preference">
                <div class="preference-copy">
                  <svg class="icon preference-icon" aria-hidden="true"><use href="#i-text-align-justify" /></svg>
                  <div>
                    <strong>Taille du texte du copilote</strong>
                    <small>S’applique à la conversation — réponses, questions et saisie. Les commandes du panneau gardent leur taille.</small>
                  </div>
                </div>
                <div class="segmented text-sizes" class:kbd={segmentedKbd} role="radiogroup" aria-label="Taille du texte du copilote">
                  {#each COPILOT_TEXT_SIZES as size (size.key)}
                    <button
                      role="radio"
                      aria-checked={app.copilotTextSize === size.key}
                      tabindex={app.copilotTextSize === size.key ? 0 : -1}
                      onkeydown={onSegmentedKey}
                      class:active={app.copilotTextSize === size.key}
                      onclick={() => setCopilotTextSize(size.key)}
                    >
                      <span class="text-sample" style:font-size={COPILOT_TEXT_PX[size.key]} aria-hidden="true">Aa</span>{size.label}
                    </button>
                  {/each}
                </div>
              </div>
            </div>
          </section>
        {:else if activeSection === 'system'}
          <section class="pane" aria-labelledby="system-title">
            <div class="pane-heading">
              <h3 id="system-title">Système</h3>
              <p>Gardez Doku à portée de main, dès l’ouverture de votre session.</p>
            </div>

            <div class="preference-list">
              <div class="preference toggle">
                <div class="preference-copy">
                  <svg class="icon preference-icon" aria-hidden="true"><use href="#i-power" /></svg>
                  <div>
                    <strong>Ouvrir Doku au démarrage</strong>
                    <small>
                      {app.backgroundMode
                        ? 'Doku se lance avec votre session et attend en veille, sans ouvrir de fenêtre.'
                        : 'Doku se lance et s’ouvre avec votre session.'}
                    </small>
                    {#if autostartError}<small class="switch-error" role="alert">{autostartError}</small>{/if}
                  </div>
                </div>
                <button
                  class="switch"
                  role="switch"
                  aria-checked={autostart === true}
                  aria-label="Ouvrir Doku au démarrage"
                  disabled={!isTauri || autostart === null || autostartBusy}
                  onclick={() => void toggleAutostart()}
                ><span class="knob"></span></button>
              </div>

              <div class="preference toggle">
                <div class="preference-copy">
                  <svg class="icon preference-icon" aria-hidden="true"><use href="#i-moon" /></svg>
                  <div>
                    <strong>Rester en veille à la fermeture</strong>
                    <small>Fermer la fenêtre la masque : Doku reste prêt dans la zone de notification, près de l’horloge. Pour quitter, clic droit sur son icône puis « Quitter Doku ».</small>
                  </div>
                </div>
                <button
                  class="switch"
                  role="switch"
                  aria-checked={app.backgroundMode}
                  aria-label="Rester en veille à la fermeture"
                  disabled={!isTauri}
                  onclick={() => void setBackgroundModeSetting(!app.backgroundMode)}
                ><span class="knob"></span></button>
              </div>
            </div>
          </section>
        {:else if activeSection === 'data'}
          <section class="pane" aria-labelledby="data-title">
            <div class="pane-heading">
              <h3 id="data-title">Données locales</h3>
              <p>Gérez uniquement les fichiers créés par Doku. Vos documents ne sont jamais concernés.</p>
            </div>

            <div class="privacy-note">
              <svg class="icon" aria-hidden="true"><use href="#i-shield" /></svg>
              <span>Tout reste sur cet appareil. Les suppressions ci-dessous sont définitives.</span>
            </div>

            <div class="data-list">
              <div class="data-row">
                <svg class="icon data-icon" aria-hidden="true"><use href="#i-rotate-ccw-clock" /></svg>
                <div class="data-copy">
                  <strong>Historique des versions</strong>
                  <small>Instantanés créés à chaque enregistrement et purgés automatiquement.</small>
                </div>
                <div class="row-actions">
                  {#if confirming === 'snapshots'}
                    <span class="confirm-label">Supprimer définitivement ?</span>
                    <button class="button danger" disabled={!!running} onclick={() => purge('snapshots')}>
                      {running === 'snapshots' ? 'Suppression…' : 'Supprimer'}
                    </button>
                    <button class="button secondary" disabled={!!running} onclick={() => (confirming = null)}>Annuler</button>
                  {:else}
                    <button class="button danger-quiet" disabled={!isTauri || !!running} onclick={() => (confirming = 'snapshots')}>
                      Supprimer…
                    </button>
                  {/if}
                </div>
              </div>

              <div class="data-row">
                <svg class="icon data-icon" aria-hidden="true"><use href="#i-box" /></svg>
                <div class="data-copy">
                  <strong>Index sémantique</strong>
                  <small>Vecteurs utilisés par Doku-San pour rechercher dans un dossier.</small>
                </div>
                <div class="row-actions">
                  {#if confirming === 'rag'}
                    <span class="confirm-label">Supprimer définitivement ?</span>
                    <button class="button danger" disabled={!!running} onclick={() => purge('rag')}>
                      {running === 'rag' ? 'Suppression…' : 'Supprimer'}
                    </button>
                    <button class="button secondary" disabled={!!running} onclick={() => (confirming = null)}>Annuler</button>
                  {:else}
                    <button class="button danger-quiet" disabled={!isTauri || !!running} onclick={() => (confirming = 'rag')}>
                      Supprimer…
                    </button>
                  {/if}
                </div>
              </div>

              <div class="data-row">
                <svg class="icon data-icon" aria-hidden="true"><use href="#i-message-circle" /></svg>
                <div class="data-copy">
                  <strong>Discussions Doku-San</strong>
                  <small>Conversations, contexte associé et espace de documents à reprendre.</small>
                </div>
                <div class="row-actions">
                  {#if confirming === 'conversations'}
                    <span class="confirm-label">Supprimer définitivement ?</span>
                    <button class="button danger" disabled={!!running} onclick={() => purge('conversations')}>
                      {running === 'conversations' ? 'Suppression…' : 'Supprimer'}
                    </button>
                    <button class="button secondary" disabled={!!running} onclick={() => (confirming = null)}>Annuler</button>
                  {:else}
                    <button class="button danger-quiet" disabled={!isTauri || !!running} onclick={() => (confirming = 'conversations')}>
                      Supprimer…
                    </button>
                  {/if}
                </div>
              </div>
            </div>

            {#if done}<p class="done" role="status">{done}</p>{/if}

            <div class="models-note">
              <svg class="icon" aria-hidden="true"><use href="#i-bot" /></svg>
              <div><strong>Modèles IA</strong><small>Ils se gèrent depuis l’onglet Modèles du copilote.</small></div>
            </div>
          </section>
        {:else}
          <section class="pane about-pane" aria-labelledby="about-title">
            <div class="brand-lockup">
              <div class="mark"><DokuMark size={46} /></div>
              <div>
                <div class="product-name"><h3 id="about-title">Doku</h3><span>v{version}</span></div>
                <p>Un lecteur-éditeur local pensé pour laisser toute la place à vos documents.</p>
              </div>
            </div>

            <div class="about-list">
              <div>
                <svg class="icon" aria-hidden="true"><use href="#i-file-text" /></svg>
                <p><strong>Formats essentiels</strong><small>Markdown, HTML, texte et PDF dans une seule application.</small></p>
              </div>
              <div>
                <svg class="icon" aria-hidden="true"><use href="#i-lock" /></svg>
                <p><strong>100 % hors-ligne</strong><small>Aucun document ne quitte cette machine.</small></p>
              </div>
              <div>
                <svg class="icon" aria-hidden="true"><use href="#i-badge-check" /></svg>
                <p><strong>Vos fichiers restent intacts</strong><small>Doku préserve leur contenu et leur format d’origine.</small></p>
              </div>
            </div>
          </section>
        {/if}
      </main>
    </div>
  </div>
</dialog>

<style>
  .settings {
    width: min(720px, calc(100vw - 32px));
    max-width: none;
    max-height: none;
    margin: auto;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--ink);
    overflow: visible;
  }
  /* Voile discret, partagé par toutes les modales de Doku. */
  .settings::backdrop {
    background: var(--scrim);
    animation: doku-fade-in var(--duration-dialog) var(--ease-enter-snappy);
  }

  .window {
    height: min(520px, calc(100vh - 48px));
    min-height: 420px;
    display: flex;
    flex-direction: column;
    background: var(--surface);
    border-radius: var(--radius-2xl);
    box-shadow: var(--shadow-dialog);
    overflow: hidden;
    animation: doku-dialog-in var(--duration-dialog) var(--ease-enter-snappy);
  }

  header {
    min-height: 60px;
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 12px 12px 16px;
    border-bottom: 1px solid var(--line-1);
  }
  .title-icon {
    width: 36px;
    height: 36px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-xl);
    background: var(--accent-soft);
    color: var(--ink);
    font-size: 18px;
  }
  .title-copy { flex: 1; min-width: 0; }
  h2 { margin: 0; font-size: var(--text-lg); line-height: var(--leading-tight); font-weight: var(--weight-strong); letter-spacing: var(--tracking-tight); text-wrap: balance; }
  .title-copy p { margin: 2px 0 0; font-size: var(--text-xs); color: var(--ink-3); }
  .close {
    width: var(--control-md);
    height: var(--control-md);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 0;
    border-radius: var(--radius-lg);
    background: transparent;
    color: var(--ink-4);
    font-size: 16px;
    cursor: pointer;
    transition: background-color var(--duration-basic) ease, color var(--duration-basic) ease, transform var(--duration-basic) var(--ease-enter-snappy);
  }
  .close:hover { background: var(--fill-hover); color: var(--ink); }
  .close:active { transform: scale(0.97); }

  .layout { min-height: 0; flex: 1; display: flex; }
  nav {
    width: 188px;
    flex: 0 0 auto;
    display: flex;
    flex-direction: column;
    padding: 8px;
    background: var(--cream-base);
    border-right: 1px solid var(--line-1);
  }
  .nav-items { display: flex; flex-direction: column; gap: 1px; }
  .nav-items button {
    height: var(--control-md);
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 10px;
    border: 0;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--ink-3);
    font: inherit;
    font-size: 13px;
    font-weight: 510;
    text-align: left;
    cursor: pointer;
    transition: background-color var(--duration-basic) ease, color var(--duration-basic) ease;
  }
  .nav-items button .icon { font-size: 16px; }
  .nav-items button:hover { background: var(--surface-hover); color: var(--ink); }
  .nav-items button.active { background: var(--accent-soft); color: var(--ink); }
  .auto-save-note {
    margin-top: auto;
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 10px 6px 4px;
    font-size: 12px;
    line-height: 1.4;
    color: var(--ink-3);
  }
  .auto-save-note .icon { margin-top: 1px; font-size: 14px; color: var(--ok-text); }

  main { min-width: 0; flex: 1; overflow-y: auto; }
  .pane { padding: 24px 24px 28px; }
  .pane-animated > .pane { animation: pane-in var(--duration-basic) var(--ease-enter); }
  .pane-heading { margin-bottom: 20px; }
  .pane-heading h3, .product-name h3 { margin: 0; font-size: var(--text-xl); line-height: var(--leading-tight); font-weight: var(--weight-strong); letter-spacing: -0.02em; text-wrap: balance; }
  .pane-heading p { margin: 4px 0 0; max-width: 52ch; font-size: 13px; line-height: 1.5; color: var(--ink-3); text-wrap: pretty; }

  /* Groupe de réglages (motif SettingsPage) : une boîte à filet, des rangées séparées par
     un filet ; le contrôle segmenté passe sous le texte, l'interrupteur reste à droite. */
  .preference-list, .data-list {
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid var(--line-1);
    border-radius: var(--radius-2xl);
    background: var(--cream-content);
  }
  .preference {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 10px 24px;
    padding: 12px 16px;
  }
  .preference + .preference, .data-row + .data-row { border-top: 1px solid var(--line-1); }
  .preference-copy { flex: 1 1 220px; min-width: 0; display: flex; align-items: flex-start; gap: 10px; }
  .preference-icon { margin-top: 1px; font-size: 16px; color: var(--ink-4); }
  .preference-copy div, .data-copy { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  strong { font-size: 13px; line-height: 1.4; font-weight: 510; }
  small { display: block; font-size: 12px; line-height: 1.4; color: var(--ink-3); }

  /* Contrôle segmenté : piste enfoncée, le choix courant porte le curseur en relief. */
  .segmented {
    width: fit-content;
    max-width: 100%;
    display: flex;
    gap: 2px;
    padding: 2px;
    border-radius: var(--radius-md);
    background: var(--track);
  }
  .segmented button {
    min-width: 88px;
    height: calc(var(--control-md) - 4px);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 0 12px;
    border: 0;
    border-radius: calc(var(--radius-md) - 2px);
    background: transparent;
    color: var(--ink-3);
    font: inherit;
    font-size: 13px;
    font-weight: 510;
    white-space: nowrap;
    cursor: pointer;
    transition: background-color var(--duration-basic) ease, color var(--duration-basic) ease, box-shadow var(--duration-basic) ease;
  }
  .segmented.kbd button { transition: none; }
  .segmented button .icon { font-size: 16px; }
  .segmented button:not(.active):hover { background: var(--fill-hover); color: var(--ink); }
  .segmented button.active {
    background: var(--track-thumb);
    color: var(--ink);
    box-shadow: var(--shadow-sm), 0 0 0 0.5px var(--elevation-ring);
  }
  .widths button { min-width: 104px; }
  /* Contrôle segmenté toujours SOUS son libellé : « Largeur » et « Taille du texte » ne
     tiennent pas à droite, « Thème » si — trois rangées voisines, trois mises en page. */
  .preference:not(.toggle) .preference-copy { flex-basis: 100%; }
  /* Réglage oui/non : texte à gauche, interrupteur à droite, sans retour à la ligne. */
  .preference.toggle { flex-wrap: nowrap; }
  .switch {
    position: relative; flex: 0 0 auto; width: 32px; height: 20px; padding: 0; border: 0; border-radius: var(--radius-full);
    background: var(--line-2); cursor: pointer; transition: background-color var(--duration-basic) ease;
  }
  .switch .knob {
    position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%;
    background: var(--cream-content); box-shadow: var(--shadow-sm), 0 0 0 0.5px var(--elevation-ring);
    transition: translate var(--duration-basic) var(--ease-enter-snappy);
  }
  .switch[aria-checked="true"] { background: var(--ink); }
  .switch[aria-checked="true"] .knob { translate: 12px 0; }
  .switch:disabled { opacity: var(--opacity-disabled); cursor: not-allowed; }
  .switch:focus-visible { outline-offset: 0; }
  /* Au doigt, 20 px de haut ne se visent pas : la zone touchable passe à 32 × 32 sans changer le dessin. */
  @media (any-pointer: coarse) {
    .switch::after { content: ''; position: absolute; inset: -6px 0; }
  }
  .switch-error { display: block; margin-top: 4px; color: var(--err-text); }
  .text-sizes button { min-width: 84px; gap: 7px; }
  /* Échantillon rendu à la taille qu'il propose : le bouton montre son effet au lieu
     de le nommer. Hauteur de ligne à 1 pour que « Très grand » ne creuse pas la piste. */
  .text-sample { font-weight: 600; line-height: 1; }

  .privacy-note {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin-bottom: 12px;
    padding: 10px 12px;
    border-radius: var(--radius-xl);
    background: var(--accent-soft);
    color: var(--ink-3);
    font-size: var(--text-xs);
    line-height: var(--leading-snug);
  }
  .privacy-note .icon { flex: 0 0 auto; margin-top: 1px; font-size: 16px; color: var(--ok-text); }
  .data-row {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 60px;
    padding: 12px 16px;
  }
  .data-icon { flex: 0 0 auto; font-size: 16px; color: var(--ink-4); }
  .data-copy { flex: 1; }
  .row-actions { flex: 0 0 auto; display: flex; align-items: center; gap: 6px; }
  .confirm-label { font-size: 12px; color: var(--ink-3); }
  .button {
    height: var(--control-sm);
    padding: 0 10px;
    border: 0;
    border-radius: var(--radius-md);
    font: inherit;
    font-size: 13px;
    font-weight: 510;
    white-space: nowrap;
    cursor: pointer;
    transition: background-color var(--duration-basic) ease, color var(--duration-basic) ease, opacity var(--duration-basic) ease, transform var(--duration-basic) var(--ease-enter-snappy);
  }
  .button:not(:disabled):active { transform: scale(0.97); }
  .button.secondary { background: var(--accent-soft); color: var(--ink); }
  .button.secondary:hover:not(:disabled) { background: var(--fill-pressed); }
  .button.danger-quiet { background: transparent; color: var(--danger-action-text); }
  .button.danger-quiet:hover:not(:disabled) { background: color-mix(in srgb, var(--danger-action-text) 10%, transparent); }
  .button.danger { background: var(--danger-action-text); color: var(--cream-content); }
  .button.danger:hover:not(:disabled) { background: color-mix(in srgb, var(--danger-action-text) 88%, transparent); }
  .button:disabled { opacity: var(--opacity-disabled); cursor: default; }
  .done { margin: 10px 0 0; font-size: var(--text-xs); color: var(--ok-text); }
  .models-note { display: flex; align-items: flex-start; gap: 10px; margin-top: 20px; padding-inline: 16px; color: var(--ink-3); }
  .models-note > .icon { margin-top: 1px; font-size: 16px; color: var(--ink-4); }
  .models-note div { display: flex; flex-direction: column; gap: 2px; }

  .about-pane { padding-top: 32px; }
  .brand-lockup { display: flex; align-items: center; gap: 16px; padding-bottom: 24px; border-bottom: 1px solid var(--line-1); }
  .mark {
    width: 64px;
    height: 64px;
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-2xl);
    background: var(--cream-content);
    box-shadow: var(--shadow-card);
  }
  .brand-lockup > div:last-child { min-width: 0; }
  .product-name { display: flex; align-items: center; gap: 8px; }
  .product-name span {
    height: 20px; display: inline-flex; align-items: center; padding: 0 8px; border-radius: var(--radius-full);
    background: var(--accent-soft); color: var(--ink-3); font-size: var(--text-2xs); font-weight: var(--weight-strong); font-variant-numeric: tabular-nums;
  }
  .brand-lockup p { margin: 6px 0 0; max-width: 42ch; font-size: 13px; line-height: 1.5; color: var(--ink-3); text-wrap: pretty; }
  .about-list { display: flex; flex-direction: column; padding-top: 8px; }
  .about-list > div { display: flex; align-items: flex-start; gap: 12px; padding: 12px 0; }
  .about-list > div > .icon { margin-top: 1px; font-size: 16px; color: var(--ink-4); }
  .about-list p { display: flex; flex-direction: column; gap: 2px; }

  @keyframes pane-in {
    from { opacity: 0; transform: translateY(4px); }
  }

  @media (max-width: 680px) {
    .settings { width: min(560px, calc(100vw - 20px)); }
    .window { height: min(590px, calc(100vh - 24px)); }
    .layout { flex-direction: column; }
    nav { width: auto; flex-direction: row; align-items: center; padding: 8px; border-right: 0; border-bottom: 1px solid var(--line-1); overflow-x: auto; }
    .nav-items { flex: 1; flex-direction: row; }
    .nav-items button { justify-content: center; flex: 1; min-width: 104px; }
    .auto-save-note { display: none; }
    .pane { padding: 20px 16px 24px; }
  }

  @media (max-width: 520px) {
    .title-copy p { display: none; }
    .nav-items button { min-width: 40px; padding: 0 10px; }
    .nav-items button span:last-child { display: none; }
    .segmented { width: 100%; }
    .segmented button { min-width: 0; flex: 1; padding-inline: 8px; }
    .widths button { min-width: 0; }
    .text-sizes button { min-width: 0; }
    .data-row { align-items: flex-start; flex-wrap: wrap; }
    .data-copy { min-width: calc(100% - 32px); }
    .row-actions { width: 100%; justify-content: flex-end; }
  }
</style>
