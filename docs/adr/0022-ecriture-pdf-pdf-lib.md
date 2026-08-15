# 0022. Écriture PDF : `@cantoo/pdf-lib`, export non destructif — édition de texte refusée

Date : 2026-08-15 · Status : accepted · Deciders : Kubo · Tags : pdf, écriture, pdf-lib, annotations, formulaires, licence, arm64

## Context

L'ADR-0011 a doté Doku d'une **lecture** PDF (PDF.js, canvas, hors ligne) explicitement en lecture seule, et le sprint des annotations a livré un carnet **non destructif** : manifeste v5 stocké à côté du document, tout en tracés, coordonnées en fractions `0..1`, le PDF source jamais modifié.

L'utilisateur demande maintenant de « modifier un PDF », et a confirmé les quatre volets : **graver les annotations** dans le fichier, **manipuler les pages**, **éditer le texte existant**, **remplir les formulaires**.

Le point de départ technique est net : **PDF.js sait lire, il ne sait pas écrire** — son API display n'expose aucune sérialisation. Écrire du PDF impose donc une seconde bibliothèque. Le choix est contraint par : pur JS/WASM (Windows ARM64 **et** x64, aucun binaire natif — ADR-0004), 100 % hors ligne (principe 8.3), CSP stricte, et un dépôt **sans fichier `LICENSE`** — Doku est donc propriétaire par défaut, ce qui exclut l'AGPL.

L'étude complète est dans [`docs/planning/feasibility-pdf-edition.md`](../planning/feasibility-pdf-edition.md) (verdict CONDITIONAL_GO).

## Decision drivers

- Pur JS ⇒ ARM64 et x64 gratuits, zéro binaire natif (ADR-0004 tient).
- Licence compatible avec une distribution propriétaire.
- Le manifeste d'annotations doit **rester la source de vérité** — l'utilisateur doit pouvoir continuer à éditer, effacer et annuler après avoir exporté.
- Zéro réseau au runtime, CSP inchangée.
- Ne pas promettre à l'utilisateur une capacité que le format PDF ne permet pas.
- Bibliothèque **maintenue** — le projet a déjà payé le prix d'une dépendance figée.

## Considered options

### Option 1 : `pdf-lib` (original)
Référence historique du domaine, MIT, pur JS. · **Pros** : API mûre, modification de documents existants, dessin vectoriel, polices, pages, formulaires. · **Cons** : figé à **1.17.1 depuis 2021**, maintenance déclarée inactive.

### Option 2 : `@cantoo/pdf-lib` (fork maintenu)
Fork MIT de `pdf-lib`, **2.8.1**, publié il y a onze jours. · **Pros** : même API, corrections en cours, ajoute le dessin SVG (`drawSvgPath`, `drawSvg`) qui sert directement aux tracés du carnet. · **Cons** : dépendance à un fork communautaire ; l'éditeur ne garantit le support que dans le périmètre de sa propre feuille de route.

### Option 3 : MuPDF.js (Artifex, WASM)
Le moteur le plus complet du domaine, y compris le caviardage. · **Pros** : fidélité, redaction réelle, manipulation riche. · **Cons** : **AGPL ou licence commerciale sur devis** — rédhibitoire pour un Doku propriétaire ; poids WASM ; et **ne fait pas non plus d'édition de texte en place**.

### Option 4 : PDFium en WASM (`@embedpdf/pdfium`, `@hyzyla/pdfium`)
Le moteur PDF de Chrome, BSD, compilé en WASM. · **Pros** : licence permissive, qualité Google/Foxit. · **Cons** : son API publique **ne fait pas le sous-ensemblage de police** (« out of the scope of PDFium ») ; les wrappers JS disponibles n'exposent que le **rendu et l'extraction**, pas l'édition ; poids WASM pour une capacité qu'on n'obtient pas.

### Option 5 : écrire le PDF nous-mêmes
· **Pros** : aucune dépendance. · **Cons** : réécrire un analyseur/sérialiseur PDF (xref, flux compressés, chiffrement, polices) — hors de proportion.

## Decision

**Retenu : `@cantoo/pdf-lib`** (option 2), chargée en `import()` dynamique au point d'usage — comme `docx` (ADR-0010) — donc hors du bundle principal. La conversion de repère (fraction `0..1` → points PDF, origine en bas à gauche, rotation `/Rotate` appliquée) vit dans un module pur `src/lib/pdf-write.ts`, testable sans navigateur, sur le modèle de `pdf-drawing.ts`.

Trois volets sont **acceptés** : graver les annotations, manipuler les pages, remplir et aplatir les formulaires AcroForm.

**Le quatrième est refusé : l'édition du texte existant est un NO_GO de format.** Ce n'est pas une limite de JavaScript ni du choix de bibliothèque, et aucun budget ne la lève :

- `pdf-lib` le déclare : il modifie le contenu des champs de formulaire, mais **« ne fournit pas d'API pour supprimer ou modifier du texte sur une page en dehors d'un champ de formulaire »**.
- **PDFium** sait créer un objet texte, mais laisse le sous-ensemblage de police hors périmètre — il faut donc fournir une police complète, donc **substituer**, donc quitter la police du document.
- **MuPDF / PyMuPDF**, le moteur open source le plus complet, ne fait pas d'édition en place non plus : sa recette officielle est **caviarder puis réinsérer**, et Artifex documente lui-même les ratés (polices embarquées mal reproduites, texte qui ne retombe pas sur la ligne hors des 14 polices standard, casse sur le multiligne).

