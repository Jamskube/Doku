# Epics & Stories

_Source PRD : docs/planning/PRD.md (v1) + docs/planning/PRD-v1.5.md · Architecture : docs/planning/architecture.md · Décomposé le : 2026-07-09 (v1), 2026-07-13 (v1.5)_

Backlog **v1** (Epics 1-8, jalons M1-M4) : ✅ **livré, feature-complete** (ledger 35/35). Cap P0 respecté : 10/36 (28 %).
Backlog **v1.5** (Epics 9-12, source PRD-v1.5) : ✅ **livré, feature-complete** (ledger 46/46). Cap P0 : 3/11 (27 %).
Backlog **v2** (Epics 13-16, source PRD-v2 — copilote IA local) : 🟡 **Epic 13 livrée** (ledger 50/50, fondation copilote) ; Epics 14-16 à faire (**8 stories**). Cap P0 : **7/13 (54 %)** — dérogation assumée au seuil 40 % : la fondation (sidecar + client + panneau) est de l'infra **irréductiblement P0** (rien ne fonctionne sans elle), voir note Epic 13.
Légende état : ✅ fait · 🟡 amorcé (socle en place, à finir/tester) · ⬜ à faire.

---

## Epic 1 : Socle lecteur — ouvrir & rendre (FR-1, FR-2)

**Goal** : ouvrir n'importe quel fichier supporté et l'afficher rendu, propre et sûr, en moins de 1,5 s.
**Spans PRD** : FR-1, FR-2, NFR Performance/Sécurité.
**État** : 🟡 éditeur live preview branché sur une démo en mémoire — l'I/O réel et le rendu GFM complet restent à finir.

### Stories
| # | Title | Size | Priority | Acceptance |
|---|---|---|---|---|
| 1.1 | Ouverture réelle via dialogue + I/O natif (Ctrl+O) 🟡 | S | P0 | Given plugin-dialog/fs câblés, when j'ouvre un `.md` via Ctrl+O, then son contenu réel s'affiche dans un onglet (remplace la démo mémoire) |
| 1.2 | Détection d'encodage & fichiers non supportés | S | P1 | Given un fichier non-UTF-8/binaire, when je l'ouvre, then message « encodage non supporté » sans planter ni corrompre le fichier |
| 1.3 | Rendu GFM complet + coloration des blocs de code | M | P0 | Given un doc GFM (tableaux, task lists, code fences), when affiché, then tous rendus, code coloré syntaxiquement |
| 1.4 | Sanitization du HTML inline (allowlist) | S | P0 | Given un doc avec `<script>`/`onclick`, when affiché, then aucun script exécuté (SanitizeService type KUDE) |
| 1.5 | Images locales relatives + placeholder si manquante | S | P1 | Given une image relative (ou absente), when affiché, then résolue au dossier du fichier / placeholder discret sans casser la mise en page |
| 1.6 | Gros fichiers (≥ ~2 Mo) réactifs | M | P1 | Given un fichier ≥ 5 Mo, when ouvert, then app réactive (pas de gel > 200 ms), bascule mode source proposée |

---

## Epic 2 : Onglets & session (FR-4)

**Goal** : garder plusieurs documents ouverts dans une fenêtre et retrouver sa session au relancement.
**Spans PRD** : FR-4, NFR Performance (< 500 ms/onglet).
**État** : 🟡 UI onglets + cycle/fermeture faits ; instance unique câblée côté Rust ; restauration de session à construire.

