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
      <span class="icon" aria-hidden="true">
        <span class="msr">edit_note</span>
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

  .confirm-dialog::backdrop {
    background: rgb(0 0 0 / 0.38);
    -webkit-backdrop-filter: blur(3px);
    backdrop-filter: blur(3px);
  }

  .panel {
    padding: 20px;
    border-radius: 16px;
    background: var(--cream-base);
    box-shadow:
      0 0 0 1px var(--elevation-ring),
      0 24px 64px rgba(var(--shadow-rgb), 0.34),
      0 5px 18px rgba(var(--shadow-rgb), 0.16);
    animation: dialog-in 180ms cubic-bezier(0.22, 1, 0.36, 1);
  }

  .heading {
    display: flex;
    align-items: flex-start;
    gap: 13px;
  }

  .icon {
    width: 36px;
    height: 36px;
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 10px;
    background: var(--accent-soft);
    color: var(--ink-2);
  }
  .icon .msr { font-size: 20px; }

  .copy { min-width: 0; padding-top: 1px; }
  h2 {
    margin: 0 0 5px;
    font-size: 15px;
    line-height: 1.35;
    font-weight: 600;
    color: var(--ink);
    text-wrap: balance;
  }
  p {
    margin: 0;
    max-width: 46ch;
    font-size: 13px;
    line-height: 1.5;
    color: var(--ink-3);
    text-wrap: pretty;
  }

  .actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-top: 22px;
  }
  .actions-primary { display: flex; gap: 7px; }

  .button {
    min-height: 34px;
    padding: 0 16px;
    border: 0;
    border-radius: 999px;
    font: inherit;
    font-size: 12.5px;
    font-weight: 500;
    white-space: nowrap;
    cursor: pointer;
    transition:
      background-color 140ms ease,
      color 140ms ease,
      box-shadow 140ms ease,
      transform 100ms ease;
  }
  .button:active { transform: scale(0.97); }
  .button:focus-visible {
    outline: 2px solid var(--line-3);
    outline-offset: 2px;
  }

  .discard { background: transparent; color: var(--danger-action-text); font-weight: 600; }
  .discard:hover { background: color-mix(in srgb, var(--err) 11%, transparent); }
  .cancel {
    background: var(--surface);
    color: var(--ink-2);
    box-shadow: inset 0 0 0 1px var(--line-2);
  }
  .cancel:hover { background: var(--surface-hover); color: var(--ink); }
  .save { background: var(--ink); color: var(--cream-content); }
  .save:hover { background: var(--ink-2); }

  @keyframes dialog-in {
    from { opacity: 0; transform: translateY(5px) scale(0.985); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }

  @media (max-width: 460px) {
    .actions { align-items: stretch; flex-direction: column-reverse; }
    .actions-primary { display: grid; grid-template-columns: 1fr 1fr; }
    .button { width: 100%; }
  }

  @media (prefers-reduced-motion: reduce) {
    .panel { animation: none; }
    .button { transition: none; }
  }
</style>
