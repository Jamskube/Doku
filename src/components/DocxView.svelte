<script lang="ts">
  // Éditeur DOCX (ADR-0023) : c'est la marche qui referme la boucle
  // PDF → conversion → édition → PDF, et la raison pour laquelle Doku est passé en AGPL.
  //
  // SuperDoc est bâti sur ProseMirror, que l'ADR-0002 avait écarté POUR LE MARKDOWN
  // (réécriture systématique des fichiers, mesurée au spike S0). Le risque ne se
  // reporte pas ici : un `.docx` n'a pas de source texte à préserver au caractère près,
  // c'est un format structuré qu'on relit et réécrit tel quel. Doku a donc deux moteurs
  // d'édition — CM6 pour le texte, ProseMirror pour le DOCX — et c'est assumé.
  import { app } from '../lib/stores.svelte'
  import { readFileBytes, savePdfDialog, writeFileAtomic } from '../lib/tauri'

  // Ports injectables, comme les modales PDF : c'est ce qui permet au banc de contrôle
  // de monter la VRAIE vue sans hôte natif. Par défaut, ce sont les accès fichiers de
  // Tauri — l'application ne passe rien.
  let {
    path,
    tabId,
    readBytes = readFileBytes,
    writeFile = writeFileAtomic,
    savePdf = savePdfDialog,
  }: {
    path: string
    tabId: number
    readBytes?: (path: string) => Promise<Uint8Array | null>
    writeFile?: (path: string, bytes: Uint8Array) => Promise<unknown>
    savePdf?: (name: string, bytes: Uint8Array) => Promise<boolean>
  } = $props()

  let host: HTMLElement | undefined = $state()
  // Conteneur de la barre d'outils de SuperDoc. Elle doit exister AVANT la construction
  // de l'éditeur : SuperDoc la monte lui-même dans l'élément qu'on lui désigne.
  let toolbarEl: HTMLElement | undefined = $state()
  let status: 'loading' | 'ready' | 'error' = $state('loading')
  let message = $state('')
  let busy = $state<'' | 'save' | 'pdf'>('')
  let dirty = $state(false)

  // L'instance SuperDoc n'est pas un état réactif : c'est un objet impératif lourd qui
  // gère son propre DOM. Un proxy Svelte autour ne servirait qu'à le casser.
  let editor: { export: (o: unknown) => Promise<Blob>; destroy?: () => void } | null = null

  const fileName = $derived(path.split(/[\\/]/).pop() ?? 'document.docx')

  $effect(() => {
    const target = host
    const barre = toolbarEl
    const source = path
    if (!target || !barre || !source) return
    let cancelled = false
    void (async () => {
      status = 'loading'
      message = ''
      try {
        const bytes = await readBytes(source)
        if (cancelled) return
        if (!bytes) {
          status = 'error'
          message = 'Le document est introuvable.'
          return
        }
        // SuperDoc et sa feuille de style sont chargés à la demande : ils n'ont rien à
        // faire dans le bundle de démarrage d'une app dont le cœur est le Markdown.
        const [{ SuperDoc }] = await Promise.all([
          import('superdoc'),
          import('superdoc/style.css'),
        ])
        if (cancelled) return
        const file = new File([bytes as BlobPart], fileName, {
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        })
        editor = new SuperDoc({
          selector: target,
          document: file,
          documentMode: 'editing',
          // `documentMode` seul ne suffit pas : sans `role`, SuperDoc monte une surface
          // de PRÉSENTATION, sans aucun `contenteditable` — le document s'affiche mais
          // ne se modifie pas. Constaté au banc.
          role: 'editor',
          // Les outils habituels d'un traitement de texte — graisse, style, couleur,
          // titres, listes, alignements, retraits, liens, images, tableaux, saut de
          // page, reproduire la mise en forme, suivi des modifications — sont livrés
          // par SuperDoc. Il ne les monte que si on lui désigne un conteneur : sans
          // cette ligne, l'éditeur est nu et tout se fait au clavier.
          toolbar: barre,
          onEditorUpdate: () => { dirty = true },
        }) as unknown as typeof editor
        status = 'ready'
      } catch (error) {
        status = 'error'
        message = error instanceof Error ? error.message : 'Ce document n’a pas pu être ouvert.'
      }
    })()
    return () => {
      cancelled = true
      try {
        editor?.destroy?.()
      } catch {
        // Un éditeur déjà démonté ne doit pas empêcher de changer d'onglet.
      }
      editor = null
      dirty = false
    }
  })

  async function exportBlob(type: 'docx' | 'pdf'): Promise<Uint8Array | null> {
    if (!editor) return null
    const blob = await editor.export({ exportType: type, triggerDownload: false })
    return new Uint8Array(await blob.arrayBuffer())
  }

  // Enregistre PAR-DESSUS le .docx ouvert : contrairement au PDF, ce fichier EST le
  // document de travail de l'utilisateur — c'est lui qu'il édite, l'écrire est le geste
  // attendu. L'écriture reste atomique (tmp + rename).
  async function save() {
    if (!editor || busy) return
    busy = 'save'
    try {
      const bytes = await exportBlob('docx')
      if (!bytes) return
      await writeFile(path, bytes)
      dirty = false
      app.banner = { tone: 'success', title: 'Document enregistré', message: fileName }
    } catch {
      app.banner = {
        tone: 'error',
        title: 'Enregistrement impossible',
        message: 'Doku n’a pas pu écrire ce document Word.',
      }
    } finally {
      busy = ''
    }
  }

  // Retour au PDF — la dernière marche de la boucle. Elle ne passe PAS par SuperDoc :
  // son `export({ exportType: 'pdf' })` rend une archive vide de 22 octets, il n'existe
  // aucun `exportPdf` dans son bundle et sa documentation n'en parle pas. Doku écrit
  // donc le PDF lui-même (`export/docx-to-pdf.ts`), à partir du DOCX que SuperDoc vient
  // de produire — ce qui garantit d'exporter exactement ce qui a été enregistré.
  async function exportPdf() {
    if (!editor || busy) return
    busy = 'pdf'
    try {
      const [{ convertDocxToPdf, DocxToPdfError }] = await Promise.all([import('../lib/export/docx-to-pdf')])
      const docx = await exportBlob('docx')
      if (!docx) return
      try {
        const report = await convertDocxToPdf(docx, (xml) => new DOMParser().parseFromString(xml, 'application/xml'))
        const base = fileName.replace(/\.docx$/i, '')
        if (await savePdf(`${base}.pdf`, report.bytes)) {
          app.banner = {
            tone: 'success',
            title: 'PDF créé',
            message: `${report.paragraphs} paragraphe${report.paragraphs > 1 ? 's' : ''} sur ${report.pages} page${report.pages > 1 ? 's' : ''}. Texte, styles et titres sont repris ; images et tableaux ne le sont pas encore.`,
          }
        }
      } catch (error) {
        app.banner = {
          tone: 'error',
          title: 'Export PDF impossible',
          message: error instanceof DocxToPdfError ? error.message : 'Doku n’a pas pu produire le PDF.',
        }
      }
    } finally {
      busy = ''
    }
  }

  export function saveDocx() {
    return save()
  }
