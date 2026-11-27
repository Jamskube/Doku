<script lang="ts">
  import DocumentView from './DocumentView.svelte'
  import DokuMark from '../lib/DokuMark.svelte'
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
  // Aucun document du tout : accueil (raccourcis) ; sinon simple volet libre d'une vue scindée.
  const welcome = $derived(app.tabs.length === 0)

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
    <DocumentView {paneId} {tabId} />
  {:else}
    <div class="pane-empty">
      <span class="pane-empty-mark"><DokuMark size={56} trace="once" /></span>
      <div class="pane-empty-text">
        <strong class="rise"><span>{welcome ? 'Aucun document ouvert' : 'Volet disponible'}</span></strong>
        <p class="settle">{welcome ? 'Ouvrez un fichier ou commencez une note Markdown.' : 'Affichez un document ouvert ou commencez une note Markdown.'}</p>
      </div>
      <div class="pane-empty-actions settle">
        <button onclick={onOpen}>Ouvrir un document{#if welcome}<kbd>Ctrl+O</kbd>{/if}</button>
        <button class="primary" onclick={() => onNewNote(paneId)}>Nouvelle note</button>
      </div>
      {#if welcome}
        <dl class="pane-empty-shortcuts settle">
          <div><dt><kbd>Ctrl+/</kbd></dt><dd>source ↔ rendu</dd></div>
          <div><dt><kbd>F9</kbd></dt><dd>mode focus</dd></div>
          <div><dt><kbd>Ctrl+Maj+E</kbd></dt><dd>explorateur</dd></div>
          <div><dt><kbd>Ctrl+Maj+P</kbd></dt><dd>plan</dd></div>
        </dl>
      {/if}
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
    user-select: none;
    /* Grain de papier : le bruit du chrome, déjà dosé très bas (3,5 % / 1,4 % en sombre). */
    background-image: var(--chrome-material-noise);
  }
  .pane-empty-mark { display: inline-flex; margin-bottom: 4px; color: var(--ink-4); opacity: 0.55; }
  .pane-empty-text { display: grid; gap: 6px; }
  /* Titre qui monte de derrière son propre masque, après le début du tracé de la marque. */
  .rise { display: block; overflow: hidden; }
  .rise > span { display: block; animation: pane-empty-rise 500ms var(--ease-enter) 250ms both; }
  @keyframes pane-empty-rise { from { transform: translateY(100%); } }
  .settle { animation: doku-fade-in 400ms ease 400ms both; }
  @media (prefers-reduced-motion: reduce) {
    .rise > span { animation: none; }
    .settle { animation-delay: 0ms; }
  }
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
    display: inline-flex;
    align-items: center;
    gap: 8px;
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
  /* Touche à la Kube : capuchon plat teinté par la couleur du texte qui l'entoure. */
  .pane-empty kbd {
    min-width: 16px;
    padding: 2px 5px;
    border-radius: var(--radius-xs);
    background: color-mix(in srgb, currentColor 10%, transparent);
    font: 400 var(--text-xs)/1 var(--font-sans);
    text-align: center;
  }
  .pane-empty-actions kbd { margin-right: -4px; color: var(--ink-3); }
  .pane-empty-shortcuts {
    margin: 12px 0 0;
    display: grid;
    grid-template-columns: auto auto;
    gap: 8px 24px;
    color: var(--ink-3);
    font-size: var(--text-xs);
  }
  .pane-empty-shortcuts div { display: flex; align-items: center; gap: 8px; }
  .pane-empty-shortcuts dd { margin: 0; }
</style>
