# PRD : Doku v1.5 — recherche, export, lecture PDF

**Date** : 2026-07-13 · **Status** : Draft · **Version** : 1.0 · **Base** : [PRD.md](./PRD.md) (v1, feature-complete)

## 1. Overview

Doku v1 est feature-complete (lecture/édition WYSIWYG md/txt/html, onglets, explorateur, wikilinks, historique, épinglage). Ce PRD spécifie le **cap v1.5** : trois capacités qui étendent le cœur « lecteur/éditeur » sans changer la stack — **recherche plein-texte** dans un dossier, **export** du document (PDF, HTML autonome, DOCX), **lecture de PDF**, plus le **collage d'image** du presse-papier. Ces items étaient listés « OUT → v1.5 » dans le PRD v1. Le **copilote IA local** (Ollama sidecar, [ADR-0006](../adr/0006-copilote-ia-ollama-sidecar-cpu.md)) est **hors de ce PRD** — il fera l'objet d'un PRD v2 dédié.

## 2. Problem statement

La v1 rend Doku utilisable au quotidien, mais trois frictions subsistent. (1) **Retrouver** une info oblige à ouvrir les fichiers un par un — pas de recherche dans le dossier. (2) **Sortir** un document de Doku (partage, archivage, impression) est impossible : ni PDF, ni HTML autonome. (3) Les **PDF** — format explicitement visé dès le PRD v1 (« extension prévue vers le PDF ») — s'ouvrent encore dans une autre app. Accessoirement, illustrer une note impose de sauver manuellement chaque capture d'écran avant de l'insérer.

## 3. Target users

Mêmes personas que le PRD v1 (utilisateur unique, trois casquettes) — rappel ciblé sur ce cap :

| Persona | Ce que v1.5 lui apporte |
|---|---|
| **Lecteur** | Ouvre ses PDF dans Doku ; exporte un doc en PDF pour lire/imprimer ailleurs |
| **Rédacteur** | Colle une capture directement dans une note ; exporte en PDF/HTML/DOCX pour partager |
| **Organisateur** | Cherche un terme dans tout un dossier de notes et saute au résultat |

## 4. Functional requirements

### FR-1 : Recherche plein-texte dans un dossier
Description : chercher une chaîne dans tous les fichiers supportés d'un dossier (et sous-dossiers), résultats cliquables menant à l'occurrence.
User story : En tant qu'organisateur, je veux chercher un mot dans tout mon dossier de notes, pour retrouver une info sans ouvrir chaque fichier.
Acceptance :
- Given un dossier de contexte (celui du document actif, ou un dossier ouvert explicitement), When je lance la recherche (ex. Ctrl+Maj+F) et saisis une requête (casse-insensible par défaut), Then Doku liste les fichiers correspondants avec, par occurrence, le nom du fichier + un extrait de contexte (ligne, terme surligné), en **< 300 ms sur ~1000 fichiers** (~5 Mo cumulés).
- Given un résultat, When je clique dessus, Then le fichier s'ouvre dans un onglet, scrollé sur l'occurrence (ligne visible, terme mis en évidence).
- Given une requête sans correspondance, When la recherche s'exécute, Then un état vide clair s'affiche (« Aucun résultat »).
- Given des fichiers non supportés/binaires dans le dossier, When la recherche s'exécute, Then ils sont ignorés (aucune lecture binaire — réutilise `detectUnsupported`).
- Given une recherche en cours, When je modifie la requête, Then la recherche précédente est annulée (garde anti-périmé type req-token, cf. `loadSnapshotsForActive`).
Priority : **P0**

