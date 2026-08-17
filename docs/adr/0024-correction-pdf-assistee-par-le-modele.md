# 0024. Correction de PDF assistée par le modèle : patch ciblé, jamais réécriture de ligne

Date : 2026-08-17 · Status : accepted · Deciders : Kubo · Tags : pdf, copilote, cloud, édition, spike

## Context

Doku sait déjà écrire dans un PDF : `applyTextEdits` remplace des codes de glyphes dans le flux de contenu, en conservant police, taille, couleur et position ([ADR-0022](./0022-ecriture-pdf-pdf-lib.md)). Jusqu'ici, chaque modification était **tapée à la main** par l'utilisateur, une ligne à la fois, dans la modale « Modifier le texte ».

La demande est d'ouvrir ce chemin au copilote cloud : une consigne libre (« corrige les fautes de cette page »), et le modèle propose les modifications. Cela change deux choses de nature :

1. **Le volume.** On passe d'une modification relue caractère par caractère à une douzaine de modifications produites en une seconde. Un moteur qui pardonnait une erreur rare ne pardonne plus une erreur systématique.
2. **L'auteur des caractères.** L'utilisateur possédait chaque caractère qu'il tapait. Il ne possède désormais qu'une intention ; les caractères viennent du modèle. C'est le précédent nouveau — **la sortie d'un fournisseur cloud devient des octets du document**.

Ce qui, en revanche, **n'est pas** nouveau : la sortie du contenu vers le cloud. `copilot.svelte.ts` fournit déjà **le document entier** (jusqu'à 240 000 caractères) au fournisseur dès qu'on lui pose une question dessus. Les lignes d'une page sont strictement moins. Le consentement reste celui des [ADR-0014](./0014-connexion-compte-openai-codex.md) et [ADR-0018](./0018-fournisseur-cloud-compatible-openai.md) : avoir choisi un fournisseur cloud.

Trois contraintes dures encadrent la décision, et deux d'entre elles ont été **mesurées** sur les PDF réels de l'utilisateur (`.agent/analysis/mesure-lignes-pdf.md`) :

- **Aucun reflow.** La ligne est l'atome ; un texte plus long déborde sur son voisin, et rien dans le moteur ne le mesure.
- **Une « ligne » de PDF n'est pas une phrase.** Médiane de 6 à 16 caractères, et **56 à 83 % des lignes continuent au milieu d'une phrase**. Beaucoup sont des cellules de tableau, dont les colonnes ne tiennent que par leurs espaces.
- **Les polices sont sous-ensemblées.** Elles ne contiennent que les caractères déjà employés : sur les trois documents mesurés, la pire police d'une page ne sait écrire que 34 glyphes, et l'un des documents possède l'apostrophe typographique mais **pas** l'apostrophe droite.

## Decision drivers

- Ne jamais écrire dans le document ce que l'utilisateur n'a pas vu et accepté.
- Ne jamais dégrader la mise en page pour faire passer une correction.
- Un refus est une information, jamais un silence.
- Le fichier source reste intact, quoi qu'il arrive.

## Considered options

### Option 1 : le modèle réécrit la ligne entière
Le modèle reçoit les lignes et rend, pour chacune, sa nouvelle version. · **Pros** : contrat trivial, un seul champ. · **Cons** : chaque défaut mesuré devient un dégât. Une rangée de tableau « Désignation⎵⎵⎵⎵Qté⎵⎵⎵P.U. » revient « Désignation Qté P.U. » et **les colonnes s'effondrent** ; une ligne césurée invite le modèle à y ramener la suite ; une réponse vide **efface la ligne** — et passe même la relecture de contrôle du moteur.

### Option 2 : le modèle rend un patch ciblé à l'intérieur d'une ligne désignée
`{"i":"L12","find":"d'affaire du","to":"d'affaires du"}`. · **Pros** : la charpente d'espacement, les tabulations et les tirets de césure survivent **par construction** ; la fusion de lignes et le vidage deviennent impossibles ; le delta de longueur est local, donc mesurable ; `planLineEdit` ne réécrit que le passage réellement touché, préservant les mots en gras voisins. · **Cons** : une validation d'occurrence unique à écrire, et un `find` qui doit correspondre au caractère près.

