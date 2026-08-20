<script lang="ts">
  import { onMount, tick } from 'svelte'
  import {
    conversations,
    deleteConversation,
    initConversations,
    renameConversation,
    runConversationSearch,
    setConversationArchived,
  } from '../lib/copilot-conversations.svelte'
  import { copilot, newChat, resumeConversation } from '../lib/copilot.svelte'
  import { groupConversations, type ConversationSummary } from '../lib/copilot-conversation'
  import { app } from '../lib/stores.svelte'
  import { confirmAction } from '../lib/tauri'

  let searchOpen = $state(false)
  let showArchived = $state(false)
  let expanded = $state<Record<string, boolean>>({})
  let collapsed = $state<Record<string, boolean>>({})
  let editingId = $state<string | null>(null)
  let editingTitle = $state('')
  let searchInput = $state<HTMLInputElement | null>(null)
  let menu = $state<{ id: string; x: number; y: number } | null>(null)

  const listed = $derived(
    conversations.searchQuery.trim()
      ? conversations.searchResults.map((result) => result.summary).filter((item) => item.archived === showArchived)
      : conversations.summaries.filter((item) => item.archived === showArchived),
  )
  const groups = $derived(
    conversations.searchQuery.trim()
      ? [{ key: 'search', label: 'Résultats', conversations: listed }]
      : groupConversations(listed),
  )

  onMount(() => {
    void initConversations().then(() => {
      if (!import.meta.env.DEV || !new URLSearchParams(location.search).has('conversation-demo') || conversations.summaries.length) return
      const now = Date.now()
      conversations.summaries = Array.from({ length: 12 }, (_, index) => ({
        id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        title: index === 0
          ? 'Vérifier la cohérence de cette facture OpenAI'
          : index === 1
            ? 'Résumer le plan de licence et relever les décisions encore ouvertes'
            : `Discussion documentaire ${index + 1}`,
        createdAt: new Date(now - index * 86_400_000).toISOString(),
        updatedAt: new Date(now - index * 86_400_000).toISOString(),
        documentNames: index % 3 === 0 ? ['facture-openai.pdf', 'notes.md'] : [`document-${index + 1}.md`],
        preview: 'Aperçu de la dernière réponse de Doku-San.',
        messageCount: 4 + index,
        archived: index === 11,
      }))
    })
    const close = (event: PointerEvent) => {
      if (!(event.target as HTMLElement).closest('.conversation-menu, .conversation-more')) menu = null
    }
    document.addEventListener('pointerdown', close, true)
    return () => document.removeEventListener('pointerdown', close, true)
  })

  async function toggleSearch() {
    searchOpen = !searchOpen
    if (!searchOpen) await runConversationSearch('')
    else {
      await tick()
      searchInput?.focus()
    }
  }

  function openMenu(event: MouseEvent, id: string) {
    event.stopPropagation()
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
    menu = menu?.id === id ? null : {
      id,
      x: Math.max(8, rect.right - 184),
      y: Math.min(window.innerHeight - 154, rect.bottom + 4),
    }
  }

  async function openConversation(id: string) {
    if (editingId || menu) return
    await resumeConversation(id)
  }

  async function startRename(item: ConversationSummary) {
    menu = null
    editingId = item.id
    editingTitle = item.title
    await tick()
    document.querySelector<HTMLInputElement>(`[data-conversation-rename="${item.id}"]`)?.select()
  }

  async function commitRename(item: ConversationSummary) {
    const title = editingTitle.trim()
    editingId = null
    if (!title || title === item.title) return
    const record = await renameConversation(item.id, title)
    if (record && conversations.activeId === item.id) {
      copilot.conversationRevision = record.revision
      copilot.conversationTitle = record.title
      copilot.conversationTitlePinned = record.titlePinned
    }
  }

  async function archive(item: ConversationSummary) {
    menu = null
    if (conversations.activeId === item.id && !(await newChat())) return
    await setConversationArchived(item.id, !item.archived)
  }

  async function remove(item: ConversationSummary) {
    menu = null
    if (!(await confirmAction('Supprimer cette discussion ?', `« ${item.title} » sera supprimée définitivement.`))) return
    if (conversations.activeId === item.id && !(await newChat())) return
    await deleteConversation(item.id)
  }

  function documentMeta(item: ConversationSummary): string {
    if (!item.documentNames.length) return `${Math.ceil(item.messageCount / 2)} échange${item.messageCount > 2 ? 's' : ''}`
    return item.documentNames.join(' + ')
  }
</script>

