<script lang="ts">
  import { app, chooseWikilinkCandidate, createWikilinkTarget, dismissWikiPrompt } from '../lib/stores.svelte'

  // <dialog> modale native (comme ConfirmDialog) : piège de focus, fond inerte, Échap.
  // Entrée n'est plus interceptée : le bouton focalisé reçoit son clic natif, donc
  // Entrée sur « Annuler » annule (avant, elle créait le fichier).
  function modal(node: HTMLDialogElement) {
    node.showModal()
    // close() avant le démontage : le navigateur rend le focus à l'élément d'avant
    // (l'éditeur) ; un <dialog> simplement retiré du DOM le laisserait sur <body>.
    return { destroy: () => { if (node.open) node.close() } }
  }

  function onKey(e: KeyboardEvent) {
    if (e.key !== 'Escape') return
    // Arrêté ici : les raccourcis Échap de la fenêtre (mode focus, copilote agrandi)
    // ne doivent pas partir en même temps.
    e.preventDefault()
    e.stopPropagation()
    dismissWikiPrompt()
  }
</script>

{#if app.wikiPrompt}
  {@const p = app.wikiPrompt}
  <dialog
    class="card"
    use:modal
    aria-labelledby="wiki-title"
    aria-describedby="wiki-message"
    onkeydown={onKey}
    oncancel={(e) => { e.preventDefault(); dismissWikiPrompt() }}
    onclose={(e) => { if (e.currentTarget.isConnected && app.wikiPrompt) dismissWikiPrompt() }}
  >
    {#if p.kind === 'create'}
      <div class="heading">
        <span class="tile" aria-hidden="true"><svg class="icon" aria-hidden="true"><use href="#i-file-plus" /></svg></span>
        <div class="copy">
          <h2 id="wiki-title" class="title">Créer une note</h2>
          <p id="wiki-message" class="msg">« {p.target} » n'existe pas encore. Créer <strong>{p.fileName}</strong> dans ce dossier ?</p>
        </div>
      </div>
      <div class="actions">
        <button class="btn secondary" onclick={dismissWikiPrompt}>Annuler</button>
        <!-- svelte-ignore a11y_autofocus -->
        <button class="btn primary" autofocus onclick={() => createWikilinkTarget()}>Créer</button>
      </div>
    {:else}
      <h2 id="wiki-title" class="title">Plusieurs notes trouvées</h2>
      <p id="wiki-message" class="msg">Quelle note « {p.target} » ouvrir ?</p>
      <div class="candidates">
        {#each p.candidates as c (c.path)}
          <button class="cand" onclick={() => chooseWikilinkCandidate(c.path)}>
            <span class="cand-name">{c.name}</span>
            {#if c.dir}<span class="cand-dir">{c.dir}</span>{/if}
          </button>
        {/each}
      </div>
      <div class="actions">
        <button class="btn secondary" onclick={dismissWikiPrompt}>Annuler</button>
      </div>
    {/if}
  </dialog>
{/if}

<style>
  /* Alerte à la Kube : rayon 2xl, ombre de rôle, entrée qui monte en fondu. `margin:
     auto` + `max-*` : le reset d'app.css écrase le centrage natif du <dialog>. */
  .card {
    width: min(440px, calc(100vw - 48px));
    max-width: none;
    max-height: none;
    margin: auto;
    border: 0;
    background: var(--surface);
    color: var(--ink);
    border-radius: var(--radius-2xl);
    box-shadow: var(--shadow-dialog);
    padding: 20px;
    animation: doku-dialog-in var(--duration-dialog) var(--ease-enter-snappy);
  }
  /* --scrim passe par --shadow-rgb, jamais --ink-rgb : en sombre, ce dernier est
     CLAIR et le voile éclaircirait la page au lieu de l'assombrir. */
  .card::backdrop {
    background: var(--scrim);
    animation: doku-fade-in var(--duration-dialog) var(--ease-enter-snappy);
  }
  /* Tuile d'icône 36px des alertes (ConfirmDialog) : même en-tête d'une modale à l'autre. */
  .heading { display: flex; align-items: flex-start; gap: 12px; }
  .tile {
    width: 36px;
    height: 36px;
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-xl);
    background: var(--accent-soft);
    color: var(--ink);
    font-size: 18px;
  }
  .copy { min-width: 0; padding-top: 2px; }
  .title {
    margin: 0 0 6px;
    font-size: var(--text-lg);
    line-height: var(--leading-tight);
    font-weight: var(--weight-strong);
    letter-spacing: var(--tracking-tight);
    color: var(--ink);
    text-wrap: balance;
  }
  .msg {
    margin: 0 0 20px;
    font-size: var(--text-md);
    line-height: var(--leading-normal);
    color: var(--ink-3);
    text-wrap: pretty;
  }
  .msg strong { color: var(--ink); font-weight: var(--weight-strong); }
  .candidates { display: flex; flex-direction: column; gap: 2px; margin: 0 0 20px; max-height: 260px; overflow-y: auto; }
  /* Rangées de liste : 32px, rayon de rangée, survol en --accent-soft. */
  .cand {
    display: flex;
    align-items: baseline;
    gap: 8px;
    width: 100%;
    min-height: var(--control-md);
    padding: 7px 12px;
    background: var(--surface-2);
    border: 0;
    border-radius: var(--radius-md);
    cursor: pointer;
    text-align: left;
    transition: background-color var(--duration-basic) ease;
  }
  /* Survol de rangée réservé à la souris : au doigt, il resterait allumé après le toucher. */
  @media (hover: hover) and (pointer: fine) {
    .cand:hover { background: var(--accent-soft); }
  }
  .cand-name { font-size: var(--text-sm); color: var(--ink); font-weight: var(--weight-control); }
  .cand-dir { min-width: 0; overflow-wrap: anywhere; font-size: var(--text-xs); color: var(--ink-3); }
  .actions { display: flex; justify-content: flex-end; gap: 8px; }
  .btn {
    height: var(--control-md);
    padding: 0 14px;
    border-radius: var(--radius-lg);
    border: 0;
    font-size: var(--text-sm);
    font-weight: var(--weight-control);
    cursor: pointer;
    transition: background-color var(--duration-basic) ease, transform var(--duration-basic) var(--ease-enter-snappy);
  }
  .btn:active { transform: scale(0.97); }
  .btn.secondary { background: var(--accent-soft); color: var(--ink); }
  .btn.secondary:hover { background: var(--fill-pressed); }
  .btn.primary { background: var(--ink); color: var(--cream-content); }
  .btn.primary:hover { background: var(--ink-2); }
  /* Focus CLAVIER : c'est une boîte de dialogue, elle se pilote au clavier. */
  .btn:focus-visible,
  .cand:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
  .cand:focus-visible { outline-offset: -2px; }
</style>
