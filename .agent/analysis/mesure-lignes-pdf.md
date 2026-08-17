# Mesure — à quoi ressemble vraiment une page de PDF qu'on voudrait corriger

_2026-08-17 · sonde jetable exécutée sur les 3 PDF réels de `C:\Users\nicos\Downloads\pdfmod`, page la plus dense de chaque document · instrument supprimé après lecture (autopilot `run-2026-08-17-2`)._

Mesuré **avant** d'écrire le prompt du spike « corriger une page par consigne », pour que le contrat modèle parte du document réel et non de l'idée qu'on s'en fait.

## Ce qui a été mesuré

| Document | Pages | Page analysée | Lignes | Éditables | Longueur médiane | Lignes coupées en milieu de phrase |
|---|---|---|---|---|---|---|
| `lic-tech 3.pdf` | 10 | 5 | 107 | 97 (91 %) | **16 car.** | **54 / 96** (56 %) |
| `manual.pdf` | 20 | 7 | 149 | 140 (94 %) | **6 car.** | **109 / 139** (78 %) |
| `plan-licence 5.pdf` | 16 | 4 | 71 | 70 (99 %) | **16 car.** | **57 / 69** (83 %) |

Raisons de non-éditabilité rencontrées : « Doku n'a pas su relier cette ligne au contenu du document » (9, 8 et 1 occurrences) et « la police du document ne sait pas écrire : `;` / `—` » (1 chacune).

## Couverture des polices — par police, jamais en union

24 caractères candidats testés (ceux qu'une correction française introduit : accents, majuscules accentuées, `œ`, apostrophes, guillemets, espaces insécables, tirets).

| Document | Polices | Absents de l'**union** | Pire police de la page |
|---|---|---|---|
| `lic-tech 3.pdf` | 3 | `Œ`, espace fine insécable | `f2` : 34 glyphes, **22/24 candidats absents** |
| `manual.pdf` | 3 | **tous les accents français**, `œ`, `Œ`, `'` (U+0027), `«`, `»`, espace fine | `f1` : 75 glyphes, 21/24 absents |
| `plan-licence 5.pdf` | 3 | `œ`, `Œ`, espace fine, `–` | `f2` : 48 glyphes, 19/24 absents |

## Les quatre conclusions qui changent la conception

1. **Une « ligne » de PDF n'est pas une phrase, c'est un fragment de mise en page.** Médiane de **6 à 16 caractères**, et **56 à 83 % des lignes continuent au milieu d'une phrase**. Une consigne « corrige les fautes » appliquée ligne par ligne, sans que le modèle voie la suite, corrigerait à l'aveugle. → Le prompt doit présenter les lignes **numérotées et contiguës**, en disant explicitement qu'une phrase peut être coupée entre plusieurs lignes, et interdire de **déplacer du texte d'une ligne à l'autre**.

2. **Une page dense fait 70 à 150 lignes, pas 40.** Le volume envoyé reste minuscule (~2 Ko), mais le plafond de remplacements et le panneau de relecture doivent tenir cette échelle.

3. **La couverture de police se juge police par police, jamais en union.** Sur `lic-tech 3.pdf`, l'union semble presque complète alors qu'une des trois polices de la page ne sait écrire que 34 glyphes. Une ligne s'écrit avec SA police : le refus tombera au niveau de la ligne, pas du document.

4. **`manual.pdf` ne sait écrire aucun accent français** — et possède `’` sans posséder `'`. Deux conséquences : (a) corriger un document anglais en français est structurellement impossible, et le refus doit être lisible ; (b) un modèle qui rend une apostrophe droite là où le document utilise l'apostrophe typographique se fait refuser **pour une différence invisible à l'œil**. → Normaliser la sortie du modèle sur les caractères réellement employés par la ligne d'origine (apostrophes, guillemets, tirets, espaces) avant de l'envoyer au moteur.

## Ce que la mesure ne dit pas

- Elle porte sur **3 documents**, tous de la même provenance. Le corpus de référence de l'étude de faisabilité en demande 10, dont un scanné et un à pages tournées.
- Elle ne mesure **aucune largeur** : « plus long » y est compté en caractères, pas en points.
- Elle n'a pas testé de PDF issu de LaTeX ni de page à deux colonnes, où l'ordre de lecture des blocs MuPDF peut ne pas suivre l'œil.
