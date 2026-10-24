<script lang="ts">
  import DocumentView from './DocumentView.svelte'
  import PaneTabSelector from './PaneTabSelector.svelte'
  import { activatePane, app, workspace } from '../lib/stores.svelte'
  import type { PaneId } from '../lib/workspace'

  let {
    paneId,
    showLocalSelector = false,
    onOpen,
    onNewNote,
  }: {
    paneId: PaneId
    showLocalSelector?: boolean
    onOpen: () => void
    onNewNote: (paneId: PaneId) => void
  } = $props()

  const tabId = $derived(workspace[paneId].tabId)
  const tab = $derived(app.tabs.find((item) => item.id === tabId))
  const active = $derived(workspace.activePaneId === paneId)

  function activate() {
    activatePane(paneId)
  }
</script>

<section
  class="pane"
  class:active
  aria-label={`${paneId === 'primary' ? 'Volet principal' : 'Volet secondaire'}${tab ? ` : ${tab.name}` : ' vide'}`}
  onpointerdown={activate}
  onfocusin={activate}
>
  {#if showLocalSelector}
    <PaneTabSelector {paneId} {onOpen} local />
  {/if}
  {#if tab}
    <DocumentView {onOpen} {paneId} {tabId} />
  {:else}
    <div class="pane-empty">
      <svg class="icon" aria-hidden="true"><use href="#i-file-text" /></svg>
      <div class="pane-empty-text">
        <strong>Volet disponible</strong>
        <p>Affichez un document ouvert ou commencez une note Markdown.</p>
      </div>
      <div class="pane-empty-actions">
        <button onclick={onOpen}>Ouvrir un document</button>
        <button class="primary" onclick={() => onNewNote(paneId)}>Nouvelle note</button>
      </div>
    </div>
  {/if}
</section>

<style>
  .pane {
    position: relative;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    background: var(--cream-content);
  }
  .pane-empty {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 24px 16px;
    text-align: center;
  }
  .pane-empty > .icon { color: var(--ink-4); font-size: 24px; stroke-width: 1.5; }
  .pane-empty-text { display: grid; gap: 6px; }
  .pane-empty strong {
    color: var(--ink);
    font-size: var(--text-lg);
    font-weight: var(--weight-strong);
    letter-spacing: var(--tracking-tight);
    text-wrap: balance;
  }
  .pane-empty p {
    max-width: 310px;
    color: var(--ink-3);
    font-size: var(--text-xs);
    line-height: var(--leading-normal);
    text-wrap: pretty;
  }
  .pane-empty-actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; margin-top: 4px; }
  /* Bouton secondaire = remplissage d'encre léger ; primaire = encre, un seul par vue. */
  .pane-empty-actions button {
    height: var(--control-md);
    padding: 0 12px;
    border: 0;
    border-radius: var(--radius-lg);
    background: var(--accent-soft);
    color: var(--ink);
    font: var(--weight-control) var(--text-sm) var(--font-sans);
    cursor: pointer;
    transition: background-color var(--duration-basic) ease;
  }
  .pane-empty-actions button:hover { background: var(--fill-pressed); }
  .pane-empty-actions button.primary { background: var(--ink); color: var(--cream-content); }
  .pane-empty-actions button.primary:hover { background: var(--ink-2); }
</style>
