<script lang="ts">
  // « Modifier le texte » (ADR-0023) : la page telle qu'elle est, avec des champs de
  // saisie posés EXACTEMENT sur ses lignes. L'utilisateur tape dans le document, jamais
  // dans du code — et ce qu'il ne modifie pas n'est pas touché d'un octet.
  //
  // Modale autonome, sur le motif de « Organiser les pages » : le lecteur `PdfView`
  // gère déjà quatre modes de pointeur, la sélection de texte, le dessin et la gomme.
  // Y greffer une cinquième surface de saisie était le chemin le plus court vers une
  // collision.
  import { app, askSave, closePdfTextEdit, isCloudProvider } from '../lib/stores.svelte'
  import { cancelPdfCorrection, copilot, correctPdfPage, pdfCorrection } from '../lib/copilot.svelte'
  import { diffWords } from '../lib/copilot-service'
  import { lineLabel, pdfCorrectionMatches, repinRefusedEdits, revealInvisibles } from '../lib/pdf-correction'
  import { baseName } from '../lib/paths'
  import { readFileBytes, savePdfDialog, SourceOverwriteError } from '../lib/tauri'
  import type { PdfEditableLine, PdfEditRequest } from '../lib/export/pdf-edit-text'
  import type { PdfDoc } from '../lib/pdf'

  let {
    readBytes = readFileBytes,
    writeCopy = savePdfDialog,
  }: {
    readBytes?: (path: string) => Promise<Uint8Array | null>
    writeCopy?: (name: string, bytes: Uint8Array, protect?: string) => Promise<boolean>
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
  // Le composant est-il toujours monté ? Une application en vol peut se terminer APRÈS le
  // démontage : sans ce drapeau, le document rechargé n'aurait plus personne pour le
  // détruire — un worker pdf.js et ses pages retenus jusqu'au redémarrage.
  let vivant = true

  // --- Correction par consigne (spike) ---------------------------------------------------
  let instruction = $state('')
  // Séquence d'application : verrouille les chevrons, le champ et l'acceptation. Sans elle,
  // un double-clic lance deux `applyTextEdits` sur les mêmes octets d'origine — dernier
  // écrit gagnant, la première correction disparaît.
  let applying = $state(false)
  // Octets réécrits en mémoire mais pas encore sur le disque. Le fichier source, lui, n'est
  // JAMAIS touché : l'écriture passe toujours par le dialogue « Enregistrer une copie ».
  let dirty = $state(false)
  // Incrémentée à chaque application : une proposition calculée sur les octets d'avant ne
  // vise plus les mêmes lignes.
  let revision = $state(0)
  let accepted = $state<Record<number, boolean>>({})
  // Liste FERMÉE réellement soumise au modèle — c'est elle qui résout les index rendus.
  let submitted = $state<PdfEditableLine[]>([])
  // Rechargement échoué : les octets en mémoire ne correspondent plus à ce qui est affiché.
  // Continuer à taper dessus ne produirait que des refus, et bloquerait l'enregistrement de
  // secours. Les champs deviennent donc en lecture seule jusqu'à la fermeture.
  let perime = $state(false)

  const path = $derived(app.pdfTextEditPath ?? '')
  const fileName = $derived(baseName(path) || 'document.pdf')
  const pageLines = $derived(lines.filter((l) => l.page === pageIndex))
  const pending = $derived(Object.entries(edits).filter(([, v]) => v.trim() !== ''))
  // Typé au MINIMUM structurel : la clé ne lit que ces trois champs, et elle doit se
  // calculer aussi bien sur une ligne complète que sur l'identité rendue par `repinRefusedEdits`.
  const key = (l: { page: number; occurrence: number; text: string }) => `${l.page}:${l.occurrence}:${l.text}`

  const run = $derived(pdfCorrection.current)
  const streaming = $derived(run?.phase === 'streaming')
  // Le run ne s'affiche que s'il désigne encore CE document, CETTE page et CETTE révision
  // des octets. Sinon il viserait des lignes que l'utilisateur n'a jamais soumises.
  const runIci = $derived(run && pdfCorrectionMatches(run, path, pageIndex, revision) ? run : null)
  const propositions = $derived(runIci?.phase === 'ready' ? runIci.edits : [])
  // Une proposition dont la ligne porte DÉJÀ une saisie manuelle est écartée : les deux
  // partent dans le même appel, la saisie passe en premier et gagne, et la proposition
  // revient refusée « passage déjà modifié » avec la même identité — de quoi faire croire
  // ensuite que la saisie, elle, a été perdue. Écarter le conflit vaut mieux que l'expliquer.
  const acceptees = $derived(
    propositions.filter((e) => {
      if (accepted[e.index] === false) return false
      const cible = runIci?.targets[e.index]
      return !cible || !edits[key(cible)]
    }),
  )
  // `perime` verrouille aussi la navigation : `pdf` est nul, donc un changement de page
  // laisserait le canvas sur l'image de la page PRÉCÉDENTE, sous les champs de la nouvelle.
  const locked = $derived(streaming || applying || perime)
  // Jamais un bouton muet : quand la correction est indisponible, on dit pourquoi.
  const raisonIndispo = $derived.by(() => {
    // Les lignes affichées ne correspondent plus aux octets : une proposition serait
    // calculée sur du texte d'avant, s'afficherait comme valide, et serait refusée à
    // l'écriture. Un diff qui ment est pire qu'une fonction indisponible.
    if (perime) return 'L’aperçu n’a pas pu être rechargé — enregistrez une copie pour conserver les corrections.'
    if (!isCloudProvider(app.copilotProvider))
      return 'La correction par consigne demande un fournisseur cloud (Modèles → OpenAI ou MiniMax).'
    if (copilot.generating && !streaming) return 'Doku-San termine une autre réponse.'
    // La garde doit refléter le FILTRE réel : sans le `!edits[...]`, une page dont toutes
    // les lignes portent déjà une saisie laissait le champ actif et muet.
    if (!pageLines.some((l) => l.editable && !edits[key(l)]))
      return pageLines.some((l) => l.editable)
        ? 'Toutes les lignes modifiables de cette page ont déjà une saisie en attente.'
        : 'Aucune ligne modifiable sur cette page.'
    return ''
  })

  $effect(() => {
    const el = dlg
    if (!el) return
    if (path && !el.open) el.showModal()
    else if (!path && el.open) el.close()
  })

  $effect(() => {
    if (!path) return
    let cancelled = false
    vivant = true
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
      vivant = false
      // L'état du run vit dans `copilot.svelte.ts`, pas ici : sans cet appel, une
      // proposition survivrait à la fermeture et s'appliquerait d'un clic à la
      // réouverture — éventuellement sur un autre document.
      cancelPdfCorrection()
      void destroyPdf?.()
      destroyPdf = null
      pdf = null
      bytes = null
      lines = []
      edits = {}
      instruction = ''
      accepted = {}
      submitted = []
      dirty = false
      perime = false
      revision = 0
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
      // Le document est CAPTURÉ en tête d'étape : `pdf` est remplacé pendant une
      // application, et le relire après l'`await` mesurerait l'échelle sur l'ancien
      // document pour rendre sur le nouveau.
      const doc = pdf
      if (!doc || !canvas || abort.signal.aborted) return
      const { pageSize, renderPage: render } = await import('../lib/pdf')
      // On mesure la page par `pageSize`, qui fait son propre ménage. Appeler
      // `cleanup()` soi-même juste avant de rendre CETTE page libère les ressources dont
      // le rendu a besoin — et le canvas ressort vide.
      const base = await pageSize(doc, cible, 1)
      // Largeur fixe : la modale n'a pas à suivre le zoom du lecteur, et les overlays
      // sont posés en pourcentage, donc indépendants de l'échelle choisie.
      const scale = Math.min(720 / base.width, 940 / base.height)
      if (abort.signal.aborted) return
      renderScale = scale
      await render(doc, cible, canvas, scale, abort.signal)
    }).catch(() => {
      // Un rendu abandonné ne doit pas casser la chaîne des suivants.
    }).finally(() => {
      // Seul le rendu le PLUS RÉCENT éteint le témoin : un abandon ne doit pas
      // faire croire que la page en cours est prête.
      if (renderAbort === abort) rendering = false
    })
    return renderChain
  }

  const geometrie = (l: PdfEditableLine) => ({
    text: l.text,
    left: l.left,
    width: l.width,
    top: l.top,
    height: l.height,
  })

  function lancerConsigne(event: Event) {
    event.preventDefault()
    if (locked || raisonIndispo || !instruction.trim()) return
    // Une proposition en attente — sur cette page ou sur une autre — bloquerait le run
    // suivant, et le champ répondrait par le silence. Une nouvelle consigne remplace
    // l'ancienne proposition : c'est le geste que l'utilisateur vient de faire.
    cancelPdfCorrection()
    // Les lignes que l'utilisateur vient de retoucher à la main sont ÉCARTÉES : le modèle
    // les verrait dans leur ancien texte, proposerait dessus, et sa proposition serait
    // refusée à l'application (« passage déjà modifié ») après avoir été affichée comme
    // valide. Un diff qui ment est pire qu'une proposition en moins.
    const soumises = pageLines.filter((l) => l.editable && !edits[key(l)])
    submitted = soumises
    accepted = {}
    void correctPdfPage({
      path,
      page: pageIndex,
      revision,
      instruction,
      lines: soumises.map(geometrie),
      // TOUTES les lignes de la page, y compris celles qu'on ne peut pas modifier : une
      // cellule voisine non éditable occupe l'espace tout autant, et l'oublier fait
      // repartir le budget de largeur jusqu'à la marge de page.
      geometry: pageLines.map(geometrie),
      // L'identité voyage AVEC le run : un index n'a de sens que par rapport à la liste
      // qui l'a produit.
      targets: soumises.map((l) => ({ page: l.page, occurrence: l.occurrence, text: l.text })),
    })
  }

  /**
   * Applique les corrections retenues AUX OCTETS EN MÉMOIRE, puis recharge le document
   * depuis ces octets : c'est cela, le « rafraîchissement » — on regarde le résultat réel,
   * substitutions de police comprises, pas un aperçu simulé.
   *
   * L'ordre n'est pas négociable : abandonner le rendu en vol, ATTENDRE qu'il ait fini,
   * seulement ensuite détruire l'ancien document. Détruire pendant qu'un `render` tourne
   * fait rejeter la promesse, le `.catch()` l'avale, et le canvas reste sur l'image
   * d'avant — la promesse « ça se rafraîchit » tomberait en silence.
   *
   * Les modifications tapées à la main partent DANS LE MÊME appel : les écarter serait
   * perdre le travail de l'utilisateur, et les garder après coup serait pire — les rangs
   * `occurrence` se renumérotent dès qu'une ligne homonyme change.
   */
  async function appliquer() {
    const cur = runIci
    if (!cur || applying || !bytes || !acceptees.length) return
    applying = true
    message = ''
    try {
      const { applyTextEdits, PdfEditError, readEditableLines } = await import('../lib/export/pdf-edit-text')
      const demandes: PdfEditRequest[] = [
        ...manualRequests(),
        ...acceptees.flatMap((e) => {
          const cible = cur.targets[e.index]
          // Une proposition dont la cible a disparu n'est pas écrite : elle viserait une
          // ligne que l'utilisateur n'a jamais soumise.
          return cible ? [{ page: cible.page, occurrence: cible.occurrence, from: cible.text, to: e.lineAfter }] : []
        }),
      ]
      if (!demandes.length) return
      let rapport: Awaited<ReturnType<typeof applyTextEdits>>
      try {
        rapport = await applyTextEdits(bytes.slice(), demandes)
      } catch (error) {
        message = error instanceof PdfEditError ? error.message : 'Doku n’a pas pu écrire ce PDF.'
        return
      }

      renderAbort?.abort()
      await renderChain
      await destroyPdf?.()
      destroyPdf = null
      pdf = null

      const nouveaux = rapport.bytes
      // Les lignes d'AVANT : c'est leur position qui permettra de retrouver, après
      // rechargement, la ligne exacte d'une saisie refusée — le rang, lui, se renumérote.
      const avant = lines
      try {
        const { loadPdf } = await import('../lib/pdf')
        const charge = await loadPdf(nouveaux.slice())
        // Modale fermée pendant le chargement : on détruit CE document nous-mêmes, le
        // démontage étant déjà passé.
        if (!vivant) {
          void charge.destroy()
          return
        }
        bytes = nouveaux.slice()
        pdf = charge.doc
        destroyPdf = charge.destroy
        pageCount = charge.doc.numPages
        lines = await readEditableLines(nouveaux.slice())
      } catch (error) {
        // Les corrections SONT dans `nouveaux` : les perdre ici serait perdre le travail
        // pour un échec d'affichage. On les garde, on le dit, et on laisse
        // « Enregistrer une copie » disponible — le canvas resterait sinon vide à jamais,
        // sans un mot (`renderPage` sort sur un document nul).
        bytes = nouveaux.slice()
        // `edits` DOIT être vidé : les modifications tapées à la main sont déjà cuites
        // dans `nouveaux`. Les laisser en attente enverrait `save()` les réappliquer, sur
        // des `from` qui n'existent plus — tout serait refusé, `applyTextEdits` jetterait,
        // et AUCUNE copie ne serait écrite. Le message promettrait alors l'inverse de ce
        // qui se passe.
        edits = {}
        accepted = {}
        submitted = []
        revision++
        dirty = true
        perime = true
        console.error('[pdf] rechargement après correction', error)
        // Ne pas dire « les corrections sont écrites » quand une partie ne l'est pas : sur
        // ce chemin les lignes ne sont plus relues, donc les saisies refusées ne peuvent
        // pas être reposées — elles sont perdues, et ça se dit.
        message = rapport.refused.length
          ? `L’aperçu n’a pas pu être rechargé. Les modifications écrites sont conservées — enregistrez une copie. ${rapport.refused.length} n’ont pas pu l’être et sont perdues.`
          : 'Les corrections sont écrites, mais l’aperçu n’a pas pu être rechargé. Enregistrez une copie pour les conserver.'
        cancelPdfCorrection()
        return
      }
      // Les saisies manuelles REFUSÉES n'ont pas été écrites : les effacer perdrait du
      // texte tapé, sans recours. On les repose sur les lignes fraîchement relues — les
      // rangs `occurrence` ayant pu se renuméroter, la clé se reconstruit, elle ne se
      // recopie pas. Celles qui ne retrouvent pas leur ligne sont nommées dans le bandeau
      // plutôt que perdues en silence.
      const { keep, orphans } = repinRefusedEdits(
        manualRequests().map((d) => ({ page: d.page, occurrence: d.occurrence ?? 0, from: d.from, to: d.to })),
        rapport.refused,
        avant,
        lines,
      )
      const rescapes: Record<string, string> = {}
      for (const { line, to } of keep) rescapes[key(line)] = to
      const orphelins = orphans.map((o) => `« ${o.from.slice(0, 24)} » → « ${o.to.slice(0, 24)} »`)
      edits = rescapes
      accepted = {}
      submitted = []
      revision++
      dirty = true
      cancelPdfCorrection()
      void renderPage()

      // On compte les LIGNES demandées, jamais `rapport.applied` : le moteur compte des
      // passages, et une ligne mixte en vaut plusieurs.
      const refuses = rapport.refused.length
      app.banner = {
        tone: refuses ? 'warning' : 'success',
        title: refuses ? 'Corrections partiellement appliquées' : 'Corrections appliquées',
        message: `${demandes.length - refuses} ligne${demandes.length - refuses > 1 ? 's' : ''} sur ${demandes.length} réécrite${demandes.length - refuses > 1 ? 's' : ''} dans le document.` +
          (refuses
            ? ` ${refuses} refusée${refuses > 1 ? 's' : ''} : ${rapport.refused.map((r) => (r.chars?.length ? `« ${r.from.slice(0, 30)} » — caractères absents de la police (${r.chars.join(' ')})` : `« ${r.from.slice(0, 30)} » — ${r.reason}`)).join(' ; ')}.`
            : ' Rien d’autre n’a bougé, et le fichier d’origine est intact.') +
          (orphelins.length
            ? ` Vos saisies ${orphelins.join(', ')} n’ont pas pu être retrouvées après le rechargement — elles sont perdues, les voici pour les retaper.`
            : ''),
      }
    } finally {
      applying = false
    }
  }

  function manualRequests(): PdfEditRequest[] {
    return pending.map(([id, to]) => {
      const premier = id.indexOf(':')
      const second = id.indexOf(':', premier + 1)
      return {
        page: Number(id.slice(0, premier)),
        occurrence: Number(id.slice(premier + 1, second)),
        from: id.slice(second + 1),
        to,
      }
    })
  }

  function edit(line: PdfEditableLine, value: string) {
    const id = key(line)
    // Revenir au texte d'origine efface la modification plutôt que d'enregistrer une
    // écriture inutile.
    edits = value === line.text ? { ...edits, [id]: '' } : { ...edits, [id]: value }
  }

  async function save() {
    if (!bytes || saving || (!pending.length && !dirty)) return
    saving = true
    message = ''
    try {
      const { applyTextEdits, PdfEditError } = await import('../lib/export/pdf-edit-text')
      // « Le document d'origine n'est jamais modifié » est écrit dans le pied de cette
      // modale : c'est au code de le tenir, pas à la retenue de qui clique.
      const ecrire = async (octets: Uint8Array): Promise<boolean> => {
        try {
          return await writeCopy(`${fileName.replace(/\.pdf$/i, '')} — modifié.pdf`, octets, path)
        } catch (error) {
          if (!(error instanceof SourceOverwriteError)) throw error
          message = error.message
          return false
        }
      }
      // Corrections déjà écrites dans les octets en mémoire et rien en attente : il n'y a
      // plus rien à appliquer, seulement à enregistrer. Sans cette branche, le bouton
      // primaire répondait « Aucune modification à appliquer » sur un document pourtant
      // modifié — `applyTextEdits` jette sur une liste vide.
      if (!pending.length) {
        // `.slice()` : toute API qui reçoit un TypedArray et travaille hors du thread est
        // suspecte de TRANSFERT — on garde nos octets si l'utilisateur annule le dialogue
        // et enregistre à nouveau (leçon AGENTS du 2026-08-15, deux fois).
        if (await ecrire(bytes.slice())) {
          dirty = false
          closePdfTextEdit()
        }
        return
      }
      const demandes = manualRequests()
      try {
        const rapport = await applyTextEdits(bytes.slice(), demandes)
        if (!await ecrire(rapport.bytes)) return
        // On dit ce qui n'a PAS été écrit, avec les caractères en cause : un refus tu
        // ferait croire à une modification complète.
        const refus = rapport.refused.length
          ? ` ${rapport.refused.length} non appliquée${rapport.refused.length > 1 ? 's' : ''} : ${rapport.refused.map((r) => r.chars?.length ? `caractères absents (${r.chars.join(' ')})` : r.reason).join(' ; ')}.`
          : ''
        // On compte les LIGNES demandées, jamais `rapport.applied` : le moteur compte des
        // passages réécrits, et une ligne à styles mixtes en vaut plusieurs.
        const ecrites = demandes.length - rapport.refused.length
        app.banner = {
          tone: rapport.refused.length ? 'warning' : 'success',
          title: 'PDF modifié enregistré',
          message: `${ecrites} ligne${ecrites > 1 ? 's' : ''} réécrite${ecrites > 1 ? 's' : ''} dans le document, sans rien changer d’autre.${refus}`,
        }
        // La copie EST écrite, refus ou pas : `dirty` retombe dans les deux cas, sinon un
        // second clic en écrirait une deuxième pour rien. La modale reste ouverte quand
        // il y a des refus, pour qu'ils se lisent.
        dirty = false
        if (!rapport.refused.length) closePdfTextEdit()
      } catch (error) {
        // `applyTextEdits` JETTE quand rien n'a pu être écrit — par exemple une seule
        // saisie manuelle dont un caractère manque à la police. Sans ce repli, des
        // corrections déjà appliquées en mémoire se retrouvaient prises en otage par cette
        // saisie : plus aucune copie n'était écrite, et le seul moyen de les sauver était
        // de retaper à l'identique le texte d'origine pour vider la ligne en attente.
        if (dirty && error instanceof PdfEditError) {
          if (!(await ecrire(bytes.slice()))) return
          app.banner = {
            tone: 'warning',
            title: 'PDF modifié enregistré',
            message: `Les corrections déjà appliquées ont été enregistrées. Vos ${pending.length} saisie${pending.length > 1 ? 's' : ''} en attente n’ont pas pu être écrite${pending.length > 1 ? 's' : ''} : ${error.message}`,
          }
          dirty = false
          return
        }
        message = error instanceof PdfEditError ? error.message : 'Doku n’a pas pu écrire ce PDF.'
      }
    } finally {
      saving = false
    }
  }

  // Fermeture alors que des octets réécrits ne sont pas enregistrés. `onclose` arrive APRÈS
  // la fermeture et n'est pas annulable : c'est `oncancel` (Échap) qu'il faut intercepter,
  // et les boutons qu'il faut garder séparément.
  const nonEnregistre = $derived(dirty || pending.length > 0)

  async function fermer() {
    // Fermer au milieu d'une application laisserait la séquence écrire dans un composant
    // démonté. Elle dure quelques secondes et verrouille déjà le reste de la modale.
    if (applying) return
    if (!nonEnregistre) {
      closePdfTextEdit()
      return
    }
    const choix = await askSave(
      'Enregistrer une copie ?',
      dirty
        ? 'Des corrections ont été appliquées au document mais ne sont pas encore enregistrées. Le fichier d’origine, lui, est intact.'
        : 'Des modifications sont en attente et n’ont pas été écrites.',
    )
    if (choix === 'cancel') return
    if (choix === 'save') {
      await save()
      return
    }
    dirty = false
    closePdfTextEdit()
  }

  // Échap : `onclose` arrive APRÈS la fermeture et n'est pas annulable — c'est `oncancel`
  // qu'il faut intercepter. On annule TOUJOURS l'événement natif quand il reste du travail,
  // puis on pose la question de façon asynchrone.
  function surEchap(event: Event) {
    if (!applying && !nonEnregistre) return
    event.preventDefault()
    void fermer()
  }
