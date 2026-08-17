<script lang="ts">
  // Éditeur DOCX (ADR-0023) : c'est la marche qui referme la boucle
  // PDF → conversion → édition → PDF, et la raison pour laquelle Doku est passé en AGPL.
  //
  // SuperDoc est bâti sur ProseMirror, que l'ADR-0002 avait écarté POUR LE MARKDOWN
  // (réécriture systématique des fichiers, mesurée au spike S0). Le risque ne se
  // reporte pas ici : un `.docx` n'a pas de source texte à préserver au caractère près,
  // c'est un format structuré qu'on relit et réécrit tel quel. Doku a donc deux moteurs
  // d'édition — CM6 pour le texte, ProseMirror pour le DOCX — et c'est assumé.
  import { app, docxActions } from '../lib/stores.svelte'
  import { baseName } from '../lib/paths'
  import { readFileBytes, savePdfDialog, writeFileAtomic } from '../lib/tauri'
  import DocxFormatBubble from './DocxFormatBubble.svelte'

  // Ports injectables, comme les modales PDF : c'est ce qui permet au banc de contrôle
  // de monter la VRAIE vue sans hôte natif. Par défaut, ce sont les accès fichiers de
  // Tauri — l'application ne passe rien.
  let {
    path,
    tabId,
    readBytes = readFileBytes,
    writeFile = writeFileAtomic,
    savePdf = savePdfDialog,
    onEditorReady,
  }: {
    path: string
    tabId: number
    readBytes?: (path: string) => Promise<Uint8Array | null>
    writeFile?: (path: string, bytes: Uint8Array) => Promise<unknown>
    savePdf?: (name: string, bytes: Uint8Array) => Promise<boolean>
    // Le banc de contrôle en a besoin pour interroger la surface de commandes.
    onEditorReady?: (instance: unknown) => void
  } = $props()

  let host: HTMLElement | undefined = $state()
  // Cadre de référence de la bulle de mise en forme (enfant absolu, jamais `fixed`).
  let vueEl: HTMLElement | undefined = $state()
  // Instance vivante, donnée à la bulle pour qu'elle pilote les commandes de SuperDoc.
  let instance = $state.raw<{ ui?: unknown } | null>(null)
  // Le curseur est-il DANS le document ? `:focus-within` ne peut pas répondre : la
  // surface de SuperDoc est un `role="textbox"` à pont clavier, jamais un nœud focusable
  // ordinaire, donc le CSS ne voit rien. C'est SuperDoc lui-même qui doit le dire.
  let saisieActive = $state(false)
  let status: 'loading' | 'ready' | 'error' = $state('loading')
  let message = $state('')
  let busy = $state<'' | 'save' | 'pdf'>('')
  let dirty = $state(false)

  // L'instance SuperDoc n'est pas un état réactif : c'est un objet impératif lourd qui
  // gère son propre DOM. Un proxy Svelte autour ne servirait qu'à le casser.
  let editor: { export: (o: unknown) => Promise<Blob>; destroy?: () => void } | null = null
  let arreterSelection: (() => void) | null = null

  const fileName = $derived(baseName(path) || 'document.docx')

  $effect(() => {
    const target = host
    const source = path
    if (!target || !source) return
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
          // La carte de chargement de SuperDoc — « Loading document / Almost ready »,
          // en anglais, avec sa barre de progression bleue — est coupée : Doku a la
          // sienne. Sa documentation pose la contrepartie noir sur blanc : « turning it
          // off hands that responsibility to your UI: keep yours up until `onReady` ».
          // D'où le `status` qui ne bascule qu'à `onReady` plus bas, et non au retour du
          // constructeur : c'est ce décalage qui laissait sa carte apparaître après la
          // nôtre.
          ui: { loading: false },
          // AUCUNE barre d'outils SuperDoc : ses 21 outils permanents contredisent la
          // D.A. (« le document est le composant signature, sans barre d'outils
          // persistante »). Les outils vivent dans `DocxFormatBubble`, qui pilote les
          // MÊMES commandes via `superdoc.ui` — la surface publique que la barre
          // intégrée consomme elle aussi, donc aucun risque de désynchronisation.
          onEditorUpdate: () => { dirty = true },
          // Le document n'est réellement affichable qu'ici. Le constructeur, lui, rend
          // la main bien avant.
          onReady: () => { if (!cancelled) status = 'ready' },
        }) as unknown as typeof editor
        instance = editor as unknown as { ui?: unknown }
        // Le signal vient du POINTEUR, pas de SuperDoc : sa tranche `selection` ne
        // remonte une cible que pour une sélection ÉTENDUE — un simple curseur posé
        // dans le texte n'y apparaît pas, et c'est justement ce cas qu'il faut montrer.
        // Un clic dans le document ouvre la saisie, un clic ailleurs la referme.
        // EN CAPTURE, et un seul écouteur : SuperDoc appelle `stopPropagation()` sur le
        // `pointerdown` de sa surface, donc un écouteur en phase de bulle ne voit jamais
        // les clics DANS le texte — exactement ceux qui comptent. Mesuré au banc :
        // l'état ressortait inversé.
        // La cible est la FEUILLE, pas le volet : cliquer la marge grise autour de la
        // page n'est pas se mettre à écrire dedans.
        const surClic = (event: PointerEvent) => {
          const cible = event.target as Element | null
          saisieActive = !!cible?.closest?.('.v2-super-editor__stage')
        }
        window.addEventListener('pointerdown', surClic, true)
        arreterSelection = () => {
          // Le drapeau de capture fait partie de l'IDENTITÉ de l'écouteur : sans lui,
          // `removeEventListener` ne retire rien (piège déjà payé sur `PdfView`).
          window.removeEventListener('pointerdown', surClic, true)
        }
        onEditorReady?.(editor)
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
      arreterSelection?.()
      arreterSelection = null
      editor = null
      instance = null
      saisieActive = false
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

  // Publication des actions vers le menu et le clavier. Le `tabId` sert de garde : si un
  // autre onglet devient actif, le menu ne doit pas appeler l'enregistrement d'un
  // document qui n'est plus à l'écran.
  $effect(() => {
    docxActions.tabId = tabId
    docxActions.save = () => save()
    docxActions.exportPdf = () => exportPdf()
    return () => {
      if (docxActions.tabId !== tabId) return
      docxActions.tabId = null
      docxActions.save = null
      docxActions.exportPdf = null
      docxActions.busy = ''
      docxActions.dirty = false
    }
  })

  $effect(() => {
    if (docxActions.tabId !== tabId) return
    docxActions.busy = busy
    docxActions.dirty = dirty
  })
