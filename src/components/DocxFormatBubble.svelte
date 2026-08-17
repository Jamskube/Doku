<script lang="ts">
  // Mise en forme d'un DOCX : une bulle qui n'apparaît QUE sur une sélection.
  //
  // La barre permanente de SuperDoc — 21 outils repliés sur trois rangées, en anglais,
  // dans son propre style — contredisait deux règles nommées de la D.A. : « le document
  // est le composant signature, sans barre d'outils persistante ; les affordances
  // d'édition apparaissent au survol ou au focus », et le Don't « pas de barres d'outils
  // denses, pas de cockpit ».
  //
  // Rien n'est réimplémenté pour autant. SuperDoc publie une surface d'observation et de
  // commande (`superdoc.ui`) que sa PROPRE barre consomme — « command state never
  // diverges between built-in and custom UI ». On dessine donc la surface, pas le moteur.
  //
  // Deux découvertes faites au banc, qui déterminent toute la mécanique :
  //  1. `document.getSelection()` est VIDE pendant une sélection SuperDoc — il peint sa
  //     propre couche. Impossible d'ancrer la bulle comme on le ferait ailleurs ; le
  //     repère est `ui.selection.getAnchorRect()`.
  //  2. L'état d'une commande porte un `reason` (`range-selection-required`,
  //     `history-empty`…) : un outil inerte peut donc DIRE pourquoi, au lieu d'être
  //     grisé sans explication (règle « branché ou retiré, jamais muet »).
  import { onMount } from 'svelte'

  interface EtatCommande {
    enabled?: boolean
    disabled?: boolean
    active?: boolean
    supported?: boolean
    reason?: string
    value?: unknown
  }
  interface PoigneeCommande {
    execute: (payload?: unknown) => Promise<boolean | void>
    getState: () => EtatCommande
    observe: (cb: (etat: EtatCommande) => void) => () => void
  }
  interface StyleParagraphe {
    id: string
    name: string
    preview?: { css?: Record<string, string> }
  }
  interface SurfaceUi {
    commands: { get: (id: string) => PoigneeCommande }
    selection: {
      get: () => { status?: string; empty?: boolean }
      observe: (cb: () => void) => () => void
      getAnchorRect: () => { left: number; top: number; width: number; height: number } | null
    }
    styles: { get: () => { quickGallery?: StyleParagraphe[]; activeParagraphStyleName?: string; activeParagraphStyleId?: string } }
  }

  let { superdoc, container }: { superdoc: { ui?: SurfaceUi } | null; container: HTMLElement | undefined } = $props()

  let visible = $state(false)
  let x = $state(0)
  let y = $state(0)
  let dessous = $state(false)
  let bulleEl: HTMLElement | undefined = $state()
  let largeurBulle = $state(0)
  let hauteurBulle = $state(0)
  let palette = $state(false)
  let menuStyles = $state(false)
  // Minuterie du délai de grâce avant de refermer la bulle.
  let fermeture: number | null = null

  // État courant de chaque commande affichée, relu à chaque changement de sélection.
  let etats = $state<Record<string, EtatCommande>>({})
  let styleCourant = $state('Normal')
  let galerie = $state<StyleParagraphe[]>([])

  const ui = $derived(superdoc?.ui ?? null)

  // Les libellés sont en FRANÇAIS : la barre d'origine était en anglais au milieu d'une
  // application entièrement française.
  const CARACTERE = [
    { id: 'bold', label: 'Gras', icone: 'format_bold' },
    { id: 'italic', label: 'Italique', icone: 'format_italic' },
    { id: 'underline', label: 'Souligné', icone: 'format_underlined' },
    { id: 'strikethrough', label: 'Barré', icone: 'format_strikethrough' },
  ]
  const LISTES = [
    { id: 'bullet-list', label: 'Liste à puces', icone: 'format_list_bulleted' },
    { id: 'numbered-list', label: 'Liste numérotée', icone: 'format_list_numbered' },
  ]
  const ALIGNEMENTS = [
    { valeur: 'left', label: 'Aligner à gauche', icone: 'format_align_left' },
    { valeur: 'center', label: 'Centrer', icone: 'format_align_center' },
    { valeur: 'right', label: 'Aligner à droite', icone: 'format_align_right' },
    { valeur: 'justify', label: 'Justifier', icone: 'format_align_justify' },
  ]
  const RETRAITS = [
    { id: 'indent-decrease', label: 'Diminuer le retrait', icone: 'format_indent_decrease' },
    { id: 'indent-increase', label: 'Augmenter le retrait', icone: 'format_indent_increase' },
  ]
  // Couleurs de DOCUMENT : elles atterrissent dans le fichier, pas dans le mobilier de
  // Doku. Elles sont donc écrites en dur et ne suivent pas le thème — un texte mis en
  // « encre » ne doit pas devenir blanc parce que l'utilisateur passe en thème sombre.
  // Même raisonnement que la feuille blanche de la modale PDF.
  const COULEURS_TEXTE = [
    { valeur: '#000000', label: 'Noir' },
    { valeur: '#595959', label: 'Gris' },
    { valeur: '#B51D2A', label: 'Rouge' },
    { valeur: '#B26B00', label: 'Orange' },
    { valeur: '#2E7D46', label: 'Vert' },
    { valeur: '#2E74B5', label: 'Bleu' },
    { valeur: '#6B3FA0', label: 'Violet' },
  ]
  const COULEURS_SURLIGNAGE = [
    { valeur: 'none', label: 'Aucun' },
    { valeur: '#FFF3A3', label: 'Jaune' },
    { valeur: '#C7F0CC', label: 'Vert' },
    { valeur: '#CFE4FB', label: 'Bleu' },
    { valeur: '#FBD3E0', label: 'Rose' },
  ]

  const SUIVIES = [...CARACTERE, ...LISTES, ...RETRAITS, { id: 'link', label: 'Lien', icone: 'link' },
    { id: 'text-color', label: 'Couleur du texte', icone: 'format_color_text' },
    { id: 'highlight-color', label: 'Surlignage', icone: 'ink_highlighter' },
    { id: 'text-align', label: 'Alignement', icone: 'format_align_left' },
    { id: 'clear-formatting', label: 'Effacer la mise en forme', icone: 'format_clear' },
    { id: 'table-insert', label: 'Tableau', icone: 'table' }]

  // Traduction des raisons d'indisponibilité : un outil inerte doit dire pourquoi.
  function raisonLisible(etat: EtatCommande | undefined): string {
    if (!etat || (!etat.disabled && etat.enabled !== false)) return ''
    if (etat.supported === false) return 'Ce document ne prend pas en charge cette action.'
    switch (etat.reason) {
      case 'range-selection-required':
      case 'selection-required': return 'Sélectionnez du texte pour l’appliquer.'
      case 'history-empty': return 'Rien à annuler.'
      default: return 'Indisponible sur cette sélection.'
    }
  }

  function etatDe(id: string): EtatCommande {
    return etats[id] ?? {}
  }

  async function lancer(id: string, payload?: unknown) {
    if (!ui) return
    try {
      await ui.commands.get(id).execute(payload)
    } catch {
      // Une commande qui refuse ne doit pas emporter la bulle avec elle.
    }
    relireEtats()
  }

  function relireEtats() {
    if (!ui) return
    const suivant: Record<string, EtatCommande> = {}
    for (const { id } of SUIVIES) {
      try {
        suivant[id] = ui.commands.get(id).getState()
      } catch {
        suivant[id] = { supported: false }
      }
    }
    etats = suivant
    try {
      const s = ui.styles.get()
      galerie = (s.quickGallery ?? []).filter((st) => /^(Normal|Title|Subtitle|Heading[1-3])$/.test(st.id))
      styleCourant = s.activeParagraphStyleName ?? 'Normal'
    } catch {
      galerie = []
    }
  }

  // Taille de l'aperçu « Aa ». Recopier la taille RÉELLE du style (28 pt pour « Titre »)
  // faisait déborder l'aperçu de sa colonne et chevaucher le libellé. On garde la
  // hiérarchie — un titre reste visiblement plus gros qu'un corps de texte — en la
  // repliant dans une plage tenable.
  const MIN_APERCU = 11
  const MAX_APERCU = 19
  function tailleApercu(css: Record<string, string> | undefined): string {
    const pt = Number.parseFloat(css?.fontSize ?? '')
    if (!Number.isFinite(pt) || pt <= 0) return `${MIN_APERCU + 2}px`
    // 10 pt (corps) → plancher ; 28 pt (Titre) → plafond ; linéaire entre les deux.
    const part = Math.min(Math.max((pt - 10) / (28 - 10), 0), 1)
    return `${Math.round(MIN_APERCU + part * (MAX_APERCU - MIN_APERCU))}px`
  }

  // Nom français des styles Word, qui arrivent en anglais du modèle OOXML.
  const NOMS: Record<string, string> = {
    Normal: 'Normal', Title: 'Titre', Subtitle: 'Sous-titre',
    Heading1: 'Titre 1', Heading2: 'Titre 2', Heading3: 'Titre 3',
  }
  const nomStyle = (s: StyleParagraphe) => NOMS[s.id] ?? s.name
  const styleCourantLisible = $derived(NOMS[styleCourant.replace(/\s/g, '')] ?? styleCourant)

  // Dernier repère connu. Le garder en état permet de REPLACER la bulle quand sa taille
  // devient enfin mesurable, sans attendre une nouvelle sélection.
  let ancre = $state.raw<{ left: number; top: number; width: number; height: number } | null>(null)

  function placer() {
    if (!ui || !container || !ancre) return
    const cadre = container.getBoundingClientRect()
    const marge = 10
    // Coordonnées EXPRIMÉES DANS LE CADRE de la vue : la bulle est un enfant absolu de
    // `.docx-view`, pas un élément fixe. Un `position: fixed` serait capturé par le
    // moindre `transform` d'ancêtre — piège déjà payé sur le panneau copilote.
    const centre = ancre.left + ancre.width / 2 - cadre.left
    const haut = ancre.top - cadre.top
    dessous = haut - hauteurBulle - marge < 0
    y = dessous ? haut + ancre.height + marge : haut - hauteurBulle - marge
    x = Math.min(Math.max(centre - largeurBulle / 2, 8), Math.max(8, cadre.width - largeurBulle - 8))
    visible = true
  }

  onMount(() => {
    let stop: (() => void) | null = null
    let armé = true
    const brancher = () => {
      if (!armé || !ui) return
      stop = ui.selection.observe(() => {
        const sel = ui.selection.get()
        if (sel.status !== 'ready' || sel.empty) {
          // DÉLAI DE GRÂCE, pas un raffinement : appliquer une commande fait passer la
          // sélection par un état vide fugace. Sans ce sursis, la bulle se refermait à
          // chaque couleur posée — on ne pouvait pas en essayer deux de suite — et
          // clignotait pendant la frappe.
          if (fermeture === null) {
            fermeture = window.setTimeout(() => {
              fermeture = null
              visible = false
              palette = false
              menuStyles = false
            }, 180)
          }
          return
        }
        if (fermeture !== null) { clearTimeout(fermeture); fermeture = null }
        relireEtats()
        ancre = ui.selection.getAnchorRect()
        if (!ancre) { visible = false; return }
        visible = true
      })
    }
    brancher()
    const surScroll = () => {
      if (!visible || !ui) return
      ancre = ui.selection.getAnchorRect()
      placer()
    }
    window.addEventListener('scroll', surScroll, true)
    window.addEventListener('resize', surScroll)
    return () => {
      armé = false
      stop?.()
      window.removeEventListener('scroll', surScroll, true)
      window.removeEventListener('resize', surScroll)
    }
  })

  // Un changement d'instance (autre document ouvert) doit rebrancher l'observation.
  $effect(() => {
    if (!ui) { visible = false; return }
    relireEtats()
  })

  // Replacement dès que la taille RÉELLE de la bulle est connue. Sans cet effet, le
  // premier calcul se faisait sur une largeur et une hauteur de zéro — la bulle
  // atterrissait dans le coin haut-gauche au lieu de coiffer la sélection. Les
  // dimensions ne sont mesurables qu'après le rendu, et l'ouverture d'un volet les
  // change encore.
  $effect(() => {
    void ancre
    void largeurBulle
    void hauteurBulle
    void palette
    void menuStyles
    if (visible) placer()
  })
