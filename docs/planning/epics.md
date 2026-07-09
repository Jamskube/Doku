# Epics & Stories

_Source PRD : docs/planning/PRD.md · Architecture : docs/planning/architecture.md · Décomposé le : 2026-07-09_

Backlog de la v1 (jalons M1-M4 du PRD). **Cap P0 respecté** : 10/36 stories (28 %).
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

## Stories reportées / hors décomposition (non prêtes)

Signalées ici, **pas** dans le backlog tant que le critère d'acceptation n'est pas clair (règle : pas de story sans acceptance) :
- **Coller intelligent** (image presse-papier → fichier lié) — v1.5 (hors scope PRD)
- **Recherche plein texte** dans le dossier — v1.5
- **Export** md → PDF/HTML/DOCX — v1.5
- **Lecture/annotations PDF** — v2 (l'interface DocumentView le prépare, rien de construit)
- **Copilote IA local NPU** (Gemma 3n) — v2+, après `/gate feasibility`