</script>

<!-- Rien au-dessus du document : les outils n'apparaissent qu'à la sélection, et
     « Enregistrer » / « Exporter en PDF » ont rejoint le menu, avec les autres exports. -->
<div class="docx-view" data-tab={tabId} bind:this={vueEl}>
  {#if status === 'loading'}
    <!-- Squelette plutôt que rouage qui tourne : ce qui s'annonce, c'est une FEUILLE,
         et elle apparaît d'abord vide puis se remplit. La règle du registre produit —
         « skeleton states for loading, not spinners in the middle of content » — et le
         principe « le document parle » disent la même chose ici. -->
    <div class="docx-attente" role="status" aria-label="Ouverture du document">
      <div class="feuille-vide">
        <div class="trame">
          <span class="ligne titre"></span>
          <span class="ligne l1"></span>
          <span class="ligne l2"></span>
          <span class="ligne l3"></span>
          <span class="ligne titre court"></span>
          <span class="ligne l1"></span>
          <span class="ligne l4"></span>
        </div>
      </div>
      <p class="mention">Ouverture de {fileName}…</p>
    </div>
  {:else if status === 'error'}
    <div class="docx-attente" role="alert">
      <div class="feuille-vide vide">
        <span class="msr" aria-hidden="true">description</span>
        <p>{message}</p>
      </div>
    </div>
  {/if}

  <div class="docx-host" class:saisie={saisieActive} bind:this={host}></div>

  {#if status === 'ready' && instance}
    <DocxFormatBubble superdoc={instance as never} container={vueEl} />
  {/if}
</div>

<style>
  .docx-view {
    position: relative;
    height: 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  /* L'attente occupe la même surface que le document à venir : la feuille ne saute pas
     en place au moment du montage, elle se remplit. */
  .docx-attente {
    /* SURCOUCHE, pas un frère dans le flux : l'hôte de SuperDoc reste monté et gardé à
       sa taille réelle — il le mesure au montage — pendant que l'attente le recouvre.
       En frère, les deux se partageaient la hauteur et la feuille s'arrêtait au milieu. */
    position: absolute;
    inset: 0;
    z-index: 2;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding: 20px;
    overflow: hidden;
    background: var(--cream-tint);
  }
  .feuille-vide {
    width: min(794px, 100%);
    flex: 1 1 auto;
    min-height: 0;
    background: #fff;
    box-shadow: 0 0 0 1px var(--elevation-ring), 0 12px 30px rgba(var(--shadow-rgb), 0.18);
  }
  .feuille-vide.vide {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    /* La feuille d'erreur reste BLANCHE — c'est une page, pas un panneau d'alerte : le
       ton sémantique est porté par le texte, jamais par le papier. */
    color: var(--err-text);
  }
  .feuille-vide.vide .msr { font-size: 30px; color: rgba(28, 26, 22, 0.28); }
  .feuille-vide.vide p { margin: 0; max-width: 40ch; text-align: center; font-size: 12.5px; line-height: 1.5; }

  .trame { padding: 84px 92px; display: flex; flex-direction: column; gap: 11px; }
  /* Les barres imitent la mise en page d'un document Word : un titre, puis des lignes
     de longueurs inégales. Une trame régulière ressemblerait à un tableau. */
  .ligne {
    height: 9px;
    border-radius: 3px;
    /* Gris de PAPIER, indépendant du thème : la feuille est blanche dans les deux, une
       trame en `--ink` deviendrait blanche sur blanc en thème sombre. */
    background: rgba(28, 26, 22, 0.09);
  }
  .ligne.titre { height: 15px; width: 46%; margin-bottom: 7px; background: rgba(28, 26, 22, 0.14); }
  .ligne.titre.court { width: 32%; margin-top: 22px; }
  .ligne.l1 { width: 100%; }
  .ligne.l2 { width: 96%; }
  .ligne.l3 { width: 72%; }
  .ligne.l4 { width: 88%; }

  /* Un balayage lent traverse la trame — il dit « ça travaille » sans rien faire
     tourner. Le mouvement est porté par un dégradé, pas par une propriété de layout. */
  .trame .ligne {
    background-image: linear-gradient(
      100deg,
      transparent 20%,
      rgba(28, 26, 22, 0.07) 42%,
      transparent 64%
    );
    background-size: 260% 100%;
    background-repeat: no-repeat;
    animation: trame-balayage 1900ms ease-in-out infinite;
  }
  @keyframes trame-balayage {
    from { background-position: 130% 0; }
    to { background-position: -30% 0; }
  }

  .mention { margin: 0; font-size: 11.5px; color: var(--ink-5); }

  @media (prefers-reduced-motion: reduce) {
    /* La trame reste VISIBLE, seule son animation s'arrête : l'état d'attente ne doit
       pas dépendre du mouvement pour exister. */
    .trame .ligne { animation: none; background-image: none; }
  }

  .docx-host {
    flex: 1 1 auto;
    overflow: auto;
    scrollbar-gutter: stable;
    /* La page Word a une largeur FIXE (794 px en A4 à 100 %). Dans un conteneur bloc,
       elle se colle à gauche et laisse un vide sur toute la droite du volet. On la
       centre — et `safe` est indispensable : à un zoom qui rend la page plus large que
       le volet, un centrage ordinaire rend le bord GAUCHE inatteignable au défilement. */
    display: flex;
    justify-content: safe center;
    align-items: flex-start;
    /* Le pourtour est une surface de travail, pas un trou : même papier teinté que la
       scène de la modale d'édition PDF, pour que la feuille soit posée sur quelque
       chose plutôt que suspendue devant le mobilier sombre. */
    background: var(--cream-tint);
  }

  /* « Je peux écrire ici » : SuperDoc laisse le curseur en `auto` sur sa surface de
     saisie — aucun I-beam au survol du texte, donc rien qui dise que le document
     s'édite. C'est l'affordance la plus standard qui soit, et elle manquait. */
  .docx-host :global([role='textbox']) { cursor: text; }

  /* Et « j'écris ici EN CE MOMENT » : la feuille prend une élévation quand la saisie a
     le focus. Anneau et ombre ambiante, jamais de halo coloré — le système réserve la
     couleur aux statuts sémantiques. */
  .docx-host :global(.v2-super-editor__stage) {
    /* État de repos de MÊME STRUCTURE que l'état de focus (trois couches) : une
       transition qui part de `none` n'a rien à interpoler et laisse l'ombre bloquée en
       transparent. */
    box-shadow:
      0 0 0 1px transparent,
      0 0 0 3px transparent,
      0 0 0 0 transparent;
    transition: box-shadow 160ms ease;
  }
  .docx-host.saisie :global(.v2-super-editor__stage) {
    box-shadow:
      0 0 0 1px var(--elevation-ring),
      0 0 0 3px rgba(var(--ink-rgb), 0.10),
      0 12px 30px rgba(var(--shadow-rgb), 0.18);
  }

  @media (prefers-reduced-motion: reduce) {
    .docx-host :global(.v2-super-editor__stage) { transition: none; }
  }
</style>
