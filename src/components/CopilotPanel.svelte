<script lang="ts">
  import { untrack } from 'svelte'
  import { activeTab, app } from '../lib/stores.svelte'
  import { closeWindow, minimizeWindow, toggleMaximizeWindow } from '../lib/tauri'
  import { formatBytes } from '../lib/ollama'
  import { cancelPull, copilot, pullModel, refreshModels, removeModel, setActiveModel } from '../lib/copilot.svelte'

  const SUGGESTIONS = ['gemma2:2b', 'phi3:mini', 'codellama:7b']

  // Vue Modèles : liste à l'ouverture (intention explicite). L'effet ne track QUE la vue —
  // `refreshModels` (lit ET écrit copilot.*) est `untrack`é pour ne pas s'auto-re-déclencher.
  // La vue « chat » ne démarre JAMAIS le moteur (coquille statique) → aucun spawn au boot.
  let pullName = $state('')
  $effect(() => {
    if (app.copilotOpen && app.copilotView === 'models') {
      untrack(() => void refreshModels())
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

  function confirmRemove(name: string) {
    if (confirm(`Supprimer le modèle « ${name} » du disque ? Cette action est irréversible.`)) {
      void removeModel(name)
    }
  }
</script>

<aside class="cop-panel">
  <!-- En-tête : contrôles panneau + contrôles fenêtre (draggable, motif TitleBar) -->
  <header class="cop-head" data-tauri-drag-region>
    <span class="cop-title" data-tauri-drag-region>Doku-San</span>
    <div class="cop-head-spacer" data-tauri-drag-region></div>
    {#if app.copilotView === 'models'}
      <button class="cop-ic" title="Retour au chat" aria-label="Retour au chat" onclick={() => (app.copilotView = 'chat')}>
        <span class="msr" style="font-size:19px">arrow_back</span>
      </button>
    {:else}
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
    <div class="cop-scroll">
      {#if app.copilotView === 'models'}
        {#if copilot.error}
          <p class="cop-msg err">{copilot.error}</p>
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
                <span class="cop-mono">qwen2.5:3b</span>
                <span class="cop-badge">conseillé</span>
              </div>
              <div class="cop-reco-sub">1,9 Go · léger, rapide, idéal pour les notes</div>
              <button class="cop-btn-fill" onclick={() => startPull('qwen2.5:3b')}>
                <span class="msr" style="font-size:17px">download</span>Télécharger ce modèle
              </button>
            </div>
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
                    <div class="cop-hero-name">
                      <div class="cop-mono lg">{activeInstalled.name}</div>
                      <div class="cop-hero-tag">Modèle actif</div>
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
                  <div class="cop-row" class:active={isActive}>
                    <button class="cop-row-pick" title="Choisir comme modèle actif" aria-pressed={isActive} onclick={() => setActiveModel(m.name)}>
                      <span class="cop-dot" class:on={isActive}></span>
                      <span class="cop-mono grow">{m.name}</span>
                      <span class="cop-size">{formatBytes(m.size)}</span>
                    </button>
                    <button class="cop-del" title="Supprimer" aria-label={'Supprimer ' + m.name} onclick={() => confirmRemove(m.name)}>
                      <span class="msr" style="font-size:17px">delete</span>
                    </button>
                  </div>
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
                    <span class="cop-size">{copilot.pulling.pct > 0 ? copilot.pulling.pct + ' %' : '…'}</span>
                    <button class="cop-del" title="Annuler" aria-label="Annuler le téléchargement" onclick={cancelPull}>
                      <span class="msr" style="font-size:16px">close</span>
                    </button>
                  </div>
                  <div class="cop-track"><div class="doku-skel" style="width:{copilot.pulling.pct}%;height:100%;border-radius:3px"></div></div>
                </div>
              </section>
            {/if}

            <!-- Ajouter -->
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
                <button class="cop-btn-sm" onclick={() => startPull()} disabled={!pullName.trim()}>Obtenir</button>
              </div>
              <div class="cop-chips">
                {#each SUGGESTIONS as s (s)}
                  <button class="cop-chip" onclick={() => startPull(s)}>
                    <span class="msr" style="font-size:14px;color:var(--ink-4)">add</span>{s}
                  </button>
                {/each}
              </div>
            </section>
          </div>
        {/if}
      {:else}
        <!-- Vue chat : coquille statique (14.0). Câblage streaming = 14.1. -->
        <div class="cop-chat-empty">
          <div class="cop-empty-title">Bonjour.</div>
          <p class="cop-empty-sub">Posez une question, ou lancez une action sur le document ouvert.</p>
          <div class="cop-actions">
            <button class="cop-action" disabled>
              <span class="msr" style="font-size:19px;color:var(--ink-4)">summarize</span><span class="grow">Résumer ce document</span><span class="msr" style="font-size:16px;color:var(--ink-5)">arrow_forward</span>
            </button>
            <button class="cop-action" disabled>
              <span class="msr" style="font-size:19px;color:var(--ink-4)">quiz</span><span class="grow">Poser une question dessus</span><span class="msr" style="font-size:16px;color:var(--ink-5)">arrow_forward</span>
            </button>
            <button class="cop-action" disabled>
              <span class="msr" style="font-size:19px;color:var(--ink-4)">key</span><span class="grow">Extraire les points clés</span><span class="msr" style="font-size:16px;color:var(--ink-5)">arrow_forward</span>
            </button>
          </div>
          <p class="cop-soon">Le chat arrive bientôt (14.1).</p>
        </div>
      {/if}
    </div>

    <!-- Zone de saisie « imbriquée » (coquille désactivée en 14.0) -->
    {#if app.copilotView === 'chat'}
      <div class="cop-input-wrap">
        <div class="cop-input">
          <div class="cop-input-ctx">
            <span class="cop-ctx-chip">
              <span class="msr" style="font-size:14px;color:var(--ink-4)">description</span>{activeTab()?.name ?? 'aucun document'}
            </span>
            <button class="cop-ctx-add" disabled><span class="msr" style="font-size:14px">add</span>Contexte</button>
          </div>
          <div class="cop-input-field">
            <button class="cop-input-attach" disabled aria-label="Joindre"><span class="msr" style="font-size:20px">add</span></button>
            <div class="cop-input-ph">Posez une question sur ce document…</div>
            <button class="cop-input-send" disabled aria-label="Envoyer"><span class="msr" style="font-size:19px">arrow_upward</span></button>
          </div>
        </div>
        <div class="cop-disclaimer">Doku peut se tromper — vérifiez les informations importantes.</div>
      </div>
    {/if}
  </div>
</aside>

<style>
  .cop-panel {
    flex: 0 0 344px;
    height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--cream-base);
    animation: doku-panel-in 200ms cubic-bezier(0.22, 1, 0.36, 1);
  }

  /* En-tête */
  .cop-head {
    height: 40px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 2px 0 15px;
    user-select: none;
  }
  .cop-title { font-size: 12.5px; font-weight: 600; color: var(--ink-2); }
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
  }
  .cop-ic { width: 28px; height: 28px; border-radius: 7px; color: var(--ink-4); }
  .cop-win { width: 38px; }
  .cop-win.close { width: 40px; }
  .cop-ic:hover,
  .cop-win:hover { background: var(--surface-hover); color: var(--ink); }
  .cop-win.close:hover { background: var(--err); color: #fff; }

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
  .cop-scroll { flex: 1; min-height: 0; overflow-y: auto; padding: 0 13px; }
  .cop-msg { margin: 14px 4px; font-size: 12.5px; color: var(--ink-4); }
  .cop-msg.err { color: var(--err); }

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
  .cop-count { font-size: 11px; color: var(--ink-5); white-space: nowrap; letter-spacing: 0; }

  /* Carte héro */
  .cop-hero { border-radius: 18px; overflow: hidden; border: 1px solid var(--line-2); }
  .cop-hero-head { background: var(--cream-content); padding: 14px 15px 26px; display: flex; align-items: center; gap: 12px; }
  .cop-hero-icon {
    width: 42px; height: 42px; flex: 0 0 auto; border-radius: 12px;
    background: var(--surface-2); border: 1px solid var(--line-2); display: flex; align-items: center; justify-content: center; color: var(--ink);
  }
  .cop-hero-name { min-width: 0; flex: 1; }
  .cop-hero-tag { font-size: 11.5px; color: var(--ink-4); margin-top: 2px; }
  .cop-hero-stats { margin-top: -16px; background: var(--surface-2); border-radius: 16px 16px 0 0; padding: 15px 16px; display: flex; }
  .cop-stat { flex: 1; text-align: center; }
  .cop-stat .cop-mono { font-size: 15px; }
  .cop-stat-lbl { font-size: 10px; color: var(--ink-4); letter-spacing: 0.04em; margin-top: 3px; }
  .cop-stat-sep { width: 1px; background: var(--line-2); }
  .cop-pill {
    display: inline-flex; align-items: center; gap: 5px; height: 23px; padding: 0 9px 0 8px; border-radius: 999px;
    background: rgba(107, 164, 123, 0.16); color: var(--ok); font-size: 11px; font-weight: 600;
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
  .cop-add-input::placeholder { color: var(--ink-5); }
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

  /* Chat (coquille) */
  .cop-chat-empty { padding: 20px 4px 8px; }
  .cop-empty-title { font-size: 16px; font-weight: 600; color: var(--ink); margin-bottom: 4px; }
  .cop-empty-sub { font-size: 12.5px; line-height: 1.55; color: var(--ink-4); margin-bottom: 18px; }
  .cop-actions { display: flex; flex-direction: column; gap: 6px; }
  .cop-action {
    display: flex; align-items: center; gap: 10px; width: 100%; padding: 11px 12px;
    background: var(--cream-content); border: 1px solid var(--line-1); border-radius: 11px;
    color: var(--ink-2); font-family: var(--font-sans); font-size: 13px; text-align: left; cursor: default;
  }
  .cop-action[disabled] { opacity: 0.55; }
  .cop-soon { margin: 16px 0 0; text-align: center; font-size: 11px; color: var(--ink-5); }

  /* Saisie imbriquée (désactivée) */
  .cop-input-wrap { flex-shrink: 0; padding: 8px 13px 12px; }
  .cop-input { border-radius: 19px; overflow: hidden; border: 1px solid var(--line-2); display: flex; flex-direction: column; opacity: 0.75; }
  .cop-input-ctx { background: var(--cream-tint); padding: 10px 13px 22px; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .cop-ctx-chip {
    display: inline-flex; align-items: center; gap: 5px; height: 24px; padding: 0 8px;
    background: var(--cream-content); border: 1px solid var(--line-2); border-radius: 8px; font-size: 11.5px; color: var(--ink-2);
  }
  .cop-ctx-add {
    display: inline-flex; align-items: center; gap: 3px; height: 24px; padding: 0 9px;
    background: transparent; border: 1px dashed var(--line-3); border-radius: 8px;
    font-family: var(--font-sans); font-size: 11.5px; color: var(--ink-4); cursor: default;
  }
  .cop-input-field { margin-top: -15px; background: var(--cream-content); border-radius: 15px 15px 0 0; padding: 11px 12px 12px; display: flex; align-items: flex-end; gap: 8px; }
  .cop-input-attach { width: 30px; height: 30px; flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; background: transparent; border: 0; border-radius: 9px; color: var(--ink-4); cursor: default; }
  .cop-input-ph { flex: 1; min-width: 0; font-size: 13px; color: var(--ink-5); padding: 6px 0; line-height: 1.4; }
  .cop-input-send { width: 30px; height: 30px; flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; background: var(--ink); border: 0; border-radius: 50%; color: var(--cream-content); cursor: default; opacity: 0.6; }
  .cop-disclaimer { text-align: center; font-size: 10.5px; color: var(--ink-5); margin-top: 9px; }
</style>