</script>

{#if visible}
  <div
    class="bulle"
    class:dessous
    bind:this={bulleEl}
    bind:clientWidth={largeurBulle}
    bind:clientHeight={hauteurBulle}
    style:left="{x}px"
    style:top="{y}px"
    role="toolbar"
    aria-label="Mise en forme"
  >
    <div class="rangee">
      <button
        class="style"
        aria-haspopup="menu"
        aria-expanded={menuStyles}
        onclick={() => { menuStyles = !menuStyles; palette = false }}
      >
        <span class="nom">{styleCourantLisible}</span>
        <span class="msr fleche">expand_more</span>
      </button>

      <span class="sep"></span>

      {#each CARACTERE as outil (outil.id)}
        {@const etat = etatDe(outil.id)}
        <button
          class="outil"
          class:actif={etat.active}
          title={raisonLisible(etat) || outil.label}
          aria-label={outil.label}
          aria-pressed={!!etat.active}
          onclick={() => void lancer(outil.id)}
        >
          <span class="msr">{outil.icone}</span>
        </button>
      {/each}

      <span class="sep"></span>

      {#each LISTES as outil (outil.id)}
        {@const etat = etatDe(outil.id)}
        <button
          class="outil"
          class:actif={etat.active}
          title={raisonLisible(etat) || outil.label}
          aria-label={outil.label}
          aria-pressed={!!etat.active}
          onclick={() => void lancer(outil.id)}
        >
          <span class="msr">{outil.icone}</span>
        </button>
      {/each}

      <button
        class="outil"
        title={raisonLisible(etatDe('link')) || 'Lien'}
        aria-label="Lien"
        onclick={() => void lancer('link')}
      >
        <span class="msr">link</span>
      </button>

      <span class="sep"></span>

      <button
        class="outil"
        class:actif={palette}
        aria-haspopup="menu"
        aria-expanded={palette}
        title="Plus d’outils"
        aria-label="Plus d’outils"
        onclick={() => { palette = !palette; menuStyles = false }}
      >
        <span class="msr">more_horiz</span>
      </button>
    </div>

    {#if menuStyles}
      <div class="volet styles" role="menu">
        {#each galerie as st (st.id)}
          <button
            role="menuitem"
            class:coche={nomStyle(st) === styleCourantLisible}
            onclick={() => { void lancer('linked-style', { styleId: st.id }); menuStyles = false }}
          >
            <span class="apercu" style:font-size={tailleApercu(st.preview?.css)} style:font-weight={st.preview?.css?.fontWeight}>Aa</span>
            <span>{nomStyle(st)}</span>
          </button>
        {/each}
      </div>
    {/if}

    {#if palette}
      <div class="volet palette" role="menu">
        <div class="groupe">
          <span class="titre-groupe">Couleur du texte</span>
          <div class="ligne">
            {#each COULEURS_TEXTE as c (c.valeur)}
              <button
                role="menuitem"
                class="pastille"
                class:choisie={etatDe('text-color').value === c.valeur}
                title={c.label}
                aria-label="Couleur du texte : {c.label}"
                onclick={() => void lancer('text-color', c.valeur)}
              >
                <span class="teinte" style:background={c.valeur}></span>
              </button>
            {/each}
          </div>
        </div>
        <div class="groupe">
          <span class="titre-groupe">Surlignage</span>
          <div class="ligne">
            {#each COULEURS_SURLIGNAGE as c (c.valeur)}
              <button
                role="menuitem"
                class="pastille"
                class:choisie={etatDe('highlight-color').value === c.valeur}
                title={c.label}
                aria-label="Surlignage : {c.label}"
                onclick={() => void lancer('highlight-color', c.valeur)}
              >
                {#if c.valeur === 'none'}
                  <span class="teinte aucune"><span class="msr">format_color_reset</span></span>
                {:else}
                  <span class="teinte" style:background={c.valeur}></span>
                {/if}
              </button>
            {/each}
          </div>
        </div>
        <div class="groupe">
          <span class="titre-groupe">Paragraphe</span>
          <div class="ligne">
            {#each ALIGNEMENTS as a (a.valeur)}
              <button
                role="menuitem"
                class="outil"
                class:actif={etatDe('text-align').value === a.valeur}
                title={a.label}
                aria-label={a.label}
                onclick={() => void lancer('text-align', a.valeur)}
              >
                <span class="msr">{a.icone}</span>
              </button>
            {/each}
            {#each RETRAITS as r (r.id)}
              <button role="menuitem" class="outil" title={raisonLisible(etatDe(r.id)) || r.label} aria-label={r.label} onclick={() => void lancer(r.id)}>
                <span class="msr">{r.icone}</span>
              </button>
            {/each}
          </div>
        </div>
        <div class="groupe">
          <span class="titre-groupe">Insérer</span>
          <div class="ligne">
            <button role="menuitem" class="outil" title="Tableau" aria-label="Tableau" onclick={() => void lancer('table-insert')}>
              <span class="msr">table</span>
            </button>
            <button role="menuitem" class="outil" title="Image" aria-label="Image" onclick={() => void lancer('image')}>
              <span class="msr">image</span>
            </button>
          </div>
        </div>
        <div class="groupe">
          <button role="menuitem" class="large" title={raisonLisible(etatDe('clear-formatting')) || 'Effacer la mise en forme'} onclick={() => void lancer('clear-formatting')}>
            <span class="msr">format_clear</span><span>Effacer la mise en forme</span>
          </button>
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  /* Vocabulaire des menus flottants du système : papier teinté, rayon 13–14px, 6px de
     padding, ombre ambiante — jamais un contour dur. */
  .bulle {
    position: absolute;
    z-index: 40;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 5px;
    border-radius: 13px;
    background: var(--cream-tint);
    box-shadow:
      0 0 0 1px var(--elevation-ring),
      0 12px 30px rgba(var(--shadow-rgb), 0.18);
    animation: bulle-in 130ms cubic-bezier(0.22, 1, 0.36, 1);
  }
  @keyframes bulle-in {
    from { opacity: 0; transform: translateY(4px) scale(0.97); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }
  .bulle.dessous { animation-name: bulle-in-dessous; }
  @keyframes bulle-in-dessous {
    from { opacity: 0; transform: translateY(-4px) scale(0.97); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }

  .rangee { display: flex; align-items: center; gap: 2px; }
  .sep { width: 1px; height: 18px; margin: 0 3px; background: var(--line-2); }

  .outil, .style {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    height: 30px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--ink-3);
    font: inherit;
    font-size: 12.5px;
    font-weight: 500;
    cursor: pointer;
    transition: background-color 120ms ease, color 120ms ease;
  }
  .outil { width: 30px; }
  .style { padding: 0 6px 0 9px; min-width: 84px; justify-content: space-between; }
  .style .nom { white-space: nowrap; }
  .style .fleche { font-size: 16px; color: var(--ink-5); }
  .outil:hover, .style:hover { background: var(--surface-hover); color: var(--ink); }
  /* L'état ACTIF est une encre pleine sur fond tonal — pas une couleur d'accent : le
     système réserve la couleur aux statuts sémantiques. */
  .outil.actif { background: var(--cream-base); color: var(--ink); box-shadow: 0 1px 4px rgba(var(--shadow-rgb), 0.12); }
  .outil .msr { font-size: 18px; }
  .outil:focus-visible, .style:focus-visible { outline: 2px solid var(--line-3); outline-offset: 1px; }

  .volet {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 6px;
    border-radius: 10px;
    background: var(--cream-base);
    box-shadow: 0 0 0 1px var(--elevation-ring-soft);
  }
  .volet button {
    display: flex;
    align-items: center;
    gap: 9px;
    min-height: 32px;
    padding: 0 9px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--ink-3);
    font: inherit;
    font-size: 12.5px;
    font-weight: 500;
    text-align: left;
    cursor: pointer;
  }
  .volet button:hover { background: var(--surface-hover); color: var(--ink); }
  .styles button.coche { background: var(--cream-tint); color: var(--ink); }
  /* L'aperçu montre le style plutôt que de le nommer deux fois. Colonne à largeur FIXE
     et hauteur de ligne neutralisée : c'est ce qui garantit que la ligne ne bouge pas
     d'un style à l'autre et que rien ne déborde sur le libellé. */
  .styles button { min-height: 34px; }
  .apercu {
    flex: none;
    width: 32px;
    color: var(--ink-4);
    line-height: 1;
    text-align: center;
    overflow: hidden;
  }

  /* Pastilles de couleur : la teinte EST l'étiquette, on ne la nomme pas deux fois. */
  .pastille {
    width: 26px; height: 26px; padding: 0;
    display: inline-flex; align-items: center; justify-content: center;
    border: 0; border-radius: 8px; background: transparent; cursor: pointer;
  }
  .pastille:hover { background: var(--surface-hover); }
  .pastille .teinte {
    width: 16px; height: 16px; border-radius: 5px;
    box-shadow: inset 0 0 0 1px rgba(28, 26, 22, 0.22);
  }
  .pastille .teinte.aucune {
    display: inline-flex; align-items: center; justify-content: center;
    background: var(--cream-content); color: var(--ink-5);
  }
  .pastille .teinte.aucune .msr { font-size: 13px; }
  .pastille.choisie { background: var(--cream-tint); box-shadow: 0 0 0 1px var(--line-2); }
  .pastille:focus-visible { outline: 2px solid var(--line-3); outline-offset: 1px; }

  .groupe { display: flex; flex-direction: column; gap: 3px; }
  .titre-groupe { padding: 0 4px; font-size: 10.5px; font-weight: 600; color: var(--ink-5); }
  .ligne { display: flex; align-items: center; gap: 2px; }
  .ligne .outil { width: 30px; padding: 0; }
  .volet .large { width: 100%; }

  @media (prefers-reduced-motion: reduce) {
    .bulle { animation: none; }
    .outil, .style { transition: none; }
  }
</style>
