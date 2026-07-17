# Design brief — Assistance d'écriture ancrée à la sélection (popover + aperçu en place)

_Issu de `/impeccable shape`, confirmé le 2026-07-17. Direction choisie par l'utilisateur :_
_verbes en **popover à la sélection** · proposition en **aperçu dans l'éditeur** · **diff mot à mot**._
_**Décision** : « Corriger » (16.2) intégré d'emblée comme 4ᵉ verbe — un seul chantier pour toute l'assistance d'écriture._

## 1. Résumé
La reformulation quitte le panneau pour vivre **là où vit le texte** : une barre de verbes flottante
apparaît à la sélection, la proposition s'affiche **en place** (aperçu type suggestion/track-changes,
document **intact** jusqu'à Accepter), en **diff mot à mot**. Le panneau Doku-San redevient une pure
surface de conversation. Aboutissement de « un geste pour le quotidien » : la décision se prend à
l'endroit exact où elle s'applique.

## 2. Action utilisateur primaire
Sélectionner → un verbe (**Clarifier / Raccourcir / Ton neutre / Corriger**) → **voir ce qui change**
→ Accepter (ou Refuser, Esc). Zéro trajet vers le panneau.

## 3. Direction visuelle
Registre **product / Restrained** (PRODUCT.md) : popover et aperçu parlent le vocabulaire papier
existant — carte `--cream-content`, filet `--line-2`, ombre discrète, rayons 8-12. Diff avec les
tokens texte : suppressions barrées `--err-text` doux, ajouts fond `--accent-soft`/vert doux.
Ancres : barre de sélection **Medium**, **suggested edits Google Docs** (aperçu en place), calme
d'**iA Writer**. Aucun élément persistant — le chrome continue de s'effacer.

## 4. Portée
Production-ready (standard Doku), une surface (overlay éditeur) + **retrait** de la barre
« Sélection » et des cartes Proposition du panneau (16.1 v1). Interactif complet, clavier inclus.
Taille **story M/L** — remplace l'UI 16.1 et **absorbe 16.2** (Corriger = 4ᵉ verbe, hérite du diff).

## 5. Stratégie de layout
Deux étages éphémères ancrés à la sélection :
1. **Barre de verbes** — pilule horizontale (4 verbes), positionnée au-dessus/dessous de la
   sélection selon l'espace (`view.coordsAtPos` + flip), repositionnée au scroll, jamais pendant le drag.
2. **Aperçu en place** — la plage sélectionnée est recouverte par une **décoration CM6** (le
   document n'est JAMAIS modifié avant Accepter) rendant le diff, mini-barre Accepter/Refuser collée
   dessous. Multi-paragraphe : suivre les frontières de lignes (gotchas AGENTS.md : StateField pour
   replace multi-lignes, ancrage `doc.lineAt(...)`).
Le popover échappe au clipping du scroller (position fixed/portal).

## 6. États clés
| État | Ce que l'utilisateur voit |
|---|---|
| Sélection stable (mouseup) | Barre de verbes, apparition ~150 ms ; jamais pendant le drag |
| Génération | Aperçu recouvre la sélection, texte proposé streame (teinté), « Esc pour annuler » ; Esc = abort + restaure la vue |
| Proposition prête | **Diff mot à mot** + Accepter (plein) / Refuser ; focus sur Accepter (Esc = Refuser) |
| Accepté | Remplacement en UNE transaction CM (Ctrl+Z restaure), bref flash discret, tout disparaît |
| Refusé / Esc | Restauration instantanée de la vue, document intact |
| Doc modifié pendant la proposition | Auto-dismiss silencieux (rien n'était écrit) — réutilise la garde tabId/région de 16.1 |
| Aucun modèle actif | Note config dans le popover + « Choisir un modèle » (ouvre panneau → vue Modèles) |
| Échec moteur | Note d'erreur dans le popover + Réessayer (mécanisme `retry` existant) |
| Reduced motion | Fondus instantanés, pas de flash |

## 7. Modèle d'interaction
`selectionSet` stable → barre. Clic verbe → streaming en place. Clic ailleurs **pendant** une
proposition = ne détruit rien (persiste jusqu'à décision/Esc/édition du doc). Clavier : barre
focusable, Esc ferme à chaque étage.

## 8. Contenu
Verbes : Clarifier · Raccourcir · Ton neutre · **Corriger** (16.2 : « sans changer le sens ni le
Markdown », critère ledger). Streaming : « Doku-San reformule… » / « Doku-San corrige… ». Diff :
légende implicite (barré = retiré, teinté = ajouté). **Nouvelle primitive pure** :
`diffWords(original, proposed)` dans `copilot-service.ts` (LCS mot à mot, ~40 lignes, tests vitest,
zéro dépendance) + `buildCorrectPrompt` (16.2).

## 9. Références d'implémentation
Gotchas CM6 d'AGENTS.md (StateField replace multi-lignes, frontières de lignes, `mousedown` dans
`toDOM`, conteneur stable) · skill `make-interfaces-feel-better` · store 16.1 existant
(`rephrase` state machine, garde zéro-perte tabId/région, `retry`) — **se réutilise tel quel**,
seul le rendu déménage de CopilotPanel vers l'overlay éditeur.

## 10. Décisions posées
- **Pas de journal des reformulations dans le panneau** : l'éditeur est la scène, le panneau reste
  conversation. Barre « Sélection » + cartes Proposition du panneau **supprimées** à la livraison.
- **Diff affiché seulement à la fin** du streaming (un diff sur texte partiel ment) ; pendant le
  flux : texte proposé brut teinté.
- **Corriger (16.2) intégré d'emblée** — le critère ledger 16.2 (« corrigée sans changer le sens ni
  le Markdown ; annulable Ctrl+Z ») est satisfait par la même mécanique aperçu→Accepter.
