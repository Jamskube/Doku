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

  let { path, tabId }: { path: string; tabId: number } = $props()

  let host: HTMLElement | undefined = $state()
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
    const source = path
    if (!target || !source) return
    let cancelled = false
    void (async () => {
      status = 'loading'
      message = ''
      try {
        const bytes = await readFileBytes(source)
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
      await writeFileAtomic(path, bytes)
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
        if (await savePdfDialog(`${base}.pdf`, report.bytes)) {
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
  .docx-actions {
    position: absolute;
    top: 8px;
    right: 12px;
    z-index: 5;
    display: flex;
    gap: 6px;
  }
  .docx-actions button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 30px;
    padding: 0 11px;
    border: 1px solid var(--line-1);
    border-radius: 999px;
    background: var(--cream-base);
    color: inherit;
    font: inherit;
    font-size: 13px;
    cursor: pointer;
  }
  .docx-actions button:hover:not(:disabled) { background: rgba(var(--ink-rgb), 0.06); }
  .docx-actions button:disabled { opacity: 0.45; cursor: default; }
  .docx-actions .msr { font-size: 17px; }

  .docx-note { margin: 0; padding: 24px; text-align: center; opacity: 0.72; }
  .docx-note.error { color: var(--danger, #b3261e); }

  .docx-host {
    flex: 1 1 auto;
    overflow: auto;
    scrollbar-gutter: stable;
  }
</style>
