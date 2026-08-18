# Faisabilité — précision de la sélection PDF, et ce qu'Okular fait mieux

_Date : 2026-08-18 · Statut : **étude, rien de décidé** · Déclencheur : usage réel (utilisateur + collègue sous Arch)_

## Ce qui a déclenché l'étude

Deux remarques du même jour, qui se sont révélées être deux sujets :

1. « Quand j'essaie de sélectionner ou surligner du texte, c'est compliqué d'avoir exactement ce que je veux — dans Okular c'est top. » Après essais : **ça fonctionne, mais ça demande de la dextérité.** Défaut de précision, pas panne.
2. Okular fait plusieurs choses que Doku ne fait pas du tout.

## Ce qui a été TENTÉ et ÉCARTÉ — le mécanisme `endOfContent` de pdf.js

pdf.js expose deux étages : la classe `TextLayer` (bas niveau, celle que Doku utilise) pose les spans ; le **visualiseur officiel** ajoute par-dessus un bloc `endOfContent`, invisible et non sélectionnable, qui couvre la page pendant une sélection pour donner au glisser une surface où atterrir.

**Transplanté fidèlement — CSS identique à l'originale — et écarté après essai réel.** Résultats mesurés à l'usage :

| Mode | Effet |
|---|---|
| Surligneur (`text`) | **Aperçu entièrement disparu** : Doku masque volontairement la sélection native et peint sa propre géométrie ; le repère change les rectangles rendus par le navigateur, et il n'y a plus rien à peindre |
| Lecture (`read`) | **Sélection totalement bloquée** : le repère intercepte le glisser au lieu de le guider |

Borner le repère au seul mode lecture a rendu le surligneur intact — et laissé la sélection de lecture cassée. Le mécanisme a donc été **retiré entièrement**.

**Pourquoi il ne se transplante pas.** Chez pdf.js la couche texte est seule dans son cadre. Chez Doku elle est prise dans un empilement à trois étages — surlignage (`z-index: 1`), texte (`z-index: 2`, `overflow: clip`), dessin (`z-index: 3`) — et un bloc couvrant toute la page y intercepte le pointeur. Le mécanisme suppose une couche texte isolée ; nous n'en avons pas.

**Leçon** : « copié fidèlement depuis l'amont » n'est pas une vérification. Cette tentative a été livrée sans pouvoir être observée, et elle a cassé deux fonctions qui marchaient.

## Ce qu'on sait maintenant du vrai défaut

- Les deux modes ont des chemins **séparés** : lecture = sélection native du navigateur ; surligneur = géométrie balayée, peinte par Doku, sélection native masquée.
- Le surligneur est jugé **propre** à l'usage. Le problème est dans la **sélection de lecture**.
- Le code porte déjà l'aveu du symptôme, dans `selectionHighlight` : « la sélection déborde volontiers d'une ligne ; dès que le pointeur dépasse la fin d'une ligne, elle avale la suivante » — suivi d'un filtre vertical (`sweep`) qui compense **en aval**.
- Cause structurelle probable : les spans de pdf.js sont positionnés et étirés (`transform: scaleX`) pour épouser les glyphes du PDF. Le navigateur y calcule ses positions de caret avec **sa** mise en page, pas celle du PDF — d'où un décalage de quelques pixels, et des boîtes de lignes qui se chevauchent verticalement.

## Trois observations à faire avant de coder

Elles discriminent trois causes distinctes, et **aucun correctif ne doit partir avant** :

1. Glisser **dans une seule ligne**, du milieu d'un mot au milieu d'un autre → si imprécis : géométrie des spans.
2. Glisser **sur trois lignes** d'un paragraphe → si des bouts de lignes voisines sont avalés : chevauchement des boîtes.
3. Glisser **en dépassant la marge droite** → si la ligne suivante est avalée : débordement de fin de ligne (le cas que le filtre `sweep` compense déjà).

## La piste de fond — faire comme Okular

Okular ne passe pas par un DOM : il calcule la sélection sur la **géométrie du texte**, ce qui explique sa précision.

Doku sait déjà le faire : `rectQuote` mesure exactement ça (boîtes des spans, découpe aux bords) pour citer un surlignage. L'étendre à la sélection de lecture supprimerait d'un coup le débordement, le filtre de compensation, et la dépendance à la mise en page du navigateur.

**Coût honnête** : il faudrait peindre la sélection (le navigateur ne la dessinerait plus), gérer le double-clic-mot, le triple-clic-ligne, `Ctrl+A`, le copier, et l'accessibilité. C'est un chantier, pas un correctif. À ne lancer que si les trois observations montrent que la sélection native est irrécupérable.

## Ce qu'Okular fait et que Doku ne fait pas

Relevé sur [okular.kde.org](https://okular.kde.org/) et le dépôt KDE (GPLv2+, C++/Qt, ~20 ans, moteur Poppler).

| Fonction | Okular | Doku | Verdict |
|---|---|---|---|
| **Signatures numériques** | signe ET vérifie, détecte toute modification | rien | Okular loin devant |
| **Formulaires** | AcroForms remplis et enregistrés | palier 4 non commencé | Okular devant |
| **Formats** | PDF, EPUB, DjVu, CBR/CBZ, PostScript, images | PDF, Markdown, DOCX, HTML, texte | périmètres différents |
| **Sélection de zone / tableau** | extraction d'une région ou d'un tableau en texte | rien | **à voler** |
| **Mode présentation, loupe, vignettes** | oui | vignettes seulement | confort de lecture |
| **Édition** | aucune (visualiseur) | Markdown, DOCX, texte PDF en place | **Doku devant** |
| **Copilote IA** | aucun | RAG, citations cliquables, réécriture | **Doku devant** |

## Recommandation

**Ne pas courir après Okular sur son terrain.** Rattraper vingt ans de lecteur PDF pour arriver deuxième n'a pas d'intérêt : un utilisateur gardera Okular pour lire, et c'est très bien. Doku édite et raisonne sur les documents — ce n'est pas la même catégorie.

Deux choses valent d'être prises, parce qu'elles sont utiles ET bornées :

1. **Sélection de zone / tableau** — extraire un tableau d'un PDF en texte exploitable alimente directement le copilote et l'édition. Périmètre réduit, gain réel, et Doku a déjà la géométrie du texte.
2. **Vérification de signature** — *vérifier*, pas signer. Afficher « ce document est signé et intact » coûte bien moins cher que de gérer des certificats, et compte sur un document contractuel.

Les formulaires AcroForm restent au palier 4 de `feasibility-pdf-edition.md`. Savoir qu'Okular les fait bien, gratuitement, est surtout une raison de **ne pas se presser**.
