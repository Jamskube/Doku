<script lang="ts">
  // « Organiser les pages » (ADR-0022, palier 2) : pivoter, supprimer, réordonner,
  // insérer un autre PDF. Rien n'est écrit tant que l'utilisateur n'enregistre pas, et
  // ce qu'il enregistre est TOUJOURS une copie — le document ouvert reste intact.
  import { app, closePdfPages } from '../lib/stores.svelte'
  import { baseName } from '../lib/paths'
  import { openPdfDialog, readFileBytes, savePdfDialog } from '../lib/tauri'
  import {
    dropPdfPagePlan,
    identityPdfPagePlan,
    insertPdfPagePlan,
    isPdfPagePlanUnchanged,
    movePdfPagePlan,
    summarizePdfPagePlan,
    turnAllPdfPagePlan,
    turnPdfPagePlan,
    type PdfPagePlan,
  } from '../lib/pdf-pages'
  import type { PdfDoc } from '../lib/pdf'

  // Entrées/sorties injectables (motif des exports HTML et DOCX) : par défaut ce sont
  // celles de Tauri, ce qui permet au banc de contrôle de piloter la modale avec de
  // vrais gestes sans hôte natif.
  let {
    readBytes = readFileBytes,
    pickPdf = openPdfDialog,
    writeCopy = savePdfDialog,
  }: {
    readBytes?: (path: string) => Promise<Uint8Array | null>
    pickPdf?: () => Promise<string | null>
    writeCopy?: (name: string, bytes: Uint8Array) => Promise<boolean>
  } = $props()

  let dlg = $state<HTMLDialogElement | null>(null)
  let status = $state<'loading' | 'ready' | 'error'>('loading')
  let message = $state('')
  let saving = $state(false)
  let plan = $state<PdfPagePlan>([])
  let sourceCount = $state(0)
  let dragFrom = $state<number | null>(null)
  let dragOver = $state<number | null>(null)

  // Documents chargés : index 0 = celui qu'on organise, les suivants sont les PDF
  // insérés. Les octets sont conservés pour l'écriture finale.
  // `$state.raw` et non `$state` : la liste doit être réactive (le badge « inséré » lit
  // le nom du document source), mais un proxy PROFOND envelopperait le PDFDocumentProxy
  // de pdf.js et casserait ses appels au worker. On réassigne donc toujours la liste.
  let sources = $state.raw<{ bytes: Uint8Array; doc: PdfDoc; destroy: () => Promise<void>; name: string }[]>([])
  const thumbs = new Map<string, string>()
  let thumbVersion = $state(0)
  const pending = new Set<string>()

  const path = $derived(app.pdfPagesPath ?? '')
  const fileName = $derived(baseName(path) || 'document.pdf')
  const summary = $derived(summarizePdfPagePlan(plan, sourceCount))
  const untouched = $derived(isPdfPagePlanUnchanged(plan, sourceCount))
  const key = (entry: { from: number; source: number }) => `${entry.from}:${entry.source}`

  $effect(() => {
    const el = dlg
    if (!el) return
    if (path && !el.open) el.showModal()
    else if (!path && el.open) el.close()
  })

  $effect(() => {
    if (!path) return
    let cancelled = false
    void (async () => {
      status = 'loading'
      message = ''
      const bytes = await readBytes(path)
      if (cancelled) return
      if (!bytes) {
        status = 'error'
        message = 'Le document est introuvable.'
        return
      }
      const { loadPdf } = await import('../lib/pdf')
      const loaded = await loadPdf(bytes)
      if (cancelled) {
        void loaded.destroy()
        return
      }
      sources = [{ bytes, doc: loaded.doc, destroy: loaded.destroy, name: fileName }]
      sourceCount = loaded.doc.numPages
      plan = identityPdfPagePlan(sourceCount)
      status = 'ready'
    })()
    return () => {
      cancelled = true
      for (const source of sources) void source.destroy()
      sources = []
      thumbs.clear()
      pending.clear()
      plan = []
      sourceCount = 0
    }
  })

  // Vignette rendue à la demande, mémorisée par page d'origine : réordonner ou pivoter
  // ne coûte donc aucun rendu, et un document de 200 pages n'en rend que ce qu'on voit.
  async function ensureThumb(entry: { from: number; source: number }) {
    const id = key(entry)
    if (thumbs.has(id) || pending.has(id)) return
    pending.add(id)
    try {
      const source = sources[entry.from]
      if (!source) return
      const page = await source.doc.getPage(entry.source)
      const base = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale: Math.min(150 / base.width, 190 / base.height) })
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(viewport.width))
      canvas.height = Math.max(1, Math.round(viewport.height))
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      await page.render({ canvas, canvasContext: ctx, viewport }).promise
      page.cleanup()
      thumbs.set(id, canvas.toDataURL('image/png'))
      thumbVersion++
    } catch {
      // Une vignette manquante n'empêche pas d'organiser : la carte reste utilisable.
    } finally {
      pending.delete(id)
    }
  }

  function thumbFor(entry: { from: number; source: number }): string | undefined {
    void thumbVersion // dépendance explicite : la Map n'est pas réactive
    return thumbs.get(key(entry))
  }

  function observe(node: HTMLElement, entry: { from: number; source: number }) {
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((item) => item.isIntersecting)) void ensureThumb(entry)
    }, { rootMargin: '200px' })
    observer.observe(node)
    return { destroy: () => observer.disconnect() }
  }

  async function insertDocument() {
    if (saving) return
    const picked = await pickPdf()
    if (!picked) return
    const bytes = await readBytes(picked)
    if (!bytes) {
      message = 'Ce PDF n’a pas pu être lu.'
      return
    }
    try {
      const { loadPdf } = await import('../lib/pdf')
      const loaded = await loadPdf(bytes)
      sources = [...sources, {
        bytes,
        doc: loaded.doc,
        destroy: loaded.destroy,
        name: baseName(picked) || 'document.pdf',
      }]
      plan = insertPdfPagePlan(plan, plan.length, sources.length - 1, loaded.doc.numPages)
      message = ''
    } catch {
      message = 'Ce PDF n’a pas pu être ouvert.'
    }
  }

  async function saveCopy() {
    if (saving || untouched) return
    saving = true
    message = ''
    try {
      const { applyPdfPagePlan, PdfBurnError } = await import('../lib/pdf-write')
      try {
        const result = await applyPdfPagePlan(sources.map((source) => source.bytes), plan)
        const base = fileName.replace(/\.pdf$/i, '')
        if (await writeCopy(`${base} — pages.pdf`, result.bytes)) closePdfPages()
      } catch (error) {
        message = error instanceof PdfBurnError ? error.message : 'Doku n’a pas pu écrire ce PDF.'
      }
    } finally {
      saving = false
    }
  }

  // Réordonnancement en ÉVÉNEMENTS POINTEUR, et non en glisser-déposer HTML5 : la
  // fenêtre Tauri a `dragDropEnabled` (dépôt de fichiers, story 2.4), donc WebView2
  // capte le glisser au niveau natif et la page ne reçoit jamais `dragstart`. Le
  // navigateur ne le montre pas — ça ne se voit qu'en natif.
  let dragPointer = -1
  let dragOrigin = { x: 0, y: 0 }
  // Lu dans le template (la carte ne s'estompe qu'une fois le seuil franchi) : doit
  // donc être réactif, sinon Svelte ne re-rend pas.
  let dragArmed = $state(false)

  // Suivi sur `window` plutôt que par `setPointerCapture` : la capture se comporte
  // différemment d'un moteur à l'autre, et un `pointercancel` de la WebView suffisait à
  // la perdre. Des écouteurs globaux posés pour la durée du geste, retirés
  // systématiquement au relâchement, ne dépendent d'aucune de ces subtilités.
  function trackDrag(on: boolean) {
    // Mêmes options à l'ajout et au retrait : le drapeau de capture fait partie de
    // l'identité de l'écouteur (leçon AGENTS 2026-08-14). Et surtout : appeler
    // `window.addEventListener` par une référence détachée perdrait `this` et ne
    // poserait rien du tout, en silence.
    const types = ['pointermove', 'pointerup', 'pointercancel'] as const
    for (const type of types) {
      const handler = (type === 'pointermove' ? moveDrag : endDrag) as EventListener
      if (on) window.addEventListener(type, handler, true)
      else window.removeEventListener(type, handler, true)
    }
  }

  function startDrag(event: PointerEvent, index: number) {
    if (event.button !== 0 || saving || dragPointer !== -1) return
    // Un appui qui commence sur un bouton reste un clic de bouton : sans cette sortie,
    // le seuil ci-dessous avalerait des pivotements et des suppressions.
    if ((event.target as HTMLElement).closest('button')) return
    // Coupe court à toute réaction native de la WebView (sélection, glisser d'élément).
    // Sans risque ici : la carte elle-même n'a aucun clic à préserver.
    event.preventDefault()
    dragPointer = event.pointerId
    dragOrigin = { x: event.clientX, y: event.clientY }
    dragArmed = true
    dragFrom = index
    trackDrag(true)
  }

  function moveDrag(event: PointerEvent) {
    if (dragPointer !== event.pointerId || dragFrom === null) return
    if (dragArmed) {
      // Seuil : en deçà, c'est un clic, pas un déplacement. Au doigt, `touch-action:
      // pan-y` laisse le défilement vertical au navigateur et ne nous donne que les
      // gestes horizontaux — donc réordonner et faire défiler ne se marchent pas dessus.
      if (Math.hypot(event.clientX - dragOrigin.x, event.clientY - dragOrigin.y) < 4) return
      dragArmed = false
    }
    const card = (document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null)?.closest('.card')
    const at = card ? Number((card as HTMLElement).dataset.index) : Number.NaN
    dragOver = Number.isInteger(at) ? at : null
  }

  function endDrag(event: PointerEvent) {
    if (dragPointer !== event.pointerId) return
    trackDrag(false)
    // `dragArmed` encore vrai = le seuil n'a jamais été franchi : simple clic, rien à
    // déplacer. Un `pointercancel` en cours de geste dépose la page là où elle est,
    // plutôt que de perdre le déplacement.
    if (!dragArmed && dragFrom !== null && dragOver !== null) {
      plan = movePdfPagePlan(plan, dragFrom, dragOver)
    }
    dragPointer = -1
    dragArmed = false
    dragFrom = null
    dragOver = null
  }

  // Filet de sécurité : si la modale se ferme en plein geste, l'écouteur global ne doit
  // pas survivre à son composant (leçon AGENTS sur les écouteurs `document` fantômes).
  $effect(() => () => trackDrag(false))