<div class="conversation-view">
  <header class="conversation-head">
    {#if searchOpen}
      <span class="msr search-symbol" aria-hidden="true">search</span>
      <input
        bind:this={searchInput}
        value={conversations.searchQuery}
        placeholder="Rechercher une discussion"
        aria-label="Rechercher une discussion"
        oninput={(event) => void runConversationSearch(event.currentTarget.value)}
        onkeydown={(event) => { if (event.key === 'Escape') void toggleSearch() }}
      />
    {:else}
      <h2>Discussions</h2>
    {/if}
    <button class:active={searchOpen} title={searchOpen ? 'Fermer la recherche' : 'Rechercher'} aria-label={searchOpen ? 'Fermer la recherche' : 'Rechercher'} onclick={() => void toggleSearch()}>
      <span class="msr">{searchOpen ? 'close' : 'search'}</span>
    </button>
  </header>

  <div class="conversation-toolbar">
    <button class="new-conversation" onclick={() => void newChat()}>
      <span class="msr">edit_square</span>
      <span>Nouvelle discussion</span>
    </button>
    <button class="archive-filter" class:active={showArchived} title="Discussions archivées" aria-label="Afficher les discussions archivées" onclick={() => (showArchived = !showArchived)}>
      <span class="msr">archive</span>
    </button>
  </div>

  {#if conversations.error}
    <p class="conversation-error" role="status">{conversations.error}</p>
  {/if}

  <div class="conversation-list">
    {#if conversations.loading && !conversations.ready}
      <p class="conversation-empty">Chargement des discussions…</p>
    {:else if groups.length === 0}
      <div class="conversation-empty rich">
        <span class="msr">chat_bubble</span>
        <strong>{showArchived ? 'Aucune discussion archivée' : 'Vos discussions apparaîtront ici'}</strong>
        <p>Reprenez un échange avec ses documents, ses volets et son contexte.</p>
      </div>
    {:else}
      {#each groups as group (group.key)}
        <section class="conversation-group">
          <button
            class="group-heading"
            aria-expanded={!collapsed[group.key]}
            onclick={() => (collapsed = { ...collapsed, [group.key]: !collapsed[group.key] })}
          >
            <span class="msr">expand_more</span>{group.label}<span>{group.conversations.length}</span>
          </button>
          {#if !collapsed[group.key]}
          {#each group.conversations.slice(0, expanded[group.key] ? undefined : 5) as item (item.id)}
            <div class="conversation-row" class:current={conversations.activeId === item.id}>
              {#if editingId === item.id}
                <input
                  data-conversation-rename={item.id}
                  class="rename-input"
                  bind:value={editingTitle}
                  aria-label="Renommer la discussion"
                  onblur={() => void commitRename(item)}
                  onkeydown={(event) => {
                    if (event.key === 'Enter') void commitRename(item)
                    if (event.key === 'Escape') editingId = null
                  }}
                />
              {:else}
                <button class="conversation-main" title={item.title} onclick={() => void openConversation(item.id)}>
                  <span class="conversation-title">{item.title}</span>
                  <span class="conversation-meta">{documentMeta(item)}</span>
                </button>
              {/if}
              <button class="conversation-more" aria-label={`Actions pour ${item.title}`} aria-haspopup="menu" aria-expanded={menu?.id === item.id} onclick={(event) => openMenu(event, item.id)}>
                <span class="msr">more_horiz</span>
              </button>
            </div>
          {/each}
          {#if group.conversations.length > 5}
            <button class="show-more" onclick={() => (expanded = { ...expanded, [group.key]: !expanded[group.key] })}>
              <span class="msr">{expanded[group.key] ? 'expand_less' : 'expand_more'}</span>
              {expanded[group.key] ? 'Afficher moins' : `Afficher ${group.conversations.length - 5} de plus`}
            </button>
          {/if}
          {/if}
        </section>
      {/each}
      {#if conversations.searchLimited}<p class="conversation-limit">Recherche limitée aux discussions les plus récentes.</p>{/if}
    {/if}
  </div>
</div>

{#if menu}
  {@const item = conversations.summaries.find((candidate) => candidate.id === menu?.id)}
  {#if item}
    <div class="conversation-menu" role="menu" style={`left:${menu.x}px;top:${menu.y}px`}>
      <button role="menuitem" onclick={() => void startRename(item)}><span class="msr">edit_note</span>Renommer</button>
      <button role="menuitem" onclick={() => void archive(item)}><span class="msr">archive</span>{item.archived ? 'Désarchiver' : 'Archiver'}</button>
      <button class="danger" role="menuitem" onclick={() => void remove(item)}><span class="msr">delete</span>Supprimer</button>
    </div>
  {/if}
{/if}

<style>
  .conversation-view { height: 100%; min-height: 0; display: flex; flex-direction: column; }
  .conversation-head { height: 40px; display: flex; align-items: center; gap: 6px; padding: 0 8px 0 12px; }
  .conversation-head h2 { flex: 1; margin: 0; color: var(--ink); font-size: 13px; font-weight: 600; }
  .conversation-head input { flex: 1; min-width: 0; height: 30px; padding: 0; border: 0; outline: 0; background: transparent; color: var(--ink); font: inherit; font-size: 12.5px; }
  .search-symbol { font-size: 17px; color: var(--ink-4); }
  .conversation-head button, .archive-filter { width: 30px; height: 30px; display: grid; place-items: center; border: 0; border-radius: 8px; background: transparent; color: var(--ink-4); cursor: pointer; }
  .conversation-head button:hover, .conversation-head button.active, .archive-filter:hover, .archive-filter.active { background: var(--surface-hover); color: var(--ink); }
  .conversation-head button .msr, .archive-filter .msr { font-size: 18px; }
  .conversation-toolbar { display: flex; align-items: center; gap: 4px; padding: 2px 8px 8px; }
  .new-conversation { flex: 1; height: 32px; display: flex; align-items: center; gap: 8px; padding: 0 9px; border: 0; border-radius: 8px; background: transparent; color: var(--ink-2); font: inherit; font-size: 12.5px; font-weight: 500; cursor: pointer; }
  .new-conversation:hover { background: var(--surface-hover); color: var(--ink); }
  .new-conversation .msr { font-size: 18px; color: var(--ink-4); }
  .conversation-list { flex: 1; min-height: 0; overflow-y: auto; padding: 0 8px 16px; }
  .conversation-group { margin-top: 8px; }
  .group-heading { width: 100%; height: 26px; display: flex; align-items: center; gap: 4px; padding: 0 5px; border: 0; background: transparent; color: var(--ink-5); font: inherit; font-size: 10.5px; font-weight: 550; text-align: left; cursor: pointer; }
  .group-heading:hover { color: var(--ink-2); }
  .group-heading > .msr { font-size: 15px; transition: transform 130ms ease; }
  .group-heading[aria-expanded='false'] > .msr { transform: rotate(-90deg); }
  .group-heading > span:last-child { margin-left: auto; font-variant-numeric: tabular-nums; }
  .conversation-row { position: relative; display: flex; align-items: center; min-height: 42px; border-radius: 8px; color: var(--ink-2); }
  .conversation-row:hover { background: var(--surface-hover); color: var(--ink); }
  .conversation-row.current { background: var(--accent-soft); color: var(--ink); }
  .conversation-main { flex: 1; min-width: 0; align-self: stretch; display: flex; flex-direction: column; justify-content: center; gap: 2px; padding: 4px 30px 4px 8px; border: 0; background: transparent; color: inherit; text-align: left; cursor: pointer; }
  .conversation-title, .conversation-meta { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .conversation-title { font-size: 12.5px; font-weight: 500; }
  .conversation-meta { color: var(--ink-5); font-size: 10.5px; }
  .conversation-more { position: absolute; right: 4px; width: 28px; height: 28px; display: grid; place-items: center; border: 0; border-radius: 7px; background: transparent; color: var(--ink-4); opacity: 0; cursor: pointer; }
  .conversation-row:hover .conversation-more, .conversation-more:focus-visible, .conversation-more[aria-expanded='true'] { opacity: 1; }
  .conversation-more:hover { background: var(--surface-hover); color: var(--ink); }
  .conversation-more .msr { font-size: 18px; }
  .rename-input { flex: 1; min-width: 0; height: 30px; margin: 4px 34px 4px 5px; padding: 0 7px; border: 0; border-radius: 6px; outline: 2px solid var(--line-3); outline-offset: -2px; background: var(--cream-content); color: var(--ink); font: inherit; font-size: 12.5px; }
  .show-more { height: 28px; display: flex; align-items: center; gap: 4px; margin-left: 3px; padding: 0 6px; border: 0; background: transparent; color: var(--ink-4); font: inherit; font-size: 11px; cursor: pointer; }
  .show-more:hover { color: var(--ink); }
  .show-more .msr { font-size: 16px; }
  .conversation-empty { padding: 12px; color: var(--ink-4); font-size: 12px; }
  .conversation-empty.rich { min-height: 220px; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
  .conversation-empty.rich > .msr { margin-bottom: 9px; color: var(--ink-4); font-size: 26px; }
  .conversation-empty.rich strong { color: var(--ink-2); font-size: 12.5px; }
  .conversation-empty.rich p { max-width: 24ch; margin: 5px 0 0; line-height: 1.45; text-wrap: pretty; }
  .conversation-error, .conversation-limit { margin: 0 12px 6px; color: var(--err-text); font-size: 11px; line-height: 1.4; }
  .conversation-limit { color: var(--ink-4); }
  .conversation-menu { position: fixed; z-index: 120; width: 184px; padding: 5px; border-radius: 12px; background: var(--cream-tint); box-shadow: 0 0 0 1px var(--elevation-ring), 0 12px 30px rgba(var(--shadow-rgb), .2); animation: conversation-menu-in 140ms cubic-bezier(.22, 1, .36, 1); transform-origin: top right; }
  .conversation-menu button { width: 100%; height: 34px; display: flex; align-items: center; gap: 8px; padding: 0 8px; border: 0; border-radius: 7px; background: transparent; color: var(--ink-2); font: inherit; font-size: 12px; text-align: left; cursor: pointer; }
  .conversation-menu button:hover { background: var(--surface-hover); color: var(--ink); }
  .conversation-menu button.danger { color: var(--err-text); }
  .conversation-menu .msr { width: 18px; font-size: 17px; color: currentColor; }
  button:focus-visible { outline: 2px solid var(--line-3); outline-offset: 1px; }
  @keyframes conversation-menu-in { from { opacity: 0; transform: translateY(-3px) scale(.985); } }
  @media (prefers-reduced-motion: reduce) { .conversation-menu { animation: none; } .group-heading > .msr { transition: none; } }
</style>
