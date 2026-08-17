<script lang="ts">
  // « Modifier le texte » (ADR-0023) : la page telle qu'elle est, avec des champs de
  // saisie posés EXACTEMENT sur ses lignes. L'utilisateur tape dans le document, jamais
  // dans du code — et ce qu'il ne modifie pas n'est pas touché d'un octet.
  //
  // Modale autonome, sur le motif de « Organiser les pages » : le lecteur `PdfView`
  // gère déjà quatre modes de pointeur, la sélection de texte, le dessin et la gomme.
  // Y greffer une cinquième surface de saisie était le chemin le plus court vers une
  // collision.
  import { app, closePdfTextEdit } from '../lib/stores.svelte'
  import { readFileBytes, savePdfDialog } from '../lib/tauri'
  import type { PdfEditableLine } from '../lib/export/pdf-edit-text'
  import type { PdfDoc } from '../lib/pdf'

  let {
    readBytes = readFileBytes,
    writeCopy = savePdfDialog,
  }: {
    readBytes?: (path: string) => Promise<Uint8Array | null>
    writeCopy?: (name: string, bytes: Uint8Array) => Promise<boolean>
  } = $props()

  let dlg = $state<HTMLDialogElement | null>(null)
  let status = $state<'loading' | 'ready' | 'error'>('loading')
  let message = $state('')
  let saving = $state(false)
  let pageIndex = $state(1)
  let pageCount = $state(0)
  let lines = $state<PdfEditableLine[]>([])
  // Modifications en attente, indexées par `page:texte d'origine` — rien n'est écrit
  // tant que l'utilisateur n'enregistre pas.
  let edits = $state<Record<string, string>>({})
  let canvasEl = $state<HTMLCanvasElement | null>(null)
  // Échelle du rendu : les tailles de police du PDF sont en POINTS, le canvas est rendu
  // réduit. Sans ce facteur, le texte saisi ne fait pas la taille de celui du document.
  let renderScale = $state(1)
  // Le rendu d'une page dense prend une à deux secondes : sans témoin, l'application
  // paraît figée et l'utilisateur reclique — ce qui empile les demandes.
  let rendering = $state(false)

  let bytes: Uint8Array | null = null
  let pdf: PdfDoc | null = null
  let destroyPdf: (() => Promise<void>) | null = null

  const path = $derived(app.pdfTextEditPath ?? '')
  const fileName = $derived(path.split(/[\\/]/).pop() ?? 'document.pdf')
  const pageLines = $derived(lines.filter((l) => l.page === pageIndex))
  const pending = $derived(Object.entries(edits).filter(([, v]) => v.trim() !== ''))
  const key = (l: PdfEditableLine) => `${l.page}:${l.occurrence}:${l.text}`

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
      edits = {}
      pageIndex = 1
      const read = await readBytes(path)
      if (cancelled) return
      if (!read) {
        status = 'error'
        message = 'Le document est introuvable.'
        return
      }
      try {
        const [{ readEditableLines }, { loadPdf }] = await Promise.all([
          import('../lib/export/pdf-edit-text'),
          import('../lib/pdf'),
        ])
        // La lecture des lignes détache potentiellement le tableau : on garde une copie
        // pour l'écriture (leçon `loadPdf`, AGENTS 2026-08-15).
        bytes = read.slice()
        lines = await readEditableLines(read.slice())
        if (cancelled) return
        const loaded = await loadPdf(read.slice())
        if (cancelled) {
          void loaded.destroy()
          return
        }
        pdf = loaded.doc
        destroyPdf = loaded.destroy
        pageCount = loaded.doc.numPages
        status = 'ready'
        void renderPage()
      } catch (error) {
        status = 'error'
        message = error instanceof Error ? error.message : 'Ce PDF n’a pas pu être ouvert.'
      }
    })()
    return () => {
      cancelled = true
      void destroyPdf?.()
      destroyPdf = null
      pdf = null
      bytes = null
      lines = []
      edits = {}
    }
  })

  $effect(() => {
    void pageIndex
    if (status === 'ready') void renderPage()
  })

  // Les rendus sont sérialisés ET annulables. Sérialiser seul ne suffisait pas : sur un
  // document dont certaines pages sont lourdes, la file prenait du retard et les
  // demandes suivantes étaient écartées comme « obsolètes » — donc plusieurs pages ne
  // s'affichaient jamais. Désormais un changement de page ABANDONNE le rendu en cours.
  let renderChain: Promise<void> = Promise.resolve()
  let renderAbort: AbortController | null = null

  function renderPage(): Promise<void> {
    renderAbort?.abort()
    const abort = new AbortController()
    renderAbort = abort
    const cible = pageIndex
    rendering = true
    renderChain = renderChain.then(async () => {
      const canvas = canvasEl
      if (!pdf || !canvas || abort.signal.aborted) return
      const { pageSize, renderPage: render } = await import('../lib/pdf')
      // On mesure la page par `pageSize`, qui fait son propre ménage. Appeler
      // `cleanup()` soi-même juste avant de rendre CETTE page libère les ressources dont
      // le rendu a besoin — et le canvas ressort vide.
      const base = await pageSize(pdf, cible, 1)
      // Largeur fixe : la modale n'a pas à suivre le zoom du lecteur, et les overlays
      // sont posés en pourcentage, donc indépendants de l'échelle choisie.
      const scale = Math.min(720 / base.width, 940 / base.height)
      if (abort.signal.aborted) return
      renderScale = scale
      await render(pdf, cible, canvas, scale, abort.signal)
    }).catch(() => {
      // Un rendu abandonné ne doit pas casser la chaîne des suivants.
    }).finally(() => {
      // Seul le rendu le PLUS RÉCENT éteint le témoin : un abandon ne doit pas
      // faire croire que la page en cours est prête.
      if (renderAbort === abort) rendering = false
    })
    return renderChain
  }

  function edit(line: PdfEditableLine, value: string) {
    const id = key(line)
    // Revenir au texte d'origine efface la modification plutôt que d'enregistrer une
    // écriture inutile.
    edits = value === line.text ? { ...edits, [id]: '' } : { ...edits, [id]: value }
  }

  async function save() {
    if (!bytes || saving || !pending.length) return
    saving = true
    message = ''
    try {
      const { applyTextEdits, PdfEditError } = await import('../lib/export/pdf-edit-text')
      const demandes = pending.map(([id, to]) => {
        const premier = id.indexOf(':')
        const second = id.indexOf(':', premier + 1)
        return {
          page: Number(id.slice(0, premier)),
          occurrence: Number(id.slice(premier + 1, second)),
          from: id.slice(second + 1),
          to,
        }
      })
      try {
        const rapport = await applyTextEdits(bytes.slice(), demandes)
        const base = fileName.replace(/\.pdf$/i, '')
        if (!await writeCopy(`${base} — modifié.pdf`, rapport.bytes)) return
        // On dit ce qui n'a PAS été écrit, avec les caractères en cause : un refus tu
        // ferait croire à une modification complète.
        const refus = rapport.refused.length
          ? ` ${rapport.refused.length} non appliquée${rapport.refused.length > 1 ? 's' : ''} : ${rapport.refused.map((r) => r.chars?.length ? `caractères absents (${r.chars.join(' ')})` : r.reason).join(' ; ')}.`
          : ''
        app.banner = {
          tone: rapport.refused.length ? 'warning' : 'success',
          title: 'PDF modifié enregistré',
          message: `${rapport.applied} modification${rapport.applied > 1 ? 's' : ''} écrite${rapport.applied > 1 ? 's' : ''} dans le document, sans rien changer d’autre.${refus}`,
        }
        if (!rapport.refused.length) closePdfTextEdit()
      } catch (error) {
        message = error instanceof PdfEditError ? error.message : 'Doku n’a pas pu écrire ce PDF.'
      }
    } finally {
      saving = false
    }
  }
