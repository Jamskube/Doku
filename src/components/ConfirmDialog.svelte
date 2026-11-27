<script lang="ts">
  import { dialog, resolveDialog } from '../lib/stores.svelte'
  import { closeDialog, reopenDialog } from '../lib/dialog-close'

  let dialogEl: HTMLDialogElement
  let saveButton: HTMLButtonElement

  // Confirmations en rafale (fermer plusieurs onglets non enregistrés) : la suivante peut
  // arriver pendant la sortie de la précédente → on annule la sortie au lieu de rouvrir.
  $effect(() => {
    if (dialog.open && dialogEl && (!dialogEl.open || reopenDialog(dialogEl))) {
      if (!dialogEl.open) dialogEl.showModal()
      queueMicrotask(() => saveButton?.focus())
    } else if (!dialog.open && dialogEl?.open) {
      closeDialog(dialogEl)
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
  class="doku-modal"
  aria-labelledby="dlg-title"
  aria-describedby="dlg-message"
  oncancel={cancel}
  onclose={handleClose}
  onclick={(event) => {
    if (event.target === dialogEl) cancel()
  }}
>
  <!-- Alerte macOS 27 empilée : l'action principale en haut, la destructive au milieu,
       l'échappatoire en bas, toutes pleine largeur. Le focus part sur « Enregistrer ». -->
  <section class="doku-alert">
    <span class="doku-tile tint-ochre" aria-hidden="true">
      <svg class="icon" aria-hidden="true"><use href="#i-save" /></svg>
    </span>
    <h2 id="dlg-title" class="doku-alert-title">{dialog.title}</h2>
    <p id="dlg-message" class="doku-alert-message">{dialog.message}</p>
    <div class="doku-alert-actions">
      <button bind:this={saveButton} class="doku-btn is-primary" onclick={() => resolveDialog('save')}>Enregistrer</button>
      <button class="doku-btn is-danger" onclick={() => resolveDialog('discard')}>Ne pas enregistrer</button>
      <button class="doku-btn" onclick={() => resolveDialog('cancel')}>Annuler</button>
    </div>
  </section>
</dialog>
