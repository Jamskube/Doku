// Révélation de la syntaxe Markdown À LA DEMANDE (ADR-0017, story 20.1).
//
// Avant : la syntaxe se révélait sur les lignes portant une sélection (`activeLineSet`),
// donc poser le curseur suffisait — impossible d'écrire un titre sans voir ses `###`, et
// cliquer dans un tableau faisait tomber tout le widget (l'irritant qui a motivé le sprint).
//
// Maintenant : la révélation est un ÉTAT explicite de l'éditeur, piloté par un geste
// (Tab hors tableau, ou Ctrl+/ pour la bascule globale du document). Le curseur seul ne
// révèle plus rien.
//
// Le modèle de données ne bouge pas : le buffer reste du Markdown, l'écriture disque reste
// octet pour octet (ADR-0002, warning critique n°1). On ne change QUE ce qui est masqué.
import { StateEffect, StateField } from '@codemirror/state'

// Portée de la révélation :
// - `none`  : rien n'est révélé (défaut) — on écrit dans le rendu
// - `block` : seul le bloc où se trouve le curseur est révélé (geste Tab)
//
// La bascule GLOBALE du document reste `app.sourceMode` (Ctrl+/), qui échange les
// extensions via le Compartment `livePreviewComp` — un mécanisme distinct, déjà en place.
export type RevealScope = 'none' | 'block'

export const setRevealScope = StateEffect.define<RevealScope>()

export const revealScopeField = StateField.define<RevealScope>({
  create: () => 'none',
  update(scope, tr) {
    for (const e of tr.effects) if (e.is(setRevealScope)) return e.value
    // Une révélation de bloc suit le curseur tant qu'elle est active ; elle ne s'annule
    // pas toute seule à la frappe (sinon la syntaxe clignoterait pendant l'édition, ce
    // qui est exactement le défaut qu'on corrige).
    return scope
  },
})

export function revealScope(state: { field: (f: typeof revealScopeField, req: false) => RevealScope | undefined }): RevealScope {
  return state.field(revealScopeField, false) ?? 'none'
}
