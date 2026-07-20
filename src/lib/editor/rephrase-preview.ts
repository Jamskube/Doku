// Aperçu de reformulation EN PLACE (16.2, brief w3) : la plage sélectionnée est recouverte par
// une décoration replace dont le widget rend la proposition — texte streamé, puis diff mot à
// mot + barre Accepter/Refuser. Le document n'est JAMAIS modifié avant « Accepter ». StateField
// obligatoire (un ViewPlugin ne peut pas fournir de replace traversant des sauts de ligne).
// Zéro perte : toute édition ÉTRANGÈRE du document (transaction sans notre effet) vide le champ
// ATOMIQUEMENT — aucun aperçu périmé à l'écran ; la machine d'état (copilot.svelte.ts) est
// annulée en parallèle par l'updateListener de DocumentView.
import { Decoration, EditorView, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { StateEffect, StateField, type EditorState } from '@codemirror/state'
import type { DiffSeg } from '../copilot-service'

// Instantané rendu par le widget — copie plate de la machine d'état (jamais le proxy $state).
export interface RephrasePreviewSnapshot {
  phase: 'streaming' | 'ready' | 'error' | 'config'
  label: string
  text: string
  diff: DiffSeg[]
  message: string
  busy: boolean
}

export interface RephrasePreviewHandlers {
  onAccept: () => void
  onReject: () => void
  onRetry: () => void
  onChooseModel: () => void
}

// Pose (ou retire, avec null) l'aperçu sur une plage. Une transaction d'ACCEPT porte à la fois
// le remplacement et cet effet à null — c'est ce qui la distingue d'une édition étrangère.
export const setRephrasePreview = StateEffect.define<{ from: number; to: number } | null>()

// État partagé du rendu : le widget se peuple LUI-MÊME au toDOM à partir de cet instantané
// (CM6 détruit le DOM hors viewport et rappelle toDOM au retour — un conteneur rempli
// uniquement de l'extérieur reviendrait vide). Le sync externe ne sert qu'aux mises à jour.
let snapshot: RephrasePreviewSnapshot | null = null
let handlers: RephrasePreviewHandlers | null = null
let container: HTMLElement | null = null
let focusPending = false

function button(label: string, cls: string, onClick: () => void, disabled = false): HTMLButtonElement {
  const b = document.createElement('button')
  b.type = 'button'
  b.className = cls ? `cm-rephrase-btn ${cls}` : 'cm-rephrase-btn'
  b.textContent = label
  b.disabled = disabled
  // mousedown : preventDefault SEUL (ne pas voler sélection/focus à l'éditeur) ; l'action est
  // sur click → l'activation clavier (Entrée/Espace) fonctionne aussi (motif TableWidget).
  b.addEventListener('mousedown', (e) => e.preventDefault())
  b.addEventListener('click', (e) => {
    e.preventDefault()
    onClick()
  })
  return b
}

function render(): void {
  const el = container
  if (!el) return
  el.replaceChildren()
  const s = snapshot
  const h = handlers
  if (!s || !h) return
  el.dataset.phase = s.phase
  const block = (cls: string) => {
    const d = document.createElement('span')
    d.className = cls
    el.appendChild(d)
    return d
  }
  if (s.phase === 'streaming') {
    const head = block('cm-rephrase-head')
    head.textContent = s.label
    const hint = document.createElement('span')
    hint.className = 'cm-rephrase-hint'
    hint.textContent = 'Échap pour annuler'
    head.appendChild(hint)
    if (s.text) block('cm-rephrase-body').textContent = s.text
  } else if (s.phase === 'ready') {
    const body = block('cm-rephrase-body')
    for (const seg of s.diff) {
      if (seg.kind === 'same') {
        body.appendChild(document.createTextNode(seg.text))
      } else {
        const mark = document.createElement(seg.kind === 'del' ? 'del' : 'ins')
        mark.className = seg.kind === 'del' ? 'cm-rephrase-del' : 'cm-rephrase-add'
        mark.textContent = seg.text
        body.appendChild(mark)
      }
    }
    const bar = block('cm-rephrase-bar')
    const accept = button('Accepter', 'accept', h.onAccept)
    bar.appendChild(accept)
    bar.appendChild(button('Refuser', '', h.onReject))
    if (focusPending) {
      focusPending = false
      accept.focus()
    }
  } else {
    block('cm-rephrase-note').textContent = s.message
    const bar = block('cm-rephrase-bar')
    if (s.phase === 'error') bar.appendChild(button('Réessayer', 'accept', h.onRetry, s.busy))
    else bar.appendChild(button('Ouvrir les modèles', 'accept', h.onChooseModel))
    bar.appendChild(button('Fermer', '', h.onReject))
  }
}

class PreviewWidget extends WidgetType {
  eq(): boolean {
    return true // un seul aperçu à la fois — le contenu vit dans `snapshot`, pas dans le widget
  }
  toDOM(): HTMLElement {
    const el = document.createElement('span')
    el.className = 'cm-rephrase-preview'
    // Annonce lecteur d'écran des transitions (streaming → prêt/erreur), comme les cartes
    // role="status" du panneau que cet aperçu remplace.
    el.setAttribute('role', 'status')
    container = el
    render()
    return el
  }
  destroy(dom: HTMLElement): void {
    if (container === dom) container = null
  }
  ignoreEvent(): boolean {
    return true // laisser les événements atteindre les boutons du widget
  }
}

export const rephrasePreviewField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    const posed = tr.effects.find((e) => e.is(setRephrasePreview))
    // Édition étrangère (sans notre effet) → aperçu retiré atomiquement, jamais d'état périmé.
    if (tr.docChanged && !posed) return Decoration.none
    deco = deco.map(tr.changes)
    if (posed) {
      deco = posed.value
        ? Decoration.set([Decoration.replace({ widget: new PreviewWidget() }).range(posed.value.from, posed.value.to)])
        : Decoration.none
    }
    return deco
  },
  provide: (f) => [
    EditorView.decorations.from(f),
    // La plage recouverte est atomique : les flèches sautent par-dessus (pas de curseur fantôme).
    EditorView.atomicRanges.of((view) => view.state.field(f, false) ?? Decoration.none),
  ],
})

