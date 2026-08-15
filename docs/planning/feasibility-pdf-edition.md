# Faisabilité — édition de PDF dans Doku

_Date : 2026-08-15 · Verdict : **CONDITIONAL_GO — 3 volets sur 4 faisables, l'édition de texte littérale est un NO_GO de format** · Portée évaluée : gravure des annotations, manipulation de pages, édition du texte, formulaires AcroForm_

## Décision en une phrase

Doku peut écrire du PDF — graver ses annotations, recomposer des pages, remplir des formulaires — avec une bibliothèque pur JS et sans toucher à l'ADR-0004. Il ne peut pas « éditer le texte » au sens où un utilisateur l'entend, **et personne ne le peut** : ce n'est pas une limite de JavaScript, c'est une limite du format PDF, que l'état de l'art contourne par caviardage et réinsertion.

---

## F1 — Objectif falsifiable

Quatre volets, quatre seuils. Corpus de référence commun : **10 PDF réels** de l'utilisateur, incluant obligatoirement un document à pages tournées (90/180/270°), un export Word, un export LaTeX, un scanné sans couche texte, un document de 200 pages.

| Volet | Métrique primaire | PASS | FAIL |
|---|---|---|---|
| **V1 — Graver les annotations** | Écart de position entre Doku à 100 % et le PDF exporté rouvert dans Acrobat, Chrome et pdf.js | ≤ 2 px CSS sur 10/10 documents, surlignage en `multiply`, 0 annotation perdue, source bit-à-bit inchangée | tout écart > 2 px, toute annotation manquante, toute modification du fichier source |
| **V2 — Manipuler les pages** | Intégrité du document recomposé (rotation, suppression, réordonnancement, insertion, fusion, extraction) | 10/10 s'ouvrent sans erreur dans les 3 lecteurs, ordre conforme, poids ≤ 1,15× la somme des sources, 200 pages recomposées en < 3 s sur la Surface ARM64 | un seul document corrompu ou refusé par Acrobat |
| **V3 — Éditer le texte** | Remplacer un mot de ≥ 6 lettres contenant un accent français **dans la police du document**, sans décaler le reste de la ligne | ≥ 7/10 documents | ≤ 3/10 documents |
| **V4 — Formulaires AcroForm** | Remplir puis aplatir 5 PDF à formulaire, dont un hybride XFA | valeurs présentes et non modifiables après aplatissement, **0 exécution** du JS embarqué (prouvée sur un PDF piégé), 0 requête réseau | toute exécution de script, toute valeur perdue |

**Référence** : Acrobat Pro fait V1, V2 et V4 sans effort, et fait V3 mal — c'est le témoin utile, pas un objectif.

**Repli** : si V3 échoue (prédit), il se réduit à « **remplacer un passage** » — supprimer réellement les glyphes puis réinsérer un texte, avec substitution de police assumée et affichée.

---

## F2 — Audit des hypothèses

| # | Hypothèse | Statut | Base / action |
|---|---|---|---|
| 1 | pdf.js lit mais n'écrit pas : il faut une seconde bibliothèque | **Supported** | ADR-0011 ; l'API display n'expose aucune sérialisation |
| 2 | Une bibliothèque pur JS réécrit un PDF existant sans le corrompre | **Supported** | pdf-lib le documente et c'est son usage principal |
| 3 | Pur JS ⇒ ARM64 et x64 gratuits, zéro binaire natif | **Supported** | précédents `docx` et `pdfjs-dist` dans le projet |
| 4 | Le manifeste v5 contient tout le nécessaire pour graver | **Plausible** | les fractions `0..1` suffisent pour la position ; **rien n'est stocké sur la rotation de page** ni sur la police des notes — à combler |
| 5 | Les pages tournées (`/Rotate`) se gèrent au dessin | **Plausible** | pdf-lib dessine dans le repère non tourné ; c'est exactement le défaut qui avait fait échouer le spike de sélection à 90/270° |
| 6 | Le `multiply` du surligneur se reproduit fidèlement | **Supported** | ExtGState `/BM /Multiply`, exposé par pdf-lib via `blendMode` |
| 7 | **On peut éditer le texte existant comme dans un traitement de texte** | **🚩 WISHFUL** | contredit par l'état de l'art (voir F3) — c'est l'hypothèse qui fait échouer les projets d'édition PDF |
| 8 | `pdf-lib` 1.17.1, sans release depuis 2021, est acceptable | **Plausible** | risque réel, levé par le fork `@cantoo/pdf-lib` 2.8.1 (MIT, publié il y a 11 jours) |
| 9 | Remplir un formulaire n'exécute pas le JS du PDF | **Plausible** | pdf-lib n'embarque aucun interpréteur JS, mais à **prouver** par un PDF piégé, pas à supposer |
| 10 | Un PDF accepté par pdf.js est accepté par Acrobat | **Plausible** | faux en général — Acrobat est plus strict ; c'est pour ça qu'il est dans les trois lecteurs de la métrique |