</script>

<dialog class="pdftext" bind:this={dlg} onclose={closePdfTextEdit} oncancel={surEchap} aria-label="Modifier le texte du PDF">
  <div class="window">
    <header>
      <span class="title-icon" aria-hidden="true"><span class="msr">edit_document</span></span>
      <div class="title">
        <h2>Modifier le texte</h2>
        <p>{fileName}</p>
      </div>
      <span class="spacer"></span>
      <button class="close" aria-label="Fermer" disabled={applying} onclick={() => void fermer()}><span class="msr">close</span></button>
    </header>

    <div class="tools">
      <button class="icon-button" disabled={pageIndex <= 1 || locked} onclick={() => pageIndex--} aria-label="Page précédente"><span class="msr">chevron_left</span></button>
      <span class="pageno">{pageIndex} / {pageCount || '…'}</span>
      {#if rendering}<span class="rendering" role="status">rendu…</span>{/if}
      <button class="icon-button" disabled={pageIndex >= pageCount || locked} onclick={() => pageIndex++} aria-label="Page suivante"><span class="msr">chevron_right</span></button>
      <span class="spacer"></span>
      <span class="summary">
        {#if pending.length}
          {pending.length} modification{pending.length > 1 ? 's' : ''} en attente
        {:else if dirty}
          Corrections appliquées — pas encore enregistrées
        {:else}
          Cliquez sur une ligne pour la modifier
        {/if}
      </span>
    </div>

    {#if status === 'ready'}
      <form class="consigne" onsubmit={lancerConsigne}>
        <span class="consigne-icon" aria-hidden="true"><span class="msr">auto_awesome</span></span>
        <input
          class="consigne-field"
          bind:value={instruction}
          disabled={locked || !!raisonIndispo}
          type="text"
          maxlength="400"
          autocomplete="off"
          placeholder={raisonIndispo || 'Corrige les fautes de cette page…'}
          aria-label="Consigne de correction pour Doku-San"
        />
        {#if streaming}
          <button class="consigne-stop" type="button" onclick={cancelPdfCorrection}>Arrêter</button>
        {:else}
          <button class="consigne-send" type="submit" disabled={locked || !!raisonIndispo || !instruction.trim()} aria-label="Envoyer la consigne">
            <span class="msr">arrow_upward</span>
          </button>
        {/if}
      </form>
      {#if streaming}
        <p class="consigne-note" role="status">Doku-San lit les {submitted.length} lignes de la page…</p>
      {:else if !raisonIndispo}
        <p class="consigne-note">La page part chez votre fournisseur cloud. Rien n’est écrit sans votre accord.</p>
      {/if}
    {/if}

    {#if runIci && runIci.phase !== 'streaming'}
      <div class="propositions" role="group" aria-label="Corrections proposées">
        {#if runIci.phase === 'ready'}
          {#if propositions.length}
            <p class="propositions-head">
              {propositions.length} correction{propositions.length > 1 ? 's' : ''} proposée{propositions.length > 1 ? 's' : ''} — décochez ce que vous refusez.
            </p>
            <ul class="propositions-list">
              {#each propositions as e (e.index)}
                <li>
                  <label>
                    <input type="checkbox" checked={accepted[e.index] !== false} onchange={(ev) => (accepted = { ...accepted, [e.index]: ev.currentTarget.checked })} />
                    <span class="prop-ligne">{lineLabel(e.index)}</span>
                    <span class="prop-diff">
                      <!-- Le contexte n'est pas décoratif : deux corrections identiques sur
                           deux cellules différentes s'afficheraient sinon EXACTEMENT pareil,
                           et l'on accepterait sans pouvoir situer ce qu'on accepte. -->
                      <span class="prop-ctx">{revealInvisibles(e.before)}</span>
                      {#each diffWords(e.find, e.to) as seg}
                        {#if seg.kind === 'same'}<span>{revealInvisibles(seg.text)}</span>
                        {:else if seg.kind === 'del'}<del>{revealInvisibles(seg.text)}</del>
                        {:else}<ins>{revealInvisibles(seg.text)}</ins>{/if}
                      {/each}
                      <span class="prop-ctx">{revealInvisibles(e.after)}</span>
                    </span>
                    {#if e.widens}<span class="prop-tag warn" title="La ligne va s’élargir — elle reste dans la place disponible, mais vérifiez le rendu">s’élargit</span>{/if}
                    {#if e.normalized}<span class="prop-tag" title="Apostrophes, guillemets ou espaces alignés sur ceux du document">typographie alignée</span>{/if}
                  </label>
                </li>
              {/each}
            </ul>
          {:else}
            <p class="propositions-head">Doku-San n’a rien trouvé à corriger sur cette page avec cette consigne.</p>
          {/if}
          {#if runIci.dropped.length}
            <!-- Plafonné : une réponse aberrante avec deux cents entrées pousserait la
                 feuille hors de l'écran. Le nombre total reste dit. -->
            <p class="propositions-drop">
              {runIci.dropped.length} proposition{runIci.dropped.length > 1 ? 's' : ''} écartée{runIci.dropped.length > 1 ? 's' : ''} :
              {runIci.dropped.slice(0, 8).map((d) => `${d.label} — ${d.reason}`).join(' ; ')}{runIci.dropped.length > 8 ? `, et ${runIci.dropped.length - 8} autre${runIci.dropped.length - 8 > 1 ? 's' : ''}` : ''}.
            </p>
          {/if}
          {#if propositions.length}
            <div class="propositions-actions">
              <button onclick={cancelPdfCorrection} disabled={applying}>Tout refuser</button>
              <!-- Le libellé dit ce qui sera RÉELLEMENT écrit : les saisies manuelles en
                   attente partent dans le même appel, sur toutes les pages. -->
              <button class="primary" onclick={() => void appliquer()} disabled={applying || !acceptees.length}>
                {#if applying}Application…
                {:else if pending.length}Appliquer {acceptees.length} correction{acceptees.length > 1 ? 's' : ''} + {pending.length} saisie{pending.length > 1 ? 's' : ''}
                {:else}Appliquer {acceptees.length} correction{acceptees.length > 1 ? 's' : ''}{/if}
              </button>
            </div>
          {:else}
            <div class="propositions-actions">
              <button onclick={cancelPdfCorrection}>Fermer</button>
            </div>
          {/if}
        {:else}
          <p class="propositions-head error">{runIci.error}</p>
          <div class="propositions-actions">
            <button onclick={cancelPdfCorrection}>Fermer</button>
          </div>
        {/if}
      </div>
    {/if}

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
            class:locked={!line.editable || perime || applying}
            readonly={!line.editable || perime || applying}
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
      <button disabled={applying} onclick={() => void fermer()}>Annuler</button>
      <button class="primary" disabled={(!pending.length && !dirty) || saving || applying} onclick={() => void save()}>
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

  /* Consigne : même gouttière de 18 px que l'en-tête, la barre d'outils et le pied. Le
     champ emprunte la grammaire du composeur du copilote (surface posée, bouton d'envoi
     rond à l'encre) — c'est le même geste ailleurs dans l'app. */
  .consigne {
    flex: 0 0 auto;
    margin: 0 18px 6px;
    padding: 3px 3px 3px 10px;
    display: flex;
    align-items: center;
    gap: 6px;
    border-radius: 12px;
    background: var(--composer-bg);
    box-shadow: inset 0 0 0 1px var(--line-1);
    transition: box-shadow 140ms ease;
  }
  .consigne:focus-within { box-shadow: inset 0 0 0 1px var(--line-3); }
  .consigne-icon { display: inline-flex; color: var(--ink-4); }
  .consigne-icon .msr { font-size: 16px; }
  .consigne-field {
    flex: 1;
    min-width: 0;
    height: 30px;
    border: 0;
    padding: 0;
    background: none;
    color: var(--ink);
    font: inherit;
    font-size: 12.5px;
  }
  .consigne-field:focus { outline: none; }
  .consigne-field::placeholder { color: var(--ink-4); }
  .consigne-field:disabled { color: var(--ink-4); cursor: default; }
  .consigne-send {
    flex: none;
    width: 28px; height: 28px;
    display: inline-flex; align-items: center; justify-content: center;
    border: 0; border-radius: 50%;
    background: var(--ink); color: var(--cream-content);
    cursor: pointer;
    transition: background-color 140ms ease, opacity 140ms ease, transform 100ms ease;
  }
  .consigne-send .msr { font-size: 17px; }
  .consigne-send:hover:not(:disabled) { background: var(--ink-2); }
  .consigne-send:active:not(:disabled) { transform: scale(0.92); }
  .consigne-send:disabled { opacity: 0.35; cursor: default; }
  .consigne-stop {
    flex: none; height: 28px; padding: 0 12px;
    border: 0; border-radius: 999px;
    background: var(--accent-soft); color: var(--ink-2);
    font: inherit; font-size: 12px; font-weight: 500; cursor: pointer;
  }
  .consigne-note { margin: 0; padding: 0 18px 8px; font-size: 11px; color: var(--ink-5); }

  /* Propositions : une liste dense, jamais une carte par correction — douze cartes
     empilées ne se relisent pas, et c'est la relecture qui est la vraie garantie ici. */
  /* Seule LA LISTE défile. Les refus et les boutons restent visibles quoi qu'il arrive :
     un refus caché sous la ligne de flottaison est un refus tu, et c'est précisément ce
     que ce panneau existe pour empêcher. */
  .propositions {
    flex: 0 0 auto;
    display: flex;
    flex-direction: column;
    min-height: 0;
    margin: 0 18px 8px;
    padding: 8px 10px;
    border-radius: 12px;
    background: var(--surface-2);
  }
  .propositions-head { flex: none; margin: 0 0 6px; font-size: 11.5px; color: var(--ink-3); }
  .propositions-head.error { color: var(--err-text); }
  .propositions-drop { flex: none; margin: 6px 0 0; font-size: 11px; line-height: 1.5; color: var(--ink-4); }
  .propositions-list {
    flex: 0 1 auto;
    min-height: 0;
    max-height: 30vh;
    overflow-y: auto;
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .propositions-list label {
    display: flex; align-items: baseline; gap: 8px;
    padding: 4px 6px; border-radius: 8px; cursor: pointer;
  }
  .propositions-list label:hover { background: var(--surface-hover); }
  .prop-ligne {
    flex: none;
    font-family: var(--font-mono); font-size: 10.5px; color: var(--ink-5);
    font-variant-numeric: tabular-nums;
  }
  .prop-diff { flex: 1; min-width: 0; font-size: 12.5px; line-height: 1.5; word-break: break-word; }
  /* Barré/surligné empruntés à l'aperçu de reformulation : le même geste (proposer,
     accepter, refuser) doit se lire de la même façon partout dans Doku. */
  .prop-diff del { text-decoration: line-through; color: var(--err-text); opacity: 0.75; }
  .prop-diff del { margin-right: 2px; }
  .prop-diff ins { text-decoration: none; padding: 0 2px; background: var(--accent-soft); border-radius: 3px; }
  /* Le contexte est là pour SITUER, pas pour se lire : il s'efface derrière le changement. */
  .prop-ctx { color: var(--ink-5); }
  .prop-tag { flex: none; font-size: 10px; color: var(--ink-5); }
  .prop-tag.warn { color: var(--warn-text); }
  .propositions-actions { flex: none; display: flex; justify-content: flex-end; gap: 6px; margin-top: 8px; }
  .propositions-actions button {
    height: 30px; padding: 0 14px;
    border: 0; border-radius: 999px; background: transparent; color: var(--ink-3);
    font: inherit; font-size: 12px; font-weight: 500; cursor: pointer;
    transition: background-color 140ms ease, color 140ms ease;
  }
  .propositions-actions button:hover:not(:disabled) { background: var(--surface-hover); color: var(--ink); }
  .propositions-actions .primary { background: var(--ink); color: var(--cream-content); }
  .propositions-actions .primary:hover:not(:disabled) { background: var(--ink-2); color: var(--cream-content); }
  .propositions-actions button:disabled { opacity: 0.4; cursor: default; }

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
    .line, .close, .icon-button, footer button,
    .consigne, .consigne-send, .propositions-actions button { transition: none !important; }
    .close:active, .icon-button:active, footer button:active, .consigne-send:active { transform: none; }
  }
</style>
