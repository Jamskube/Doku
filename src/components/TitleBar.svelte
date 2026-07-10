<script lang="ts">
  import { app, activeTab, requestCloseTab, isDirty, toggleTheme, togglePin } from '../lib/stores.svelte'
  import { tabDiscriminator } from '../lib/tabs'
  import { closeWindow, minimizeWindow, toggleMaximizeWindow } from '../lib/tauri'
  import DokuMark from '../lib/DokuMark.svelte'

  let { onOpen }: { onOpen: () => void } = $props()

  let railHover = $state(false)
  const showLogo = $derived(!app.sidebarOpen && !railHover)
</script>

<div class="titlebar">
  <div class="rail-zone">
    <button
      class="rail-btn"
      class:lit={app.sidebarOpen || railHover}
      title={app.sidebarOpen ? 'Replier la barre latérale' : 'Déplier la barre latérale'}
      aria-label={app.sidebarOpen ? 'Replier la barre latérale' : 'Déplier la barre latérale'}
      aria-pressed={app.sidebarOpen}
      onmouseenter={() => (railHover = true)}
      onmouseleave={() => (railHover = false)}
      onclick={() => (app.sidebarOpen = !app.sidebarOpen)}
    >
      <span class="layer" style:opacity={showLogo ? 1 : 0}>
        <DokuMark size={22} />
      </span>
      <span class="layer" style:opacity={showLogo ? 0 : 1}>
        <svg width="20" height="20" viewBox="-0.5 -0.5 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
          <path d="M5.625 2.1875v10.625M1.875 5.875c0 -1.4 0 -2.1 0.2725 -2.635a2.5 2.5 0 0 1 1.0925 -1.0925C3.775 1.875 4.475 1.875 5.875 1.875h3.25c1.4 0 2.1 0 2.635 0.2725a2.5 2.5 0 0 1 1.0925 1.0925C13.125 3.775 13.125 4.475 13.125 5.875v3.25c0 1.4 0 2.1 -0.2725 2.635a2.5 2.5 0 0 1 -1.0925 1.0925C11.225 13.125 10.525 13.125 9.125 13.125H5.875c-1.4 0 -2.1 0 -2.635 -0.2725a2.5 2.5 0 0 1 -1.0925 -1.0925C1.875 11.225 1.875 10.525 1.875 9.125z" />
        </svg>
      </span>
    </button>
  </div>

  <div class="tabs" data-tauri-drag-region>
    {#each app.tabs as tab (tab.id)}
      {@const parent = tabDiscriminator(tab, app.tabs)}
      <button
        class="tab"
        class:active={tab.id === app.activeId}
        role="tab"
        aria-selected={tab.id === app.activeId}
        title={(tab.path ?? tab.name) + (isDirty(tab) ? ' — non enregistré' : '')}
        onclick={() => (app.activeId = tab.id)}
        onauxclick={(e) => { if (e.button === 1) requestCloseTab(tab.id) }}
      >
        {#if isDirty(tab)}<span class="dot">●</span>{/if}
        <span class="name">{tab.name}</span>
        {#if parent}<span class="parent">{parent}</span>{/if}
        <span
          class="close"
          title="Fermer l'onglet"
          role="button"
          tabindex="-1"
          onclick={(e) => { e.stopPropagation(); requestCloseTab(tab.id) }}
          onkeydown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); requestCloseTab(tab.id) } }}
        >
          <span class="msr" style="font-size:16px">close</span>
        </span>
      </button>
    {/each}
    <button class="new-tab" title="Nouvel onglet (Ctrl+O)" aria-label="Nouvel onglet" onclick={onOpen}>
      <span class="msr" style="font-size:20px">add</span>
    </button>
  </div>

  <div class="win-controls">
    <button class="ctrl pin" class:on={app.pinned} title="Toujours au-dessus (Ctrl+Maj+T)" aria-label="Toujours au-dessus" aria-pressed={app.pinned} onclick={togglePin}>
      <span class="msr" style="font-size:19px">keep</span>
    </button>
    <button class="ctrl" title="Thème sombre" aria-label="Thème sombre" aria-pressed={app.theme === 'dark'} onclick={toggleTheme}>
      <span class="msr" style="font-size:18px">{app.theme === 'dark' ? 'light_mode' : 'dark_mode'}</span>
    </button>
    <div class="sep"></div>
    <button class="ctrl wide" title="Réduire" aria-label="Réduire" onclick={minimizeWindow}>
      <span class="msr" style="font-size:18px">remove</span>
    </button>
    <button class="ctrl wide" title="Agrandir" aria-label="Agrandir" onclick={toggleMaximizeWindow}>
      <span class="msr" style="font-size:15px">crop_square</span>
    </button>
    <button class="ctrl wide close-win" title="Fermer" aria-label="Fermer" onclick={closeWindow}>
      <span class="msr" style="font-size:18px">close</span>
    </button>
  </div>
