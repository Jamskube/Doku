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
  import { tooltip } from '../lib/tooltip'

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
  let origineX = $state(0)
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
    { id: 'bold', label: 'Gras', icone: 'bold' },
    { id: 'italic', label: 'Italique', icone: 'italic' },
    { id: 'underline', label: 'Souligné', icone: 'underline' },
    { id: 'strikethrough', label: 'Barré', icone: 'strikethrough' },
  ]
  const LISTES = [
    { id: 'bullet-list', label: 'Liste à puces', icone: 'list' },
    { id: 'numbered-list', label: 'Liste numérotée', icone: 'list-ordered' },
  ]
  const ALIGNEMENTS = [
    { valeur: 'left', label: 'Aligner à gauche', icone: 'text-align-start' },
    { valeur: 'center', label: 'Centrer', icone: 'text-align-center' },
    { valeur: 'right', label: 'Aligner à droite', icone: 'text-align-end' },
    { valeur: 'justify', label: 'Justifier', icone: 'text-align-justify' },
  ]
  const RETRAITS = [
    { id: 'indent-decrease', label: 'Diminuer le retrait', icone: 'list-indent-decrease' },
    { id: 'indent-increase', label: 'Augmenter le retrait', icone: 'list-indent-increase' },
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
    { id: 'text-color', label: 'Couleur du texte', icone: 'baseline' },
    { id: 'highlight-color', label: 'Surlignage', icone: 'highlighter' },
    { id: 'text-align', label: 'Alignement', icone: 'text-align-start' },
    { id: 'clear-formatting', label: 'Effacer la mise en forme', icone: 'remove-formatting' },
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
    // Même quand le bord a repoussé la bulle, elle grandit depuis la sélection.
    origineX = Math.min(Math.max(centre - x, 0), largeurBulle)
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
    bind:this={bulleEl}
    bind:clientWidth={largeurBulle}
    bind:clientHeight={hauteurBulle}
    style:left="{x}px"
    style:top="{y}px"
    style:transform-origin="{origineX}px {dessous ? '0' : '100%'}"
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
        <svg class="icon fleche" aria-hidden="true"><use href="#i-chevron-down" /></svg>
      </button>

      <span class="sep"></span>

      {#each CARACTERE as outil (outil.id)}
        {@const etat = etatDe(outil.id)}
        <button
          class="outil"
          class:actif={etat.active}
          use:tooltip={raisonLisible(etat) || outil.label}
          aria-label={outil.label}
          aria-pressed={!!etat.active}
          onclick={() => void lancer(outil.id)}
        >
          <svg class="icon" aria-hidden="true"><use href="#i-{outil.icone}" /></svg>
        </button>
      {/each}

      <span class="sep"></span>

      {#each LISTES as outil (outil.id)}
        {@const etat = etatDe(outil.id)}
        <button
          class="outil"
          class:actif={etat.active}
          use:tooltip={raisonLisible(etat) || outil.label}
          aria-label={outil.label}
          aria-pressed={!!etat.active}
          onclick={() => void lancer(outil.id)}
        >
          <svg class="icon" aria-hidden="true"><use href="#i-{outil.icone}" /></svg>
        </button>
      {/each}

      <button
        class="outil"
        use:tooltip={raisonLisible(etatDe('link')) || 'Lien'}
        aria-label="Lien"
        onclick={() => void lancer('link')}
      >
        <svg class="icon" aria-hidden="true"><use href="#i-link" /></svg>
      </button>

      <span class="sep"></span>

      <button
        class="outil"
        class:actif={palette}
        aria-haspopup="menu"
        aria-expanded={palette}
        use:tooltip={'Plus d’outils'}
        aria-label="Plus d’outils"
        onclick={() => { palette = !palette; menuStyles = false }}
      >
        <svg class="icon" aria-hidden="true"><use href="#i-ellipsis" /></svg>
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
                use:tooltip={c.label}
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
                use:tooltip={c.label}
                aria-label="Surlignage : {c.label}"
                onclick={() => void lancer('highlight-color', c.valeur)}
              >
                {#if c.valeur === 'none'}
                  <span class="teinte aucune"><svg class="icon" aria-hidden="true"><use href="#i-circle-slash" /></svg></span>
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
                use:tooltip={a.label}
                aria-label={a.label}
                onclick={() => void lancer('text-align', a.valeur)}
              >
                <svg class="icon" aria-hidden="true"><use href="#i-{a.icone}" /></svg>
              </button>
            {/each}
            {#each RETRAITS as r (r.id)}
              <button role="menuitem" class="outil" use:tooltip={raisonLisible(etatDe(r.id)) || r.label} aria-label={r.label} onclick={() => void lancer(r.id)}>
                <svg class="icon" aria-hidden="true"><use href="#i-{r.icone}" /></svg>
              </button>
            {/each}
          </div>
        </div>
        <div class="groupe">
          <span class="titre-groupe">Insérer</span>
          <div class="ligne">
            <button role="menuitem" class="outil" use:tooltip={'Tableau'} aria-label="Tableau" onclick={() => void lancer('table-insert')}>
              <svg class="icon" aria-hidden="true"><use href="#i-table" /></svg>
            </button>
            <button role="menuitem" class="outil" use:tooltip={'Image'} aria-label="Image" onclick={() => void lancer('image')}>
              <svg class="icon" aria-hidden="true"><use href="#i-image" /></svg>
            </button>
          </div>
        </div>
        <div class="groupe">
          <button role="menuitem" class="large" use:tooltip={raisonLisible(etatDe('clear-formatting'))} onclick={() => void lancer('clear-formatting')}>
            <svg class="icon" aria-hidden="true"><use href="#i-remove-formatting" /></svg><span>Effacer la mise en forme</span>
          </button>
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  /* Barre flottante à la Kube : surface élevée opaque, gouttière 4px, boutons de barre
     d'outils 28px au rayon concentrique (12 − 4 = 8), ombre de rôle « menu ». Elle grandit
     depuis la sélection (origine posée en ligne par placer()) : en bas quand elle la coiffe,
     en haut quand elle passe dessous. */
  .bulle {
    position: absolute;
    z-index: 40;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 4px;
    border-radius: var(--radius-xl);
    background: var(--composer-bg);
    box-shadow: var(--shadow-xl);
    color: var(--ink);
    font-size: 13px;
    animation: doku-pop-in var(--duration-basic) var(--ease-enter-snappy);
  }

  .rangee { display: flex; align-items: center; gap: 2px; }
  .sep { flex: none; width: 1px; height: 16px; margin: 0 4px; background: var(--line-1); }

  .outil, .style {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    height: var(--control-sm);
    padding: 0;
    border: 0;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--ink-3);
    font: inherit;
    font-weight: 510;
    cursor: pointer;
    transition: background-color var(--duration-basic) ease, color var(--duration-basic) ease;
  }
  .outil { width: var(--control-sm); }
  .style { padding: 0 6px 0 8px; min-width: 84px; justify-content: space-between; }
  .style .nom { white-space: nowrap; }
  .style .fleche { font-size: 14px; color: var(--ink-4); }
  .outil:hover, .style:hover { background: rgba(var(--ink-rgb), 0.06); color: var(--ink); }
  /* L'état ACTIF (et le volet ouvert) est le remplissage de sélection, encre pleine — pas
     une couleur d'accent : le système réserve la couleur aux statuts sémantiques. */
  .outil.actif, .style[aria-expanded='true'] { background: var(--accent-soft); color: var(--ink); }
  .outil .icon { font-size: 16px; }
  .outil:focus-visible, .style:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: -1px; }

  /* Volets : pas une seconde surface posée sur la bulle (élévation imbriquée), un simple
     filet qui sépare la barre de son contenu déplié. */
  .volet {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding-top: 4px;
    border-top: 1px solid var(--line-1);
  }
  .styles { gap: 0; }
  /* Rangées de menu : 30px, rayon de rangée, sélection = --accent-soft. */
  .styles button, .large {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    min-height: 30px;
    padding: 0 8px;
    border: 0;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--ink-2);
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition: background-color var(--duration-basic) ease, color var(--duration-basic) ease;
  }
  .styles button:hover, .large:hover { background: var(--accent-soft); color: var(--ink); }
  .styles button.coche { background: var(--accent-soft); color: var(--ink); }
  .styles button:focus-visible, .large:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: -2px; }
  .large .icon { font-size: 15px; color: var(--ink-4); }
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
    width: var(--control-sm); height: var(--control-sm); padding: 0;
    display: inline-flex; align-items: center; justify-content: center;
    border: 0; border-radius: var(--radius-md); background: transparent; cursor: pointer;
    transition: background-color var(--duration-basic) ease;
  }
  .pastille:hover { background: rgba(var(--ink-rgb), 0.06); }
  /* Filet de thème, pas une encre de papier : sur la bulle sombre, la pastille noire
     disparaissait derrière un liseré sombre. */
  .pastille .teinte {
    width: 16px; height: 16px; border-radius: var(--radius-xs);
    box-shadow: inset 0 0 0 1px var(--line-2);
  }
  .pastille .teinte.aucune {
    display: inline-flex; align-items: center; justify-content: center;
    background: var(--cream-content); color: var(--ink-4);
  }
  .pastille .teinte.aucune .icon { font-size: 12px; }
  .pastille.choisie { background: var(--accent-soft); box-shadow: inset 0 0 0 1px var(--line-2); }
  .pastille:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: -1px; }

  /* Au doigt : boutons 36×40 réels. Ils ne sont séparés que de 2px, une zone élargie par
     pseudo-élément recouvrirait le voisin. */
  :global(:root[data-input='touch']) :is(.outil, .pastille) { width: 36px; height: 40px; }
  :global(:root[data-input='touch']) .style { height: 40px; }

  .groupe { display: flex; flex-direction: column; gap: 2px; }
  .titre-groupe { padding: 2px 8px 0; font-size: 12px; font-weight: 510; color: var(--ink-3); }
  .ligne { display: flex; align-items: center; gap: 2px; }
</style>