### Stories
| # | Title | Size | Priority | Acceptance |
|---|---|---|---|---|
| 2.1 | Cycle & fermeture d'onglets (Ctrl+Tab / Ctrl+W) ✅ | S | P0 | Given plusieurs onglets, when Ctrl+Tab / Ctrl+W, then je cycle / ferme l'onglet courant |
| 2.2 | Nouvel onglet actif + différenciateur d'homonymes | S | P0 | Given un 2e fichier de même nom, when ouvert, then nouvel onglet actif avec le dossier parent en différenciateur |
| 2.3 | Instance unique + ouverture par double-clic/argument | M | P0 | Given Doku déjà lancé, when 2e ouverture, then focus + nouvel onglet dans l'instance existante (< 500 ms) |
| 2.4 | Glisser-déposer de fichiers dans la fenêtre | S | P1 | Given un fichier glissé sur la fenêtre, when lâché, then ouvert dans un onglet |
| 2.5 | Restauration de session | M | P1 | Given des onglets ouverts, when je relance Doku, then mêmes onglets + actif restaurés ; un fichier disparu est signalé puis retiré (`session.json` debouncé) |

---

## Epic 3 : Édition WYSIWYG fiable (FR-3, FR-5)

**Goal** : éditer dans le rendu à la Typora et sauver sans jamais perdre de données.
**Spans PRD** : FR-3 (P0), FR-5, NFR Fiabilité (zéro perte, round-trip).
**État** : 🟡 live preview + mode source Ctrl+/ + `writeTextFileAtomic` en place — à tester en natif et à durcir (round-trip, confirmations, watcher).

### Stories
| # | Title | Size | Priority | Acceptance |
|---|---|---|---|---|
| 3.1 | Édition live preview en place 🟡 | M | P0 | Given un doc, when je tape dans un bloc, then édition en place, syntaxe révélée au curseur, re-rendu à la sortie du bloc |
| 3.2 | Sauvegarde atomique + indicateur « modifié » (Ctrl+S) 🟡 | S | P0 | Given des modifs, when Ctrl+S, then écriture atomique (tmp + rename), badge « modifié » de l'onglet disparaît |
| 3.3 | Round-trip Markdown sans perte + tests auto | M | P0 | Given un doc ouvert non édité, when sauvé, then identique octet pour octet (hors normalisation documentée) ; suite de tests round-trip verte |
| 3.4 | Confirmation de fermeture non sauvée | S | P0 | Given un onglet dirty, when je le ferme/quitte, then dialogue Sauver / Ignorer / Annuler |
| 3.5 | Rechargement sur modification externe | M | P1 | Given un fichier modifié sur disque, when Doku a le focus, then propose recharger (silencieux si aucune modif locale) — watcher |
| 3.6 | Mode source Ctrl+/ (bascule sans remount) 🟡 | S | P1 | Given WYSIWYG, when Ctrl+/, then source colorée, curseur conservé, retour sans perte (via Compartment) |
| 3.7 | Widgets tableaux & images (rendu + édition source au clic) | L | P1 | Given un tableau/une image, when affiché, then rendu en widget ; au clic, édition de la source correspondante |

---

## Epic 4 : Navigation dans les notes (FR-6, FR-7, FR-10)

**Goal** : parcourir le dossier de notes et suivre les liens entre elles, sans vault ni base de données.
**Spans PRD** : FR-6, FR-7, FR-10.
**État** : 🟡 sidebar Fichiers = arbre démo ; wikilinks émettent déjà un événement au clic ; `docHeadings` (TOC) déjà calculé — résolveurs à construire.

### Stories
| # | Title | Size | Priority | Acceptance |
|---|---|---|---|---|
| 4.1 | Explorateur de dossier réel | M | P1 | Given un doc ouvert, when j'affiche la sidebar, then les fichiers supportés du dossier apparaissent triés (dossiers puis fichiers, alpha) ; un clic ouvre en onglet |
| 4.2 | État sidebar persistant (masquée par défaut) | S | P1 | Given la sidebar masquée, when je démarre Doku, then elle reste masquée (app « légère » par défaut) |
| 4.3 | Fichiers non supportés grisés/masqués | S | P2 | Given un dossier mixte, when la sidebar s'affiche, then les non supportés sont grisés (pas d'ouverture binaire) |
| 4.4 | Résolution & navigation des wikilinks 🟡 | M | P1 | Given `[[note]]` et `note.md` présent (dossier ou sous-dossiers), when je clique, then la note s'ouvre dans un onglet (scan + cache invalidé par watcher) |
| 4.5 | Désambiguïsation & création de wikilink | S | P2 | Given une cible ambiguë/inexistante, when je clique, then menu de candidats / proposition de créer `note.md` à côté |
| 4.6 | Table des matières cliquable 🟡 | S | P2 | Given des titres, when j'affiche la TOC, then H1-H3, titre courant surligné au scroll, clic déplace la vue |

