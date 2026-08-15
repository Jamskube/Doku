<script lang="ts">
  // « Organiser les pages » (ADR-0022, palier 2) : pivoter, supprimer, réordonner,
  // insérer un autre PDF. Rien n'est écrit tant que l'utilisateur n'enregistre pas, et
  // ce qu'il enregistre est TOUJOURS une copie — le document ouvert reste intact.
  import { app, closePdfPages } from '../lib/stores.svelte'
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
  const fileName = $derived((path.split(/[\\/]/).pop() ?? 'document.pdf'))
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
        name: picked.split(/[\\/]/).pop() ?? 'document.pdf',
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

  // Le tactile est laissé au défilement de la grille (les flèches restent le chemin
  // accessible) ; souris et stylet déplacent, ce qui couvre l'usage Surface.
  function startDrag(event: PointerEvent, index: number) {
    if (event.button !== 0 || saving) return
    if (event.pointerType === 'touch') return
    // Un appui qui commence sur un bouton reste un clic de bouton : sans cette sortie,
    // le seuil ci-dessous avalerait des pivotements et des suppressions.
    if ((event.target as HTMLElement).closest('button')) return
    dragPointer = event.pointerId
    dragOrigin = { x: event.clientX, y: event.clientY }
    dragArmed = true
    dragFrom = index
    ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  }

  function moveDrag(event: PointerEvent) {
    if (dragPointer !== event.pointerId || dragFrom === null) return
    if (dragArmed) {
      // Seuil : en deçà, c'est un clic, pas un déplacement.
      const far = Math.hypot(event.clientX - dragOrigin.x, event.clientY - dragOrigin.y) >= 4
      if (!far) return
      dragArmed = false
    }
    const card = (document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null)?.closest('.card')
    const at = card ? Number((card as HTMLElement).dataset.index) : Number.NaN
    dragOver = Number.isInteger(at) ? at : null
  }

  function endDrag(event: PointerEvent) {
    if (dragPointer !== event.pointerId) return
    // `dragArmed` encore vrai = le seuil n'a jamais été franchi : simple clic, rien à
    // déplacer.
    if (!dragArmed && dragFrom !== null && dragOver !== null) {
      plan = movePdfPagePlan(plan, dragFrom, dragOver)
    }
    dragPointer = -1
    dragArmed = false
    dragFrom = null
    dragOver = null
  }
</script>

