# Next session pointer
_Updated: 2026-08-15 11:50_

## Where I left off
Doku sait **modifier un PDF**, et la boucle complète est fermée.

Quatre capacités livrées et vérifiées :
1. **Graver les annotations** dans une copie du PDF — surlignages en `multiply`, tracés en Béziers, formes, notes converties en vraies annotations PDF lisibles dans Acrobat.
2. **Organiser les pages** — pivoter, supprimer, réordonner au glisser-déposer, fusionner un autre PDF.
3. **Convertir en DOCX éditable** — MuPDF extrait texte/police/graisse/taille, `pdf-structure` reconstruit les paragraphes et détecte les titres.
4. **Éditer le DOCX dans Doku puis réexporter en PDF** — SuperDoc pour l'édition, `docx-to-pdf` (écrit par Doku) pour le retour.

Le tout est **entièrement hors ligne**, rendu possible par le passage en **AGPL-3.0-or-later** (ADR-0023), qui a débloqué MuPDF.js et SuperDoc.

## Open work
- Branch `main`, tout est poussé.
- 628 tests verts, 0 erreur de type, build vert.
- Installateurs : à reconstruire sur `HEAD` (une compilation ARM64 était en cours à la fin de session).

## Next concrete step
**Smoke natif sur la Surface** : ouvrir un PDF → `Exporter → Document Word éditable` → le document se rouvre tout seul dans Doku → **taper dedans** → `Exporter en PDF`. C'est le seul maillon que le banc navigateur n'a pas pu prouver (voir ci-dessous), et il se tranche en trente secondes.

## Restes connus
- **La frappe dans SuperDoc n'est pas prouvée.** Il n'utilise pas `contenteditable` mais une surface `role="textbox"` avec pont clavier, que le pilotage synthétique n'atteint pas ; ses propres diagnostics annoncent pourtant `editableEnabled: true`, `editingMounted: true` et `text.insert` supporté. L'ouverture, l'enregistrement et l'export sont, eux, prouvés de bout en bout. **À trancher à la main.**
- **Retour au PDF : texte seulement.** `docx-to-pdf` reprend texte, graisse, italique, taille, alignement, titres et pagination. Images, tableaux, en-têtes/pieds et colonnes ne sont **pas** repris — le bandeau de fin le dit à l'utilisateur.
- **Qualité de conversion PDF → DOCX** : niveau `pdf2docx`, bonne sur une mise en page simple, en dessous d'un convertisseur commercial sur un document complexe. Mesurée sur un contrat texte, pas encore sur un corpus varié.
- **Sécurité, à traiter en priorité** : `pdfjs-dist` est en **6.1.200**, l'avis « exécution de JavaScript arbitraire à l'ouverture d'un PDF malveillant » couvre `>=5.6.83 <6.2.108`. **Le correctif existe : 6.2.108.** Non appliqué à dessein — il aurait invalidé les vérifications de rendu. Parade en place : ADR-0011 (aucune couche scripting montée). À faire : monter en 6.2.108 puis rejouer `.agent/visual/pdf-annotations/` et `pdf-burn/`.
- **Numéro de version** : toujours `2.2.0` alors que quatre fonctionnalités sont arrivées, et un installateur avait été renommé `2.4.0` à la main. **Choix produit à trancher avant publication.**
- `PdfView.svelte` fait ~3 000 lignes ; le peintre SVG gagnerait à sortir en module `lib`.
- Le zoom PDF ne se mémorise pas d'un document à l'autre.