---

## Epic 5 : HTML & multi-format (FR-8)

**Goal** : ouvrir et éditer des `.html` (et `.txt`) dans le même outil, en sécurité.
**Spans PRD** : FR-8, NFR Sécurité (sandbox).
**État** : ⬜ HtmlView non construite ; DocumentView à généraliser par format.

### Stories
| # | Title | Size | Priority | Acceptance |
|---|---|---|---|---|
| 5.1 | Rendu HTML sandboxé | M | P1 | Given un `.html` local, when ouvert, then rendu dans `<iframe sandbox>` sans script ni réseau, CSP `default-src 'none'` |
| 5.2 | Édition source HTML + refresh à la sauvegarde | S | P1 | Given un `.html` affiché, when je bascule en source, then source colorée éditable ; Ctrl+S rafraîchit le rendu |
| 5.3 | Support `.txt` (éditeur simple) | S | P2 | Given un `.txt`, when ouvert, then éditeur CM6 simple, sauvegarde fiable |

---

## Epic 6 : Confort de lecture (FR-9)

**Goal** : une mise en page douce, réglable, et un mode focus pour lire longtemps.
**Spans PRD** : FR-9, NFR Accessibilité.
**État** : 🟡 bascule crème/sombre fonctionne à l'écran — persistance, largeur de colonne et focus à ajouter.

### Stories
| # | Title | Size | Priority | Acceptance |
|---|---|---|---|---|
| 6.1 | Thème crème/sombre persistant 🟡 | S | P1 | Given le 1er lancement, when l'app s'ouvre, then thème crème par défaut ; la bascule persiste entre sessions (`settings.json`) |
| 6.2 | Largeur de colonne réglable (3 crans) | S | P1 | Given un doc, when je règle la largeur (~65ch / ~80ch / pleine), then appliqué immédiatement et persistant |
| 6.3 | Mode focus (masque tout le chrome) | S | P1 | Given le focus activé (F9), when je lis, then onglets/sidebar/barres masqués, ne reste que le document ; Échap restaure |

---

## Epic 7 : Fenêtre & versions (FR-11, FR-12)

**Goal** : épingler la fenêtre au-dessus des autres apps et retrouver les versions passées d'une note.
**Spans PRD** : FR-11, FR-12, ADR-0003.
**État** : 🟡 bouton/appel always-on-top câblé ; SnapshotService à construire.

### Stories
| # | Title | Size | Priority | Acceptance |
|---|---|---|---|---|
| 7.1 | Épinglage always-on-top 🟡 | S | P2 | Given l'app ouverte, when j'active l'épinglage (bouton/raccourci), then la fenêtre reste au-dessus, état visible, désactivable d'un clic |
| 7.2 | SnapshotService (copie à la save + purge) | M | P2 | Given un fichier sauvé plusieurs fois, when j'ouvre l'historique, then snapshots datés avec aperçu ; purge auto (20 versions / 30 j) — stockage ADR-0003 |
| 7.3 | Restauration depuis l'historique | S | P2 | Given des snapshots, when je restaure une version, then le fichier courant est snapshotté d'abord puis remplacé |

---

## Epic 8 : Distribution ARM64 (installateur & associations)

