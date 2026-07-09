<script lang="ts">
  import { app, activeTab, docHeadings, isDirty, scrollToLine, toggleSidebarView } from '../lib/stores.svelte'
  import DokuMark from '../lib/DokuMark.svelte'

  const headings = $derived(docHeadings(activeTab()?.content ?? ''))

  function openByName(name: string) {
    const tab = app.tabs.find((t) => t.name === name)
    if (tab) app.activeId = tab.id
  }

  function tabDirty(name: string): boolean {
    const tab = app.tabs.find((t) => t.name === name)
    return tab ? isDirty(tab) : false
  }
</script>

<aside class="sidebar" class:open={app.sidebarOpen}>
  <div class="inner">
    <div class="ribbon">
      <button class="logo" title="Doku" onclick={() => {}}>
        <DokuMark size={26} />
      </button>
      <div class="divider"></div>

      <button class="rib" class:active={app.sidebarView === 'files' && app.sidebarOpen} title="Fichiers" aria-label="Fichiers" onclick={() => toggleSidebarView('files')}>
        <span class="msr" style="font-size:21px">folder_open</span>
      </button>
      <button class="rib" class:active={app.sidebarView === 'plan' && app.sidebarOpen} title="Plan du document" aria-label="Plan" onclick={() => toggleSidebarView('plan')}>
        <span class="msr" style="font-size:21px">format_list_bulleted</span>
      </button>
      <button class="rib" class:active={app.sidebarView === 'history' && app.sidebarOpen} title="Historique des versions" aria-label="Historique" onclick={() => toggleSidebarView('history')}>
        <span class="msr" style="font-size:21px">history</span>
      </button>

      <div class="spacer"></div>

      <button class="rib" title="Paramètres" aria-label="Paramètres" onclick={() => {}}>
        <span class="msr" style="font-size:21px">settings</span>
      </button>
    </div>

    <div class="panel">
      <div class="panel-head">
        {#if app.sidebarView === 'files'}
          <div class="actions">
            <button title="Nouvelle note" aria-label="Nouvelle note"><span class="msr" style="font-size:19px">edit_square</span></button>
            <button title="Nouveau dossier" aria-label="Nouveau dossier"><span class="msr" style="font-size:19px">create_new_folder</span></button>
            <button title="Trier" aria-label="Trier"><span class="msr" style="font-size:19px">sort</span></button>
            <button title="Tout replier" aria-label="Tout replier"><span class="msr" style="font-size:19px">unfold_less</span></button>
          </div>
        {/if}
      </div>

      <div class="panel-body">
        {#if app.sidebarView === 'files'}
          <!-- Arborescence de démonstration (le vrai explorateur arrive avec FR-6) -->
          <button class="row folder">
            <span class="msr chev">keyboard_arrow_down</span>
            <span class="msr fold">folder</span>
            <span class="label strong">Projets</span>
          </button>
          <div class="children">
            <button class="row folder">
              <span class="msr chev">keyboard_arrow_down</span>
              <span class="msr fold">folder</span>
              <span class="label strong">SoundNodes</span>
            </button>
            <div class="children">
              <button class="row file"><span class="label">_index</span></button>
              <button class="row file"><span class="label">Audience</span></button>
              <button class="row file"><span class="label grow">Fiche-remise</span><span class="chip">PDF</span></button>
            </div>
          </div>
          <button class="row folder">
            <span class="msr chev">chevron_right</span>
            <span class="msr fold">folder</span>
            <span class="label strong">archives</span>
          </button>

          <div style="height:6px"></div>

          <button class="row file root" class:current={activeTab()?.name === 'notes.md'} onclick={() => openByName('notes.md')}>
            <span class="label grow strong-if-current">notes</span>
            {#if tabDirty('notes.md')}<span class="filedot">●</span>{/if}
          </button>
          <button class="row file root" class:current={activeTab()?.name === 'idées.md'} onclick={() => openByName('idées.md')}>
            <span class="label grow">idées</span>
          </button>
          <button class="row file root"><span class="label grow">todo</span></button>
          <button class="row file root"><span class="label grow">image</span><span class="chip">PNG</span></button>
        {:else if app.sidebarView === 'plan'}
          <div class="plan">
            {#each headings as h, i (h.line)}
              {#if h.level === 1}
                <button class="plan-h1" class:first={i === 0} onclick={() => scrollToLine(h.line)}>{h.text}</button>
              {:else}
                <button class="plan-sub" onclick={() => scrollToLine(h.line)}>{h.text}</button>
              {/if}
            {:else}
              <p class="empty">Pas de titres dans ce document</p>
            {/each}
          </div>
        {:else}
          <div class="history">
            <div class="snap current-snap">
              <div class="snap-head">
                <span class="snap-title">Aujourd'hui · 14:32</span>
                <span class="pill">courant</span>
              </div>
            </div>
            <div class="snap">
              <div class="snap-title dim">Aujourd'hui · 09:15</div>
              <div class="snap-actions">
                <button>Aperçu</button>
                <button>Restaurer</button>
              </div>
            </div>
            <div class="snap">
              <div class="snap-title dim">Hier · 18:40</div>
              <div class="snap-actions">
                <button>Aperçu</button>
                <button>Restaurer</button>
              </div>
            </div>
            <p class="purge">Purge auto : 20 versions / 30 jours.</p>
          </div>
        {/if}
      </div>
    </div>
  </div>
</aside>

<style>
  .sidebar {
    flex: 0 0 auto;
    width: 0;
    overflow: hidden;
    background: var(--cream-base);
    transition: width 220ms cubic-bezier(0.22, 1, 0.36, 1);
  }
  .sidebar.open { width: 296px; }
  .inner { width: 296px; height: 100%; display: flex; }

  .ribbon {
    flex: 0 0 46px;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 0 0 12px;
    gap: 2px;
  }
  .logo {
    width: 38px;
    height: 40px;
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: 0;
    border-radius: 10px;
    cursor: pointer;
    color: var(--ink);
    margin-bottom: 6px;
  }
  .divider { width: 22px; height: 1px; background: var(--line-2); margin: 0 0 6px; }
  .rib {
    width: 38px;
    height: 38px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: 0;
    border-radius: 10px;
    cursor: pointer;
    color: var(--ink-3);
    transition: color 140ms ease, background 140ms ease;
  }
  .rib:hover { background: var(--surface-hover); color: var(--ink); }
  .rib.active { background: var(--accent-soft); color: var(--ink); }
  .spacer { flex: 1; }

  .panel { flex: 1; min-width: 0; display: flex; flex-direction: column; border-left: 1px solid var(--line-1); }
  .panel-head { height: 41px; flex-shrink: 0; display: flex; align-items: center; justify-content: flex-end; padding: 0 8px 0 14px; }
  .actions { display: flex; align-items: center; gap: 1px; }
  .actions button {
    width: 26px;
    height: 26px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: 0;
    border-radius: 6px;
    color: var(--ink-4);
    cursor: pointer;
  }
  .actions button:hover { background: var(--surface-hover); color: var(--ink); }
  .panel-body { flex: 1; overflow-y: auto; min-height: 0; padding: 4px 8px 16px; }

  .row {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 5px;
    height: 28px;
    padding: 0 6px;
    background: transparent;
    border: 0;
    border-radius: 6px;
    cursor: pointer;
    color: var(--ink-2);
    text-align: left;
  }
  .row:hover { background: var(--surface-hover); color: var(--ink); }
  .row.file { padding-left: 23px; color: var(--ink-3); gap: 6px; }
  .row.file.root { padding: 0 8px 0 25px; }
  .row.file.current { background: var(--accent-soft); color: var(--ink); }
  .row.file.current .label { font-weight: 500; }
  .children { margin-left: 14px; border-left: 1px solid var(--line-1); padding-left: 3px; }
  .chev { font-size: 20px; color: var(--ink-4); }
  .fold { font-size: 19px; color: var(--ink-4); }
  .label { font-size: 13px; }
  .label.strong { font-weight: 500; }
  .label.grow { flex: 1; }
  .filedot { font-size: 8px; color: var(--ink); }
  .chip {
    font-family: var(--font-mono);
    font-size: 8.5px;
    letter-spacing: 0.06em;
    color: var(--ink-5);
    border: 1px solid var(--line-2);
    border-radius: 4px;
    padding: 1px 4px;
  }

  .plan { padding-top: 4px; }
  .plan-h1 {
    width: 100%;
    display: block;
    text-align: left;
    padding: 7px 12px;
    background: transparent;
    border: 0;
    border-left: 2px solid transparent;
    border-radius: 0 8px 8px 0;
    cursor: pointer;
    color: var(--ink);
    font-size: 13px;
    font-weight: 600;
  }
  .plan-h1.first { background: var(--accent-soft); border-left-color: var(--ink); }
  .plan-h1:hover { background: var(--accent-soft); }
  .plan-sub {
    width: 100%;
    display: block;
    text-align: left;
    padding: 6px 12px 6px 26px;
    background: transparent;
    border: 0;
    border-radius: 8px;
    cursor: pointer;
    color: var(--ink-3);
    font-size: 12.5px;
    margin-top: 2px;
  }
  .plan-sub:hover { background: var(--surface-hover); color: var(--ink); }
  .empty { font-size: 12px; color: var(--ink-5); padding: 8px 12px; }

  .history { padding-top: 2px; }
  .snap { padding: 9px 12px; border-radius: 10px; }
  .snap:hover { background: var(--surface-hover); }
  .snap.current-snap { background: var(--surface-hover); margin-bottom: 3px; }
  .snap-head { display: flex; align-items: center; justify-content: space-between; }
  .snap-title { font-size: 12.5px; font-weight: 500; color: var(--ink); }
  .snap-title.dim { color: var(--ink-2); margin-bottom: 7px; }
  .pill {
    font-family: var(--font-mono);
    font-size: 9px;
    padding: 2px 7px;
    border-radius: 999px;
    background: rgba(var(--ink-rgb), 0.10);
    color: var(--ink-3);
  }
  .snap-actions { display: flex; gap: 6px; }
  .snap-actions button {
    font-size: 11px;
    padding: 4px 10px;
    border-radius: 7px;
    border: 1px solid var(--line-2);
    background: transparent;
    color: var(--ink-2);
    cursor: pointer;
  }
  .snap-actions button:hover { background: var(--surface-hover); color: var(--ink); }
  .purge { font-size: 10.5px; color: var(--ink-5); padding: 12px 12px 0; line-height: 1.5; }
</style>