### FR-2 : Export PDF & HTML autonome
Description : exporter le document rendu en PDF (fidèle au WYSIWYG) et en fichier HTML autonome (styles + images inline).
User story : En tant que rédacteur, je veux exporter ma note en PDF ou en HTML autonome, pour la partager ou l'archiver hors de Doku.
Acceptance :
- Given un document md/html affiché, When je déclenche « Exporter → PDF », Then Doku produit un PDF fidèle au rendu via l'impression WebView2 (`window.print()` + feuille `@media print` : chrome masqué, sauts de page `break-inside: avoid`, marges), **100 % hors-ligne**.
- Given un document affiché, When je déclenche « Exporter → HTML autonome », Then Doku écrit **un seul** `.html` contenant le rendu, les styles inline (thème AIR) et les images en `data:` — aucune dépendance externe, ouvrable dans n'importe quel navigateur hors-ligne, **sanitizé** (aucun script).
- Given l'export PDF, When l'écriture se déroule, Then le piège WebView2 (#5199 : PDF supprimé si la webview est disposée trop tôt) est évité — privilégier « Microsoft Print to PDF » ou `ICoreWebView2.PrintToPdfAsync`, ne pas fermer la fenêtre avant fin d'écriture.
- Given un onglet non exportable (PDF en lecture, fichier binaire), When j'ouvre le menu export, Then les entrées sont grisées.
Priority : **P1**

### FR-3 : Lecture de PDF
Description : ouvrir un `.pdf` en lecture seule dans un onglet Doku, rendu par PDF.js bundlé localement.
User story : En tant que lecteur, je veux ouvrir mes PDF dans Doku, pour ne pas dépendre d'un autre lecteur.
Acceptance :
- Given un fichier `.pdf`, When je l'ouvre (double-clic / dialogue / explorateur), Then il s'affiche **en lecture seule** dans un onglet (PDF.js bundlé local, **100 % hors-ligne**), avec défilement multi-pages et zoom ; **1re page affichée < 1 s** pour un PDF de 10 Mo.
- Given la CSP stricte en place, When PDF.js s'initialise, Then son worker local est autorisé (`worker-src 'self' blob:`) **sans aucune requête réseau**.
- Given un PDF à charger, When Doku l'ouvre, Then les octets sont lus via `plugin-fs` et passés en `Uint8Array` à PDF.js (pas d'URL `file://`, cohérent avec le scope asset).
- Given `.pdf` ajouté aux formats supportés, When l'explorateur/les associations listent les fichiers, Then `.pdf` n'est plus masqué (`isSupportedFile`), mais aucun mode édition n'est proposé.
Priority : **P1**