**Goal** : livrer un binaire ARM64 natif installé et enregistré comme app par défaut (métrique de succès du PRD).
**Spans PRD** : NFR Compatibilité/Hors-ligne, Success metrics, milestone M4.
**État** : 🟡 polices bundlées (@fontsource) ; `bundle.active: false` — build/installateur à activer et vérifier.

### Stories
| # | Title | Size | Priority | Acceptance |
|---|---|---|---|---|
| 8.1 | Build ARM64 natif vérifié | S | P1 | Given `tauri build --target aarch64-pc-windows-msvc`, when je vérifie le process, then ARM64 natif (aucune émulation x64), démarrage à froid < 1,5 s |
| 8.2 | Installateur NSIS + associations de fichiers | M | P1 | Given l'installateur, when installé, then `.md`/`.markdown`/`.html` associés (`.txt` proposé sans forcer) ; double-clic ouvre Doku |
| 8.3 | Zéro requête réseau au runtime | S | P1 | Given l'app lancée, when je monitore le réseau, then aucune requête (polices & assets bundlés) |

---

# Cap v1.5 — recherche, export, lecture PDF

_Source : docs/planning/PRD-v1.5.md · Décomposé le 2026-07-13. Les 2 blockers archi du gate readiness sont inscrits en **spikes** (9.1, 10.1), à trancher par la mesure avant de coder (pattern Spike S0)._

## Epic 9 : Recherche plein-texte (FR-1)

**Goal** : chercher un terme dans tout un dossier de notes et sauter au résultat, sans base de données.
**Spans PRD** : PRD-v1.5 FR-1 (P0), NFR Performance (< 300 ms / ~1000 fichiers).
**État** : ⬜ à faire.

### Stories
| # | Title | Size | Priority | Acceptance |
|---|---|---|---|---|
| 9.1 | Spike : stratégie d'index (mémoire vs scan à la volée) | S | P0 | Given un corpus ~1000 fichiers (~5 Mo), when je prototype scan-à-la-volée vs index-en-mémoire, then je tranche par la mesure (cible < 300 ms) et documente le choix (note/ADR) avant de coder 9.2 |
| 9.2 | Moteur de recherche (scan dossier + sous-dossiers, casse-insensible, garde anti-périmé) | M | P0 | Given un dossier de contexte, when je lance une requête, then les fichiers correspondants sont retournés avec extraits, < 300 ms sur ~1000 fichiers ; non-supportés/binaires ignorés (`detectUnsupported`) ; requête modifiée → recherche précédente annulée (req-token) |
| 9.3 | Panneau de recherche (raccourci Ctrl+Maj+F, saisie, résultats surlignés) | M | P0 | Given Ctrl+Maj+F, when je saisis une requête, then un panneau liste les fichiers + extraits (terme surligné) ; « Aucun résultat » clair si vide |
| 9.4 | Saut vers l'occurrence au clic | S | P1 | Given un résultat, when je clique, then le fichier s'ouvre dans un onglet scrollé sur l'occurrence (ligne visible, terme mis en évidence) |

---

## Epic 10 : Export de documents (FR-2, FR-5)

**Goal** : sortir un document de Doku en PDF, HTML autonome ou DOCX, hors-ligne.
**Spans PRD** : PRD-v1.5 FR-2 (P1), FR-5 (P2 stretch).
**État** : ⬜ à faire.

### Stories
| # | Title | Size | Priority | Acceptance |
|---|---|---|---|---|
| 10.1 | Spike : pipeline export PDF (`window.print` vs `PrintToPdfAsync`) | S | P1 | Given un doc rendu, when je compare l'impression WebView2 par dialogue vs `PrintToPdfAsync` (COM) sur ARM64, then je tranche fidélité/UX (piège WebView2 #5199) et documente avant de coder 10.2 |
| 10.2 | Export PDF (feuille `@media print`, fidèle WYSIWYG) | M | P1 | Given un doc md/html affiché, when « Exporter → PDF », then PDF fidèle produit (chrome masqué, sauts de page, marges), 100 % hors-ligne |
| 10.3 | Export HTML autonome (styles + images inline, sanitizé) | M | P1 | Given un doc affiché, when « Exporter → HTML autonome », then un seul `.html` avec styles inline (AIR) + images en `data:`, sanitizé, ouvrable hors-ligne partout |
| 10.4 | Export DOCX (lib OOXML JS) — **stretch** | M | P2 | Given un doc Markdown, when « Exporter → DOCX », then `.docx` ouvrable dans Word (titres/gras/listes/liens/tableaux/code, fidélité raisonnable) ; éléments non mappables → texte brut sans planter. **Coupable en premier** si le cap déborde |