L'hypothèse 7 est la seule wishful, et c'est précisément celle que l'utilisateur a demandée.

---

## F3 — État de l'art externe

**Question posée** : peut-on, en pur JS/WASM, hors ligne, sans AGPL et sans binaire natif, éditer le texte d'un PDF existant ?

**Réponse : NON pour V3, OUI pour V1/V2/V4.** Justification quantitative et convergente :

- **pdf-lib** (MIT) documente explicitement la frontière : il *peut* modifier le contenu des champs de formulaire, mais **« ne fournit pas d'API pour supprimer ou modifier du texte sur une page en dehors d'un champ de formulaire »**. Ce n'est pas un oubli, c'est déclaré comme difficile et hors périmètre.
- **PDFium** (BSD, moteur PDF de Chrome) sait créer un objet texte (`FPDFPageObj_CreateTextObj` + `FPDFText_SetText` + `FPDFPage_InsertObject`), mais son API publique **ne fait pas le sous-ensemblage de police** — « font subsetting is out of the scope of PDFium ». Il faut donc fournir soi-même une police complète, donc **substituer**, donc ne plus être dans la police du document. Et les wrappers WASM disponibles (`@embedpdf/pdfium`, `@hyzyla/pdfium`) n'exposent que l'extraction de texte, pas l'édition.
- **MuPDF / PyMuPDF** (Artifex) — le moteur open source le plus complet du domaine — ne fait pas non plus d'édition en place. Sa recette officielle pour « remplacer du texte » est : **poser une annotation de caviardage sur la boîte du passage, l'appliquer, puis réinsérer du texte à la même position**. Artifex documente lui-même les ratés : polices embarquées mal reproduites, texte réinséré qui ne retombe pas sur la même ligne dès qu'on sort des 14 polices standard ou du CJK, et casse sur le multiligne.
- **MuPDF.js** est de toute façon **exclu par la licence** : AGPL, ou licence commerciale sur devis. Doku n'a aucun fichier `LICENSE`, donc est propriétaire par défaut, donc l'AGPL est incompatible avec sa distribution.

**Le plancher réaliste sous nos contraintes** est donc : caviardage + réinsertion avec police substituée — c'est-à-dire exactement ce que fait le meilleur moteur du marché, pas un pis-aller de bricolage. L'effort qu'une équipe de pointe y consacrerait ne change pas le plafond : la cause est que le PDF ne stocke ni paragraphes ni lignes, seulement des glyphes positionnés un par un, dans des polices **sous-ensemblées** qui ne contiennent souvent que les caractères déjà utilisés.

**Élément manquant X** : un moteur de mise en page inverse (reconstruire paragraphes et césures depuis des positions de glyphes) + une bibliothèque de sous-ensemblage de polices. Les deux existent séparément ; les assembler est un projet en soi, sans rapport avec le périmètre de Doku.

---

## F4 — Kill-test le moins cher

**Hypothèse visée** : la n° 7 (wishful). Coût ≈ ½ journée, soit < 5 % du projet.

```
Hypothèse   V3 littéral : remplacer un mot dans la police du document
Montage     10 PDF réels de l'utilisateur. Pour chacun : localiser un mot de
            ≥ 6 lettres contenant un accent français, énumérer la police
            embarquée du run, mesurer la couverture de glyphes pour le mot
            de remplacement, puis tenter la substitution et rouvrir.
Mesure      (a) glyphes disponibles dans la police embarquée ? oui/non
            (b) le reste de la ligne bouge-t-il de plus de 1 px ?
            (c) l'extraction texte de la sortie reste-t-elle cohérente ?
PASS        ≥ 7/10 documents avec (a) oui, (b) non, (c) oui
FAIL        ≤ 3/10  →  V3 devient officiellement « remplacer un passage »
AMBIGU      4-6/10  →  étendre à 20 documents (+ ½ journée), même seuil relatif
```

**Prédiction honnête : FAIL.** Les polices sous-ensemblées et le renoncement de MuPDF le disent déjà. Le kill-test ne sert pas à espérer un autre résultat — il sert à le prouver **sur les documents réels de l'utilisateur**, pour que le libellé produit soit défendable plutôt que subi.

---

## F5 — Points d'arrêt

| Jalon | Métrique falsifiable | Action si STOP |
|---|---|---|
| **~15 %** — V1 sur 1 document | Une annotation gravée, rouverte dans Acrobat, à ≤ 2 px de sa position Doku | Le choix de bibliothèque est mauvais → re-gater avant toute UI |
| **~50 %** — V1 sur 10 + V2 complet | 10/10 exportés lisibles par les 3 lecteurs, 0 corruption, source intacte | Un seul document corrompu = arrêt : le problème est le moteur d'écriture, pas le cas particulier |
| **~80 %** — V4 + kill-test V3 rendu | 0 exécution de JS sur le PDF piégé ; verdict V3 écrit et libellé produit tranché | Toute exécution de script = retrait immédiat du volet formulaires |