</script>

<dialog class="pages" bind:this={dlg} onclose={closePdfPages} aria-label="Organiser les pages">
  <div class="window">
    <header>
      <span class="title-icon" aria-hidden="true"><svg class="icon" aria-hidden="true"><use href="#i-layers" /></svg></span>
      <div class="title">
        <strong>Organiser les pages</strong>
        <small>{fileName}</small>
      </div>
      <span class="spacer"></span>
      <button class="icon-button" aria-label="Fermer" onclick={closePdfPages}><svg class="icon" aria-hidden="true"><use href="#i-x" /></svg></button>
    </header>

    <div class="tools">
      <button onclick={() => plan = turnAllPdfPagePlan(plan, -1)} disabled={status !== 'ready'}>
        <svg class="icon" aria-hidden="true"><use href="#i-rotate-ccw" /></svg><span>Tout pivoter</span>
      </button>
      <button onclick={() => void insertDocument()} disabled={status !== 'ready' || saving}>
        <svg class="icon" aria-hidden="true"><use href="#i-copy-plus" /></svg><span>Insérer un PDF…</span>
      </button>
      <button onclick={() => { plan = identityPdfPagePlan(sourceCount); message = '' }} disabled={untouched || saving}>
        <svg class="icon" aria-hidden="true"><use href="#i-undo-2" /></svg><span>Réinitialiser</span>
      </button>
      <span class="spacer"></span>
      <!-- Le compte rendu est permanent : l'utilisateur voit ce qu'il s'apprête à
           écrire avant d'ouvrir le dialogue d'enregistrement. -->
      <span class="summary">
        {#if untouched}
          Aucune modification
        {:else}
          {summary.pages} page{summary.pages > 1 ? 's' : ''}{summary.removed ? ` · ${summary.removed} retirée${summary.removed > 1 ? 's' : ''}` : ''}{summary.inserted ? ` · ${summary.inserted} insérée${summary.inserted > 1 ? 's' : ''}` : ''}{summary.turned ? ` · ${summary.turned} pivotée${summary.turned > 1 ? 's' : ''}` : ''}{summary.reordered ? ' · réordonné' : ''}
        {/if}
      </span>
    </div>

    <!-- En erreur de chargement, le message vit dans la grille : une seule fois. -->
    {#if message && status === 'ready'}<p class="message" role="status">{message}</p>{/if}

    <div class="grid" class:busy={status === 'error'} aria-busy={status === 'loading'}>
      {#if status === 'loading'}
        <!-- Cartes fantômes à la mise en page des vraies, invisibles pendant 400 ms : une
             ouverture rapide ne clignote pas. -->
        <div class="loading" role="status" aria-label="Ouverture du document">
          {#each [0, 1, 2, 3, 4, 5] as n (n)}
            <div class="ghost-card" aria-hidden="true">
              <div class="thumb"><span class="placeholder doku-skel"></span></div>
              <span class="ghost-tools"></span>
            </div>
          {/each}
        </div>
      {:else if status === 'error'}
        <p class="hint error" role="status">{message}</p>
      {:else}
        {#each plan as entry, index (`${entry.from}:${entry.source}:${index}`)}
          <div
            class="card"
            class:dragging={dragFrom === index && !dragArmed}
            class:over={dragOver === index && dragFrom !== index}
            role="listitem"
            data-index={index}
            onpointerdown={(event) => startDrag(event, index)}
          >
            <div class="thumb" use:observe={entry}>
              {#if thumbFor(entry)}
                <!-- `draggable=false` : sans ça, l'appui sur la vignette lance le
                     glisser NATIF d'image de la WebView, qui émet un `pointercancel`
                     et tue le déplacement avant qu'il commence. -->
                <img src={thumbFor(entry)} alt="" draggable="false" style:transform={`rotate(${entry.turn * 90}deg)`} />
              {:else}
                <span class="placeholder"></span>
              {/if}
              {#if entry.from !== 0}<span class="badge" title={sources[entry.from]?.name}>Inséré</span>{/if}
            </div>
            <div class="card-tools">
              <button aria-label="Pivoter à gauche" title="Pivoter à gauche" onclick={() => plan = turnPdfPagePlan(plan, index, -1)}><svg class="icon" aria-hidden="true"><use href="#i-rotate-ccw" /></svg></button>
              <button aria-label="Pivoter à droite" title="Pivoter à droite" onclick={() => plan = turnPdfPagePlan(plan, index, 1)}><svg class="icon" aria-hidden="true"><use href="#i-rotate-cw" /></svg></button>
              <button aria-label="Reculer" title="Reculer" disabled={index === 0} onclick={() => plan = movePdfPagePlan(plan, index, index - 1)}><svg class="icon" aria-hidden="true"><use href="#i-chevron-left" /></svg></button>
              <button aria-label="Avancer" title="Avancer" disabled={index === plan.length - 1} onclick={() => plan = movePdfPagePlan(plan, index, index + 1)}><svg class="icon" aria-hidden="true"><use href="#i-chevron-right" /></svg></button>
              <button class="danger" aria-label="Supprimer" title="Supprimer" disabled={plan.length <= 1} onclick={() => plan = dropPdfPagePlan(plan, index)}><svg class="icon" aria-hidden="true"><use href="#i-trash" /></svg></button>
            </div>
            <span class="number">{index + 1}</span>
          </div>
        {/each}
      {/if}
    </div>

    <footer>
      <!-- Jamais d'écrasement du document ouvert : l'action s'appelle « copie », et le
           nom proposé porte un suffixe. -->
      <small>Le document d’origine n’est jamais modifié.</small>
      <span class="spacer"></span>
      <button class="secondary" onclick={closePdfPages}>Annuler</button>
      <button class="primary" disabled={untouched || saving} onclick={() => void saveCopy()}>
        {saving ? 'Écriture…' : 'Enregistrer une copie…'}
      </button>
    </footer>
  </div>
</dialog>

<style>
  .pages {
    width: min(980px, calc(100vw - 32px));
    max-width: none;
    max-height: none;
    margin: auto;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--ink);
    overflow: visible;
  }
  /* Voile discret, partagé par toutes les modales de Doku. */
  .pages::backdrop {
    background: var(--scrim);
    animation: doku-fade-in var(--duration-dialog) var(--ease-enter-snappy);
  }
  .window {
    height: min(660px, calc(100vh - 48px));
    display: flex;
    flex-direction: column;
    background: var(--surface);
    border-radius: var(--radius-2xl);
    box-shadow: var(--shadow-dialog);
    overflow: hidden;
    animation: doku-dialog-in var(--duration-dialog) var(--ease-enter-snappy);
  }
  header {
    min-height: 60px;
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 12px 12px 16px;
    border-bottom: 1px solid var(--line-1);
  }
  .title-icon {
    width: 36px; height: 36px; display: inline-flex; align-items: center; justify-content: center;
    border-radius: var(--radius-xl); background: var(--accent-soft); color: var(--ink); font-size: 18px;
  }
  .title { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .title strong { font-size: var(--text-lg); line-height: var(--leading-tight); font-weight: var(--weight-strong); letter-spacing: var(--tracking-tight); }
  .title small { overflow: hidden; font-size: var(--text-xs); color: var(--ink-3); text-overflow: ellipsis; white-space: nowrap; }
  .spacer { flex: 1 1 auto; }

  .tools {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--line-1);
  }
  /* Boutons fantômes, sans contour permanent : le fond n'apparaît qu'au survol. */
  .tools button, footer button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: var(--control-md);
    padding: 0 12px;
    border: 0;
    border-radius: var(--radius-lg);
    background: transparent;
    color: var(--ink-3);
    cursor: pointer;
    font: inherit;
    font-size: var(--text-sm);
    font-weight: var(--weight-control);
    transition: background-color var(--duration-basic) ease, color var(--duration-basic) ease, transform var(--duration-basic) var(--ease-enter-snappy);
  }
  /* Alignement optique : côté icône = côté texte − 2 px. */
  .tools button { height: var(--control-sm); padding: 0 10px 0 8px; border-radius: var(--radius-md); }
  .tools .icon { font-size: 16px; }
  .tools button:hover:not(:disabled), footer button:hover:not(:disabled) { background: var(--fill-hover); color: var(--ink); }
  .tools button:disabled, footer button:disabled, .card-tools button:disabled { opacity: var(--opacity-disabled); cursor: default; }
  .summary { font-size: var(--text-xs); color: var(--ink-3); font-variant-numeric: tabular-nums; }
  .message { margin: 0; padding: 8px 16px; font-size: var(--text-xs); color: var(--err-text); }

  .grid {
    flex: 1 1 auto;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(158px, 1fr));
    gap: 16px;
    padding: 16px;
    overflow-y: auto;
    scrollbar-gutter: stable;
    align-content: start;
  }
  .grid.busy { display: block; }
  .loading {
    grid-column: 1 / -1;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(158px, 1fr));
    gap: 16px;
    animation: doku-fade-in var(--duration-moderate) ease 400ms backwards;
  }
  .ghost-card {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px;
    border: 1px solid var(--line-1);
    border-radius: var(--radius-xl);
    background: var(--cream-content);
  }
  .ghost-tools { height: var(--control-sm); }
  /* Bande du balayage en gris de papier : la vignette reste blanche en thème sombre. */
  .placeholder.doku-skel::after { background: linear-gradient(90deg, transparent 0%, rgba(var(--shadow-rgb), 0.06) 50%, transparent 100%); }
  .hint { padding: 24px; font-size: var(--text-sm); color: var(--ink-3); text-align: center; text-wrap: pretty; }
  .hint.error { color: var(--err-text); }

  .card {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px;
    border: 1px solid var(--line-1);
    border-radius: var(--radius-xl);
    background: var(--cream-content);
    transition: border-color var(--duration-basic) ease, box-shadow var(--duration-basic) ease, opacity var(--duration-basic) ease;
    cursor: grab;
    /* Sans ça, déplacer à la souris sélectionne le numéro et le badge au passage. */
    user-select: none;
    /* Et sans ça, la WebView démarre son propre glisser d'élément, qui annule le nôtre. */
    -webkit-user-drag: none;
    /* Le pointeur nous appartient : pas de défilement tactile parasite pendant le geste. */
    touch-action: pan-y;
  }
  .card :global(img) { -webkit-user-drag: none; pointer-events: none; }
  .card:active { cursor: grabbing; }
  .card.dragging { opacity: 0.45; }
  /* Cible de dépôt : en encre, jamais en reflet lavande — « The Quiet Accent Rule »
     réserve le lavande à la profondeur du chrome, jamais à une sélection ou un état. */
  .card.over { border-color: var(--line-3); box-shadow: 0 0 0 2px var(--line-2); }
  /* Rayon intérieur = rayon de la carte moins son padding : les coins restent concentriques. */
  .thumb {
    position: relative;
    display: grid;
    place-items: center;
    height: 190px;
    background: #fff;
    border-radius: var(--radius-xs);
    overflow: hidden;
  }
  /* Filet d'image : le bord d'une page blanche reste lisible sur le fond blanc de .thumb. */
  .thumb img { max-width: 100%; max-height: 100%; display: block; outline: 1px solid var(--image-outline); outline-offset: -1px; transition: transform var(--duration-moderate) var(--ease-move); }
  /* Sur le papier toujours blanc, l'encre d'interface (claire en thème sombre) disparaîtrait :
     repères et pastilles prennent les teintes fixes des épingles posées sur une page. */
  .placeholder { width: 60%; height: 70%; border-radius: var(--radius-xs); background: rgba(var(--shadow-rgb), 0.07); }
  .badge, .number {
    position: absolute;
    top: 6px;
    height: 18px;
    display: inline-flex;
    align-items: center;
    padding: 0 6px;
    border-radius: var(--radius-xs);
    background: var(--pdf-annotation-pin-bg);
    color: var(--pdf-annotation-pin-ink);
    font-size: var(--text-2xs);
    font-weight: var(--weight-strong);
    letter-spacing: var(--tracking-badge);
  }
  .badge { left: 6px; }
  .card-tools { display: flex; justify-content: center; }
  .card-tools button {
    display: grid;
    place-items: center;
    width: var(--control-sm);
    height: var(--control-sm);
    border: 0;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--ink-3);
    cursor: pointer;
    transition: background-color var(--duration-basic) ease, color var(--duration-basic) ease, transform var(--duration-basic) var(--ease-enter-snappy);
  }
  .card-tools button:hover:not(:disabled) { background: var(--fill-hover); color: var(--ink); }
  /* Supprimer une page est une action destructive : c'est le rouge d'action du système,
     pas un rouge d'erreur ni une couleur inventée. */
  .card-tools .danger:hover:not(:disabled) { color: var(--danger-action-text); }
  .card-tools .icon { font-size: 16px; }
  /* Numéro posé sur la vignette, dans le coin opposé au badge « Inséré ». */
  .number { right: 14px; top: 14px; font-variant-numeric: tabular-nums; }

  footer {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 16px;
    border-top: 1px solid var(--line-1);
  }
  footer small { font-size: var(--text-xs); color: var(--ink-3); }
  footer .primary { background: var(--ink); color: var(--cream-content); }
  footer .primary:hover:not(:disabled) { background: var(--ink-2); color: var(--cream-content); }
  footer .secondary { background: var(--accent-soft); color: var(--ink); }
  footer .secondary:hover:not(:disabled) { background: var(--fill-pressed); color: var(--ink); }

  .icon-button {
    display: grid;
    place-items: center;
    width: var(--control-md);
    height: var(--control-md);
    border: 0;
    border-radius: var(--radius-lg);
    background: transparent;
    color: var(--ink-4);
    font-size: 16px;
    cursor: pointer;
    transition: background-color var(--duration-basic) ease, color var(--duration-basic) ease, transform var(--duration-basic) var(--ease-enter-snappy);
  }
  .icon-button:hover { background: var(--fill-hover); color: var(--ink); }
  .tools button:not(:disabled):active, footer button:not(:disabled):active, .card-tools button:not(:disabled):active, .icon-button:active { transform: scale(0.97); }
</style>
