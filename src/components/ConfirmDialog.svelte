<script lang="ts">
  import { dialog, resolveDialog } from '../lib/stores.svelte'

  function onKey(e: KeyboardEvent) {
    if (!dialog.open) return
    if (e.key === 'Escape') {
      e.preventDefault()
      resolveDialog('cancel')
    } else if (e.key === 'Enter') {
      e.preventDefault()
      resolveDialog('save')
    }
  }
</script>

<svelte:window onkeydown={onKey} />

{#if dialog.open}
  <div class="overlay">
    <div class="card" role="dialog" aria-modal="true" aria-labelledby="dlg-title">
      <h2 id="dlg-title" class="title">{dialog.title}</h2>
      <p class="msg">{dialog.message}</p>
      <div class="actions">
        <button class="btn ghost" onclick={() => resolveDialog('cancel')}>Annuler</button>
        <button class="btn danger" onclick={() => resolveDialog('discard')}>Ignorer</button>
        <!-- svelte-ignore a11y_autofocus -->
        <button class="btn primary" autofocus onclick={() => resolveDialog('save')}>Sauver</button>
      </div>
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
    width: min(420px, calc(100vw - 48px));
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
    margin: 0 0 20px;
    font-size: 13.5px;
    line-height: 1.55;
    color: var(--ink-3);
  }
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
  .btn.danger { background: transparent; color: var(--err); }
  .btn.danger:hover { background: rgba(var(--ink-rgb), 0.04); }
  .btn.primary { background: var(--ink); color: var(--cream-content); }
  .btn.primary:hover { background: var(--ink-2); }
</style>
