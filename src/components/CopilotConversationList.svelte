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
  import { tooltip } from '../lib/tooltip'

  let searchOpen = $state(false)
  let showArchived = $state(false)
  let expanded = $state<Record<string, boolean>>({})
  let collapsed = $state<Record<string, boolean>>({})
  let editingId = $state<string | null>(null)
  let editingTitle = $state('')
  let searchInput = $state<HTMLInputElement | null>(null)
  let menu = $state<{ id: string; x: number; y: number; origin: string; kbd: boolean } | null>(null)
  let menuEl = $state<HTMLElement | null>(null)
  let menuTrigger: HTMLElement | null = null

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
    const x = Math.max(8, rect.right - 184)
    const y = Math.min(window.innerHeight - 154, rect.bottom + 4)
    // Le menu croît depuis son déclencheur, même quand le bord bas l'a fait remonter.
    const ox = Math.min(184, Math.max(0, rect.left + rect.width / 2 - x))
    const oy = Math.min(150, Math.max(0, rect.top + rect.height / 2 - y))
    // Ouvert au clavier (`detail === 0`) : pas d'animation. Décidé à l'ouverture seulement :
    // passer d'un menu affiché à un autre garde l'élément monté, et retirer `.kbd` relancerait
    // son animation d'entrée.
    const kbd = menu ? menu.kbd : event.detail === 0
    menu = menu?.id === id ? null : { id, x, y, origin: `${ox}px ${oy}px`, kbd }
    menuTrigger = event.currentTarget as HTMLElement
    // Ouvert au clavier (Entrée/Espace) : le focus entre dans le menu, motif de TitleBar.
    if (menu && event.detail === 0) void tick().then(() => menuItems()[0]?.focus())
  }

  const menuItems = () => Array.from(menuEl?.querySelectorAll<HTMLButtonElement>(':scope > button:not(:disabled)') ?? [])

  // Menu focalisé (clavier) qu'une action referme : le focus rejoint le déclencheur AVANT le
  // dialogue qui suit, sinon il tombe sur <body> et le dialogue le rend à <body>.
  const menuHasFocus = () => menuEl?.contains(document.activeElement) ?? false

  function closeMenu(restoreFocus = false) {
    menu = null
    if (restoreFocus) menuTrigger?.focus()
  }

  function onMenuKey(event: KeyboardEvent) {
    const items = menuItems()
    const index = items.indexOf(document.activeElement as HTMLButtonElement)
    let next: number
    if (event.key === 'ArrowDown') next = index < 0 ? 0 : (index + 1) % items.length
    else if (event.key === 'ArrowUp') next = index < 0 ? items.length - 1 : (index - 1 + items.length) % items.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = items.length - 1
    else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      closeMenu(true)
      return
    } else return
    event.preventDefault()
    event.stopPropagation()
    items[next]?.focus()
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
    closeMenu(menuHasFocus())
    if (conversations.activeId === item.id && !(await newChat())) return
    await setConversationArchived(item.id, !item.archived)
  }

  async function remove(item: ConversationSummary) {
    closeMenu(menuHasFocus())
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
      <!-- Le champ est nu : c'est la boîte (icône + saisie) qui porte l'anneau de focus. -->
      <label class="search-box">
        <svg class="icon search-symbol" aria-hidden="true"><use href="#i-search" /></svg>
        <input
          bind:this={searchInput}
          value={conversations.searchQuery}
          placeholder="Rechercher une discussion"
          aria-label="Rechercher une discussion"
          oninput={(event) => void runConversationSearch(event.currentTarget.value)}
          onkeydown={(event) => { if (event.key === 'Escape') void toggleSearch() }}
        />
      </label>
    {:else}
      <h2>Discussions</h2>
    {/if}
    <button class:active={searchOpen} use:tooltip={searchOpen ? 'Fermer la recherche' : 'Rechercher'} aria-label={searchOpen ? 'Fermer la recherche' : 'Rechercher'} onclick={() => void toggleSearch()}>
      <svg class="icon" aria-hidden="true"><use href="#i-{searchOpen ? 'x' : 'search'}" /></svg>
    </button>
  </header>

  <div class="conversation-toolbar">
    <button class="new-conversation" onclick={() => void newChat()}>
      <svg class="icon" aria-hidden="true"><use href="#i-square-pen" /></svg>
      <span>Nouvelle discussion</span>
    </button>
    <button class="archive-filter" class:active={showArchived} use:tooltip={'Discussions archivées'} aria-label="Afficher les discussions archivées" aria-pressed={showArchived} onclick={() => (showArchived = !showArchived)}>
      <svg class="icon" aria-hidden="true"><use href="#i-archive" /></svg>
    </button>
  </div>

  {#if conversations.error}
    <p class="conversation-error" role="status">{conversations.error}</p>
  {/if}

  <div class="conversation-list">
    {#if conversations.loading && !conversations.ready}
      <p class="conversation-empty" role="status">Chargement des discussions…</p>
    {:else if groups.length === 0}
      <div class="conversation-empty rich">
        <svg class="icon" aria-hidden="true"><use href="#i-message-circle" /></svg>
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
            {group.label}<svg class="icon" aria-hidden="true"><use href="#i-chevron-down" /></svg><span>{group.conversations.length}</span>
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
                <svg class="icon" aria-hidden="true"><use href="#i-ellipsis" /></svg>
              </button>
            </div>
          {/each}
          {#if group.conversations.length > 5}
            <button class="show-more" onclick={() => (expanded = { ...expanded, [group.key]: !expanded[group.key] })}>
              <svg class="icon" aria-hidden="true"><use href="#i-{expanded[group.key] ? 'chevron-up' : 'chevron-down'}" /></svg>
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
    <div
      class="conversation-menu"
      class:kbd={menu.kbd}
      role="menu"
      tabindex="-1"
      aria-label={`Actions pour ${item.title}`}
      bind:this={menuEl}
      onkeydown={onMenuKey}
      onfocusout={(event) => {
        // Vers le « … » d'origine : son clic referme déjà le menu (bascule), ne pas le rouvrir.
        const next = event.relatedTarget as Node | null
        if (!menuEl?.contains(next) && next !== menuTrigger) menu = null
      }}
      style={`left:${menu.x}px;top:${menu.y}px;transform-origin:${menu.origin}`}>
      <button role="menuitem" onclick={() => void startRename(item)}><svg class="icon" aria-hidden="true"><use href="#i-pencil-line" /></svg>Renommer</button>
      <button role="menuitem" onclick={() => void archive(item)}><svg class="icon" aria-hidden="true"><use href="#i-archive" /></svg>{item.archived ? 'Désarchiver' : 'Archiver'}</button>
      <button class="danger" role="menuitem" onclick={() => void remove(item)}><svg class="icon" aria-hidden="true"><use href="#i-trash" /></svg>Supprimer</button>
    </div>
  {/if}
{/if}
<svelte:window onkeydown={menu ? (event) => { if (event.key === 'Escape') closeMenu(true) } : undefined} />

<style>
  /* Fondu de bord de la liste (motif ScrollFade de Kube, comme .panel-body de Sidebar). */
  @property --edge-top { syntax: '<length>'; inherits: false; initial-value: 0px; }
  @property --edge-bottom { syntax: '<length>'; inherits: false; initial-value: 0px; }

  .conversation-view { height: 100%; min-height: 0; display: flex; flex-direction: column; }
  /* Même hauteur que .panel-head (Sidebar) : changer de vue ne fait pas sauter le panneau. */
  .conversation-head { height: var(--chrome-titlebar-height); flex-shrink: 0; display: flex; align-items: center; gap: 8px; padding: 0 8px 0 16px; }
  .conversation-head h2 { flex: 1; min-width: 0; font-size: var(--text-sm); font-weight: var(--weight-strong); color: var(--ink); }
  /* Marge négative : l'icône reste à 16 px, alignée sur le titre qu'elle remplace. */
  .search-box { flex: 1; min-width: 0; height: var(--control-sm); display: flex; align-items: center; gap: 8px; margin-left: -8px; padding: 0 8px; border-radius: var(--radius-md); }
  .search-box:focus-within { outline: 2px solid var(--focus-ring); outline-offset: -1px; }
  .conversation-head input { flex: 1; min-width: 0; height: 100%; padding: 0; border: 0; outline: 0; background: transparent; color: var(--ink); font: inherit; font-size: var(--text-sm); }
  .conversation-head input::placeholder { color: var(--ink-4); }
  .search-symbol { font-size: 16px; color: var(--ink-4); }
  .conversation-head button,
  .archive-filter {
    width: var(--control-sm);
    height: var(--control-sm);
    flex: none;
    display: grid;
    place-items: center;
    border: 0;
    border-radius: var(--radius-lg);
    background: transparent;
    color: var(--ink-4);
    cursor: pointer;
    transition: background-color var(--duration-basic) ease, color var(--duration-basic) ease, transform var(--duration-basic) var(--ease-enter-snappy);
  }
  :is(.conversation-head button, .archive-filter):is(:hover, .active) { background: var(--fill-hover); color: var(--ink); }
  :is(.conversation-head button, .archive-filter) .icon { font-size: 16px; }
  .conversation-toolbar { display: flex; align-items: center; gap: 4px; padding: 0 8px 8px; }
  .new-conversation {
    flex: 1;
    min-width: 0;
    height: var(--control-md);
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 8px;
    border: 0;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--ink-2);
    font: inherit;
    font-size: var(--text-sm);
    font-weight: var(--weight-control);
    cursor: pointer;
    transition: background-color var(--duration-basic) ease, color var(--duration-basic) ease, transform var(--duration-basic) var(--ease-enter-snappy);
  }
  .new-conversation:hover { background: var(--surface-hover); color: var(--ink); }
  .conversation-head button:active, .new-conversation:active, .conversation-more:active { transform: scale(0.97); }
  .new-conversation .icon { font-size: 16px; color: var(--ink-3); }

  .conversation-list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 0 8px 12px;
  }
  /* Sans animation-timeline (WebKitGTK), ni fondu ni masque : un masque inerte coûterait
     une passe de composition pour rien. */
  @supports (animation-timeline: scroll()) {
    .conversation-list {
      -webkit-mask-image: linear-gradient(to bottom, transparent, #000 var(--edge-top), #000 calc(100% - var(--edge-bottom)), transparent);
      mask-image: linear-gradient(to bottom, transparent, #000 var(--edge-top), #000 calc(100% - var(--edge-bottom)), transparent);
      animation: edge-top linear both, edge-bottom linear both;
      animation-duration: auto;
      animation-timeline: scroll(self block), scroll(self block);
      animation-range: 0 20px, calc(100% - 40px) 100%;
    }
  }
  @keyframes edge-top { to { --edge-top: 20px; } }
  @keyframes edge-bottom { from { --edge-bottom: 40px; } to { --edge-bottom: 0px; } }

  .conversation-group { margin-top: 8px; }
  .group-heading {
    width: 100%;
    height: 28px;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 0 8px;
    border: 0;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--ink-3);
    font: inherit;
    font-size: 12px;
    font-weight: 510;
    text-align: left;
    cursor: pointer;
    transition: color var(--duration-basic) ease;
  }

  /* Chevron révélé au survol (motif NavSection de Kube), toujours visible groupe replié. */
  .group-heading > .icon { font-size: 12px; opacity: 0; transition: transform var(--duration-basic) var(--ease-enter-snappy), opacity var(--duration-basic) ease; }
  .group-heading:is(:hover, :focus-visible, [aria-expanded='false']) > .icon { opacity: 1; }
  .group-heading[aria-expanded='false'] > .icon { transform: rotate(-90deg); }
  .group-heading > span { margin-left: auto; color: var(--ink-4); font-variant-numeric: tabular-nums; }

  .conversation-row {
    position: relative;
    display: flex;
    align-items: center;
    min-height: 44px;
    border-radius: var(--radius-md);
    color: var(--ink-2);
    transition: background-color var(--duration-basic) ease, color var(--duration-basic) ease;
  }
  .conversation-row.current { background: var(--accent-soft); color: var(--ink); }
  .conversation-main {
    flex: 1;
    min-width: 0;
    align-self: stretch;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 2px;
    padding: 4px 32px 4px 8px;
    border: 0;
    border-radius: inherit;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .conversation-title, .conversation-meta { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .conversation-title { font-size: 13px; font-weight: 510; }
  .conversation-meta { font-size: 12px; color: var(--ink-3); }
  /* Action de ligne révélée au survol ou au focus ; toujours visible au tactile. */
  .conversation-more {
    position: absolute;
    right: 4px;
    width: var(--control-2xs);
    height: var(--control-2xs);
    display: grid;
    place-items: center;
    border: 0;
    /* Concentrique : rangée rayon 8, retrait de 4. */
    border-radius: var(--radius-xs);
    background: transparent;
    color: var(--ink-3);
    cursor: pointer;
    transition: opacity var(--duration-basic) ease, background-color var(--duration-basic) ease, color var(--duration-basic) ease, transform var(--duration-basic) var(--ease-enter-snappy);
  }
  /* Survols réservés à la souris : au doigt, la rangée resterait allumée après le toucher. */
  @media (hover: hover) and (pointer: fine) {
    .group-heading:hover { color: var(--ink); }
    .conversation-row:not(.current):hover { background: var(--surface-hover); color: var(--ink); }
    .show-more:hover { background: var(--surface-hover); color: var(--ink); }
    .conversation-more { opacity: 0; }
    .conversation-row:is(:hover, :focus-within) .conversation-more,
    .conversation-more[aria-expanded='true'] { opacity: 1; }
  }
  /* Révélée au doigt d'après le dernier pointeur utilisé (main.ts) : `any-pointer: coarse`
     est toujours vrai sur Surface, la souris n'aurait plus jamais vu l'action s'effacer.
     La cible de 24 px s'élargit à 40 px sans changer le dessin (dans la rangée de 44 px). */
  :global(:root[data-input='touch']) .conversation-more { opacity: 1; }
  @media (any-pointer: coarse) {
    /* 4px à droite seulement : affleure le bord de la rangée, sans mordre sur la barre de défilement. */
    .conversation-more::after { content: ''; position: absolute; inset: -8px -4px -8px -8px; }
  }
  .conversation-more:hover { background: var(--fill-hover); color: var(--ink); }
  .conversation-more .icon { font-size: 14px; }
  .rename-input {
    flex: 1;
    min-width: 0;
    height: var(--control-md);
    margin: 6px 32px 6px 4px;
    padding: 0 8px;
    border: 1px solid var(--line-3);
    border-radius: var(--radius-md);
    background: var(--cream-content);
    color: var(--ink);
    font: inherit;
    font-size: 13px;
  }
  .rename-input:focus { outline: 2px solid var(--focus-ring); outline-offset: -1px; }
  .show-more {
    height: 28px;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 0 8px;
    border: 0;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--ink-3);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
    transition: background-color var(--duration-basic) ease, color var(--duration-basic) ease;
  }
  .show-more .icon { font-size: 14px; }
  /* Rangées dans une zone défilante masquée : l'anneau de focus se dessine dedans. */
  :is(.new-conversation, .group-heading, .conversation-main, .show-more):focus-visible { outline-offset: -2px; }

  .conversation-empty { padding: 12px 8px; font-size: var(--text-xs); color: var(--ink-3); }
  .conversation-empty.rich { min-height: 220px; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 24px 16px; text-align: center; }
  .conversation-empty.rich > .icon { margin-bottom: 12px; font-size: 24px; color: var(--ink-4); }
  .conversation-empty.rich strong { font-size: var(--text-md); font-weight: var(--weight-strong); color: var(--ink-2); text-wrap: balance; }
  .conversation-empty.rich p { max-width: 24ch; margin-top: 4px; line-height: 1.45; text-wrap: pretty; }
  .conversation-error, .conversation-limit { margin: 0 12px 8px; font-size: 12px; line-height: 1.4; color: var(--err-text); }
  .conversation-limit { margin: 8px 8px 0; color: var(--ink-3); }

  .conversation-menu {
    position: fixed;
    z-index: var(--z-context);
    width: 184px;
    padding: 4px;
    border-radius: var(--radius-xl);
    background: var(--composer-bg);
    box-shadow: var(--shadow-xl);
    animation: doku-pop-in var(--duration-basic) var(--ease-enter-snappy);
  }
  .conversation-menu.kbd { animation: none; }
  .conversation-menu button {
    width: 100%;
    height: var(--control-md);
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 8px;
    border: 0;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--ink-2);
    font: inherit;
    font-size: var(--text-sm);
    font-weight: var(--weight-control);
    text-align: left;
    cursor: pointer;
  }
  :global(:root[data-input='touch']) .conversation-menu button { min-height: 40px; }
  :global(:where(:root[data-input='touch'])) :is(.new-conversation, .group-heading, .show-more) { height: 40px; }
  /* Surbrillance instantanée : elle suit les flèches du clavier, une transition y traînerait.
     L'anneau double la teinte, trop pâle seule pour signaler le focus (WCAG 2.4.11). */
  .conversation-menu button:is(:hover, :focus-visible) { background: var(--accent-soft); color: var(--ink); }
  .conversation-menu button:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: -2px; }
  .conversation-menu button.danger { color: var(--danger-action-text); }
  .conversation-menu .icon { font-size: 15px; opacity: 0.75; }
  .conversation-menu button:is(:hover, :focus-visible) .icon { opacity: 1; }
</style>
