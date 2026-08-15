# Next session pointer
_Updated: 2026-08-15 14:22_

## Where I left off
La question du jour — « comment modifier un PDF dans Doku ? » — a été menée jusqu'à sa conclusion. Doku est passé en **AGPL-3.0-or-later** (ADR-0023), ce qui a débloqué MuPDF.js et SuperDoc, puis quatre capacités sont arrivées en production : gravure des annotations dans une copie du PDF, organisateur de pages (pivoter / supprimer / réordonner / fusionner), aller-retour PDF → DOCX → PDF, et surtout **l'édition du texte directement dans le flux de contenu** — celle que l'ADR-0022 déclarait impossible le matin même. C'est l'intuition de l'utilisateur (« coder de 0 une façon de modifier un PDF ») qui a fait basculer la journée, et elle était juste : en réécrivant les opérateurs `Tj`/`TJ` avec les codes de glyphes de la police déjà embarquée, police, taille, couleur, position, images et tableaux restent intacts *parce qu'on n'y touche pas*. Couverture mesurée à **92 %** des lignes visibles sur les propres documents de l'utilisateur. 29 commits, tout poussé, arbre propre. **Ce qui n'a PAS été vérifié : rien n'a tourné en natif sur la Surface** — toutes les preuves sont au navigateur et en tests.

## Open work
- Branche : `main` (propre, poussée jusqu'à `e6d0527`)
- PR ouvertes : aucune
- Plans / brouillons :
  - `docs/plans/edition-texte-pdf-en-place.md` — révision 3, exécutée ; sert de référence, pas de reste-à-faire
  - `docs/planning/feasibility-pdf-edition.md` — palier 4 (formulaires AcroForm) toujours non commencé
  - `docs/autopilot/run-2026-08-15.md` — journal de bord de la conduite autonome

## À trancher par toi (parqué, en attente depuis aujourd'hui)
1. **Le numéro de version** — toujours `2.2.0` alors que quatre fonctionnalités sont arrivées. Un installateur a été renommé `2.4.0` à la main : l'écart entre le nom du fichier et ce que le binaire déclare est un piège pour plus tard.
2. **`pdfjs-dist` → 6.2.108** — avis de sécurité (exécution de JS arbitraire à l'ouverture d'un PDF hostile). Volontairement différé pour ne pas invalider les vérifications de rendu faites dans la foulée. À faire **avant** la prochaine diffusion, avec re-passage des contrôles visuels.
3. **Installateurs** — ceux qui existent datent d'avant l'édition de texte. À reconstruire (ARM64 + x64) une fois les deux points ci-dessus tranchés.

## Next concrete step
Lancer Doku en natif sur la Surface et faire le parcours réel sur un vrai PDF — `Exporter → Modifier le texte…`, corriger une ligne, enregistrer la copie, rouvrir le fichier produit — c'est le seul maillon de la chaîne qui n'a encore jamais tourné hors du navigateur.
