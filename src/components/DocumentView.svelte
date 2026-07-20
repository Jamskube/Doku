<script lang="ts">
  import { onMount } from 'svelte'
  import { EditorView } from '@codemirror/view'
  import { EditorState, type Extension } from '@codemirror/state'
  import { app, activeTab, COLUMN_PX, docHeadings, editorRef, editorSel, forcePreview, isDirty } from '../lib/stores.svelte'
  import { baseExtensions, htmlSourceExtensions, livePreviewComp, previewExtensions, serializeDoc, sourceExtensions, txtExtensions } from '../lib/editor/editor'
  import { docDirFacet } from '../lib/editor/live-preview'
  import { revealMatch, searchFlashField } from '../lib/editor/search-flash'
  import { isRephrasePreviewUpdate, rephrasePreviewField, setRephrasePreview, syncRephrasePreview } from '../lib/editor/rephrase-preview'
  import { parentPath } from '../lib/explorer'
  import { sandboxDoc } from '../lib/html'
  import { writePastedImage } from '../lib/tauri'
  import { imageMarkdown, imageStamp, sniffImageExt } from '../lib/paste-image'
  import { acceptRephrase, cancelRephrase, copilot, rephrase, rephraseSelection, retryRephrase } from '../lib/copilot.svelte'
  import { diffWords, type RephraseMode } from '../lib/copilot-service'
  import DokuMark from '../lib/DokuMark.svelte'
  import PdfView from './PdfView.svelte'

  const MAX_PASTE_IMAGE = 25 * 1024 * 1024 // 25 Mo : garde-fou mémoire (tablette ARM)

  // Coller une image (12.1). Le File doit être extrait du presse-papier SYNCHRONEMENT
  // (clipboardData devient inerte dès le premier await) ; l'écriture + l'insertion se
  // font ensuite en asynchrone. Retourner true = collage pris en charge (CM ne colle pas
  // de texte) ; false = laisser CM coller le texte normalement.
  function imagePasteHandler(tabId: number): Extension {
    return EditorView.domEventHandlers({
      paste(event, view) {
        const items = event.clipboardData?.items
        if (!items) return false
        let file: File | null = null
        for (let i = 0; i < items.length; i++) {
          const it = items[i]
          if (it.kind === 'file' && it.type.startsWith('image/')) {
            file = it.getAsFile()
            if (file) break
          }
        }
        if (!file) return false // pas d'image exploitable → coller texte normal
        // Tout item image/* est consommé ici (preventDefault synchrone obligatoire) ; le
        // sniff du format vient APRÈS l'await → un format non reconnu (BMP/SVG/TIFF) est
        // rejeté par un bandeau plutôt que recollé en texte. Tradeoff assumé, ne pas
        // « corriger » en fall-through (le sniff ne peut pas être synchrone ici).
        event.preventDefault()
        void pasteImage(tabId, file, view)
        return true
      },
    })
  }

  async function pasteImage(tabId: number, file: File, view: EditorView) {
    const tab = app.tabs.find((t) => t.id === tabId)
    if (!tab) return
    if (!tab.path) {
      app.banner = 'Enregistrez le document avant de coller une image.'
      return
    }
    const dir = parentPath(tab.path)
    if (!dir) {
      app.banner = 'Impossible de localiser le dossier du document.'
      return
    }
    if (file.size > MAX_PASTE_IMAGE) {
      app.banner = 'Image trop volumineuse (max 25 Mo).'
      return
    }
    const bytes = new Uint8Array(await file.arrayBuffer())
    const ext = sniffImageExt(bytes)
    if (!ext) {
      app.banner = "Format d'image du presse-papier non reconnu."
      return
    }
    let name: string | null
    try {
      name = await writePastedImage(dir, bytes, imageStamp(new Date()), ext)
    } catch (err) {
      console.error("Écriture de l'image collée échouée", err)
      app.banner = "Échec de l'écriture de l'image ; aucun lien inséré."
      return
    }
    if (!name) return // navigateur : no-op
    // L'éditeur est partagé entre onglets : si l'utilisateur a changé d'onglet pendant
    // l'écriture, NE PAS insérer le lien dans le mauvais document (le fichier est bien
    // écrit → aucune perte).
    if (app.activeId !== tabId) {
      app.banner = 'Image enregistrée ; lien non inséré (onglet changé).'
      return
    }
    view.dispatch(view.state.replaceSelection(imageMarkdown(name)))
  }

  // Onglet HTML en mode rendu : aperçu sandboxé (iframe), pas l'éditeur (FR-8).
  const htmlRender = $derived(activeTab()?.kind === 'html' && !app.sourceMode)
  // Onglet PDF : viewer lecture seule (11.1), pas l'éditeur.
  const pdfRender = $derived(activeTab()?.kind === 'pdf')

  let { onOpen }: { onOpen: () => void } = $props()

  let host: HTMLElement | undefined = $state()
  let view: EditorView | null = null
  const states = new Map<number, EditorState>()
  // rev auquel l'état caché de chaque onglet a été construit (invalidation au reload externe).
  const revs = new Map<number, number>()
  let renderedId = -1
  let renderedRev = -1
  let selectionMenu = $state<{ left: number; top: number } | null>(null)
  let selectionMenuExpanded = $state(false)
  let selectionMenuConfig = $state(false)
  let selectionMenuEl: HTMLElement | undefined = $state()
  let selectionMenuTimer: ReturnType<typeof setTimeout> | undefined

  // Copilote non configuré : le clic sur un verbe affiche une note dans le popover au lieu de
  // lancer une génération vouée à l'échec (brief w3 « Aucun modèle actif »).
  const copilotNeedsSetup = $derived(
    app.copilotProvider === 'ollama'
      ? !app.activeModel
      : copilot.openAiAuthenticated === false || copilot.openAiPreferredAvailable === false,
  )
  const setupNote = $derived(
    app.copilotProvider === 'openai'
      ? 'Compte OpenAI non connecté — connectez-le dans Modèles, ou choisissez un modèle local.'
      : 'Aucun modèle actif — choisissez ou téléchargez un modèle pour utiliser Doku-San.',
  )

  function hideSelectionMenu() {
    clearTimeout(selectionMenuTimer)
    selectionMenu = null
    selectionMenuExpanded = false
    selectionMenuConfig = false
  }

  function positionSelectionMenu(currentView: EditorView, expanded = selectionMenuExpanded) {
    const sel = currentView.state.selection.main
    if (sel.empty || copilot.generating || rephrase.current || activeTab()?.kind === 'pdf') {
      selectionMenu = null
      return
    }
    const start = currentView.coordsAtPos(sel.from)
    const end = currentView.coordsAtPos(sel.to)
    if (!start || !end) {
      selectionMenu = null
      return
    }

    const menuWidth = 264
    const menuHeight = expanded ? 348 : 180
    const viewportMargin = 12
    const gap = 8
    const anchorX = end.left
    const editorRect = currentView.dom.getBoundingClientRect()
    const selectionTop = Math.min(start.top, end.top)
    const selectionBottom = Math.max(start.bottom, end.bottom)
    const viewportMaxLeft = window.innerWidth - menuWidth - viewportMargin
    const editorMinLeft = Math.max(viewportMargin, editorRect.left + viewportMargin)
    const editorMaxLeft = Math.min(viewportMaxLeft, editorRect.right - menuWidth - viewportMargin)
    const minLeft = editorMaxLeft >= editorMinLeft ? editorMinLeft : viewportMargin
    const maxLeft = editorMaxLeft >= editorMinLeft ? editorMaxLeft : viewportMaxLeft
    const left = Math.min(Math.max(anchorX - menuWidth / 2, minLeft), maxLeft)
    const above = selectionTop - menuHeight - gap
    const top = above >= 48 ? above : Math.min(selectionBottom + gap, window.innerHeight - menuHeight - viewportMargin)
    selectionMenu = { left, top }
    selectionMenuTimer = undefined
  }

  function publishSelection(currentView: EditorView) {
    const sel = currentView.state.selection.main
    editorSel.from = sel.from
    editorSel.to = sel.to
    editorSel.text = sel.empty ? '' : currentView.state.sliceDoc(sel.from, sel.to)
    clearTimeout(selectionMenuTimer)
    // Un aperçu de reformulation en cours a priorité : pas de menu par-dessus le widget.
    if (sel.empty || !editorSel.text.trim() || rephrase.current) {
      selectionMenu = null
      selectionMenuExpanded = false
      selectionMenuConfig = false
      return
    }
    selectionMenuTimer = setTimeout(() => positionSelectionMenu(currentView), 120)
  }

  function toggleRewriteOptions() {
    selectionMenuExpanded = !selectionMenuExpanded
    selectionMenuConfig = selectionMenuExpanded && copilotNeedsSetup
    if (view) positionSelectionMenu(view, selectionMenuExpanded)
  }

  async function copySelection() {
    const text = editorSel.text
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      hideSelectionMenu()
    } catch {
      view?.focus()
    }
  }

  async function cutSelection() {
    if (!view) return
    const { from, to } = view.state.selection.main
    const text = view.state.sliceDoc(from, to)
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      view.dispatch({
        changes: { from, to, insert: '' },
        selection: { anchor: from },
        userEvent: 'delete.cut',
      })
      view.focus()
      hideSelectionMenu()
    } catch {
      view.focus()
    }
  }

  async function pasteClipboard() {
    if (!view) return
    try {
      const text = await navigator.clipboard.readText()
      if (!text) return
      const { from, to } = view.state.selection.main
      view.dispatch({
        changes: { from, to, insert: text },
        selection: { anchor: from + text.length },
        userEvent: 'input.paste',
      })
      view.focus()
      hideSelectionMenu()
    } catch {
      view.focus()
    }
  }

  // Lance la proposition EN PLACE (brief w3) : le panneau ne s'ouvre plus, l'aperçu recouvre
  // la sélection dans l'éditeur (rephrase-preview) jusqu'à Accepter/Refuser.
  function runSelectionAction(mode: RephraseMode) {
    if (copilotNeedsSetup) {
      selectionMenuConfig = true
      if (view) positionSelectionMenu(view, true)
      return
    }
    hideSelectionMenu()
    void rephraseSelection(mode)
  }

  function openModelSettings() {
    hideSelectionMenu()
    cancelRephrase()
    app.copilotOpen = true
    app.copilotView = 'models'
  }

  function makeState(tabId: number, content: string): EditorState {
    const tab = app.tabs.find((t) => t.id === tabId)
    const dir = parentPath(tab?.path ?? null) ?? ''
    const extra: Extension[] = [
      docDirFacet.of(dir),
      searchFlashField,
      rephrasePreviewField,
      EditorView.updateListener.of((u) => {
        if (u.docChanged) {
          const t = app.tabs.find((x) => x.id === tabId)
          if (t) t.content = serializeDoc(u.state.doc.toString(), t.eol)
          // Édition étrangère pendant un aperçu de reformulation : le champ s'est déjà vidé
          // atomiquement ; on annule la machine (abort si streaming) — rien n'était écrit.
          // Les $effect Svelte tournent en microtâche APRÈS le cycle CM → aucun dispatch
          // pendant un update en cours.
          if (rephrase.current && !isRephrasePreviewUpdate(u)) cancelRephrase()
        }
        // Publie la sélection courante (16.1) : le copilote propose « Reformuler » quand
        // `text` est non vide. Sur édition, les bornes bougent → on republie aussi.
        if (u.selectionSet || u.docChanged) {
          publishSelection(u.view)
        }
      }),
    ]
    // Coller une image (12.1) : Markdown uniquement (le lien ![]() n'a de sens qu'en md).
    if (tab?.kind === 'md') extra.push(imagePasteHandler(tabId))
    return EditorState.create({
      doc: content,
      extensions:
        tab?.kind === 'html'
          ? htmlSourceExtensions(extra)
          : tab?.kind === 'txt'
            ? txtExtensions(extra)
            : baseExtensions(app.sourceMode || (tab?.heavy ?? false), extra),
    })
  }

  // Scroll-spy : titre courant = dernier titre au-dessus du haut du viewport (4.6).
  // Titres seulement pour le Markdown (un .txt/.html n'a pas de structure de titres).
  function updateActiveHeading(v: EditorView) {
    const tab = activeTab()
    // Gros fichier : pas de scroll-spy (docHeadings est O(doc), gèlerait le scroll).
    const headings = tab?.kind === 'md' && !tab.heavy ? docHeadings(tab.content) : []
    if (!headings.length) {
      app.activeHeadingLine = 0
      return
    }
    const block = v.elementAtHeight(v.scrollDOM.scrollTop + 24)
    const topLine = v.state.doc.lineAt(block.from).number
    let active = headings[0].line
    for (const h of headings) {
      if (h.line <= topLine) active = h.line
      else break
    }
    app.activeHeadingLine = active
  }

  onMount(() => {
    view = new EditorView({ parent: host! })
    editorRef.view = view
    const onScroll = () => {
      selectionMenu = null
      if (view) updateActiveHeading(view)
    }
    const onSelectionIntent = () => {
      if (!view) return
      publishSelection(view)
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (selectionMenuEl?.contains(target)) return
      if (view?.dom.contains(target)) return
      hideSelectionMenu()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      // Un Échap déjà consommé par un autre overlay (modale, recherche…) ne doit pas écarter
      // une proposition qui a coûté une génération complète.
      if (event.defaultPrevented) return
      // Priorité à l'aperçu de reformulation : Échap = annuler (streaming) ou refuser (prêt),
      // document intact dans tous les cas (brief w3).
      if (rephrase.current) {
        cancelRephrase()
        return
      }
      if (selectionMenu) hideSelectionMenu()
    }
    view.scrollDOM.addEventListener('scroll', onScroll, { passive: true })
    view.dom.addEventListener('pointerup', onSelectionIntent)
    view.dom.addEventListener('keyup', onSelectionIntent)
    window.addEventListener('resize', hideSelectionMenu)
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      clearTimeout(selectionMenuTimer)
      view?.scrollDOM.removeEventListener('scroll', onScroll)
      view?.dom.removeEventListener('pointerup', onSelectionIntent)
      view?.dom.removeEventListener('keyup', onSelectionIntent)
      window.removeEventListener('resize', hideSelectionMenu)
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      view?.destroy()
      editorRef.view = null
    }
  })

  $effect(() => {
    const tab = activeTab()
    const sourceMode = app.sourceMode
    if (!view) return
    if (tab && tab.id !== renderedId) {
      if (renderedId !== -1) {
        // Ne jamais mettre en cache un état portant encore l'aperçu de reformulation : au
        // retour sur l'onglet, la décoration renaîtrait orpheline (l'effet de sync la
        // nettoierait, mais la robustesse ne doit pas dépendre de cet ordre).
        if ((view.state.field(rephrasePreviewField, false)?.size ?? 0) > 0) {
          view.dispatch({ effects: setRephrasePreview.of(null) })
        }
        states.set(renderedId, view.state)
      }
      // Cache réutilisable seulement s'il a été bâti au rev courant de l'onglet.
      const cached = revs.get(tab.id) === tab.rev ? states.get(tab.id) : undefined
      view.setState(cached ?? makeState(tab.id, tab.content))
      renderedId = tab.id
      renderedRev = tab.rev
      revs.set(tab.id, tab.rev)
    } else if (tab && tab.rev !== renderedRev) {
      // Onglet actif rechargé depuis le disque : reconstruire depuis le contenu frais.
      states.delete(tab.id)
      view.setState(makeState(tab.id, tab.content))
      renderedRev = tab.rev
      revs.set(tab.id, tab.rev)
    }
    const useSource = sourceMode || (tab?.heavy ?? false)
    view.dispatch({ effects: livePreviewComp.reconfigure(useSource ? sourceExtensions() : previewExtensions()) })
    view.requestMeasure({ read: () => view && updateActiveHeading(view) })
    // Resync de la sélection publiée (16.1) : setState (changement d'onglet/reload) ne déclenche
    // pas toujours selectionSet — on lit l'état courant pour éviter une sélection périmée.
    const sel = view.state.selection.main
    editorSel.from = sel.from
    editorSel.to = sel.to
    editorSel.text = sel.empty ? '' : view.state.sliceDoc(sel.from, sel.to)
    selectionMenu = null
  })

  $effect(() => {
    if (copilot.generating || app.copilotExpanded || htmlRender || pdfRender) hideSelectionMenu()
  })

  // Aperçu de reformulation en place (16.2, brief w3). Déclaré APRÈS l'effet de switch
  // d'onglet : quand l'onglet ou son rev change, le setState tourne d'abord — on revalide
  // ensuite ici que la plage porte toujours l'original. Indispensable pour le rechargement
  // externe (bump de rev) : setState ne passe par AUCUNE transaction, ni l'auto-dismiss du
  // champ ni l'updateListener ne le voient.
  const rephraseDiff = $derived(
    rephrase.current?.phase === 'ready' ? diffWords(rephrase.current.original, rephrase.current.text) : [],
  )
  $effect(() => {
    const cur = rephrase.current
    void activeTab()?.rev // re-déclenche sur rechargement externe de l'onglet actif
    if (!view) return
    if (cur) {
      const stale =
        cur.tabId !== app.activeId ||
        cur.to > view.state.doc.length ||
        view.state.sliceDoc(cur.from, cur.to) !== cur.original
      if (stale) {
        cancelRephrase()
        return
      }
    }
    syncRephrasePreview(
      view,
      cur
        ? {
            from: cur.from,
            to: cur.to,
            snapshot: {
              phase: cur.phase,
              label: cur.mode === 'correct' ? 'Doku-San corrige…' : 'Doku-San reformule…',
              text: cur.text,
              diff: rephraseDiff,
              message: cur.error,
              busy: copilot.generating,
            },
          }
        : null,
      { onAccept: acceptRephrase, onReject: cancelRephrase, onRetry: retryRephrase, onChooseModel: openModelSettings },
    )
  })

  // Révélation d'une occurrence de recherche (9.4). Déclaré APRÈS l'effet de switch
  // d'onglet ci-dessus : quand un clic ouvre un onglet, le setState y tourne d'abord
  // (contenu prêt), puis celui-ci saute + surligne. Onglet déjà actif : contenu déjà là.
  $effect(() => {
    const reveal = app.pendingReveal
    if (!reveal || !view) return
    const tab = activeTab()
    if (!tab || tab.path !== reveal.path) return
    revealMatch(view, reveal.line, reveal.col, reveal.length)
    app.pendingReveal = null
  })