</script>

<dialog class="pdftext" bind:this={dlg} onclose={closePdfTextEdit} aria-label="Modifier le texte du PDF">
  <div class="window">
    <header>
      <span class="title-icon" aria-hidden="true"><span class="msr">edit_document</span></span>
      <div class="title">
        <h2>Modifier le texte</h2>
        <p>{fileName}</p>
      </div>
      <span class="spacer"></span>
      <button class="close" aria-label="Fermer" onclick={closePdfTextEdit}><span class="msr">close</span></button>
    </header>

    <div class="tools">
      <button class="icon-button" disabled={pageIndex <= 1} onclick={() => pageIndex--} aria-label="Page précédente"><span class="msr">chevron_left</span></button>
      <span class="pageno">{pageIndex} / {pageCount || '…'}</span>
      {#if rendering}<span class="rendering" role="status">rendu…</span>{/if}
      <button class="icon-button" disabled={pageIndex >= pageCount} onclick={() => pageIndex++} aria-label="Page suivante"><span class="msr">chevron_right</span></button>
      <span class="spacer"></span>
      <span class="summary">
        {#if pending.length}
          {pending.length} modification{pending.length > 1 ? 's' : ''} en attente
        {:else}
          Cliquez sur une ligne pour la modifier
        {/if}
      </span>
    </div>

    {#if message}<p class="message" role="status">{message}</p>{/if}

    <div class="stage">
      {#if status === 'loading'}
        <p class="hint">Analyse du document…</p>
      {:else if status === 'error'}
        <p class="hint error">{message}</p>
      {/if}
      <div class="sheet">
        <canvas bind:this={canvasEl}></canvas>
        {#each pageLines as line (key(line))}
          <input
            class="line"
            class:changed={!!edits[key(line)]}
            class:locked={!line.editable}
            readonly={!line.editable}
            title={line.editable ? line.text : (line.reason ?? 'Cette ligne ne peut pas être modifiée.')}
            value={edits[key(line)] || line.text}
            oninput={(event) => edit(line, event.currentTarget.value)}
            style:left="{line.left * 100}%"
            style:top="{line.top * 100}%"
            style:min-width="{Math.min(line.width * 100 + 6, 100 - line.left * 100)}%"
            style:height="{line.height * 100}%"
            style:font-size="{Math.max(6, line.size * renderScale)}px"
            style:--doc-color={line.color}
            style:caret-color={line.color}
            style:font-weight={line.bold ? '700' : '400'}
            style:font-style={line.italic ? 'italic' : 'normal'}
          />
        {/each}
      </div>
    </div>

    <footer>
      <small>Le document d’origine n’est jamais modifié.</small>
      <span class="spacer"></span>
      <button onclick={closePdfTextEdit}>Annuler</button>
      <button class="primary" disabled={!pending.length || saving} onclick={() => void save()}>
        {saving ? 'Écriture…' : 'Enregistrer une copie…'}
      </button>
    </footer>
  </div>
</dialog>

<style>
  .pdftext {
    width: min(860px, calc(100vw - 32px));
    max-width: none;
    max-height: none;
    margin: auto;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--ink);
    overflow: visible;
  }
  /* Même voile que SettingsDialog : deux dialogues de la même app ne se posent pas sur
     deux fonds différents. */
  .pdftext::backdrop {
    background: rgb(0 0 0 / 0.38);
    -webkit-backdrop-filter: blur(3px);
    backdrop-filter: blur(3px);
  }
  .window {
    height: min(880px, calc(100vh - 40px));
    display: flex;
    flex-direction: column;
    background: var(--cream-base);
    border-radius: 18px;
    /* Vocabulaire « Fenêtre modale » du système d'élévation, les trois couches. */
    box-shadow:
      0 0 0 1px var(--elevation-ring),
      0 28px 76px rgba(var(--shadow-rgb), 0.34),
      0 6px 20px rgba(var(--shadow-rgb), 0.16);
    overflow: hidden;
    animation: pdftext-in 190ms cubic-bezier(0.22, 1, 0.36, 1);
  }
  @keyframes pdftext-in {
    from { opacity: 0; transform: translateY(6px) scale(0.985); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }

  /* En-tête et barre d'outils forment UN seul bloc de chrome : le changement de ton
     vers la scène suffit à les en séparer. Un filet en plus serait une redite. */
  header { flex: 0 0 auto; display: flex; align-items: center; gap: 11px; padding: 12px 14px 12px 18px; }
  .title-icon {
    width: 36px; height: 36px; display: inline-flex; align-items: center; justify-content: center;
    border-radius: 10px; background: var(--accent-soft); color: var(--ink-2);
  }
  .title-icon .msr { font-size: 20px; }
  .title { min-width: 0; }
  .title h2 { margin: 0; font-size: 15px; line-height: 1.3; font-weight: 650; }
  .title p { margin: 2px 0 0; font-size: 11.5px; line-height: 1.3; color: var(--ink-4); }
  .spacer { flex: 1 1 auto; }
  .close {
    width: 34px; height: 34px; display: inline-flex; align-items: center; justify-content: center;
    border: 0; border-radius: 999px; background: transparent; color: var(--ink-4); cursor: pointer;
    transition: background-color 140ms ease, color 140ms ease, transform 100ms ease;
  }
  .close:hover { background: var(--surface-hover); color: var(--ink); }
  .close:active { transform: scale(0.96); }

  /* Gouttière de 18px partagée avec l'en-tête et le pied : la pastille de titre, le
     premier chevron et la mention du pied s'alignent sur une seule verticale. */
  .tools { flex: 0 0 auto; display: flex; align-items: center; gap: 6px; padding: 0 18px 10px; }
  .pageno { font-variant-numeric: tabular-nums; font-size: 12.5px; font-weight: 500; color: var(--ink-4); }
  .rendering { font-size: 11.5px; color: var(--ink-5); }
  .summary { font-size: 11.5px; color: var(--ink-4); }
  /* Le rouge d'erreur du système EXISTE en variante textuelle par thème (`--err-text`) :
     le fond `--err` calibré pour une pastille n'a pas le contraste d'un petit texte. */
  .message { margin: 0; padding: 0 16px 10px; font-size: 12.5px; color: var(--err-text); }

  /* C'est le TON, pas un contour, qui détache la feuille du mobilier (« The Document
     Contrast Rule »). Papier teinté plutôt que voile doux : la scène doit être plus
     SOMBRE que la feuille pour l'asseoir — un fond plus clair que le papier la ferait
     flotter dans le vide. */
  .stage {
    flex: 1 1 auto; overflow: auto; scrollbar-gutter: stable;
    display: grid; place-items: start center; padding: 20px;
    background: var(--cream-tint);
  }
  .hint { padding: 24px; font-size: 12.5px; color: var(--ink-4); }
  .hint.error { color: var(--err-text); }

  .sheet {
    position: relative; line-height: 0;
    /* Vocabulaire « Surface flottante » : la feuille flotte réellement au-dessus de la scène. */
    box-shadow: 0 0 0 1px var(--elevation-ring), 0 12px 30px rgba(var(--shadow-rgb), 0.18);
    /* La feuille est BLANCHE dans les deux thèmes : son encre ne peut donc pas suivre
       `--ink`, qui vire au blanc en sombre. Ces trois valeurs sont l'encre brune du
       système, figées ici parce qu'elles vivent sur du papier, pas sur du mobilier. */
    --sheet-ink: #1C1A16;
    --sheet-line: rgba(28, 26, 22, 0.24);
    --sheet-focus: rgba(28, 26, 22, 0.55);
  }
  .sheet canvas { display: block; max-width: 100%; height: auto; background: #fff; }

  /* Le champ se fond dans la page : on ne voit le texte du document qu'à travers lui,
     et il ne se révèle qu'au survol ou au focus. */
  .line {
    position: absolute;
    margin: 0;
    padding: 0 2px;
    border: 1px solid transparent;
    border-radius: 3px;
    background: transparent;
    /* Au repos le champ est invisible : c'est le texte du canvas qu'on lit à travers.
       La couleur n'apparaît qu'en saisie, et c'est CELLE DU DOCUMENT — jamais
       `var(--ink)`, qui vire au blanc en thème sombre et rendrait le texte invisible
       sur le papier blanc de la page (même piège que les ombres, cf. AGENTS.md). */
    color: transparent;
    font-family: inherit;
    line-height: 1;
    box-sizing: content-box;
    /* La largeur suit le CONTENU au-delà de la boîte d'origine : un texte rallongé
       débordait du fond blanc et se lisait superposé au texte du canvas. */
    width: auto;
    field-sizing: content;
    max-width: 96%;
    transition: background-color 120ms ease, border-color 120ms ease;
  }
  /* Au survol : un CADRE, jamais de fond. Un fond semi-transparent délavait le texte du
     document sans révéler celui du champ — on ne lisait plus ni l'un ni l'autre. */
  /*
   * `:not(:focus)` est INDISPENSABLE ici, pas un raffinement : `.line:hover:not(.locked)`
   * a une spécificité plus forte que `.line:focus`, et la souris reste sur la ligne
   * qu'on vient de cliquer. Sans cette exclusion, le survol imposait son fond au champ
   * en cours de saisie — on ne lisait plus ni le document ni ce qu'on tapait.
   */
  /* `:not(.changed)` pour la même raison de spécificité : sans elle, le survol repeint
     les quatre côtés et efface la marque d'encre d'une ligne déjà modifiée. Une ligne
     modifiée porte déjà son état, elle n'a rien à gagner d'un survol. */
  .line:hover:not(.locked):not(:focus):not(.changed) {
    border-color: var(--sheet-line);
    background: transparent;
    cursor: text;
  }
  /* Le fond blanc DÉBORDE de la boîte (`box-shadow` en anneau plein) : sans ça, le
     texte d'origine du canvas dépasse du champ et on lit les deux superposés — le mot
     modifié devient illisible. */
  /* En saisie : fond OPAQUE et texte visible. C'est le seul état où l'on doit lire ce
     qu'on écrit plutôt que ce qui était écrit — les deux superposés ne se lisent pas. */
  .line:focus {
    outline: none;
    border-color: transparent;
    background: #fff;
    /* La couleur vient du DOCUMENT, transportée par une propriété personnalisée. */
    color: var(--doc-color, #1a1a1a);
    /* 3px de blanc pour déborder du texte d'origine, puis l'anneau de focus de 2px à
       contraste moyen prescrit par le système — en encre, jamais en accent coloré. */
    box-shadow: 0 0 0 3px #fff, 0 0 0 5px var(--sheet-focus);
    z-index: 3;
  }
  /* Une ligne modifiée reste VISIBLE sans focus : sinon l'utilisateur perd de vue ce
     qu'il a déjà changé. Le repère est une marque d'éditeur — un filet d'encre sous la
     ligne — et non une couleur d'accent : rien ne doit rivaliser avec le document. */
  .line.changed {
    background: #fff;
    color: var(--doc-color, #1a1a1a);
    border-bottom-color: var(--sheet-ink);
    box-shadow: 0 0 0 3px #fff;
    z-index: 1;
  }
  .line.locked { cursor: not-allowed; }
  /* Une ligne verrouillée ne doit ni voiler le document ni sonner l'alarme : un filet
     tireté dit « pas modifiable », l'infobulle dit pourquoi. */
  .line.locked:hover { border-color: var(--sheet-line); border-style: dashed; background: transparent; }

  footer { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; padding: 12px 18px; }
  footer small { font-size: 11.5px; color: var(--ink-5); }

  /* Un SEUL vocabulaire de bouton dans la modale : pilule sans contour permanent, qui
     ne se révèle qu'au survol. Le contour permanent d'avant faisait ressembler la
     fenêtre à un dialogue générique posé dans Doku. */
  .icon-button, footer button {
    display: inline-flex; align-items: center; justify-content: center;
    border: 0; background: transparent; color: var(--ink-3);
    font: inherit; font-size: 12.5px; font-weight: 500; cursor: pointer;
    transition: background-color 140ms ease, color 140ms ease, transform 100ms ease;
  }
  .icon-button { width: 30px; height: 30px; border-radius: 9px; color: var(--ink-4); }
  footer button { height: 34px; padding: 0 16px; border-radius: 999px; }
  .icon-button:hover:not(:disabled), footer button:hover:not(:disabled) { background: var(--surface-hover); color: var(--ink); }
  .icon-button:active:not(:disabled), footer button:active:not(:disabled) { transform: scale(0.97); }
  .icon-button:disabled, footer button:disabled { opacity: 0.4; cursor: default; }
  footer .primary { background: var(--ink); color: var(--cream-content); }
  footer .primary:hover:not(:disabled) { background: var(--ink-2); color: var(--cream-content); }

  @media (prefers-reduced-motion: reduce) {
    .window { animation: none; }
    .line, .close, .icon-button, footer button { transition: none !important; }
    .close:active, .icon-button:active, footer button:active { transform: none; }
  }
</style>