La cause est le format : un PDF ne stocke ni paragraphes ni lignes, seulement des glyphes positionnés un par un, dans des polices **sous-ensemblées** qui ne contiennent souvent que les caractères déjà utilisés. Rien ne reflue.

**Ce qui est retenu à la place** : « **remplacer un passage** » — supprimer réellement les glyphes puis réinsérer un texte, avec substitution de police **assumée et affichée** dans l'interface. Jamais présenté comme de l'édition de texte.

Deux règles fermes accompagnent la décision :

1. **Graver est un export à sens unique.** Le manifeste v5 reste la vérité ; le PDF gravé est un produit, pas une synchronisation — sinon deux sources de vérité et des annotations devenues inéditables.
2. **Jamais d'écrasement du PDF source par défaut.** Toujours par dialogue « Enregistrer une copie », via `writeFileAtomic`. Le projet a déjà la cicatrice : un Ctrl+S sur un onglet PDF écrivait `content=''` et détruisait le fichier (garde `saveTab`, ADR-0011).

## Consequences

**Positives** : Doku produit enfin un PDF partageable contenant ses annotations ; aucun binaire natif ajouté (ADR-0004 intact, ARM64 et x64 gratuits) ; CSP inchangée et zéro réseau maintenu ; le carnet non destructif survit intact ; le refus documenté évite de relitiger l'édition de texte tous les trimestres.

**Négatives** : une dépendance de plus (~300 Ko, lazy-loadée) ; dépendance à un fork communautaire ; l'utilisateur n'aura pas l'édition de texte qu'il a demandée, et le libellé produit devra être honnête là-dessus.

**Risques → parades** :
- *Pages tournées mal gravées* → pdf-lib dessine dans le repère non tourné ; c'est exactement le défaut qui avait fait échouer le spike de sélection à 90/270°. Parade : la rotation est traitée dans `pdf-write.ts` sous tests, et le corpus de validation contient obligatoirement un document tourné.
- *Le manifeste ne stocke rien sur la rotation de page* → à combler avant la première gravure.
- *Acrobat plus strict que pdf.js* → un PDF « valide » selon pdf.js peut être refusé par Acrobat. Parade : la métrique de validation exige les **trois** lecteurs (Acrobat, Chrome, pdf.js).
- *Analyser un PDF hostile avec un second analyseur* → pdf-lib n'embarque aucun interpréteur JavaScript, donc ouvrir et réécrire n'exécute rien. Parade : à **prouver** par un PDF piégé, pas à supposer ; taille de fichier bornée ; on ne monte toujours ni `AnnotationEditorLayer` ni `ScriptingManager`, y compris pour les formulaires (les valeurs AcroForm passent par pdf-lib, pas par une couche PDF.js).
- *Le fork s'arrête à son tour* → l'API est celle de `pdf-lib` ; un retour à l'original reste possible au prix du dessin SVG.

## Validation

Non validé tant que le premier palier n'est pas mesuré. Critères, sur un corpus de **10 PDF réels** incluant un document à pages tournées, un export Word, un export LaTeX, un scanné et un document de 200 pages :

- **Gravure** : écart ≤ 2 px CSS entre la position dans Doku à 100 % et le PDF exporté rouvert dans Acrobat, Chrome et pdf.js ; surlignage en `multiply` ; 0 annotation perdue ; **fichier source bit-à-bit inchangé**.
- **Pages** : 10/10 recomposés s'ouvrent sans erreur dans les trois lecteurs ; 200 pages en < 3 s sur la Surface ARM64.
- **Formulaires** : valeurs présentes et non modifiables après aplatissement, **0 exécution** de JS embarqué prouvée sur un PDF piégé, 0 requête réseau.

Le volet « remplacer un passage » ne démarre qu'après le kill-test décrit dans l'étude de faisabilité (10 documents, PASS ≥ 7/10, FAIL ≤ 3/10 — échec prédit, à prouver sur les documents réels de l'utilisateur).

## Related

- **[ADR-0023](./0023-licence-agpl.md) lève l'obstacle de licence invoqué ci-dessus** : Doku est passé en AGPL-3.0-or-later le jour même, MuPDF.js redevient donc utilisable. Le choix de `@cantoo/pdf-lib` pour **écrire** reste valable (plus léger, plus simple, suffisant pour graver et recomposer) ; c'est l'**extraction de structure** par MuPDF.js qui est à réexaminer.
- [ADR-0011](./0011-lecture-pdf-pdfjs.md) — **amendé** : la lecture reste PDF.js en canvas seul ; cet ADR ajoute un chemin d'**écriture** séparé et lève, sous conditions de preuve, l'interdiction de la couche formulaire.
- [ADR-0004](./0004-io-fichiers-plugins-officiels.md) — zéro Rust : écarte PDFium natif, impose le pur JS.
- [ADR-0010](./0010-export-docx-lib-lazy.md) — précédent de bibliothèque d'export lazy-loadée.
- [ADR-0008](./0008-pipeline-export-pdf-window-print.md) — export PDF *depuis* Markdown (autre sens, ne se recouvre pas).
- [`docs/planning/feasibility-pdf-edition.md`](../planning/feasibility-pdf-edition.md) — étude, kill-test, points d'arrêt et sources.
- [`docs/planning/feasibility-pdf-annotations.md`](../planning/feasibility-pdf-annotations.md) — le palier non destructif déjà livré.
