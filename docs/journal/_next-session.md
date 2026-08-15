# Next session pointer
_Updated: 2026-08-15 09:20_

## Where I left off
Doku sait désormais **écrire** du PDF, pas seulement le lire. Deux paliers de l'ADR-0022 sont livrés et vérifiés : **graver les annotations** dans une copie du document (surlignages en `multiply`, tracés en Béziers, formes, et les notes converties en vraies annotations PDF lisibles dans Acrobat), et **organiser les pages** (pivoter, supprimer, réordonner au glisser-déposer, fusionner un autre PDF). Les deux passent par un dialogue « Enregistrer une copie » — le document source n'est jamais réécrit.

Le chemin y a mené par une décision plus lourde : deux études de faisabilité ont buté sur le même mur — MuPDF.js puis SuperDoc, tous deux AGPL — ce qui a révélé que Doku n'avait **aucun fichier `LICENSE`**. Il est donc passé en **AGPL-3.0-or-later** (ADR-0023), ce qui ouvre les deux moteurs nécessaires à l'édition de documents.

## Open work
- Branch: `main`, tout est poussé jusqu'à `330fb61` ; restent à commiter le journal, le pointeur, l'ADR-0022 mis à jour et le correctif du script sidecar.
- Installateurs : ARM64 reconstruit sur cet état. **x64 pas encore reconstruit.**
- **Version inchangée à 2.2.0** alors que deux fonctionnalités sont arrivées — à trancher (le fichier x64 sur disque avait été renommé 2.4.0 à la main).

## Next concrete step
Faire le **smoke natif sur la Surface** avec l'installateur ARM64 : ouvrir un vrai PDF annoté, `Exporter → PDF avec les annotations`, vérifier le fichier produit dans Acrobat ; puis `Exporter → Organiser les pages…`, pivoter/supprimer/fusionner et enregistrer. Ce sont les deux chemins que le banc navigateur ne peut pas couvrir : le dialogue de fichier Tauri et l'écriture réelle sur disque.

## Restes connus, non bloquants
- **Palier 4 (formulaires AcroForm) : non commencé.** L'amendement de l'ADR-0011 sur la couche formulaire reste en suspens, et la preuve « 0 exécution de JS sur un PDF piégé » n'a pas été faite. Rien n'est branché côté produit.
- **Palier 3 (« remplacer un passage ») : non commencé**, et conditionné au kill-test décrit dans `feasibility-pdf-edition.md` (10 PDF réels, échec prédit).
- **Piste DOCX** (PDF → DOCX → édition → PDF) : ouverte par le passage en AGPL, non commencée. SuperDoc pour l'édition, MuPDF.js pour l'extraction de structure. Chantier de plusieurs semaines : second moteur d'édition (ProseMirror à côté de CM6), `kind: 'docx'`, conversion retour. La qualité de conversion restera en dessous de Convertio.
- **Sécurité, à traiter en priorité** : `pdfjs-dist` est en **6.1.200** et l'avis « exécution de JavaScript arbitraire à l'ouverture d'un PDF malveillant » couvre `>=5.6.83 <6.2.108`. **Le correctif existe : 6.2.108.** Non appliqué aujourd'hui à dessein — le bump aurait invalidé les vérifications de rendu tout juste faites, et il ne fallait pas livrer un moteur non revérifié. La parade en place reste l'ADR-0011 (aucune couche scripting ni annotation montée), qui rend Doku probablement hors d'atteinte de ce vecteur précis — « probablement » n'étant pas une garantie. À faire : monter en 6.2.108, puis rejouer les bancs `.agent/visual/pdf-annotations/` et `pdf-burn/`.
- `npm audit` signale 4 autres vulnérabilités **préexistantes** (dompurify, nanoid, postcss, undici), sans rapport avec le travail du jour.
- `PdfView.svelte` fait ~3 000 lignes ; le peintre SVG gagnerait à sortir en module `lib`.
- Le zoom ne se mémorise pas d'un document à l'autre.