</div>

<style>
  .titlebar {
    display: flex;
    align-items: stretch;
    padding-left: 4px;
    height: 40px;
    flex-shrink: 0;
    background: var(--cream-base);
    user-select: none;
  }

  .rail-zone { display: flex; align-items: center; flex-shrink: 0; }
  .rail-btn {
    position: relative;
    width: 40px;
    height: 32px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--ink-3);
    cursor: pointer;
    transition: color 140ms ease, background 140ms ease;
  }
  .rail-btn.lit { background: var(--surface-hover); color: var(--ink); }
  .rail-btn .layer {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: opacity 140ms ease;
    pointer-events: none;
  }

  .tabs {
    flex: 1;
    display: flex;
    align-items: flex-end;
    gap: 3px;
    padding: 0 4px;
    min-width: 0;
  }

  .tab {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 0 8px 0 13px;
    height: 34px;
    min-width: 0;
    border: 1px solid transparent;
    border-bottom-width: 0;
    border-radius: 10px 10px 0 0;
    background: transparent;
    color: var(--ink-4);
    font-size: 12.5px;
    cursor: pointer;
    transition: background 140ms ease, color 140ms ease;
  }
  .tab:hover { background: var(--surface-hover); color: var(--ink-2); }
  .tab.active {
    background: var(--cream-content);
    color: var(--ink);
    font-weight: 500;
    z-index: 2;
  }
  .tab.active:hover { background: var(--cream-content); }
  .tab.active::before,
  .tab.active::after {
    content: '';
    position: absolute;
    bottom: 0;
    width: 11px;
    height: 11px;
    pointer-events: none;
  }
  .tab.active::before {
    left: -11px;
    background: radial-gradient(circle at top left, transparent 10.5px, var(--cream-content) 10.5px);
  }
  .tab.active::after {
    right: -11px;
    background: radial-gradient(circle at top right, transparent 10.5px, var(--cream-content) 10.5px);
  }

  .dot { font-size: 9px; color: var(--ink); line-height: 1; margin-right: 1px; }
  .name { min-width: 0; max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .parent {
    flex-shrink: 3;
    min-width: 0;
    max-width: 90px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 10.5px;
    color: var(--ink-4);
  }
  .parent::before { content: '·'; margin-right: 4px; opacity: 0.55; }
  .close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    margin-right: -4px;
    border-radius: 6px;
    color: var(--ink-4);
    opacity: 0.45;
    transition: opacity 120ms ease, background 120ms ease, color 120ms ease;
  }
  .tab.active .close { opacity: 0.9; }
  .close:hover { background: var(--surface-hover); color: var(--ink); }

  .new-tab {
    width: 32px;
    height: 33px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: 0;
    border-radius: 8px;
    color: var(--ink-4);
    cursor: pointer;
    transition: color 140ms ease, background 140ms ease;
  }
  .new-tab:hover { background: var(--surface-hover); color: var(--ink); }

  .win-controls { display: flex; align-items: center; gap: 2px; padding-right: 2px; flex-shrink: 0; }
  .ctrl {
    width: 36px;
    height: 32px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: 0;
    border-radius: 6px;
    color: var(--ink-3);
    cursor: pointer;
    transition: color 140ms ease, background 140ms ease;
  }
  .ctrl:hover { background: var(--surface-hover); color: var(--ink); }
  .ctrl.wide { width: 40px; border-radius: 0; }
  .ctrl.pin.on { background: var(--accent-soft); color: var(--ink); }
  .close-win:hover { background: var(--err); color: #fff; }
  .sep { width: 1px; height: 16px; background: var(--line-2); margin: 0 6px; }
</style>
