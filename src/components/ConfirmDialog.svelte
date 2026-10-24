<script lang="ts">
  import { dialog, resolveDialog } from '../lib/stores.svelte'

  let dialogEl: HTMLDialogElement
  let saveButton: HTMLButtonElement

  $effect(() => {
    if (dialog.open && dialogEl && !dialogEl.open) {
      dialogEl.showModal()
      queueMicrotask(() => saveButton?.focus())
    } else if (!dialog.open && dialogEl?.open) {
      dialogEl.close()
    }
  })

  function cancel(event?: Event) {
    event?.preventDefault()
    resolveDialog('cancel')
  }

  function handleClose() {
    if (dialog.open) resolveDialog('cancel')
  }

  function handleKeydown(event: KeyboardEvent) {
    if (!dialog.open || event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    resolveDialog('cancel')
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<dialog
  bind:this={dialogEl}
  class="confirm-dialog"
  aria-labelledby="dlg-title"
  aria-describedby="dlg-message"
  oncancel={cancel}
  onclose={handleClose}
  onclick={(event) => {
    if (event.target === dialogEl) cancel()
  }}
>
  <section class="panel">
    <div class="heading">
      <span class="tile" aria-hidden="true">
        <svg class="icon" aria-hidden="true"><use href="#i-save" /></svg>
      </span>
      <div class="copy">
        <h2 id="dlg-title">{dialog.title}</h2>
        <p id="dlg-message">{dialog.message}</p>
      </div>
    </div>

    <div class="actions">
      <button class="button discard" onclick={() => resolveDialog('discard')}>Ne pas enregistrer</button>
      <div class="actions-primary">
        <button class="button cancel" onclick={() => resolveDialog('cancel')}>Annuler</button>
        <button bind:this={saveButton} class="button save" onclick={() => resolveDialog('save')}>Enregistrer</button>
      </div>
    </div>
  </section>
</dialog>

<style>
  .confirm-dialog {
    width: min(440px, calc(100vw - 32px));
    max-width: none;
    margin: auto;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--ink);
    overflow: visible;
  }

  /* Voile discret, comme toutes les modales de Doku : la fenêtre se détache par son
     ombre, pas par l'assombrissement du document derrière elle. */
  .confirm-dialog::backdrop {
    background: var(--scrim);
    animation: doku-fade-in var(--duration-dialog) var(--ease-enter-snappy);
  }

  .panel {
    padding: 20px;
    border-radius: var(--radius-2xl);
    background: var(--surface);
    box-shadow: var(--shadow-dialog);
    animation: doku-dialog-in var(--duration-dialog) var(--ease-enter-snappy);
  }

  .heading {
    display: flex;
    align-items: flex-start;
    gap: 12px;
  }

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
  h2 {
    margin: 0 0 4px;
    font-size: var(--text-lg);
    line-height: var(--leading-tight);
    font-weight: var(--weight-strong);
    letter-spacing: var(--tracking-tight);
    color: var(--ink);
    text-wrap: balance;
  }
  p {
    margin: 0;
    max-width: 46ch;
    font-size: var(--text-md);
    line-height: var(--leading-normal);
    color: var(--ink-3);
    text-wrap: pretty;
  }

  .actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-top: 20px;
  }
  .actions-primary { display: flex; gap: 8px; }

  .button {
    height: var(--control-md);
    padding: 0 12px;
    border: 0;
    border-radius: var(--radius-lg);
    font: inherit;
    font-size: var(--text-sm);
    font-weight: var(--weight-control);
    white-space: nowrap;
    cursor: pointer;
    transition: background-color var(--duration-basic) ease, color var(--duration-basic) ease, transform var(--duration-basic) var(--ease-enter-snappy);
  }
  .button:active { transform: scale(0.97); }

  /* Le refus perd le travail : rouge d'action du système, en bouton fantôme pour que
     « Enregistrer » reste la seule action pleine. */
  .discard { background: transparent; color: var(--danger-action-text); }
  .discard:hover { background: color-mix(in srgb, var(--danger-action-text) 10%, transparent); }
  .cancel { background: var(--accent-soft); color: var(--ink); }
  .cancel:hover { background: var(--fill-pressed); }
  .save { background: var(--ink); color: var(--cream-content); }
  .save:hover { background: var(--ink-2); }

  @media (max-width: 460px) {
    .actions { align-items: stretch; flex-direction: column-reverse; }
    .actions-primary { display: grid; grid-template-columns: 1fr 1fr; }
    .button { width: 100%; }
  }
</style>