// Plage couverte par l'aperçu dans un état donné (null si aucun) — utilisée par live-preview
// pour ne pas poser de widget-bloc (table) chevauchant partiellement notre replace.
export function rephrasePreviewRange(state: EditorState): { from: number; to: number } | null {
  const deco = state.field(rephrasePreviewField, false)
  if (!deco || deco.size === 0) return null
  let range: { from: number; to: number } | null = null
  deco.between(0, state.doc.length, (from, to) => {
    range = { from, to }
    return false
  })
  return range
}

// Vrai si l'une des transactions porte notre effet (pose, retrait ou accept) — permet à
// l'updateListener de distinguer NOTRE transaction d'accept d'une édition étrangère.
export function isRephrasePreviewUpdate(u: ViewUpdate): boolean {
  return u.transactions.some((tr) => tr.effects.some((e) => e.is(setRephrasePreview)))
}

// Synchronise décoration + contenu du widget avec la machine d'état (appelé par un $effect de
// DocumentView). Pose/retrait = dispatch ; le contenu, lui, est muté dans le conteneur STABLE
// du widget (pattern « conteneur stable » — CM6 réconcilie et clobbererait un replaceWith).
export function syncRephrasePreview(
  view: EditorView,
  target: { from: number; to: number; snapshot: RephrasePreviewSnapshot } | null,
  h: RephrasePreviewHandlers,
): void {
  const prevPhase = snapshot?.phase
  snapshot = target?.snapshot ?? null
  handlers = h
  if (snapshot && snapshot.phase === 'ready' && prevPhase !== 'ready') focusPending = true
  const field = view.state.field(rephrasePreviewField, false)
  if (field === undefined) return
  const posed = field.size > 0
  if (!target) {
    if (posed) view.dispatch({ effects: setRephrasePreview.of(null) })
    return
  }
  if (!posed) {
    view.dispatch({
      effects: [setRephrasePreview.of({ from: target.from, to: target.to }), EditorView.scrollIntoView(target.from)],
      // Curseur replié en fin de plage : la sélection d'origine resterait sinon « armée » sous
      // le widget — une frappe l'écraserait entière (surprise maximale, même annulable).
      selection: { anchor: target.to },
    })
  } else {
    render()
  }
}
