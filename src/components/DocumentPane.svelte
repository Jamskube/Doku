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
      <span class="msr" aria-hidden="true">description</span>
      <strong>Volet disponible</strong>
      <p>Affichez un document ouvert ou commencez une note Markdown.</p>
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
    gap: 7px;
    padding: 24px;
    color: var(--ink-4);
    text-align: center;
  }
  .pane-empty > .msr { font-size: 25px; opacity: 0.55; }
  .pane-empty strong { color: var(--ink-2); font-size: 12.5px; font-weight: 600; }
  .pane-empty p { max-width: 310px; font-size: 12.5px; line-height: 1.45; }
  .pane-empty-actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 7px; margin-top: 8px; }
  .pane-empty-actions button {
    min-height: 32px;
    padding: 0 13px;
    border: 1px solid var(--line-1);
    border-radius: 999px;
    background: transparent;
    color: var(--ink-2);
    font-size: 12.5px;
    cursor: pointer;
  }
  .pane-empty-actions button:hover { background: var(--surface-hover); }
  .pane-empty-actions button.primary { border-color: transparent; background: var(--ink); color: var(--cream-content); }
</style>