### Option 3 : ne pas ouvrir ce chemin
S'en tenir à la saisie manuelle. · **Pros** : zéro risque nouveau. · **Cons** : corriger une page à la main, ligne par ligne, est exactement le travail que l'outil devrait éviter.

## Decision

**Retenu : option 2.**

1. **Le modèle ne rend jamais de texte de ligne, seulement un patch ciblé** `{i, find, to}` où `i` est une **étiquette** (`L12`) dans une **liste fermée** — celle des lignes éditables de la page affichée. Il ne produit donc jamais de `from` : Doku fournit le texte. C'est ce qui neutralise le repli permissif d'appariement du moteur, qui pourrait sinon écrire dans un passage isolé homonyme.
2. **Tout ce qui se vérifie en local se vérifie en local.** On ne demande au modèle NI de compter des caractères NI de respecter un alphabet : un LLM ne tient fiablement ni l'un ni l'autre, alors qu'une table de repli, si. Les gardes vivent dans `src/lib/pdf-correction.ts`, module pur et testé : étiquette inconnue, passage absent, passage ambigu, alignement de colonnes touché ou introduit, remplacement identique, remplacement beaucoup trop court, plafond de douze.
3. **La place disponible remplace le pourcentage d'allongement.** Le budget est la place libre **à droite de la ligne**, et l'échelle se déduit de la ligne elle-même (sa boîte rapportée à la largeur relative de son propre texte). Un ratio en caractères se trompait aux deux bouts — budget nul pour une cellule de cinq caractères entourée de vide, treize caractères de marge pour une ligne justifiée qui n'en a aucune — et ne voyait pas « resume » → « RÉSUMÉ », strictement de même longueur et un cinquième plus large.
4. **La typographie est alignée sur celle du document**, pas sur celle du modèle — mais **uniquement pour les marques réellement interchangeables** : apostrophes (`’`/`'`, la même marque à la fonte près) et guillemets (`«»`/`""`/`""`, en respectant leur sens d'ouverture). **Les tirets sont exclus** : trait d'union, demi-cadratin et cadratin ne veulent pas dire la même chose, et les aligner transformait « sous-ensemble » en « sous—ensemble » dès que la ligne contenait un cadratin ailleurs. **On ne déplie jamais `œ` en `oe` ni ne désaccentue une majuscule** : ce serait réintroduire une faute pour en faire passer une autre. Tous ces cas-là se refusent en clair, avec le caractère en cause.
5. **Acceptation ligne à ligne**, jamais en bloc, et le diff **rend visibles les caractères invisibles** (espaces insécables, espaces multiples). Sans cela, la relecture — seule vraie garantie de ce chemin — ne protégerait de rien.
6. **Le run porte un jeton `{path, page, revision}`** et la liste soumise. Changer de page, fermer la modale ou appliquer une première correction rend caduque toute proposition antérieure : elle viserait des lignes que l'utilisateur n'a jamais soumises.
7. **Cloud exigé.** Le modèle local retenu (`qwen2.5:1.5b-instruct-q4_0`) ne tient pas une sortie structurée sur cent lignes. L'action est désactivée avec sa raison affichée — jamais un bouton muet.
8. **Le fichier source n'est jamais écrasé.** Les corrections sont écrites dans les octets **en mémoire** ; la modale recharge le document depuis eux et re-rend la page — on regarde le résultat réel, substitutions comprises, pas un aperçu simulé. L'écriture disque reste le dialogue « Enregistrer une copie », et fermer avec des corrections non enregistrées demande confirmation.

**Le verbe produit est « corriger », jamais « réécrire ».** Corriger — orthographe, accords, dates, anglicismes — est borné, vérifiable et tient sous le moteur existant. Réécrire suppose un reflow qui n'existera jamais.

## Consequences

**Positives** : une page se corrige en un geste, avec une relecture ligne à ligne ; les refus sont explicites et portent leur raison ; la classe de défauts « le modèle écrit au mauvais endroit » est fermée par construction, pas par vigilance.

**Négatives** : le contrat est plus exigeant pour le modèle (`find` au caractère près), donc une part des propositions sera écartée avant même d'être montrée — c'est assumé, et compté. Le budget de largeur est une approximation, pas une mesure en métriques de police.

**Ce que le contrat rétrécit, et qu'il faut savoir** :
- **une seule correction par ligne** — si une ligne porte deux fautes, la seconde est écartée (« ligne déjà corrigée ») et demande une relance. Le prompt le dit au modèle, qui peut englober deux fautes proches dans un même `find` ;
- **`find` est borné à 60 caractères** : au-delà, le modèle recopierait la ligne ;
- **aucun patch ne peut toucher ni introduire une suite de deux espaces**, donc aucune correction n'est possible *dans* une gouttière de tableau. C'est le prix de la charpente préservée.

**Ce que ce palier ne couvre pas** (règle projet : un spike énumère sa zone d'ombre) :
- **la boucle avec un vrai modèle cloud n'a pas été jouée de bout en bout.** Le banc versionné exerce le parseur, le diff, l'application et le rechargement sur un vrai PDF, mais injecte la réponse. Rien ne prouve encore qu'un modèle de 2026 rende un `find` exact au caractère près sur des lignes de 6 à 16 caractères — c'est le pari central, et il reste à mesurer en natif ;
- **le coût de l'application croît avec le DOCUMENT, pas avec la page.** Mesuré à **175 ms** de bout en bout (écriture + rechargement + relecture des lignes + re-rendu) sur un PDF de 10 pages et 234 Ko — assez rapide pour qu'aucune frame ne s'affiche entre-temps, donc l'état « application en cours » ne se voit jamais. Mais `readEditableLines` relit **tout** le document à chaque application : sur deux cents pages, ce chiffre n'est plus le même et il faudra un témoin d'attente ;
- **le budget de largeur ne borne qu'à droite** : il ignore ce qui se trouve en dessous, donc un texte qui grandirait en hauteur (il ne le peut pas ici) ou une colonne dont la cellule voisine est vide sur cette rangée mais pleine sur la suivante ;
- la largeur en métriques réelles (`/Widths`) — un « W » et un « l » pèsent pareil au compteur de caractères, et le budget ne les distingue que par une table grossière ;
- le crénage : `rewriteTextRuns` réécrit en `TJ` à une seule chaîne et abandonne les décalages d'origine, donc même un remplacement de longueur identique peut changer la largeur rendue sur une ligne justifiée ;
- une seule page à la fois ;
- les lignes non éditables (police sans table de caractères, ligne non reliée au flux) ;
- la sémantique des tableaux et des colonnes : le modèle voit une liste plate, dans l'ordre de lecture de MuPDF, sans savoir qu'une ligne est une cellule ;
- les documents dont la police ne sait pas écrire le français : la correction sera refusée, ligne par ligne, avec les caractères en cause — **la faute que le modèle veut corriger est parfois celle que la police interdit de corriger** (un document qui écrit « Etat » n'a jamais employé « É », donc ne le contient pas).

## Related

- [ADR-0022](./0022-ecriture-pdf-pdf-lib.md) — écriture PDF · [ADR-0011](./0011-lecture-pdf-pdfjs.md) — lecture seule et la cicatrice Ctrl+S
- [ADR-0014](./0014-connexion-compte-openai-codex.md), [ADR-0018](./0018-fournisseur-cloud-compatible-openai.md) — consentement au fournisseur cloud
- [`.agent/analysis/mesure-lignes-pdf.md`](../../.agent/analysis/mesure-lignes-pdf.md) — la mesure qui a dicté le contrat
- [`docs/plans/correction-pdf-par-consigne.md`](../plans/correction-pdf-par-consigne.md) — le plan et ses deux revues