---

## Epic 11 : Lecture PDF (FR-3)

**Goal** : ouvrir et lire un PDF en lecture seule dans un onglet Doku, hors-ligne.
**Spans PRD** : PRD-v1.5 FR-3 (P1) ; concrétise le point d'extension `DocumentView`/`PdfView` (architecture.md).
**État** : ⬜ à faire.

### Stories
| # | Title | Size | Priority | Acceptance |
|---|---|---|---|---|
| 11.1 | Viewer PDF.js bundlé local (lecture seule, scroll/zoom, worker sous CSP) | L | P1 | Given un `.pdf`, when ouvert, then rendu lecture seule via PDF.js bundlé (100 % hors-ligne), scroll multi-pages + zoom ; 1re page < 1 s (PDF 10 Mo) ; worker autorisé sous CSP (`worker-src 'self' blob:`) ; octets lus via plugin-fs en `Uint8Array` |
| 11.2 | `.pdf` comme format supporté (explorateur/associations, lecture seule) | S | P1 | Given `.pdf` ajouté à `isSupportedFile`, when l'explorateur/les associations listent, then `.pdf` visible et ouvrable ; aucun mode édition proposé |

---

## Epic 12 : Coller intelligent — image (FR-4)

**Goal** : coller une image du presse-papier directement dans une note, écrite comme fichier lié.
**Spans PRD** : PRD-v1.5 FR-4 (P2), NFR Fiabilité (zéro-écrasement).
**État** : ⬜ à faire.

### Stories
| # | Title | Size | Priority | Acceptance |
|---|---|---|---|---|
| 12.1 | Coller une image → fichier lié + insertion du lien | M | P2 | Given un doc Markdown **enregistré** en édition, when je colle (Ctrl+V) une image, then Doku l'écrit à côté (ex. `assets/`, nom unique jamais écrasant) et insère `![](chemin-relatif)` au curseur ; doc non enregistré → demande de sauver d'abord ; presse-papier texte → insertion normale ; échec écriture → message clair, aucun lien cassé |

---

# Cap v2 — copilote IA local

_Source : docs/planning/PRD-v2.md · Architecture : docs/planning/architecture-v2-copilot.md · Décomposé le 2026-07-14. Livraison en 2 temps : **v2.0** (Epics 13-14, fondation + usages doc) puis **v2.1** (Epics 15-16, RAG + rédaction). Les 2 blockers archi (cycle de vie sidecar, stack RAG) sont traités en **ADR** ([0012](../adr/0012-cycle-de-vie-sidecar-ollama.md)) et **spikes** (13.1, 15.1), à confirmer par la mesure avant de coder (pattern Spike S0/9.1/10.1)._

## Epic 13 : Moteur IA local — sidecar Ollama & modèles (FR-1, FR-2)

**Goal** : Doku embarque et pilote **son propre** moteur d'inférence local, et l'utilisateur gère ses modèles (pull / choisir / purger).
**Spans PRD** : PRD-v2 FR-1 (P0), FR-2 (P0) ; ADR-0006 (moteur), ADR-0012 (cycle de vie).
**État** : ✅ **livrée** (13.1-13.4 validées natif, Sprint 11) — génération ARM64 ~120 tok/s CPU, Job Object crash-kill, hors-ligne, gestion des modèles. **13.5** (packaging release) ajoutée au Sprint 12.
**Note P0** : les 5 stories sont P0 — c'est l'infrastructure dont **tout** le copilote dépend (pas de moteur → aucun usage). C'est la source de la dérogation au seuil P0 40 %.