### FR-4 : Coller une image du presse-papier
Description : `Ctrl+V` d'une image → écrit un fichier local à côté du document + insère le lien Markdown.
User story : En tant que rédacteur, je veux coller une capture d'écran directement dans ma note, pour l'illustrer sans sauver le fichier à la main.
Acceptance :
- Given un document Markdown **enregistré** (donc ancré à un dossier) en édition, When je colle (`Ctrl+V`) une image du presse-papier, Then Doku écrit l'image dans un sous-dossier à côté du fichier (ex. `assets/`) avec un **nom unique**, et insère `![](chemin-relatif)` au curseur.
- Given un document **non encore enregistré** (pas de `path`), When je colle une image, Then Doku demande d'abord d'enregistrer le document (l'image a besoin d'un dossier d'ancrage) avant d'écrire.
- Given le presse-papier contient du texte (pas d'image), When je colle, Then le comportement normal d'insertion de texte s'applique.
- Given l'écriture de l'image échoue (permissions), When je colle, Then un message clair s'affiche et **aucun lien cassé** n'est inséré. L'écriture **n'écrase jamais** un fichier existant.
Priority : P2

### FR-5 : Export DOCX (stretch)
Description : export du document en `.docx` via une lib OOXML JavaScript (arch-agnostique).
User story : En tant que rédacteur, je veux exporter en Word, pour les contextes qui l'exigent.
Acceptance :
- Given un document Markdown, When je déclenche « Exporter → DOCX », Then Doku produit un `.docx` ouvrable dans Word, mappant titres, gras/italique, listes, liens, tableaux et blocs de code (fidélité **raisonnable**, pas pixel-perfect).
- Given des éléments non mappables (HTML inline complexe), When l'export s'exécute, Then dégradation propre (texte brut) sans planter.
Priority : P2 — **stretch** : dépend d'une lib OOXML supplémentaire, fidélité limitée ; **coupable en premier** si le cap déborde, sans impacter FR-1 à FR-4.

## 5. Non-functional requirements

| Catégorie | Exigence | Cible mesurable | Mesure |
|---|---|---|---|
| Performance | Recherche dans un dossier | < 300 ms sur ~1000 fichiers (~5 Mo) | chrono in-app |
| Performance | Export PDF | < 3 s pour un doc ~50 pages | chrono |
| Performance | Lecture PDF, 1re page | < 1 s pour un PDF de 10 Mo | chrono |
| Hors-ligne | 100 % offline au runtime | PDF.js worker local, export local, lib DOCX bundlée ; 0 requête réseau | moniteur réseau |
| Compatibilité | ARM64 natif | PDF.js / lib DOCX = JS/WASM (indépendant de l'archi), aucun binaire natif ARM64 requis | vérif. archi processus |
| Sécurité | Pas d'exécution de contenu | PDF en lecture seule (pas de JS PDF exécuté) ; export HTML autonome sanitizé | tests documents piégés |
| Fiabilité | Zéro perte / écrasement | collage image = nom unique jamais écrasant ; export n'altère pas la source | tests automatisés |
| Accessibilité | Pilotable au clavier | recherche + export accessibles par raccourci ; contraste AA | audit manuel |

## 6. Scope

**IN (v1.5)** — pourquoi : ferme les 3 frictions post-v1 (retrouver, exporter, lire un PDF) sans nouveau risque de stack :
FR-1 recherche (P0) · FR-2 export PDF/HTML (P1) · FR-3 lecture PDF (P1) · FR-4 coller image (P2) · FR-5 export DOCX (P2 stretch).

**OUT (différé)** :
| Élément | Reporté à |
|---|---|
| Copilote IA local (Ollama sidecar CPU) | **v2 — PRD dédié** ([ADR-0006](../adr/0006-copilote-ia-ollama-sidecar-cpu.md)) |
| Annotations PDF / édition PDF | v2+ |
| Recherche **& remplacement** multi-fichiers | v2 (la recherche v1.5 est lecture seule) |
| Recherche regex / mot-entier avancée | ultérieur (v1.5 = sous-chaîne casse-insensible) |

**Assumptions** (impact si faux) :
- PDF.js s'intègre proprement sous la CSP stricte (impact : ajuster `worker-src`/`blob:` — déjà identifié, faible).
- `window.print` / `PrintToPdfAsync` en ARM64 donne un PDF fidèle (impact : repli `PrintToPdfAsync` COM via `with_webview()`, +effort borné).
- La lib `docx` (JS) suffit pour un mapping raisonnable (impact : FR-5 reste P2 et peut être **coupé** sans toucher au reste).

## 7. User journeys

**Journey A — retrouver puis partager** :
| # | Action | Réponse système |
|---|---|---|
| 1 | Ctrl+Maj+F, tape « budget » | Liste des fichiers + extraits surlignés, < 300 ms |
| 2 | Clique un résultat | Le fichier s'ouvre à l'occurrence (ligne surlignée) |
| 3 | Exporter → PDF | PDF fidèle produit, 100 % local, prêt à partager |

**Journey B — illustrer** : éditer une note enregistrée → `Ctrl+V` d'une capture → image écrite dans `assets/` + `![](assets/xxx.png)` inséré → `Ctrl+S`.
**Journey C — lire un PDF** : double-clic sur `rapport.pdf` → rendu lecture seule dans un onglet (scroll + zoom).

Edge cases : dossier énorme (annulation de recherche périmée) · doc non enregistré au collage (demander de sauver) · PDF corrompu (message clair, pas de plantage) · export d'un onglet PDF (grisé).

## 8. Success metrics

| Métrique | Cible | Baseline | Mesure |
|---|---|---|---|
| Recherche → résultat trouvé | < 300 ms, adoptée pour la nav quotidienne | ouverture manuelle fichier par fichier | chrono + usage |
| Export PDF | produit un PDF partageable, 0 dépendance externe | impossible (v1) | test manuel |
| PDF lus dans Doku | Doku ouvre les .pdf consultés | autre lecteur | usage à 1 mois |

## 9. Risks

| Risque | Prob. | Impact | Mitigation |
|---|---|---|---|
| Fidélité/effort DOCX (lib OOXML) | Moyenne | Moyen | P2 **stretch**, coupable en premier ; fidélité « raisonnable » assumée |
| Bug WebView2 print #5199 (PDF supprimé au dispose) | Basse | Moyen | `PrintToPdfAsync` ou « Microsoft Print to PDF » ; ne pas fermer avant fin d'écriture |
| Perf PDF.js sur gros PDF en ARM64 | Basse | Moyen | rendu paresseux page par page ; cible mesurable (1re page < 1 s) |
| Scope creep recherche → remplacement/regex | Moyenne | Moyen | v1.5 = recherche **lecture seule**, sous-chaîne ; le reste explicitement OUT |

## 10. Timeline & milestones

Pas de deadline externe — qualité prime. Jalons :

| Jalon | Contenu | Critère de sortie |
|---|---|---|
| M1 — Recherche | FR-1 | recherche < 300 ms, navigation au résultat |
| M2 — PDF & Export | FR-3 (lecture PDF), FR-2 (export PDF/HTML) | ouvrir un PDF + exporter un doc, hors-ligne |
| M3 — Confort & stretch | FR-4 (coller image), FR-5 (DOCX si le temps le permet) | illustrer une note ; DOCX si non coupé |

## 11. Open questions

1. **Emplacement des images collées** : `assets/` partagé vs `<nom-doc>.assets/` par document ? → trancher à `/architect-design` / UX.
2. **Association `.pdf`** : Doku doit-il s'associer aux `.pdf` par défaut (conflit lecteur système) ou seulement les ouvrir sur demande ?
3. **Recherche** : index en mémoire (construit à l'ouverture du dossier) vs scan à la volée ? → archi (perf/mémoire).
4. **Export PDF** : `window.print` (dialogue, choix utilisateur) vs `PrintToPdfAsync` (silencieux, chemin choisi) — UX à trancher.
