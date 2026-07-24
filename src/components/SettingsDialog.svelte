<script lang="ts">
  import { app, closeSettings, setColumnWidth, setTheme } from '../lib/stores.svelte'
  import { deleteAllRagIndexes } from '../lib/rag-index.svelte'
  import { isTauri, purgeSnapshotsHard } from '../lib/tauri'
  import { version } from '../../package.json'
  import DokuMark from '../lib/DokuMark.svelte'

  // <dialog> natif : le piège de focus, la touche Échap et le fond assombri sont
  // fournis par la plateforme. Les réimplémenter à la main serait plus de code ET
  // moins accessible.
  let dlg = $state<HTMLDialogElement | null>(null)
  let aboutEl = $state<HTMLElement | null>(null)

  $effect(() => {
    const el = dlg
    if (!el) return
    if (app.settingsOpen && !el.open) el.showModal()
    else if (!app.settingsOpen && el.open) el.close()
  })

  // Ouverture depuis le logo : on amène « À propos » sous les yeux.
  $effect(() => {
    if (app.settingsOpen && app.settingsFocus === 'about') aboutEl?.scrollIntoView({ block: 'nearest' })
  })

  // --- Purges (destructif : confirmation en deux temps, jamais un clic unique) ---
  type Job = 'snapshots' | 'rag'
  let confirming = $state<Job | null>(null)
  let running = $state<Job | null>(null)
  let done = $state<string | null>(null)

  async function purge(job: Job) {
    if (running) return
    running = job
    done = null
    try {
      if (job === 'snapshots') {
        const n = await purgeSnapshotsHard()
        done = n === 0 ? 'Aucun historique à supprimer.' : `Historique supprimé (${n} fichier${n > 1 ? 's' : ''}).`
      } else {
        await deleteAllRagIndexes()
        done = 'Index sémantique supprimé.'
      }
    } catch {
      done = 'Suppression impossible (fichier verrouillé ?).'
    } finally {
      running = null
      confirming = null
    }
  }

  const THEMES = [
    { key: 'light' as const, label: 'Clair', icon: 'light_mode' },
    { key: 'dark' as const, label: 'Sombre', icon: 'dark_mode' },
  ]
  const WIDTHS = [
    { key: 'narrow' as const, label: 'Étroit', icon: 'width_normal' },
    { key: 'wide' as const, label: 'Confortable', icon: 'width_wide' },
    { key: 'full' as const, label: 'Pleine largeur', icon: 'width_full' },
  ]
</script>

<dialog
  bind:this={dlg}
  class="settings"
  aria-label="Paramètres"
  onclose={closeSettings}
  onclick={(e) => {
    // Clic sur le fond (la cible est le <dialog> lui-même, pas son contenu) → fermer.
    if (e.target === dlg) closeSettings()
  }}
