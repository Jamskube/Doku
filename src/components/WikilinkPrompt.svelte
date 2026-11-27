<script lang="ts">
  import { app, chooseWikilinkCandidate, createWikilinkTarget, dismissWikiPrompt } from '../lib/stores.svelte'
  import { closeDialog } from '../lib/dialog-close'

  let dlg: HTMLDialogElement | undefined = $state()
  // Annuler/Échap jouent la sortie ; onclose démonte ensuite via dismissWikiPrompt.
  const dismiss = () => (dlg ? closeDialog(dlg) : dismissWikiPrompt())

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
    dismiss()
  }
</script>

{#if app.wikiPrompt}
  {@const p = app.wikiPrompt}
  <dialog
    class="doku-modal"
    bind:this={dlg}
    use:modal
    aria-labelledby="wiki-title"
    aria-describedby="wiki-message"
    onkeydown={onKey}
    oncancel={(e) => { e.preventDefault(); dismiss() }}
    onclose={(e) => { if (e.currentTarget.isConnected && app.wikiPrompt) dismissWikiPrompt() }}
  >
    <section class="doku-alert">
      {#if p.kind === 'create'}
        <span class="doku-tile tint-sage" aria-hidden="true"><svg class="icon" aria-hidden="true"><use href="#i-file-plus" /></svg></span>
        <h2 id="wiki-title" class="doku-alert-title">Créer une note</h2>
        <p id="wiki-message" class="doku-alert-message">« {p.target} » n'existe pas encore. Créer <strong>{p.fileName}</strong> dans ce dossier ?</p>
        <div class="doku-alert-actions">
          <!-- svelte-ignore a11y_autofocus -->
          <button class="doku-btn is-primary" autofocus onclick={() => createWikilinkTarget()}>Créer</button>
          <button class="doku-btn" onclick={dismiss}>Annuler</button>
        </div>
      {:else}
        <span class="doku-tile tint-slate" aria-hidden="true"><svg class="icon" aria-hidden="true"><use href="#i-copy" /></svg></span>
        <h2 id="wiki-title" class="doku-alert-title">Plusieurs notes trouvées</h2>
        <p id="wiki-message" class="doku-alert-message">Quelle note « {p.target} » ouvrir ?</p>
        <div class="candidates doku-inset-group">
          {#each p.candidates as c (c.path)}
            <button class="cand doku-inset-row" onclick={() => chooseWikilinkCandidate(c.path)}>
              <span class="doku-inset-copy">
                <span class="doku-inset-label">{c.name}</span>
                {#if c.dir}<span class="doku-inset-help">{c.dir}</span>{/if}
              </span>
              <svg class="icon chevron" aria-hidden="true"><use href="#i-chevron-right" /></svg>
            </button>
          {/each}
        </div>
        <div class="doku-alert-actions">
          <button class="doku-btn" onclick={dismiss}>Annuler</button>
        </div>
      {/if}
    </section>
  </dialog>
{/if}

<style>
  /* Choix entre plusieurs notes : une liste encastrée dans l'alerte, une rangée par note. */
  .candidates {
    align-self: stretch;
    max-height: 260px;
    margin-top: 16px;
    overflow-y: auto;
    text-align: left;
  }
  .cand {
    width: 100%;
    border: 0;
    border-radius: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition: background-color var(--duration-basic) ease;
  }
  .cand:first-child { border-radius: var(--radius-xl) var(--radius-xl) 0 0; }
  .cand:last-child { border-radius: 0 0 var(--radius-xl) var(--radius-xl); }
  .cand:only-child { border-radius: var(--radius-xl); }
  .cand :global(.doku-inset-help) { overflow-wrap: anywhere; }
  .chevron { font-size: 14px; color: var(--ink-5); }
  /* Survol de rangée réservé à la souris : au doigt, il resterait allumé après le toucher. */
  @media (hover: hover) and (pointer: fine) {
    .cand:hover { background: var(--surface-hover); }
  }
  .cand:focus-visible { outline-offset: -2px; }
</style>