---

## Architecture recommandée

**Bibliothèque : `@cantoo/pdf-lib`** (MIT, 2.8.1, maintenu — le `pdf-lib` d'origine est figé à 1.17.1 depuis 2021). Pur JS : aucun binaire natif, ARM64 et x64 gratuits, conforme à l'ADR-0004. Chargée en **`import()` dynamique au point d'usage**, comme `docx` (précédent ADR-0010) — elle reste hors du bundle principal.

**Module** : un `src/lib/pdf-write.ts` pur, testable sans navigateur, sur le modèle de `pdf-drawing.ts` et `pdf-highlight-text.ts`. La conversion de repère (fraction `0..1` → points PDF, origine en bas à gauche, rotation `/Rotate` appliquée) y vit isolée et sous tests.

**Modèle** : le manifeste v5 **reste la source de vérité**. Graver est un **export à sens unique**, pas une synchronisation — sinon deux sources de vérité et des annotations gravées devenues inéditables.

**Écriture** : toujours par dialogue « Enregistrer une copie », `writeFileAtomic` déjà en place. **Jamais d'écrasement du PDF source par défaut** — la cicatrice existe déjà dans le projet : un Ctrl+S sur un onglet PDF écrivait `content=''` et détruisait le fichier (ADR-0011, garde `saveTab`).

**Séquencement proposé** :

1. **V1 — graver les annotations.** Toute la donnée existe ; c'est la valeur immédiate (un PDF partageable) pour le coût le plus faible.
2. **V2 — pages.** Moteur trivial, effort concentré dans l'interface (vignettes, glisser-déposer).
3. **V4 — formulaires.** Nécessite d'**amender l'ADR-0011**, qui interdit aujourd'hui la couche formulaire. La levée est défendable : pdf-lib lit et écrit les valeurs AcroForm sans monter de couche PDF.js et sans interpréteur JS — mais elle se prouve, elle ne se décrète pas.
4. **V3 réduit — remplacer un passage.** Après le kill-test, et présenté honnêtement dans l'UI comme un remplacement avec substitution de police, jamais comme de l'édition de texte.

---

## Sécurité

Écrire un PDF, c'est le faire analyser par un **second analyseur** d'un format actif. Points fermes :

- pdf-lib n'embarque aucun interpréteur JavaScript : ouvrir et réécrire n'exécute rien. À **prouver** par un PDF piégé au jalon 80 %, pas à supposer.
- Le rendu reste canvas seul ; on ne monte toujours ni `AnnotationEditorLayer`, ni `ScriptingManager`, y compris pour V4 (les valeurs de formulaire passent par pdf-lib, pas par une couche pdf.js).
- Zéro réseau maintenu (principe 8.3) : la bibliothèque est locale, aucune requête, CSP inchangée.
- Borner la taille du fichier accepté en écriture et le nombre d'objets recomposés.
- Toute réouverture depuis un manifeste continue de refuser URL, UNC, chemin de périphérique et traversée.

---

## Hors périmètre

- Édition de texte avec reflow, césure ou recomposition de paragraphe — **structurellement impossible**, quel que soit le budget.
- OCR des PDF scannés.
- Signature électronique et chiffrement.
- XFA dynamique (les formulaires XFA purs, par opposition aux hybrides, restent hors sujet).
- Compatibilité totale avec les annotations produites par Acrobat.

---

## Sources

- [pdf-lib — dépôt et limites documentées](https://github.com/Hopding/pdf-lib)
- [@cantoo/pdf-lib — fork maintenu](https://github.com/cantoo-scribe/pdf-lib) · [npm](https://www.npmjs.com/package/@cantoo/pdf-lib)
- [PDFium — API `fpdf_edit.h`](https://github.com/prepare/pdfium/blob/master/public/fpdf_edit.h) · [discussion sur le sous-ensemblage de police](https://groups.google.com/g/pdfium/c/3RlNe-r_PXU/m/UL3HIgxnAgAJ)
- [@embedpdf/pdfium — API JS/WASM exposée](https://www.embedpdf.com/docs/pdfium/introduction)
- [MuPDF.js — licence AGPL ou commerciale](https://github.com/ArtifexSoftware/mupdf.js/) · [licence MuPDF](https://mupdf.readthedocs.io/en/1.27.0/license.html)
- [Artifex — remplacer du texte via caviardage et réinsertion](https://artifex.com/blog/how-to-search-and-replace-text-in-pdfs-using-pymupdf) · [limites en pratique](https://github.com/pymupdf/PyMuPDF/discussions/3422)

## Related

- [ADR-0011](../adr/0011-lecture-pdf-pdfjs.md) — lecture seule à amender · [ADR-0004](../adr/0004-io-fichiers-plugins-officiels.md) — zéro Rust · [ADR-0010](../adr/0010-export-docx-lib-lazy.md) — précédent de lazy-load
- [feasibility-pdf-annotations.md](./feasibility-pdf-annotations.md) — le palier non destructif déjà livré
