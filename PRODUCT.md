# Product

## Register

product

## Platform

web

## Users
Utilisateur unique, pour l'instant : le créateur de Doku, sur une Surface Pro 11 (Windows ARM64, Snapdragon X Elite). C'est quelqu'un qui lit et écrit des notes Markdown au fil de la journée — de la prise de note rapide à la relecture longue — et qui veut ouvrir un fichier local aussi simplement qu'on pose une feuille sur la table. Le contexte d'usage est le travail personnel hors-ligne : pas de vault, pas de compte, pas de cloud. Doku est taillé pour cet usage d'abord ; une diffusion publique reste possible plus tard mais ne dicte pas les choix aujourd'hui.

## Product Purpose
Doku ouvre, lit et édite des fichiers Markdown locaux (et HTML, bientôt PDF) en rendu WYSIWYG « live preview », sans jamais réécrire ni corrompre le fichier source. C'est un lecteur/éditeur léger et natif, conçu pour remplacer l'app par défaut des `.md` sous Windows : double-clic → le document s'affiche, propre et fidèle, en moins d'une seconde et demie. Le succès, c'est de pouvoir vivre avec ses notes au quotidien — les ouvrir, les retoucher en place, les sauver — sans jamais se demander si l'outil a abîmé quelque chose ni sentir le poids d'un logiciel entre soi et le texte.

## Positioning
Un lecteur/éditeur Markdown natif qui ouvre un fichier comme une feuille de papier — édition en place, fidélité byte-identique au fichier source, et une interface qui s'efface dès qu'on lit.

## Brand Personality
Calme, léger, discret. Doku a la voix d'un objet bien fait qui ne s'annonce pas : le chrome s'efface, le document parle. La sensation cible est celle du papier — une colonne de texte centrée, un interligne généreux, une typographie sereine (serif pour le corps, mono pour la source) — pas celle d'un logiciel qui réclame de l'attention. La légèreté n'est pas une pauvreté de fonctions mais une discipline : ce qui reste à l'écran l'a mérité. Rien ne rivalise visuellement avec le contenu.

## Anti-references
- **Les éditeurs Electron lourds** : démarrage lent, RAM énorme, chrome envahissant — l'exact opposé de « poser une feuille de papier ».
- **Les outils Markdown qui réécrivent la source** : normalisation, reformatage automatique, perte de fidélité à la sauvegarde. C'est l'anti-valeur numéro un ; Doku garantit le round-trip sans perte.
- **L'esthétique IDE / dashboard technique** : barres d'outils denses, thème « dev tool » sombre-néon, densité d'ingénieur. Doku est un espace de lecture, pas un cockpit.

## Design Principles
Le document parle, le chrome s'efface — l'interface se retire au profit du contenu, et le mode focus n'est que la limite de ce principe déjà présent partout.

La légèreté est une discipline — chaque élément à l'écran doit se justifier ; le défaut est minimal (sidebar masquée, démarrage vide, une seule fenêtre). On retranche avant d'ajouter.

Zéro perte, toujours — la fidélité au fichier sur disque prime sur toute commodité : round-trip byte-identique, écriture atomique, confirmation avant de perdre des modifications. L'outil n'a jamais le dernier mot sur les données de l'utilisateur.

Un geste pour le quotidien — ouvrir, sauver, basculer rendu/source se font en un seul geste ; les actions courantes ne coûtent jamais un détour.

Natif et hors-ligne par principe — ARM64 natif, aucune requête réseau, assets et polices embarqués. L'outil appartient à qui l'utilise et fonctionne sans dépendre de personne.

## Accessibility & Inclusion
Priorité au confort de lecture longue durée plutôt qu'à une conformité formelle : contraste de corps de texte lisible (viser ≥ 4,5:1 même sur les fonds teintés crème), typographie sereine et colonne bornée (~65–75 caractères), et respect strict de `prefers-reduced-motion` (déjà en place). Thèmes clair (crème) et sombre pour s'adapter à la lumière ambiante. Pas de cible WCAG documentée à ce stade, mais le bon sens exigeant d'un outil qu'on regarde des heures.