### Stories
| # | Title | Size | Priority | Acceptance |
|---|---|---|---|---|
| 13.1 | Spike : sidecar Ollama ARM64 (externalBin, serve, generate, port éphémère) | M | P0 | Given `ollama.exe` ARM64 en `externalBin`, when Doku le lance sur un **port éphémère** et appelle `/api/generate` en **natif**, then une génération streame en local (**0 réseau**), spawn + kill vérifiés, pièges port/orphelin notés ; confirme l'hypothèse ADR-0012 **avant** de coder 13.2 |
| 13.2 | SidecarManager (port éphémère, readiness-poll, kill, pidfile) | M | P0 | Given le copilote activé, when Doku démarre le sidecar, then port libre choisi + **readiness-poll** avant le 1er appel ; **kill** à la fermeture ; **pidfile** → sweep d'un orphelin au démarrage ; port occupé/échec → message clair, app intacte (ADR-0012) |
| 13.3 | OllamaClient (generate stream, tags, pull, delete, annulation) | M | P0 | Given le sidecar prêt, when j'appelle le client, then `generate` streame (NDJSON) et **s'annule < 500 ms** (AbortController) ; `tags`/`pull`(progress)/`delete` exposés ; **0 requête non-`localhost`** à l'inférence |
| 13.4 | Gestion des modèles (liste, pull+progress, actif persistant, taille/purge) | M | P0 | Given le panneau modèles, when je l'ouvre, then modèles installés (nom, taille) + **actif** ; **pull** avec progression (action explicite) ; choix actif **persistant** (settings) ; **purge** confirmée (`%APPDATA%\Doku\models`) ; 0 modèle → onboarding vers un pull |
| 13.5 | Packaging release du sidecar (build ARM64 + install) | S | P0 | Given `npm run tauri build` puis l'installateur exécuté, when je lance **Doku installé** (hors dev), then le copilote génère — `lib/ollama` embarqué via `bundle.resources` et résolu par `resource_dir()` (chemin release **jamais prouvé**, S11) ; and un double-clic sur un `.pdf` l'ouvre en lecture seule (association `.pdf` validée « sur confiance » en S10). Ajoutée hors décomposition initiale (Sprint 12) pour solder les 2 dettes « à confirmer au prochain build+install » |

---

## Epic 14 : Panneau copilote & usages sur le document (FR-3, FR-4, FR-5)

**Goal** : dialoguer avec l'IA dans un panneau et l'appliquer au document ouvert (résumer, questionner).
**Spans PRD** : PRD-v2 FR-3 (P0), FR-4 (P0), FR-5 (P1).
**État** : ⬜ à faire. **Clôt v2.0** (copilote utilisable).
**Design (2026-07-16)** : maquette hifi Claude Design vendorée dans `docs/design/w2-copilot/`. Le copilote est un **panneau `aside` à DROITE** de la fenêtre (bouton collapse en haut-droite du doc), **pas** la vue sidebar gauche initialement supposée. Il **héberge aussi la gestion des modèles** (13.4 relocalisée, page `layers`). Story **14.0** (coquille + chrome + relocalisation) ajoutée en tête au Sprint 12, distincte de 14.1 (chat). Cadrage : doc courant seul en v2.0 ; puces `+ Contexte` multi-docs = coquille désactivée → câblage en Epic 15.

