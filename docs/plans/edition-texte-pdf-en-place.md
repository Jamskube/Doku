# Plan : remplacer un passage de texte dans un PDF

_Date : 2026-08-15 · Portée estimée : L · **Révision 2** après revue critique (verdict initial : Block)_

## Objectif

Permettre à l'utilisateur de **modifier le texte d'un PDF directement dans Doku** — ajouter, supprimer, corriger — sans jamais voir de code, et **sans reconstruire le document** : images, tableaux, cadres, filets et mise en page restent tels quels parce qu'on n'y touche pas.

C'est le renversement du trajet DOCX déjà livré. Celui-ci *reconstruit* le document (donc perd tout ce qui n'est pas du texte) ; celui-là *modifie* le document (donc ne perd rien, mais contraint ce qu'on peut écrire).

## Ce qui est déjà mesuré — le plan repose dessus, pas sur des espoirs

Kill-test exécuté avant d'écrire ce plan (`src/lib/zz-redact-probe`, supprimé depuis) :

| Fait | Mesure |
|---|---|
| MuPDF supprime réellement un passage du flux de contenu | 8 lignes → 7, texte ré-extrait : la ligne visée a disparu |
| Les autres lignes survivent | vérifié par ré-extraction |
| Images et tracés vectoriels préservables | `REDACT_IMAGE_NONE` + `REDACT_LINE_ART_NONE`, sans boîte noire |
| Réécriture à la même position, page droite | écart 0,00 pt |
| Réécriture sur page **tournée** avec la conversion naïve | **90° : texte hors page · 180° : 395 pt · 270° : 353 pt** |
| Réécriture via `pdfBurnPoint` + fractions de l'espace affiché + `rotate` | **0,00 pt sur les 4 rotations × 2 CropBox** |
| MuPDF donne la police et la taille par ligne | `Helvetica 12` sur la ligne testée |

Les deux bibliothèques nécessaires sont **déjà installées et déjà couvertes par l'AGPL** (ADR-0023) : `mupdf` pour supprimer, `@cantoo/pdf-lib` pour écrire.

## Ce que la revue critique a corrigé dans ce plan

La première version affirmait un « écart 0,00 pt » mesuré sur **une page triviale**. Vérifié sur les quatre rotations, la conversion naïve écrivait hors page ou à 400 pt de la cible. **Règle qui en découle** : les coordonnées MuPDF vivent dans l'espace AFFICHÉ (page déjà tournée, origine au coin haut gauche de la CropBox) ; il faut les ramener en fractions de cet espace et passer par `pdfBurnPoint` (`pdf-write.ts`), déjà prouvé contre pdf.js — ne JAMAIS écrire un second transform.

Trois autres corrections imposées par la revue :

- **`asJSON()` ne donne qu'une police par ligne** (celle du premier caractère) et **aucune couleur**. Une ligne à un mot en gras ressortirait toute en romain, un titre bleu deviendrait noir. → passer par `StructuredText.walk()`, qui fournit police, taille, couleur et quad **par caractère** ; `PdfLineAnchor` porte des RUNS, pas une police.
- **Le texte justifié se dégrade même à longueur égale** : les mots y sont positionnés par décalages calculés, la réécriture donne un espacement naturel et le bord droit n'est plus au fer. Ce n'est pas du reflow, c'est une dégradation visible → mesurer la largeur de la ligne réécrite contre la bbox d'origine et la signaler.
- **Aucune garantie d'exécution que le texte a disparu** : si l'apparence d'une annotation survit au caviardage, on écrit par-dessus l'ancien, en double, sans erreur → après application, ré-extraire et exiger que l'ancien soit absent et le neuf présent, sinon **refuser d'enregistrer** en le nommant.

Enfin, la revue rappelle que ce plan **n'amende pas** le NO_GO de l'ADR-0022 : il implémente le repli que l'ADR avait déjà accepté (« remplacer un passage, substitution de police assumée et affichée »). D'où le renommage : le mode s'appelle **« Remplacer un passage »**, jamais « éditer le texte ».

## Mesures sur le corpus RÉEL de l'utilisateur

Trois documents fournis (`lic-tech 3.pdf`, `manual.pdf`, `plan-licence 5.pdf` — 10, 20 et 16 pages), **853 lignes mesurées sur des pages de contenu**, pas des couvertures. Ce tableau remplace toutes les suppositions de la révision 1 :

| Propriété | Résultat | Conséquence pour le plan |
|---|---|---|
| Caviardage d'une ligne | **1 ligne visée → 1 ligne disparue**, sur les 3 documents | Pas de dégât collatéral : la crainte principale de la revue ne mord pas |
| Lignes multi-style | **0 %** | Le refus « multi-style » ne rejettera quasiment rien |
| Lignes justifiées | **aucune** (bord droit au fil) | La dégradation du justifié ne concerne pas ce corpus |
| Lignes non horizontales | **0** | Filtre à garder, mais inerte ici |
| Caractères hors WinAnsi | **2 sur 853** | Le filtre suffit, sans incorporation de police |
| Couleurs | **réelles et variées** : `26,26,26` corps, `37,99,235` bleu, `138,138,138` gris, `199,119,0`, `27,138,58` | **Ne PAS refuser les lignes colorées — les PRÉSERVER.** MuPDF donne la couleur par caractère, pdf-lib la réécrit. Refuser aurait rejeté 100 % du contenu |
| Écart de largeur après substitution | **4 % en moyenne, 75-81 % des lignes sous 5 %** | Acceptable, à condition de choisir la police par FAMILLE |

**Règle de substitution, mesurée et non devinée** : le nom de la police embarquée (`HCEZYJ+JetBrainsMonoNFM-Regular`, `QKHQXD+Archivo-Regular`) suffit à choisir la chasse. Tout envoyer sur Helvetica donnait **29 % d'écart sur les blocs de code** ; router les `mono|courier|consol` vers Courier et les `times|serif|garamond` vers Times ramène `manual.pdf` de 8 % à 4 % d'écart moyen, et de 62 % à 75 % de lignes sous 5 %.

## Refus explicites, dits à l'utilisateur

Une ligne n'est éditable que si elle passe tous ces filtres — sinon elle reste inerte **avec la raison affichée** :
- style unique (la **couleur, elle, se préserve** : mesurée présente partout dans le corpus réel, la refuser rejetterait tout) ;
- entièrement écrivable en WinAnsi, y compris **la partie non modifiée** ;
- horizontale, gauche-à-droite (`wmode`/`direction` de `walk()`) ;
- ne chevauchant horizontalement aucune autre ligne au même `y` (colonnes fusionnées par MuPDF) ;
- dans la CropBox.

Documents refusés en le nommant : chiffré, **signé** (`/Sig` — la réécriture invalide la signature), portant déjà des annotations `Redact` en attente (`applyRedactions` les appliquerait toutes), scanné sans couche texte.

## Hors périmètre

- Le **reflow** : remplacer un texte plus long ne repousse pas le paragraphe. On mesure et on le dit ; on ne recompose pas.
- Les polices **non standard**. La police d'origine est sous-ensemblée : elle ne contient souvent que les glyphes déjà utilisés. Le texte réécrit part donc sur une police standard approchante — visible sur une police de marque, invisible sur du Helvetica/Arial/Times.
- Le texte dans les **images** (PDF scanné) : aucune couche texte, rien à éditer. Refus explicite.
- Tableaux et colonnes en tant que **structures** : on édite les lignes de texte qui les composent, pas la structure.

## Architecture

**Le modèle est une liste d'OPÉRATIONS, pas une mutation directe.** Rien n'est écrit tant que l'utilisateur n'enregistre pas ; annuler = retirer une opération. C'est la même philosophie que le manifeste d'annotations (ADR-0022), et ça permet l'annulation, l'aperçu et le refus tardif.

```ts
type PdfTextEdit =
  | { kind: 'replace'; page: number; line: PdfLineAnchor; text: string }
  | { kind: 'delete';  page: number; line: PdfLineAnchor }
  | { kind: 'insert';  page: number; at: { x: number; y: number }; text: string; size: number }
```

`PdfLineAnchor` porte la boîte, la ligne de base, la police et la taille lues par MuPDF — donc tout ce qu'il faut pour supprimer au bon endroit et réécrire à l'identique.

**Application (à l'enregistrement)** : MuPDF pose une annotation de caviardage par ligne touchée et applique en une passe → octets intermédiaires → pdf-lib écrit les textes neufs aux lignes de base d'origine → fichier final. Deux bibliothèques, chacune sur ce qu'elle sait faire.

## Files

### Created
- `src/lib/pdf-text-edit.ts` — modèle pur des opérations : création, fusion, annulation, bornes ; aucune I/O. Testable sans navigateur.
- `src/lib/pdf-text-edit.test.ts` — couverture du modèle.
- `src/lib/export/pdf-apply-edits.ts` — application des opérations : MuPDF (suppression) puis pdf-lib (écriture), mapping police MuPDF → police standard, mesure de débordement.
- `src/lib/export/pdf-apply-edits.test.ts` — tests bout-en-bout en Node : appliquer, relire, comparer texte ET coordonnées.
- `src/components/PdfTextEditLayer.svelte` — la couche de saisie : un champ transparent posé sur chaque ligne, à sa taille réelle.
- `.agent/visual/pdf-text-edit/` — banc de contrôle et preuves.

### Modified
- `src/components/PdfView.svelte` — nouveau mode « Éditer le texte » à côté d'« Annoter » ; chargement des lignes MuPDF de la page visible ; aperçu en direct des opérations.
- `src/lib/pdf.ts` — extraction des lignes MuPDF exposée au lecteur (aujourd'hui seule la conversion DOCX l'utilise).
- `src/components/TitleBar.svelte` — entrée « Enregistrer le PDF modifié… ».
- `docs/adr/0022-ecriture-pdf-pdf-lib.md` — **amender le NO_GO** : l'édition de texte *avec reflow* reste refusée, l'édition *en place* est désormais acquise et mesurée.

## Order of operations

1. **Solder la dette du DOCX→PDF** (voir Risques) : quatre défauts bloquants sont en production. Corriger ou retirer, avant d'ajouter une seconde voie d'édition.
2. `pdf-text-edit.ts` + tests — le modèle pur, sans I/O.
3. `pdf-apply-edits.ts` + tests bout-en-bout en Node — c'est le cœur ; il doit être vert avant toute UI.
4. `PdfTextEditLayer.svelte` — la saisie, vérifiée aux vrais gestes au banc.
5. Intégration dans `PdfView` (mode, aperçu, enregistrement).
6. Vérification navigateur complète, puis smoke natif.

## Test strategy

- **Modèle** : vitest node, comme `pdf-drawing`/`pdf-pages`.
- **Application** : vitest node — appliquer des opérations sur un PDF fabriqué, **relire avec MuPDF** et comparer le texte *et les coordonnées* (l'écart de ligne de base doit rester nul). C'est le test que le DOCX→PDF n'avait pas, et c'est ce qui lui a coûté quatre défauts.
- **Saisie** : banc navigateur avec vrais gestes (le projet a déjà la règle : clic/focus/sélection ne se valident pas en jsdom).
- **Fidélité** : rendre la page avant/après en image et comparer visuellement qu'aucun élément non textuel n'a bougé.

## Risks

- **Dette en production : le DOCX→PDF a quatre défauts bloquants** (sauts de ligne devenus `?`, plantage sur `ł`/`ć`/`ğ`, zones de texte imprimées 2-3×, titres grossis de 70 % en aller-retour) → traiter en tête de file ; ne pas empiler une fonctionnalité sur une fonctionnalité cassée.
- **Police substituée visible** sur un document à police de marque → mesurer la largeur réécrite et prévenir quand l'écart dépasse un seuil ; afficher la police réellement utilisée.
- **Débordement** d'un texte plus long → mesurer à la frappe et signaler dans la couche de saisie, avant l'enregistrement.
- **Caviardage trop large** : la boîte d'une ligne peut mordre sur un élément voisin → n'appliquer qu'avec `REDACT_IMAGE_NONE` et `REDACT_LINE_ART_NONE`, et vérifier en image.
- **Assainissement WinAnsi** : la leçon du DOCX→PDF vaut ici — énumérer le jeu autorisé, jamais l'approcher par une plage.
- **Document chiffré ou protégé** → refuser en le nommant.

## Open questions

- Faut-il tenter d'**incorporer la police d'origine** (MuPDF expose `addSimpleFont`) plutôt que de substituer ? Gain de fidélité réel, coût élevé (sous-ensemblage). À trancher après avoir mesuré la gêne sur des documents réels.
- L'**insertion libre** (cliquer dans le vide pour ajouter du texte) est-elle attendue dès la v1, ou le remplacement suffit-il ?

## Rollback

Aucune migration, aucun format persisté : les opérations vivent en mémoire le temps de la session d'édition, et l'écriture passe par un dialogue « Enregistrer sous ». Retirer le mode suffit à revenir en arrière ; le document source n'est jamais réécrit.
