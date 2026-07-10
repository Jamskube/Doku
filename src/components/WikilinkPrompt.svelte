<script lang="ts">
  import { app, chooseWikilinkCandidate, createWikilinkTarget, dismissWikiPrompt } from '../lib/stores.svelte'

  function onKey(e: KeyboardEvent) {
    if (!app.wikiPrompt) return
    if (e.key === 'Escape') {
      e.preventDefault()
      dismissWikiPrompt()
    } else if (e.key === 'Enter' && app.wikiPrompt.kind === 'create') {
      e.preventDefault()
      void createWikilinkTarget()
    }
  }
</script>

<svelte:window onkeydown={onKey} />

{#if app.wikiPrompt}
  {@const p = app.wikiPrompt}
  <div class="overlay">
    <div class="card" role="dialog" aria-modal="true" aria-labelledby="wiki-title">
      {#if p.kind === 'create'}
        <h2 id="wiki-title" class="title">Créer une note</h2>
        <p class="msg">« {p.target} » n'existe pas encore. Créer <strong>{p.fileName}</strong> dans ce dossier ?</p>
        <div class="actions">
          <button class="btn ghost" onclick={dismissWikiPrompt}>Annuler</button>
          <!-- svelte-ignore a11y_autofocus -->
          <button class="btn primary" autofocus onclick={() => createWikilinkTarget()}>Créer</button>
        </div>
      {:else}
        <h2 id="wiki-title" class="title">Plusieurs notes trouvées</h2>
        <p class="msg">Quelle note « {p.target} » ouvrir ?</p>
        <div class="candidates">
          {#each p.candidates as c (c.path)}
            <button class="cand" onclick={() => chooseWikilinkCandidate(c.path)}>
              <span class="cand-name">{c.name}</span>
              {#if c.dir}<span class="cand-dir">{c.dir}</span>{/if}
            </button>
          {/each}
        </div>
        <div class="actions">
          <button class="btn ghost" onclick={dismissWikiPrompt}>Annuler</button>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(var(--ink-rgb), 0.32);
    backdrop-filter: blur(1.5px);
  }
  .card {
    width: min(440px, calc(100vw - 48px));
    background: var(--cream-content);
    border: 1px solid var(--line-2);
    border-radius: 14px;
    box-shadow: 0 18px 48px rgba(var(--ink-rgb), 0.28);
    padding: 22px 22px 18px;
  }
  .title {
    margin: 0 0 8px;
    font-family: var(--font-serif);
    font-size: 18px;
    font-weight: 600;
    color: var(--ink);
  }
  .msg {
    margin: 0 0 18px;
    font-size: 13.5px;
    line-height: 1.55;
    color: var(--ink-3);
  }
  .msg strong { color: var(--ink); font-weight: 600; }
  .candidates { display: flex; flex-direction: column; gap: 4px; margin: 0 0 18px; max-height: 260px; overflow-y: auto; }
  .cand {
    display: flex;
    align-items: baseline;
    gap: 8px;
    width: 100%;
    padding: 8px 12px;
    background: transparent;
    border: 1px solid var(--line-2);
    border-radius: 9px;
    cursor: pointer;
    text-align: left;
    transition: background 140ms ease, border-color 140ms ease;
  }
  .cand:hover { background: var(--surface-hover); border-color: var(--line-3); }
  .cand-name { font-size: 13px; color: var(--ink); font-weight: 500; }
  .cand-dir { font-size: 11.5px; color: var(--ink-4); }
  .actions { display: flex; justify-content: flex-end; gap: 8px; }
  .btn {
    padding: 8px 15px;
    border-radius: 9px;
    border: 1px solid transparent;
    font-size: 13px;
    cursor: pointer;
    transition: background 140ms ease, color 140ms ease, border-color 140ms ease;
  }
  .btn.ghost { background: transparent; color: var(--ink-3); border-color: var(--line-2); }
  .btn.ghost:hover { background: var(--surface-hover); color: var(--ink); }
  .btn.primary { background: var(--ink); color: var(--cream-content); }
  .btn.primary:hover { background: var(--ink-2); }
</style>