>
  <div class="sheet">
    <header>
      <h2>Paramètres</h2>
      <button class="close" title="Fermer" aria-label="Fermer" onclick={closeSettings}>
        <span class="msr">close</span>
      </button>
    </header>

    <div class="body">
      <section>
        <h3>Apparence</h3>
        <div class="field">
          <span class="lbl">Thème</span>
          <div class="seg" role="radiogroup" aria-label="Thème">
            {#each THEMES as t (t.key)}
              <button
                role="radio"
                aria-checked={app.theme === t.key}
                class:on={app.theme === t.key}
                onclick={() => setTheme(t.key)}
              >
                <span class="msr">{t.icon}</span>{t.label}
              </button>
            {/each}
          </div>
        </div>
        <div class="field">
          <span class="lbl">Largeur du document</span>
          <div class="seg" role="radiogroup" aria-label="Largeur du document">
            {#each WIDTHS as w (w.key)}
              <button
                role="radio"
                aria-checked={app.columnWidth === w.key}
                class:on={app.columnWidth === w.key}
                onclick={() => setColumnWidth(w.key)}
              >
                <span class="msr">{w.icon}</span>{w.label}
              </button>
            {/each}
          </div>
        </div>
      </section>

      <section>
        <h3>Données</h3>
        <p class="note">
          Tout est stocké sur cette machine. Ces suppressions sont <strong>définitives</strong> et ne
          touchent jamais vos documents — seulement ce que Doku a créé à côté.
        </p>

        <div class="row">
          <div class="grow">
            <span class="lbl">Historique des versions</span>
            <small>Instantanés gardés à chaque enregistrement, purgés automatiquement.</small>
          </div>
          {#if confirming === 'snapshots'}
            <div class="confirm">
              <button class="danger" disabled={!!running} onclick={() => purge('snapshots')}>
                {running === 'snapshots' ? 'Suppression…' : 'Confirmer'}
              </button>
              <button class="ghost" disabled={!!running} onclick={() => (confirming = null)}>Annuler</button>
            </div>
          {:else}
            <button class="ghost" disabled={!isTauri || !!running} onclick={() => (confirming = 'snapshots')}>
              Purger
            </button>
          {/if}
        </div>

        <div class="row">
          <div class="grow">
            <span class="lbl">Index sémantique</span>
            <small>Vecteurs calculés pour la recherche du copilote dans un dossier.</small>
          </div>
          {#if confirming === 'rag'}
            <div class="confirm">
              <button class="danger" disabled={!!running} onclick={() => purge('rag')}>
                {running === 'rag' ? 'Suppression…' : 'Confirmer'}
              </button>
              <button class="ghost" disabled={!!running} onclick={() => (confirming = null)}>Annuler</button>
            </div>
          {:else}
            <button class="ghost" disabled={!isTauri || !!running} onclick={() => (confirming = 'rag')}>
              Purger
            </button>
          {/if}
        </div>

        {#if done}<p class="done" role="status">{done}</p>{/if}
        <p class="hint">
          Les modèles IA se règlent dans le copilote, onglet <strong>Modèles</strong>.
        </p>
      </section>

      <section bind:this={aboutEl} class:highlight={app.settingsFocus === 'about'}>
        <h3>À propos</h3>
        <div class="about">
          <DokuMark size={34} />
          <div>
            <strong>Doku</strong> <span class="ver">v{version}</span>
            <small>Lecteur-éditeur Markdown, HTML, texte et PDF.</small>
            <small><strong>100 % hors-ligne</strong> — aucun document ne quitte cette machine.</small>
          </div>
        </div>
      </section>
    </div>
  </div>
</dialog>

<style>
  .settings {
    padding: 0;
    border: 0;
    background: transparent;
    max-width: none;
    max-height: none;
  }
  .settings::backdrop { background: rgb(0 0 0 / 0.32); }

  .sheet {
    width: min(520px, calc(100vw - 32px));
    max-height: min(640px, calc(100vh - 64px));
    display: flex;
    flex-direction: column;
    background: var(--cream-base);
    color: var(--ink);
    border: 1px solid var(--line-2);
    border-radius: 14px;
    box-shadow: 0 24px 64px rgb(0 0 0 / 0.28);
    overflow: hidden;
  }

  header {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 14px 12px 14px 18px;
    border-bottom: 1px solid var(--line-1);
  }
  h2 { flex: 1; margin: 0; font-size: 15px; font-weight: 600; }
  .close {
    width: 28px;
    height: 28px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: 0;
    border-radius: 7px;
    color: var(--ink-4);
    cursor: pointer;
  }
  .close:hover { background: var(--surface-hover); color: var(--ink); }

  .body { overflow-y: auto; padding: 6px 18px 18px; }
  section { padding: 14px 0; border-bottom: 1px solid var(--line-1); }
  section:last-child { border-bottom: 0; }
  section.highlight { background: var(--accent-soft); border-radius: 10px; padding-inline: 12px; margin-inline: -12px; }
  h3 { margin: 0 0 10px; font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--ink-4); }

  .field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; }
  .field:last-child { margin-bottom: 0; }
  .lbl { font-size: 13px; font-weight: 500; }

  .seg { display: flex; gap: 4px; flex-wrap: wrap; }
  .seg button {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 30px;
    padding: 0 10px;
    background: var(--surface);
    border: 1px solid var(--line-2);
    border-radius: 8px;
    color: var(--ink-2);
    font: inherit;
    font-size: 12.5px;
    cursor: pointer;
  }
  .seg button :global(.msr) { font-size: 17px; }
  .seg button:hover { background: var(--surface-hover); color: var(--ink); }
  .seg button.on { background: var(--accent-soft); border-color: var(--line-3); color: var(--ink); font-weight: 500; }

  .row { display: flex; align-items: flex-start; gap: 12px; padding: 8px 0; }
  .row .grow { flex: 1; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  small { font-size: 11.5px; color: var(--ink-4); line-height: 1.4; display: block; }
  .note { margin: 0 0 6px; font-size: 12px; color: var(--ink-3, var(--ink-4)); line-height: 1.5; }
  .hint { margin: 10px 0 0; font-size: 11.5px; color: var(--ink-4); }
  .done { margin: 8px 0 0; font-size: 12px; color: var(--ink-2); }

  .confirm { display: flex; gap: 6px; flex-shrink: 0; }
  .ghost, .danger {
    height: 28px;
    padding: 0 12px;
    border-radius: 7px;
    font: inherit;
    font-size: 12.5px;
    cursor: pointer;
    flex-shrink: 0;
  }
  .ghost { background: var(--surface); border: 1px solid var(--line-2); color: var(--ink-2); }
  .ghost:hover:not(:disabled) { background: var(--surface-hover); color: var(--ink); }
  .danger { background: var(--danger, #b4442f); border: 1px solid transparent; color: #fff; }
  .danger:hover:not(:disabled) { filter: brightness(1.08); }
  .ghost:disabled, .danger:disabled { opacity: 0.45; cursor: default; }

  .about { display: flex; align-items: flex-start; gap: 12px; }
  .about div { display: flex; flex-direction: column; gap: 2px; }
  .ver { font-size: 12px; color: var(--ink-4); }
</style>
