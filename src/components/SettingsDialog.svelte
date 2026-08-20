<script lang="ts">
  import { app, closeSettings, COPILOT_TEXT_PX, setColumnWidth, setCopilotTextSize, setTheme } from '../lib/stores.svelte'
  import { deleteAllRagIndexes } from '../lib/rag-index.svelte'
  import { isTauri, purgeSnapshotsHard } from '../lib/tauri'
  import { version } from '../../package.json'
  import DokuMark from '../lib/DokuMark.svelte'

  type SettingsSection = 'appearance' | 'data' | 'about'
  type Job = 'snapshots' | 'rag'

  let dlg = $state<HTMLDialogElement | null>(null)
  let activeSection = $state<SettingsSection>('appearance')
  let confirming = $state<Job | null>(null)
  let running = $state<Job | null>(null)
  let done = $state<string | null>(null)

  const NAV_ITEMS = [
    { key: 'appearance' as const, label: 'Apparence', icon: 'palette' },
    { key: 'data' as const, label: 'Données', icon: 'database' },
    { key: 'about' as const, label: 'À propos', icon: 'info' },
  ]
  const THEMES = [
    { key: 'light' as const, label: 'Clair', icon: 'light_mode' },
    { key: 'dark' as const, label: 'Sombre', icon: 'dark_mode' },
  ]
  const WIDTHS = [
    { key: 'narrow' as const, label: 'Étroit', icon: 'width_normal' },
    { key: 'wide' as const, label: 'Confortable', icon: 'width_wide' },
    { key: 'full' as const, label: 'Pleine largeur', icon: 'width_full' },
  ]
  // Sans icône, contrairement aux deux réglages voisins : il n'existe pas de pictogramme
  // de « taille de texte » dans le subset Material Symbols embarqué, et en ajouter un
  // obligerait à régénérer la police. L'échantillon rendu à sa propre taille dit de toute
  // façon mieux que n'importe quelle icône ce que chaque choix produit.
  const COPILOT_TEXT_SIZES = [
    { key: 'small' as const, label: 'Petit' },
    { key: 'normal' as const, label: 'Normal' },
    { key: 'large' as const, label: 'Grand' },
    { key: 'xlarge' as const, label: 'Très grand' },
  ]

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
    if (app.settingsOpen && app.settingsFocus === 'about') activeSection = 'about'
  })

  function selectSection(section: SettingsSection) {
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
      } else {
        await deleteAllRagIndexes()
        done = 'Index sémantique supprimé.'
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
      <div class="title-icon" aria-hidden="true"><span class="msr">tune</span></div>
      <div class="title-copy">
        <h2 id="settings-title">Options</h2>
        <p>Personnalisez votre espace Doku</p>
      </div>
      <button class="close" title="Fermer" aria-label="Fermer" onclick={closeSettings}>
        <span class="msr">close</span>
      </button>
    </header>

    <div class="layout">
      <nav aria-label="Catégories des options">
        <div class="nav-items">
          {#each NAV_ITEMS as item (item.key)}
            <button
              class:active={activeSection === item.key}
              aria-current={activeSection === item.key ? 'page' : undefined}
              aria-label={item.label}
              title={item.label}
              onclick={() => selectSection(item.key)}
            >
              <span class="msr" aria-hidden="true">{item.icon}</span>
              <span>{item.label}</span>
            </button>
          {/each}
        </div>

        <div class="auto-save-note">
          <span class="msr" aria-hidden="true">check_circle</span>
          <span>Les réglages sont appliqués automatiquement.</span>
        </div>
      </nav>

      <main>
        {#if activeSection === 'appearance'}
          <section class="pane" aria-labelledby="appearance-title">
            <div class="pane-heading">
              <h3 id="appearance-title">Apparence</h3>
              <p>Adaptez l’interface à votre façon de lire et d’écrire.</p>
            </div>

            <div class="preference-list">
              <div class="preference">
                <div class="preference-copy">
                  <span class="preference-icon msr" aria-hidden="true">contrast</span>
                  <div>
                    <strong>Thème</strong>
                    <small>Choisissez l’ambiance générale de la fenêtre.</small>
                  </div>
                </div>
                <div class="segmented" role="radiogroup" aria-label="Thème">
                  {#each THEMES as theme (theme.key)}
                    <button
                      role="radio"
                      aria-checked={app.theme === theme.key}
                      class:active={app.theme === theme.key}
                      onclick={() => setTheme(theme.key)}
                    >
                      <span class="msr" aria-hidden="true">{theme.icon}</span>{theme.label}
                    </button>
                  {/each}
                </div>
              </div>

              <div class="preference">
                <div class="preference-copy">
                  <span class="preference-icon msr" aria-hidden="true">view_column</span>
                  <div>
                    <strong>Largeur du document</strong>
                    <small>Réglez l’espace accordé au contenu dans la page.</small>
                  </div>
                </div>
                <div class="segmented widths" role="radiogroup" aria-label="Largeur du document">
                  {#each WIDTHS as width (width.key)}
                    <button
                      role="radio"
                      aria-checked={app.columnWidth === width.key}
                      class:active={app.columnWidth === width.key}
                      onclick={() => setColumnWidth(width.key)}
                    >
                      <span class="msr" aria-hidden="true">{width.icon}</span>{width.label}
                    </button>
                  {/each}
                </div>
              </div>

              <div class="preference">
                <div class="preference-copy">
                  <span class="preference-icon msr" aria-hidden="true">subject</span>
                  <div>
                    <strong>Taille du texte du copilote</strong>
                    <small>S’applique à la conversation — réponses, questions et saisie. Les commandes du panneau gardent leur taille.</small>
                  </div>
                </div>
                <div class="segmented text-sizes" role="radiogroup" aria-label="Taille du texte du copilote">
                  {#each COPILOT_TEXT_SIZES as size (size.key)}
                    <button
                      role="radio"
                      aria-checked={app.copilotTextSize === size.key}
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
        {:else if activeSection === 'data'}
          <section class="pane" aria-labelledby="data-title">
            <div class="pane-heading">
              <h3 id="data-title">Données locales</h3>
              <p>Gérez uniquement les fichiers créés par Doku. Vos documents ne sont jamais concernés.</p>
            </div>

            <div class="privacy-note">
              <span class="msr" aria-hidden="true">shield_lock</span>
              <span>Tout reste sur cet appareil. Les suppressions ci-dessous sont définitives.</span>
            </div>

            <div class="data-list">
              <div class="data-row">
                <span class="data-icon msr" aria-hidden="true">history</span>
                <div class="data-copy">
                  <strong>Historique des versions</strong>
                  <small>Instantanés créés à chaque enregistrement et purgés automatiquement.</small>
                </div>
                <div class="row-actions">
                  {#if confirming === 'snapshots'}
                    <span class="confirm-label">Supprimer ?</span>
                    <button class="button danger" disabled={!!running} onclick={() => purge('snapshots')}>
                      {running === 'snapshots' ? 'Suppression…' : 'Oui, supprimer'}
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
                <span class="data-icon msr" aria-hidden="true">deployed_code</span>
                <div class="data-copy">
                  <strong>Index sémantique</strong>
                  <small>Vecteurs utilisés par Doku-San pour rechercher dans un dossier.</small>
                </div>
                <div class="row-actions">
                  {#if confirming === 'rag'}
                    <span class="confirm-label">Supprimer ?</span>
                    <button class="button danger" disabled={!!running} onclick={() => purge('rag')}>
                      {running === 'rag' ? 'Suppression…' : 'Oui, supprimer'}
                    </button>
                    <button class="button secondary" disabled={!!running} onclick={() => (confirming = null)}>Annuler</button>
                  {:else}
                    <button class="button danger-quiet" disabled={!isTauri || !!running} onclick={() => (confirming = 'rag')}>
                      Supprimer…
                    </button>
                  {/if}
                </div>
              </div>
            </div>

            {#if done}<p class="done" role="status">{done}</p>{/if}

            <div class="models-note">
              <span class="msr" aria-hidden="true">smart_toy</span>
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
                <span class="msr" aria-hidden="true">description</span>
                <p><strong>Formats essentiels</strong><small>Markdown, HTML, texte et PDF dans une seule application.</small></p>
              </div>
              <div>
                <span class="msr" aria-hidden="true">lock</span>
                <p><strong>100 % hors-ligne</strong><small>Aucun document ne quitte cette machine.</small></p>
              </div>
              <div>
                <span class="msr" aria-hidden="true">verified</span>
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
  .settings::backdrop {
    background: rgb(0 0 0 / 0.38);
    -webkit-backdrop-filter: blur(3px);
    backdrop-filter: blur(3px);
  }

  .window {
    height: min(520px, calc(100vh - 48px));
    min-height: 420px;
    display: flex;
    flex-direction: column;
    background: var(--cream-base);
    border-radius: 18px;
    box-shadow:
      0 0 0 1px var(--elevation-ring),
      0 28px 76px rgba(var(--shadow-rgb), 0.34),
      0 6px 20px rgba(var(--shadow-rgb), 0.16);
    overflow: hidden;
    animation: settings-in 190ms cubic-bezier(0.22, 1, 0.36, 1);
  }

  header {
    min-height: 68px;
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 11px;
    padding: 12px 14px 12px 18px;
    border-bottom: 1px solid var(--line-1);
  }
  .title-icon {
    width: 36px;
    height: 36px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 10px;
    background: var(--accent-soft);
    color: var(--ink-2);
  }
  .title-icon .msr { font-size: 20px; }
  .title-copy { flex: 1; min-width: 0; }
  h2 { margin: 0; font-size: 15px; line-height: 1.3; font-weight: 650; }
  .title-copy p { margin: 2px 0 0; font-size: 11.5px; color: var(--ink-4); }
  .close {
    width: 34px;
    height: 34px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 0;
    border-radius: 999px;
    background: transparent;
    color: var(--ink-4);
    cursor: pointer;
    transition: background-color 140ms ease, color 140ms ease, transform 100ms ease;
  }
  .close:hover { background: var(--surface-hover); color: var(--ink); }
  .close:active { transform: scale(0.96); }

  .layout { min-height: 0; flex: 1; display: flex; }
  nav {
    width: 188px;
    flex: 0 0 auto;
    display: flex;
    flex-direction: column;
    padding: 12px;
    background: var(--cream-soft);
    border-right: 1px solid var(--line-1);
  }
  .nav-items { display: flex; flex-direction: column; gap: 4px; }
  .nav-items button {
    min-height: 38px;
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 0 12px;
    border: 0;
    border-radius: 999px;
    background: transparent;
    color: var(--ink-3);
    font: inherit;
    font-size: 12.5px;
    font-weight: 500;
    text-align: left;
    cursor: pointer;
    transition: background-color 140ms ease, color 140ms ease;
  }
  .nav-items button .msr { font-size: 18px; }
  .nav-items button:hover { background: var(--surface-hover); color: var(--ink); }
  .nav-items button.active { background: var(--cream-content); color: var(--ink); box-shadow: 0 0 0 1px var(--elevation-ring-soft); }
  .auto-save-note {
    margin-top: auto;
    display: flex;
    align-items: flex-start;
    gap: 7px;
    padding: 10px 8px 2px;
    font-size: 10.5px;
    line-height: 1.4;
    color: var(--ink-5);
  }
  .auto-save-note .msr { margin-top: 1px; font-size: 15px; color: var(--ok-text); }

  main { min-width: 0; flex: 1; overflow-y: auto; }
  .pane { padding: 28px 30px 30px; animation: pane-in 150ms cubic-bezier(0.22, 1, 0.36, 1); }
  .pane-heading { margin-bottom: 24px; }
  .pane-heading h3, .product-name h3 { margin: 0; font-size: 18px; line-height: 1.3; font-weight: 650; text-wrap: balance; }
  .pane-heading p { margin: 5px 0 0; max-width: 52ch; font-size: 12.5px; line-height: 1.5; color: var(--ink-4); text-wrap: pretty; }

  .preference-list { display: flex; flex-direction: column; }
  .preference {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 18px 0;
    border-bottom: 1px solid var(--line-1);
  }
  .preference:first-child { padding-top: 0; }
  .preference:last-child { border-bottom: 0; }
  .preference-copy { display: flex; align-items: flex-start; gap: 10px; }
  .preference-icon { margin-top: 1px; font-size: 19px; color: var(--ink-4); }
  .preference-copy div, .data-copy { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
  strong { font-size: 12.5px; line-height: 1.35; font-weight: 600; }
  small { display: block; font-size: 11.5px; line-height: 1.45; color: var(--ink-4); }

  .segmented {
    width: fit-content;
    max-width: 100%;
    display: flex;
    gap: 3px;
    padding: 3px;
    border-radius: 999px;
    background: var(--surface);
    box-shadow: inset 0 0 0 1px var(--line-1);
  }
  .segmented button {
    min-width: 94px;
    height: 34px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 0 14px;
    border: 0;
    border-radius: 999px;
    background: transparent;
    color: var(--ink-3);
    font: inherit;
    font-size: 12px;
    font-weight: 500;
    white-space: nowrap;
    cursor: pointer;
    transition: background-color 140ms ease, color 140ms ease, box-shadow 140ms ease;
  }
  .segmented button .msr { font-size: 17px; }
  .segmented button:hover { color: var(--ink); }
  .segmented button.active {
    background: var(--cream-content);
    color: var(--ink);
    box-shadow: 0 1px 4px rgba(var(--shadow-rgb), 0.12), 0 0 0 1px var(--elevation-ring);
  }
  .widths button { min-width: 112px; }
  .text-sizes button { min-width: 88px; gap: 7px; }
  /* Échantillon rendu à la taille qu'il propose : le bouton montre son effet au lieu
     de le nommer. Hauteur de ligne à 1 pour que « Très grand » ne creuse pas la pilule. */
  .text-sample { font-weight: 600; line-height: 1; }

  .privacy-note {
    display: flex;
    align-items: flex-start;
    gap: 9px;
    margin-bottom: 12px;
    padding: 11px 13px;
    border-radius: 12px;
    background: var(--accent-soft);
    color: var(--ink-3);
    font-size: 11.5px;
    line-height: 1.45;
  }
  .privacy-note .msr { flex: 0 0 auto; font-size: 17px; color: var(--ok-text); }
  .data-list { display: flex; flex-direction: column; }
  .data-row {
    min-height: 74px;
    display: flex;
    align-items: center;
    gap: 11px;
    padding: 12px 0;
    border-bottom: 1px solid var(--line-1);
  }
  .data-icon { flex: 0 0 auto; font-size: 19px; color: var(--ink-4); }
  .data-copy { flex: 1; }
  .row-actions { flex: 0 0 auto; display: flex; align-items: center; gap: 6px; }
  .confirm-label { font-size: 11px; color: var(--ink-4); }
  .button {
    min-height: 32px;
    padding: 0 13px;
    border: 0;
    border-radius: 999px;
    font: inherit;
    font-size: 11.5px;
    font-weight: 550;
    white-space: nowrap;
    cursor: pointer;
    transition: background-color 140ms ease, color 140ms ease, box-shadow 140ms ease, transform 100ms ease;
  }
  .button:active:not(:disabled) { transform: scale(0.96); }
  .button.secondary { background: var(--surface); color: var(--ink-2); box-shadow: inset 0 0 0 1px var(--line-2); }
  .button.secondary:hover:not(:disabled) { background: var(--surface-hover); color: var(--ink); }
  .button.danger-quiet { background: transparent; color: var(--danger-action-text); }
  .button.danger-quiet:hover:not(:disabled) { background: color-mix(in srgb, var(--err) 11%, transparent); }
  .button.danger { background: var(--danger-action-text); color: var(--cream-content); }
  .button.danger:hover:not(:disabled) { filter: brightness(1.07); }
  .button:disabled { opacity: 0.42; cursor: default; }
  .done { margin: 10px 0 0; font-size: 11.5px; color: var(--ok-text); }
  .models-note { display: flex; align-items: flex-start; gap: 10px; margin-top: 18px; color: var(--ink-3); }
  .models-note > .msr { font-size: 18px; color: var(--ink-4); }
  .models-note div { display: flex; flex-direction: column; gap: 2px; }

  .about-pane { padding-top: 34px; }
  .brand-lockup { display: flex; align-items: center; gap: 16px; padding-bottom: 25px; border-bottom: 1px solid var(--line-1); }
  .mark {
    width: 64px;
    height: 64px;
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 17px;
    background: var(--cream-content);
    box-shadow: 0 0 0 1px var(--elevation-ring), 0 6px 18px rgba(var(--shadow-rgb), 0.10);
  }
  .brand-lockup > div:last-child { min-width: 0; }
  .product-name { display: flex; align-items: center; gap: 8px; }
  .product-name span { padding: 3px 8px; border-radius: 999px; background: var(--accent-soft); color: var(--ink-3); font-size: 10.5px; font-weight: 600; }
  .brand-lockup p { margin: 6px 0 0; max-width: 42ch; font-size: 12.5px; line-height: 1.5; color: var(--ink-4); text-wrap: pretty; }
  .about-list { display: flex; flex-direction: column; padding-top: 10px; }
  .about-list > div { display: flex; align-items: flex-start; gap: 12px; padding: 13px 0; }
  .about-list > div > .msr { margin-top: 1px; font-size: 19px; color: var(--ink-4); }
  .about-list p { display: flex; flex-direction: column; gap: 3px; }

  button:focus-visible { outline: 2px solid var(--line-3); outline-offset: 2px; }

  @keyframes settings-in {
    from { opacity: 0; transform: translateY(6px) scale(0.985); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }
  @keyframes pane-in {
    from { opacity: 0; transform: translateY(3px); }
    to { opacity: 1; transform: translateY(0); }
  }

  @media (max-width: 680px) {
    .settings { width: min(560px, calc(100vw - 20px)); }
    .window { height: min(590px, calc(100vh - 24px)); }
    .layout { flex-direction: column; }
    nav { width: auto; flex-direction: row; align-items: center; padding: 8px 10px; border-right: 0; border-bottom: 1px solid var(--line-1); overflow-x: auto; }
    .nav-items { flex: 1; flex-direction: row; }
    .nav-items button { justify-content: center; flex: 1; min-width: 104px; }
    .auto-save-note { display: none; }
    .pane { padding: 24px 22px 26px; }
  }

  @media (max-width: 520px) {
    .title-copy p { display: none; }
    .nav-items button { min-width: 40px; padding: 0 11px; }
    .nav-items button span:last-child { display: none; }
    .segmented { width: 100%; }
    .segmented button { min-width: 0; flex: 1; padding-inline: 9px; }
    .widths button { min-width: 0; }
    .text-sizes button { min-width: 0; }
    .data-row { align-items: flex-start; flex-wrap: wrap; }
    .data-copy { min-width: calc(100% - 32px); }
    .row-actions { width: 100%; justify-content: flex-end; }
  }

  @media (prefers-reduced-motion: reduce) {
    .window, .pane { animation: none; }
    button { transition: none !important; }
  }
</style>