### Stories
| # | Title | Size | Priority | Acceptance |
|---|---|---|---|---|
| 14.1 | Panneau copilote (chat, streaming, annuler, rendu MD sanitizé) | M | P0 | Given le copilote (Ctrl+Maj+I / bouton sidebar), when j'envoie un message, then réponse **en streaming** token-par-token, **annulable** ; rendu Markdown **sanitizé** (pas de `{@html}` brut), copiable ; génération non perturbée par un changement d'onglet |
| 14.2 | Résumer le document | M | P0 | Given un doc md/txt/html/**PDF** affiché, when « Résumer » (ou sur la sélection), then résumé streamé ; doc > fenêtre de contexte → **segmentation map-reduce** (pas de troncature silencieuse) ; PDF scanné sans texte → message clair |
| 14.3 | Q&A sur le document courant | S | P1 | Given un doc affiché, when je pose une question, then réponse **ancrée** sur le doc ; info absente → « je ne trouve pas cela dans ce document » (pas d'invention) ; **0 requête réseau** |

---

## Epic 15 : Copilote sur le dossier — RAG (FR-6) — v2.1

**Goal** : interroger *le sens* de tout un dossier de notes (recherche sémantique + réponse citée).
**Spans PRD** : PRD-v2 FR-6 (P1). **Le plus gros chantier du cap** (risque n°1, isolé en v2.1).
**État** : ⬜ à faire.

### Stories
| # | Title | Size | Priority | Acceptance |
|---|---|---|---|---|
| 15.1 | Spike : stack RAG (embedding local + format d'index + perf/qualité ARM) | M | P1 | Given un dossier ~10²-10³ notes, when je prototype embeddings via Ollama + un index vectoriel, then je tranche **modèle d'embedding / format / incrémental** par la mesure (qualité top-k, temps d'index, empreinte) et documente en **ADR** avant de coder 15.2 |
| 15.2 | Index d'embeddings incrémental | L | P1 | Given un dossier de notes, when j'indexe, then chunking + embeddings **locaux** stockés (`%APPDATA%\Doku\rag`) ; ajout/modif/suppression → **ré-index incrémental** (hash) ; borné en ressources (ARM), n'empêche pas l'usage ; **0 réseau** |
| 15.3 | Q&A dossier avec citations sources | M | P1 | Given l'index, when je pose une question en mode « dossier », then passages pertinents récupérés (top-k) + réponse **citant les notes sources** (nom cliquable → ouvre le fichier) |

---

## Epic 16 : Assistance à la rédaction (FR-7, FR-8) — v2.1

**Goal** : améliorer le texte en place (reformuler, corriger) sans quitter la note.
**Spans PRD** : PRD-v2 FR-7 (P1), FR-8 (P1), NFR Fiabilité (zéro perte, annulable).
**État** : ⬜ à faire.

### Stories
| # | Title | Size | Priority | Acceptance |
|---|---|---|---|---|
| 16.1 | Reformuler une sélection | M | P1 | Given du texte sélectionné en édition, when « Reformuler » (variantes clarifier / raccourcir / ton), then proposition ; **accepter** → remplace (ou insère après) ; **refuser** → texte d'origine **intact** (zéro perte) |
| 16.2 | Corriger orthographe & grammaire | S | P1 | Given un texte (sélection ou doc), when « Corriger », then version corrigée **sans changer le sens ni le Markdown** ; appliquée → relisible/**annulable** (Ctrl+Z restaure) |

---

## Stories reportées / hors décomposition (non prêtes)

Signalées ici, **pas** dans le backlog tant que le critère d'acceptation n'est pas clair (règle : pas de story sans acceptance) :
- **Annotations PDF** — v2+ (la lecture est décomposée en Epic 11 ; les annotations restent non spécifiées)
- **Recherche & remplacement** multi-fichiers — v2 (la recherche v1.5 = lecture seule, Epic 9)
- **Annotations PDF** reste v2+ (non spécifié) ; **recherche & remplacement** multi-fichiers reste v2 (non décomposé).
- ~~Copilote IA local~~ → **décomposé** ci-dessus en Epics 13-16 (PRD-v2 + ADR-0006/0012).