</script>

<div class="docx-view" data-tab={tabId}>
  <!-- Une SEULE rangée d'outils : ceux de SuperDoc à gauche, les actions de Doku à
       droite. Deux barres superposées auraient donné deux grammaires de boutons pour un
       même document. -->
  <div class="docx-bar" class:ready={status === 'ready'}>
    <div class="docx-toolbar" bind:this={toolbarEl}></div>
    <div class="docx-actions">
      <button disabled={status !== 'ready' || !!busy} onclick={() => void save()}>
        <span class="msr">save</span>
        <span>{busy === 'save' ? 'Enregistrement…' : dirty ? 'Enregistrer' : 'Enregistré'}</span>
      </button>
      <button disabled={status !== 'ready' || !!busy} onclick={() => void exportPdf()}>
        <span class="msr">picture_as_pdf</span>
        <span>{busy === 'pdf' ? 'Export…' : 'Exporter en PDF'}</span>
      </button>
    </div>
  </div>

  {#if status === 'loading'}
    <p class="docx-note">Ouverture du document…</p>
  {:else if status === 'error'}
    <p class="docx-note error">{message}</p>
  {/if}

  <div class="docx-host" bind:this={host}></div>
</div>

<style>
  .docx-view {
    position: relative;
    height: 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .docx-bar {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    background: var(--cream-base);
    /* Tant que le document charge, la rangée reste en place — la barre d'outils de
       SuperDoc s'y monte — mais elle ne s'annonce pas : des outils visibles au-dessus
       d'un document absent seraient des affordances mortes. */
    opacity: 0;
    transition: opacity 160ms ease;
  }
  .docx-bar.ready { opacity: 1; }
  /* La barre de SuperDoc ne se replie pas (`nowrap`) : elle doit donc DÉFILER dans
     l'espace qui lui reste, sinon ses derniers outils passent sous les actions de Doku —
     ce que le banc a montré en fenêtre étroite. */
  .docx-toolbar { flex: 1 1 0; min-width: 0; }
  .docx-actions { flex: none; display: flex; gap: 6px; }
  /* Même grammaire que les autres surfaces Doku : pilule sans contour permanent, qui ne
     se révèle qu'au survol. */
  .docx-actions button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 32px;
    padding: 0 12px;
    border: 0;
    border-radius: 999px;
    background: transparent;
    color: var(--ink-3);
    font: inherit;
    font-size: 12.5px;
    font-weight: 500;
    cursor: pointer;
    transition: background-color 140ms ease, color 140ms ease, transform 100ms ease;
  }
  .docx-actions button:hover:not(:disabled) { background: var(--surface-hover); color: var(--ink); }
  .docx-actions button:active:not(:disabled) { transform: scale(0.97); }
  .docx-actions button:disabled { opacity: 0.4; cursor: default; }
  .docx-actions .msr { font-size: 17px; }

  /* La barre est rendue par SuperDoc, avec ses propres classes : on ne la redessine pas
     (un jour ou l'autre elles changeront), on l'assied seulement dans la typographie de
     Doku pour qu'elle ne détonne pas à côté du reste. */
  .docx-bar :global(.superdoc-toolbar) {
    background: transparent;
    border: 0;
    box-shadow: none;
    padding: 0;
    /* SuperDoc pose `nowrap` : ses derniers outils passaient alors sous les actions de
       Doku, ou obligeaient à une barre de défilement qui mangeait la rangée. On la
       laisse se REPLIER, comme le fait un traitement de texte en fenêtre étroite. */
    flex-wrap: wrap;
    row-gap: 2px;
  }
  .docx-bar :global(.superdoc-toolbar *) { font-family: inherit; }

  @media (prefers-reduced-motion: reduce) {
    .docx-bar { transition: none; }
    .docx-actions button { transition: none; }
    .docx-actions button:active { transform: none; }
  }

  .docx-note { margin: 0; padding: 24px; text-align: center; opacity: 0.72; }
  .docx-note.error { color: var(--err-text); }

  .docx-host {
    flex: 1 1 auto;
    overflow: auto;
    scrollbar-gutter: stable;
  }
</style>
