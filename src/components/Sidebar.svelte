<script lang="ts">
  import { app, activeTab, docHeadings, isDirty, openPath, scrollToLine, toggleSidebarView } from '../lib/stores.svelte'
  import { baseName, joinPath, parentPath, visibleEntries, type FsEntry } from '../lib/explorer'
  import { isTauri, readDirectory } from '../lib/tauri'
  import { DEMO_DIR } from '../lib/demo'
  import DokuMark from '../lib/DokuMark.svelte'

  // Plan : titres du Markdown seulement (un .txt/.html n'en a pas), et pas pour un
  // gros fichier (docHeadings O(doc) + DOM de milliers de titres gèlerait — 1.6).
  const headings = $derived(
    activeTab()?.kind === 'md' && !activeTab()!.heavy ? docHeadings(activeTab()!.content) : [],
  )

  // Dossier explorateur : navigation explicite, sinon dossier du document actif.
  const targetDir = $derived(app.explorerDir ?? parentPath(activeTab()?.path ?? null))
  let entries = $state<FsEntry[]>([])

  $effect(() => {
    const dir = targetDir
    if (!dir) {
      entries = []
      return
    }
    let cancelled = false
    ;(async () => {
      const raw = isTauri ? await readDirectory(dir) : DEMO_DIR
      if (!cancelled) entries = visibleEntries(raw)
    })()
    return () => {
      cancelled = true
    }
  })

  function openEntry(entry: FsEntry) {
    if (!targetDir) return
    const full = joinPath(targetDir, entry.name)
    if (entry.isDir) app.explorerDir = full
    else openPath(full)
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
          {#if targetDir}
            <div class="crumb">{baseName(targetDir)}</div>
            {#if parentPath(targetDir)}
              <button class="row up" onclick={() => (app.explorerDir = parentPath(targetDir))}>
                <span class="msr fold">drive_folder_upload</span>
                <span class="label">..</span>
              </button>
            {/if}
            {#each entries as entry (entry.name)}
              {@const full = joinPath(targetDir, entry.name)}
              {@const open = app.tabs.find((t) => t.path === full)}
              <button
                class="row"
                class:current={!entry.isDir && activeTab()?.path === full}
                title={entry.name}
                onclick={() => openEntry(entry)}
              >
                <span class="msr fold">{entry.isDir ? 'folder' : 'description'}</span>
                <span class="label grow" class:strong={entry.isDir}>{entry.name}</span>
                {#if open && isDirty(open)}<span class="filedot">●</span>{/if}
              </button>
            {:else}
              <p class="empty">Dossier vide</p>
            {/each}
          {:else}
            <p class="empty">Ouvrez un fichier pour explorer son dossier</p>
          {/if}
        {:else if app.sidebarView === 'plan'}
          <div class="plan">
            {#each headings as h (h.line)}
              {#if h.level === 1}
                <button class="plan-h1" class:active={h.line === app.activeHeadingLine} onclick={() => scrollToLine(h.line)}>{h.text}</button>
              {:else}
                <button class="plan-sub" class:active={h.line === app.activeHeadingLine} onclick={() => scrollToLine(h.line)}>{h.text}</button>
              {/if}
            {:else}
              <p class="empty">Pas de titres dans ce document</p>
            {/each}
          </div>
        {:else}
          <div class="history">
            <p class="empty">L'historique des versions arrive bientôt.</p>
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
  .row.current { background: var(--accent-soft); color: var(--ink); }
  .row.current .label { font-weight: 500; }
  .row.up { color: var(--ink-4); }
  .fold { font-size: 19px; color: var(--ink-4); }
  .label { font-size: 13px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .label.strong { font-weight: 500; }
  .label.grow { flex: 1; }
  .filedot { font-size: 8px; color: var(--ink); flex-shrink: 0; }
  .crumb {
    font-size: 11px;
    color: var(--ink-4);
    font-weight: 500;
    padding: 2px 8px 6px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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
  .plan-h1.active { background: var(--accent-soft); border-left-color: var(--ink); }
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
  .plan-sub.active { background: var(--accent-soft); color: var(--ink); }
  .empty { font-size: 12px; color: var(--ink-4); padding: 8px 12px; }

  .history { padding-top: 2px; }
</style>