</script>

<div class="doc">
  {#if activeTab()?.heavy && !app.focus}
    <div class="heavy-notice" role="status">
      <span class="msr" style="font-size:16px">bolt</span>
      <span>Fichier volumineux — affiché en mode source pour rester fluide.</span>
      <button class="heavy-action" onclick={() => forcePreview(activeTab()!.id)}>Afficher l'aperçu</button>
    </div>
  {/if}
  {#if app.focus && activeTab() && isDirty(activeTab()!)}
    <!-- Mode focus : les onglets sont masqués ; on garde un signal « non enregistré » discret. -->
    <span class="focus-dirty" title="Modifications non enregistrées" aria-label="Modifications non enregistrées"></span>
  {/if}
  {#if htmlRender}
    <iframe class="html-view" title="Aperçu HTML" sandbox="" srcdoc={sandboxDoc(activeTab()!.content, app.theme, COLUMN_PX[app.columnWidth])}></iframe>
  {/if}
  {#if pdfRender}
    <!-- Keyé par id : changer d'onglet PDF remonte le viewer → pdf.destroy()/cancel au démontage. -->
    {#key activeTab()!.id}
      <PdfView path={activeTab()!.path ?? ''} />
    {/key}
  {/if}
  <div class="editor-host doku-doc" class:source-mode={app.sourceMode || activeTab()?.heavy} class:txt={activeTab()?.kind === 'txt'} class:hidden={htmlRender || pdfRender} bind:this={host}></div>

  {#if selectionMenu}
    <div
      class="selection-menu"
      class:expanded={selectionMenuExpanded}
      bind:this={selectionMenuEl}
      style="left:{selectionMenu.left}px;top:{selectionMenu.top}px"
      role="menu"
      aria-label="Actions sur la sélection"
    >
      <button class="selection-menu-action" role="menuitem" onclick={copySelection}>
        <span class="msr">content_copy</span><span class="selection-menu-label">Copier</span><kbd>Ctrl+C</kbd>
      </button>
      <button class="selection-menu-action" role="menuitem" onclick={cutSelection}>
        <span class="msr">content_cut</span><span class="selection-menu-label">Couper</span><kbd>Ctrl+X</kbd>
      </button>
      <button class="selection-menu-action" role="menuitem" onclick={pasteClipboard}>
        <span class="msr">content_paste</span><span class="selection-menu-label">Coller</span><kbd>Ctrl+V</kbd>
      </button>
      <div class="selection-menu-sep"></div>
      <button
        class="selection-menu-action selection-menu-rewrite"
        class:open={selectionMenuExpanded}
        role="menuitem"
        aria-haspopup="true"
        aria-expanded={selectionMenuExpanded}
        onclick={toggleRewriteOptions}
      >
        <span class="selection-menu-spark"><span class="msr">auto_awesome</span></span>
        <span class="selection-menu-label">Réécrire avec Doku-San</span>
        <span class="selection-menu-count">{editorSel.text.trim().length} car.</span>
        <span class="msr selection-menu-chevron">chevron_right</span>
      </button>
      <div
        class="selection-rewrite-options"
        class:open={selectionMenuExpanded}
        role="group"
        aria-label="Options de réécriture"
        aria-hidden={!selectionMenuExpanded}
        inert={!selectionMenuExpanded}
      >
        <div class="selection-rewrite-inner">
          {#if selectionMenuConfig}
            <div class="selection-menu-note" role="note">{setupNote}</div>
            <button class="selection-menu-action selection-menu-subaction" role="menuitem" onclick={openModelSettings}>
              <span class="msr">layers</span><span>Choisir un modèle</span>
            </button>
          {:else}
            <button class="selection-menu-action selection-menu-subaction" role="menuitem" onclick={() => runSelectionAction('clarify')}>
              <span class="msr">auto_fix_high</span><span>Clarifier</span>
            </button>
            <button class="selection-menu-action selection-menu-subaction" role="menuitem" onclick={() => runSelectionAction('shorten')}>
              <span class="msr">compress</span><span>Raccourcir</span>
            </button>
            <button class="selection-menu-action selection-menu-subaction" role="menuitem" onclick={() => runSelectionAction('tone')}>
              <span class="msr">tune</span><span>Adopter un ton neutre</span>
            </button>
            <button class="selection-menu-action selection-menu-subaction" role="menuitem" onclick={() => runSelectionAction('correct')}>
              <span class="msr">spellcheck</span><span>Corriger</span>
            </button>
          {/if}
        </div>
      </div>
    </div>
  {/if}

  {#if !activeTab()}
    <div class="empty">
      <span class="empty-mark"><DokuMark size={64} /></span>
      <p class="empty-title">Aucun document ouvert</p>
      <button class="empty-open" onclick={onOpen}>
        <span class="msr" style="font-size:18px">folder_open</span>
        Ouvrir un fichier
        <span class="keys"><kbd>Ctrl</kbd><kbd>O</kbd></span>
      </button>
      <dl class="empty-shortcuts">
        <div><dt><kbd>Ctrl</kbd><kbd>/</kbd></dt><dd>source ↔ rendu</dd></div>
        <div><dt><kbd>F9</kbd></dt><dd>mode focus</dd></div>
        <div><dt><kbd>Ctrl</kbd><kbd>⇧</kbd><kbd>E</kbd></dt><dd>explorateur</dd></div>
        <div><dt><kbd>Ctrl</kbd><kbd>⇧</kbd><kbd>P</kbd></dt><dd>plan</dd></div>
      </dl>
    </div>
  {/if}
</div>

<style>
  .doc { position: relative; flex: 1; min-height: 0; display: flex; flex-direction: column; background: var(--cream-content); }

  .heavy-notice {
    flex: none;
    max-width: var(--doc-width, 680px);
    width: 100%;
    margin: 8px auto 0;
    padding: 8px 12px;
    display: flex;
    align-items: center;
    gap: 8px;
    border-radius: 8px;
    background: var(--surface);
    border: 1px solid var(--line-2);
    color: var(--ink-3);
    font-size: 12.5px;
  }
  .heavy-notice > .msr { color: var(--warn); flex: none; }
  .heavy-notice > span:not(.msr) { flex: 1; min-width: 0; }
  .heavy-action {
    flex: none;
    padding: 4px 10px;
    border-radius: 6px;
    border: 1px solid var(--line-2);
    background: transparent;
    color: var(--ink-2);
    font-size: 12px;
    cursor: pointer;
    transition: background 140ms ease, color 140ms ease;
  }
  .heavy-action:hover { background: var(--surface-hover); color: var(--ink); }

  .empty {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    background: var(--cream-content);
    color: var(--ink-4);
    user-select: none;
  }
  .empty-mark { display: inline-flex; color: var(--ink-4); opacity: 0.35; }
  .empty-title { margin: 0; font-size: 14px; color: var(--ink-3); }
  .empty-open {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 8px 14px;
    border: 1px solid var(--line-2);
    border-radius: 9px;
    background: var(--surface);
    color: var(--ink-2);
    font-size: 13px;
    cursor: pointer;
    transition: background 140ms ease, color 140ms ease, border-color 140ms ease;
  }
  .empty-open:hover { background: var(--surface-hover); color: var(--ink); border-color: var(--line-3); }
  .empty-open .keys { display: inline-flex; gap: 3px; margin-left: 4px; }
  .empty kbd {
    font-family: var(--font-mono);
    font-size: 10.5px;
    line-height: 1;
    padding: 3px 5px;
    border-radius: 4px;
    background: var(--surface-2);
    color: var(--ink-4);
    border: 1px solid var(--line-2);
  }
  .empty-shortcuts {
    margin: 8px 0 0;
    display: grid;
    grid-template-columns: auto auto;
    gap: 8px 22px;
    font-size: 12px;
    color: var(--ink-4);
  }
  .empty-shortcuts div { display: flex; align-items: center; gap: 8px; }
  .empty-shortcuts dt { display: inline-flex; gap: 3px; }
  .empty-shortcuts dd { margin: 0; }
  .focus-dirty {
    position: absolute;
    top: 14px;
    right: 16px;
    z-index: 2;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--ink-3);
    opacity: 0.55;
    pointer-events: none;
  }
  .editor-host { flex: 1; min-height: 0; user-select: text; }
  .editor-host.hidden { display: none; }
  .html-view {
    flex: 1;
    min-height: 0;
    width: 100%;
    border: 0;
    background: var(--cream-content);
  }
  .editor-host :global(.cm-editor) { height: 100%; }

  .selection-menu {
    position: fixed;
    z-index: 30;
    width: 264px;
    padding: 6px;
    border: 1px solid var(--line-2);
    border-radius: 14px;
    background: var(--cream-tint);
    box-shadow:
      0 0 0 1px var(--elevation-ring-soft),
      0 12px 30px rgba(var(--shadow-rgb), 0.16);
    color: var(--ink-2);
    font-family: var(--font-sans);
    user-select: none;
    animation: selection-menu-in 160ms cubic-bezier(0.22, 1, 0.36, 1);
  }
  .selection-menu-count {
    margin-left: auto;
    font-size: 10px;
    font-weight: 400;
    color: var(--ink-5);
    font-variant-numeric: tabular-nums;
  }
  .selection-menu-sep { height: 1px; margin: 5px 7px; background: var(--line-1); }
  .selection-menu-action {
    width: 100%;
    height: 40px;
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 0 9px;
    border: 0;
    border-radius: 9px;
    background: transparent;
    color: var(--ink-2);
    font-family: var(--font-sans);
    font-size: 12.5px;
    text-align: left;
    cursor: pointer;
    transition: background 140ms ease, color 140ms ease, scale 100ms ease;
  }
  .selection-menu-action .msr { width: 19px; font-size: 17px; color: var(--ink-4); }
  .selection-menu-label { flex: 1; min-width: 0; white-space: nowrap; }
  .selection-menu-action kbd {
    margin-left: auto;
    color: var(--ink-5);
    font-family: var(--font-sans);
    font-size: 10px;
    font-weight: 400;
  }
  .selection-menu-action:hover { background: var(--surface-hover); color: var(--ink); }
  .selection-menu-action:hover .msr { color: var(--ink-2); }
  .selection-menu-action:focus-visible { outline: 2px solid var(--line-3); outline-offset: -2px; }
  .selection-menu-action:active { scale: 0.96; }
  .selection-menu-rewrite { padding-left: 7px; }
  .selection-menu-spark {
    width: 23px;
    height: 23px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 7px;
    background: var(--surface-2);
    color: var(--ink-3);
  }
  .selection-menu-spark .msr { width: auto; font-size: 14px; }
  .selection-menu-chevron {
    width: 16px !important;
    font-size: 16px !important;
    transition: transform 180ms cubic-bezier(0.2, 0, 0, 1);
  }
  .selection-menu-rewrite.open .selection-menu-chevron { transform: rotate(90deg); }
  .selection-rewrite-options {
    display: grid;
    grid-template-rows: 0fr;
    opacity: 0;
    transition:
      grid-template-rows 190ms cubic-bezier(0.2, 0, 0, 1),
      opacity 130ms ease-in;
  }
  .selection-rewrite-options.open { grid-template-rows: 1fr; opacity: 1; }
  .selection-rewrite-inner { min-height: 0; overflow: hidden; }
  .selection-menu-subaction {
    height: 38px;
    padding-left: 39px;
    font-size: 12px;
  }
  .selection-menu-subaction .msr { width: 17px; font-size: 16px; }
  .selection-menu-note {
    margin: 4px 10px 2px 39px;
    font-size: 11.5px;
    line-height: 1.5;
    color: var(--ink-3);
  }

  @keyframes selection-menu-in {
    from { opacity: 0; transform: translateY(4px) scale(0.98); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }
  @media (prefers-reduced-motion: reduce) {
    .selection-menu { animation: none; }
    .selection-rewrite-options,
    .selection-menu-chevron { transition: none; }
  }
  .editor-host.source-mode :global(.cm-content),
  .editor-host.txt :global(.cm-content) {
    font-family: var(--font-mono);
    font-size: 14px;
    line-height: 1.7;
  }
</style>
