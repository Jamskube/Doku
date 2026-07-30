# 0017. Révélation de la syntaxe Markdown à la demande (et non au curseur)

**Date** : 2026-07-30 · **Status** : accepted · **Deciders** : nicos (+ Codex) · **Tags** : éditeur, wysiwyg, ux, tableaux, fr-3

## Contexte

L'ADR-0002 a choisi le modèle « live preview » CodeMirror 6 et, avec lui, un comportement précis hérité de FR-3 : **la syntaxe du bloc courant se révèle autour du curseur**. Concrètement, `activeLineSet()` (`src/lib/editor/live-preview.ts`) calcule les lignes portant une sélection, et toute décoration est retirée sur ces lignes — les `###`, `**`, et le markdown complet d'un tableau réapparaissent dès que le curseur s'y pose.

L'usage réel de Doku v2.2.0 (période décidée à la rétro S15) a produit le premier contre-exemple net. Sur un document dont le **tableau est le contenu** — une liste de ~100 clips à qualifier, colonnes `#`/`clip`/`durée`/`verdict`/`note` — le comportement s'inverse contre l'utilisateur : cliquer dans une cellule pour saisir un verdict fait tomber tout le widget-bloc et affiche des dizaines de lignes de `| 1 | a01_4s… | 5 s | | |`. Remplir une case devient un exercice de comptage de pipes. La même mécanique gêne l'écriture courante : on ne peut pas taper un titre sans voir ses `###`.

L'ADR-0002 avait anticipé la difficulté des tableaux (« édition inline impraticable → widget rendu + édition au clic », « même compromis qu'Obsidian ») et l'avait acceptée. Ce que l'usage montre, c'est que ce compromis ne tient que pour un tableau **décoratif**, pas pour un tableau **de saisie**.

## Décision

**La révélation de la syntaxe devient un geste explicite de l'utilisateur, et cesse d'être un effet de bord du placement du curseur.**

- En édition normale, le document reste **rendu** : on écrit dans le rendu, les marqueurs (`###`, `**`, `-`) restent masqués pendant la frappe.
- La source se révèle sur geste : **Ctrl+/** (bascule globale du document, comportement existant conservé) ou **Tab** hors tableau.
- **Dans un tableau, Tab navigue de cellule en cellule** — il ne bascule pas la source. Ce partage contextuel est délibéré : dans un tableau on veut avancer dans la saisie, hors tableau on veut voir la syntaxe. Ctrl+/ reste la bascule inconditionnelle, y compris depuis un tableau.
- Les cellules d'un tableau rendu deviennent **éditables en place** ; seule la cellule modifiée est réécrite dans la source.
- Échap reste une porte de sortie clavier de l'éditeur, pour ne pas piéger la navigation au Tab.

Ce qui **ne change pas**, et n'est pas négociable : le buffer reste du Markdown, l'écriture disque reste octet pour octet (ADR-0002, warning critique n°1). Aucune conversion en document riche, aucune re-sérialisation.

## Conséquences

**Positif** : la saisie dans un tableau redevient praticable (le cas d'usage qui a motivé la décision) ; l'écriture courante ressemble à un traitement de texte sans en payer le prix ; la fidélité du fichier est intacte puisque le modèle de données ne bouge pas ; le mode source reste disponible, mais devient un choix au lieu d'une fatalité.

**Négatif** : certaines constructions n'ont pas d'édition évidente en rendu pur — bloc de code, URL d'un lien, image. Elles nécessitent soit un geste dédié, soit de rester en source ; traitées au cas par cas plutôt que par une règle globale. Tab prend une sémantique contextuelle, à documenter dans l'aide.

**Risques** : la logique de révélation est au cœur de `live-preview.ts` — une régression y touche tout le rendu. Mitigation : le socle est livré et vérifié **avant** les volets tableaux et formatage, qui en dépendent.

## Références

- [ADR-0002](./0002-moteur-wysiwyg-cm6-live-preview.md) — amendé sur le volet « syntaxe révélée autour du curseur » ; le cœur (fidélité, moteur CM6) est inchangé
- `src/lib/editor/live-preview.ts` — `activeLineSet()`, `buildTableDecorations()`, `TableWidget`
- `src/lib/table.ts` — parseur GFM réutilisé pour l'édition en place
- `docs/planning/PRD.md` FR-3