<dialog class="pages" bind:this={dlg} onclose={closePdfPages} aria-label="Organiser les pages">
  <div class="window">
    <header>
      <span class="msr" aria-hidden="true">auto_stories</span>
      <div class="title">
        <strong>Organiser les pages</strong>
        <small>{fileName}</small>
      </div>
      <span class="spacer"></span>
      <button class="icon-button" aria-label="Fermer" onclick={closePdfPages}><span class="msr">close</span></button>
    </header>

    <div class="tools">
      <button onclick={() => plan = turnAllPdfPagePlan(plan, -1)} disabled={status !== 'ready'}>
        <span class="msr">rotate_left</span><span>Tout pivoter</span>
      </button>
      <button onclick={() => void insertDocument()} disabled={status !== 'ready' || saving}>
        <span class="msr">library_add</span><span>Insérer un PDF…</span>
      </button>
      <button onclick={() => { plan = identityPdfPagePlan(sourceCount); message = '' }} disabled={untouched || saving}>
        <span class="msr">restart_alt</span><span>Réinitialiser</span>
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

    {#if message}<p class="message" role="status">{message}</p>{/if}

    <div class="grid" class:busy={status !== 'ready'}>
      {#if status === 'loading'}
        <p class="hint">Ouverture du document…</p>
      {:else if status === 'error'}
        <p class="hint">{message}</p>
      {:else}
        {#each plan as entry, index (`${entry.from}:${entry.source}:${index}`)}
          <div
            class="card"
            class:dragging={dragFrom === index && !dragArmed}
            class:over={dragOver === index && dragFrom !== index}
            role="listitem"
            data-index={index}
            onpointerdown={(event) => startDrag(event, index)}
            onpointermove={moveDrag}
            onpointerup={endDrag}
            onpointercancel={endDrag}
          >
            <div class="thumb" use:observe={entry}>
              {#if thumbFor(entry)}
                <img src={thumbFor(entry)} alt="" style:transform={`rotate(${entry.turn * 90}deg)`} />
              {:else}
                <span class="placeholder"></span>
              {/if}
              {#if entry.from !== 0}<span class="badge" title={sources[entry.from]?.name}>inséré</span>{/if}
            </div>
            <div class="card-tools">
              <button aria-label="Pivoter à gauche" title="Pivoter à gauche" onclick={() => plan = turnPdfPagePlan(plan, index, -1)}><span class="msr">rotate_left</span></button>
              <button aria-label="Pivoter à droite" title="Pivoter à droite" onclick={() => plan = turnPdfPagePlan(plan, index, 1)}><span class="msr">rotate_right</span></button>
              <button aria-label="Reculer" title="Reculer" disabled={index === 0} onclick={() => plan = movePdfPagePlan(plan, index, index - 1)}><span class="msr">chevron_left</span></button>
              <button aria-label="Avancer" title="Avancer" disabled={index === plan.length - 1} onclick={() => plan = movePdfPagePlan(plan, index, index + 1)}><span class="msr">chevron_right</span></button>
              <button class="danger" aria-label="Supprimer" title="Supprimer" disabled={plan.length <= 1} onclick={() => plan = dropPdfPagePlan(plan, index)}><span class="msr">delete</span></button>
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
      <button class="ghost" onclick={closePdfPages}>Annuler</button>
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
  .pages::backdrop {
    background: rgb(0 0 0 / 0.38);
    -webkit-backdrop-filter: blur(3px);
    backdrop-filter: blur(3px);
  }
  .window {
    height: min(660px, calc(100vh - 48px));
    display: flex;
    flex-direction: column;
    background: var(--cream-base);
    border-radius: 18px;
    box-shadow:
      0 0 0 1px var(--elevation-ring),
      0 28px 76px rgba(var(--shadow-rgb), 0.34),
      0 6px 20px rgba(var(--shadow-rgb), 0.16);
    overflow: hidden;
  }
  header {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 11px;
    padding: 12px 14px 12px 18px;
    border-bottom: 1px solid var(--line-1);
  }
  .title { display: flex; flex-direction: column; line-height: 1.25; }
  .title small { opacity: 0.62; }
  .spacer { flex: 1 1 auto; }

  .tools {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 14px;
    border-bottom: 1px solid var(--line-1);
  }
  .tools button, footer button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 32px;
    padding: 0 12px;
    border: 1px solid var(--line-1);
    border-radius: 999px;
    background: transparent;
    color: inherit;
    cursor: pointer;
    font: inherit;
  }
  .tools button:hover:not(:disabled), footer button:hover:not(:disabled) { background: rgba(var(--ink-rgb), 0.06); }
  .tools button:disabled, footer button:disabled, .card-tools button:disabled { opacity: 0.4; cursor: default; }
  .summary { font-size: 12px; opacity: 0.7; }
  .message { margin: 0; padding: 8px 16px; font-size: 13px; color: var(--danger, #b3261e); }

  .grid {
    flex: 1 1 auto;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(158px, 1fr));
    gap: 14px;
    padding: 16px;
    overflow-y: auto;
    scrollbar-gutter: stable;
    align-content: start;
  }
  .grid.busy { display: block; }
  .hint { opacity: 0.7; padding: 24px; text-align: center; }

  .card {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px;
    border: 1px solid var(--line-1);
    border-radius: 12px;
    background: rgba(var(--ink-rgb), 0.02);
    cursor: grab;
    /* Sans ça, déplacer à la souris sélectionne le numéro et le badge au passage. */
    user-select: none;
  }
  .card:active { cursor: grabbing; }
  .card.dragging { opacity: 0.45; }
  .card.over { border-color: var(--accent, #6b5bd2); box-shadow: 0 0 0 2px rgba(107, 91, 210, 0.28); }
  .thumb {
    position: relative;
    display: grid;
    place-items: center;
    height: 190px;
    background: #fff;
    border-radius: 8px;
    overflow: hidden;
  }
  .thumb img { max-width: 100%; max-height: 100%; display: block; transition: transform 140ms ease; }
  .placeholder { width: 60%; height: 70%; border-radius: 4px; background: rgba(var(--ink-rgb), 0.07); }
  .badge {
    position: absolute;
    top: 6px;
    left: 6px;
    padding: 1px 7px;
    border-radius: 999px;
    background: rgba(var(--ink-rgb), 0.72);
    color: var(--cream-base);
    font-size: 10px;
  }
  .card-tools { display: flex; justify-content: center; gap: 1px; }
  .card-tools button {
    display: grid;
    place-items: center;
    width: 27px;
    height: 27px;
    border: 0;
    border-radius: 7px;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }
  .card-tools button:hover:not(:disabled) { background: rgba(var(--ink-rgb), 0.08); }
  .card-tools .danger:hover:not(:disabled) { color: var(--danger, #b3261e); }
  .card-tools .msr { font-size: 17px; }
  .number { position: absolute; right: 10px; top: 10px; font-size: 11px; opacity: 0.55; }

  footer {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 16px;
    border-top: 1px solid var(--line-1);
  }
  footer small { opacity: 0.6; }
  footer .primary { background: var(--ink); color: var(--cream-base); border-color: transparent; }
  footer .primary:hover:not(:disabled) { opacity: 0.88; background: var(--ink); }

  .icon-button {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border: 0;
    border-radius: 9px;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }
  .icon-button:hover { background: rgba(var(--ink-rgb), 0.08); }
</style>
