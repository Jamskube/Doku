# PRD : Doku — lecteur/éditeur de documents léger

**Date** : 2026-07-08 · **Status** : Draft · **Version** : 1.0

## 1. Overview

Doku est une application desktop Windows (ARM64 natif) légère pour **ouvrir, lire et éditer des fichiers Markdown en WYSIWYG**, avec support HTML dès la v1 et extension prévue vers le PDF (v2). Outil personnel de son unique utilisateur (Surface Pro 11), pensé comme la « visionneuse par défaut » des documents texte : double-clic → lecture immédiate → édition fluide, sans la lourdeur d'un IDE ou d'une app de vault.

Référence : le repo `G:\KUDE` (Tauri 2 + Svelte 5) fournit le design system « AIR » (thème crème), le rendu Markdown sécurisé et le pattern d'onglets.

## 2. Problem statement

Aujourd'hui, ouvrir un `.md` sur la machine signifie lancer VS Code (lourd, orienté code) ou Obsidian (impose un vault), et les formats sont éclatés entre plusieurs apps (md, html, pdf). Il n'existe pas d'outil qui s'ouvre en moins d'une seconde sur un double-clic, affiche un rendu propre, et permette d'éditer directement dans ce rendu. Résultat : friction à chaque consultation ou retouche de note, et jonglage permanent entre applications.

## 3. Target users

Utilisateur unique (l'auteur), sous trois casquettes :

| Persona | Objectif | Douleur actuelle |
|---|---|---|
| **Lecteur** — consulte une doc/note | Double-clic → rendu propre instantané | Démarrage lent, UI d'IDE chargée |
| **Rédacteur** — écrit et retouche des notes | Éditer dans le rendu, sans voir la syntaxe brute | Bascule mentale rendu/source, outils orientés code |
| **Organisateur** — navigue dans un dossier de notes | Explorer, suivre des liens entre notes, retrouver | Vault imposé (Obsidian) ou pas de navigation (visionneuses) |

## 4. Functional requirements

### FR-1 : Ouverture & association de fichiers
Description : Doku s'enregistre comme application pour `.md`/`.markdown`/`.txt`/`.html` et ouvre tout fichier vite, par double-clic, dialogue ou glisser-déposer.
User story : En tant que lecteur, je veux double-cliquer un `.md` et le lire immédiatement, pour ne plus attendre un IDE.
Acceptance :
- Given Doku installé et associé, When je double-clique un `.md` dans l'Explorateur, Then le document s'affiche rendu en moins de 1,5 s à froid (0,5 s si l'app tourne déjà, dans un nouvel onglet de l'instance existante — instance unique).
- Given un fichier de 5 Mo ou plus, When je l'ouvre, Then l'app reste réactive (pas de gel > 200 ms) et affiche le document (virtualisation ou rendu progressif si nécessaire).
- Given un fichier non-UTF-8 ou binaire, When je l'ouvre, Then Doku affiche un message clair (« encodage non supporté ») sans planter ni corrompre le fichier à la sauvegarde.
Priority : **P0**

### FR-2 : Rendu Markdown fidèle et sûr
Description : rendu GFM complet (tableaux, listes de tâches, blocs de code colorés, images locales), sanitizé.
User story : En tant que lecteur, je veux un rendu propre et complet de mes notes, pour les lire comme un document fini.
Acceptance :
- Given un document GFM (tableaux, task lists, code fences, images relatives), When il s'affiche, Then tous ces éléments sont rendus, blocs de code avec coloration syntaxique, images locales résolues relativement au fichier.
- Given un document contenant du HTML inline avec `<script>` ou handlers `onclick`, When il s'affiche, Then aucun script ne s'exécute (sanitization type allowlist, cf. `sanitize.ts` de KUDE).
- Given une image référencée manquante, When le document s'affiche, Then un placeholder discret apparaît à sa place sans casser la mise en page.
Priority : **P0**

### FR-3 : Édition WYSIWYG avec sauvegarde fiable
Description : édition directe dans le rendu, à la Typora — la syntaxe Markdown se révèle autour du curseur et se re-rend en la quittant ; sauvegarde sans perte.
User story : En tant que rédacteur, je veux corriger une phrase directement dans le rendu et sauver en Ctrl+S, pour retoucher sans changer de mode.
Acceptance :
- Given un document affiché, When je clique dans un paragraphe et tape du texte, Then l'édition se fait en place, la syntaxe du bloc courant est visible pendant l'édition et se re-rend quand le curseur en sort.
- Given des modifications non sauvées, When je presse Ctrl+S, Then le fichier est écrit de façon atomique et l'indicateur « modifié » de l'onglet disparaît ; le round-trip préserve le Markdown source (un document ouvert puis sauvé sans édition est identique octet pour octet, hors normalisation documentée).
- Given des modifications non sauvées, When je ferme l'onglet ou l'app, Then une confirmation propose Sauver / Ignorer / Annuler.
- Given un fichier modifié sur disque par un autre programme, When Doku a le focus, Then il propose de recharger (ou recharge silencieusement si aucune modification locale).
Priority : **P0**

### FR-4 : Onglets multi-documents
Description : plusieurs documents ouverts dans une même fenêtre, formats mélangés, session restaurée.
User story : En tant que rédacteur, je veux garder plusieurs notes ouvertes côte à côte, pour naviguer entre elles sans rouvrir.
Acceptance :
- Given un document ouvert, When j'en ouvre un second, Then il s'ouvre dans un nouvel onglet actif ; deux fichiers homonymes affichent un différenciateur (dossier parent).
- Given plusieurs onglets, When je presse Ctrl+Tab / Ctrl+W, Then je cycle entre onglets / ferme l'onglet courant.
- Given des onglets ouverts, When je relance Doku, Then la session précédente est restaurée (mêmes onglets, onglet actif identique) ; un fichier disparu entre-temps est signalé puis retiré.
Priority : **P0**

### FR-5 : Mode source
Description : vue de la source brute (CodeMirror) en complément du WYSIWYG, pour les cas où la syntaxe exacte compte.
User story : En tant que rédacteur, je veux basculer ponctuellement sur la source brute, pour contrôler précisément la syntaxe (frontmatter, HTML inline).
Acceptance :
- Given un document en WYSIWYG, When je presse le raccourci de bascule (ex. Ctrl+/), Then la source s'affiche dans un éditeur avec coloration Markdown, curseur positionné au même endroit du document.
- Given des éditions en mode source, When je rebascule en WYSIWYG, Then le rendu reflète exactement la source, sans perte (undo conservé au sein de chaque mode au minimum).
Priority : P1

### FR-6 : Explorateur de dossier
Description : sidebar listant les fichiers du dossier du document actif (ou d'un dossier ouvert explicitement).
User story : En tant qu'organisateur, je veux voir les autres fichiers du dossier, pour naviguer dans mes notes sans repasser par l'Explorateur Windows.
Acceptance :
- Given un document ouvert, When j'affiche la sidebar (raccourci/toggle), Then les fichiers supportés du dossier apparaissent triés (dossiers puis fichiers, alphabétique) ; un clic ouvre dans un onglet.
- Given la sidebar masquée, When je démarre Doku, Then elle reste masquée (état persistant — l'app reste « légère » par défaut).
- Given un dossier contenant des fichiers non supportés, When la sidebar s'affiche, Then ils sont grisés ou masqués (pas d'ouverture en binaire).
Priority : P1

### FR-7 : Wikilinks cliquables
Description : liens `[[note]]` résolus dans le dossier courant (et sous-dossiers), navigables, sans base de données.
User story : En tant qu'organisateur, je veux cliquer un `[[lien]]` pour ouvrir la note visée, pour relier mes notes sans vault.
Acceptance :
- Given un document contenant `[[autre-note]]` et `autre-note.md` présent dans le dossier (ou un sous-dossier), When je clique le lien dans le rendu, Then la note s'ouvre dans un nouvel onglet.
- Given une cible ambiguë (deux fichiers homonymes), When je clique, Then un menu propose les candidats.
- Given une cible inexistante, When je clique, Then Doku propose de créer `autre-note.md` à côté du document courant.
Priority : P1

### FR-8 : HTML — lecture rendue + édition source
Description : les `.html` s'ouvrent rendus (sandbox), avec bascule vers l'édition de la source.
User story : En tant que lecteur, je veux ouvrir mes fichiers HTML dans le même outil, pour ne pas dépendre du navigateur pour des documents locaux.
Acceptance :
- Given un fichier `.html` local, When je l'ouvre, Then il s'affiche rendu dans un conteneur sandboxé (scripts désactivés par défaut ; pas d'accès réseau sans action explicite).
- Given un `.html` affiché, When je bascule en mode source, Then la source s'édite avec coloration HTML et se sauve en Ctrl+S ; le rendu se rafraîchit à la sauvegarde.
Priority : P1

### FR-9 : Confort de lecture
Description : thème crème (défaut) et sombre, largeur de colonne réglable, mode focus sans chrome.
User story : En tant que lecteur, je veux une mise en page douce et réglable, pour lire longtemps sans fatigue.
Acceptance :
- Given le premier lancement, When l'app s'ouvre, Then le thème clair **crème** (tokens AIR de KUDE : base `#F4F1E9`, contenu `#FDFBF5`, encre `#1C1A16`) est actif par défaut ; la bascule crème/sombre persiste entre sessions.
- Given un document affiché, When je règle la largeur de colonne (3 crans min : ~65ch / ~80ch / pleine largeur), Then le réglage s'applique immédiatement et persiste.
- Given le mode focus activé (raccourci), When je lis, Then toute l'interface (onglets, sidebar, barres) se masque, ne laissant que le document ; Échap restaure.
Priority : P1

### FR-10 : Table des matières
Description : sidebar des titres du document actif, navigation au clic.
User story : En tant que lecteur, je veux une TOC cliquable, pour me déplacer vite dans un long document.
Acceptance :
- Given un document avec des titres, When j'affiche la TOC, Then la hiérarchie H1-H3 apparaît, le titre courant est mis en évidence au scroll, un clic y déplace la vue.
- Given un document sans titres, When j'affiche la TOC, Then un état vide discret s'affiche.
Priority : P2

### FR-11 : Épinglage toujours au-dessus
Description : garder la fenêtre au-dessus des autres applications.
User story : En tant que rédacteur, je veux épingler une note au-dessus de mon travail, pour la consulter en continu.
Acceptance :
- Given l'app ouverte, When j'active l'épinglage (raccourci + bouton), Then la fenêtre reste au-dessus de toutes les apps ; l'état est visible dans l'UI et se désactive d'un clic.
Priority : P2

### FR-12 : Snapshots à la sauvegarde
Description : copie de version locale à chaque sauvegarde, avec restauration simple.
User story : En tant que rédacteur, je veux retrouver l'état d'hier d'une note, pour annuler une mauvaise réécriture.
Acceptance :
- Given un fichier sauvé plusieurs fois, When j'ouvre l'historique du document, Then les snapshots datés se listent, avec aperçu et restauration en un clic (le fichier courant est lui-même snapshotté avant restauration).
- Given des snapshots accumulés, When la limite est atteinte (ex. 20 par fichier ou 30 jours), Then les plus anciens sont purgés automatiquement.
Priority : P2

## 5. Non-functional requirements

| Catégorie | Exigence | Cible mesurable | Mesure |
|---|---|---|---|
| Performance | Démarrage à froid → document affiché | < 1,5 s | chrono sur Surface Pro 11 |
| Performance | Ouverture d'un onglet (app lancée) | < 500 ms pour un fichier < 1 Mo | chrono in-app |
| Performance | Latence de frappe WYSIWYG | pas de retard perceptible (< 33 ms/frame, pas de gel > 100 ms) | profiling sur doc de 500 Ko |
| Performance | Mémoire | < 400 Mo avec 5 onglets ouverts | Task Manager |
| Compatibilité | Binaire **Windows ARM64 natif** | aucune émulation x64 ; cible `aarch64-pc-windows` | vérif. Task Manager (archi du processus) |
| Sécurité | Aucun code des documents exécuté | sanitization allowlist (MD) ; sandbox sans script ni réseau (HTML) | tests avec documents piégés |
| Fiabilité | Zéro perte de données | écriture atomique ; confirmation avant fermeture non sauvée ; round-trip MD sans perte | tests automatisés round-trip |
| Hors-ligne | 100 % offline | aucune requête réseau au run (polices bundlées — piège KUDE) | moniteur réseau |
| Accessibilité | Pilotable au clavier | toutes les actions FR accessibles par raccourci ; contraste AA sur les deux thèmes | audit manuel |

## 6. Scope

**IN (v1)** — pourquoi : c'est le cœur « ouvrir/lire/éditer » + la navigation qui rend l'outil quotidien :
FR-1 à FR-12 ci-dessus (md, txt, html · WYSIWYG + source · onglets · explorateur · wikilinks · thèmes crème/sombre · TOC · épinglage · snapshots).

**OUT (différé)** :
| Élément | Reporté à |
|---|---|
| Coller intelligent (image presse-papier → fichier lié) | v1.5 |
| Recherche plein texte dans le dossier | v1.5 |
| Export md → PDF/HTML/DOCX | v1.5 |
| Lecture PDF | v2 |
| Annotations PDF | v2+ |
| Copilote IA local sur NPU (Gemma 3n ou équivalent) | v2+, après `/gate feasibility` |
| Portable zéro-install | non prioritaire (installateur accepté) |

**Assumptions** (impact si faux) :
- Une lib WYSIWYG-Markdown mature s'intègre à la stack choisie (impact : repli sur bascule preview↔source à la KUDE — le PRD reste valide, FR-3 dégrade en FR-5 promu P0).
- La toolchain retenue produit un binaire ARM64 Windows natif (impact : changer de stack à l'étape architecture).
- Le design system AIR de KUDE est réutilisable tel quel (impact : recréer les tokens avec Claude design — coût faible).

## 7. User journeys

**Journey principal — retoucher une note** :
| # | Action utilisateur | Réponse système |
|---|---|---|
| 1 | Double-clic sur `notes.md` dans l'Explorateur | Doku s'ouvre (ou nouvel onglet), rendu crème < 1,5 s |
| 2 | Lit, clique un `[[lien]]` | La note liée s'ouvre dans un onglet |
| 3 | Clique dans un paragraphe, corrige une phrase | Édition en place, syntaxe révélée sur le bloc courant |
| 4 | Ctrl+S | Sauvegarde atomique + snapshot, indicateur « modifié » disparaît |
| 5 | Ctrl+W puis ferme l'app | Onglet fermé sans friction ; session mémorisée |

Edge cases : fichier supprimé/renommé pendant l'édition (avertir, proposer « Enregistrer sous ») · document énorme (rendu progressif) · deux instances demandées (instance unique, focus + nouvel onglet).

## 8. Success metrics

| Métrique | Cible | Baseline | Mesure |
|---|---|---|---|
| App par défaut pour `.md`/`.txt`/`.html` sur la machine | activée et conservée > 1 mois | VS Code/navigateur | observation |
| Temps double-clic → lecture | < 1,5 s à froid | ~5-10 s (VS Code) | chrono |
| Usage | Doku utilisé quotidiennement pour les notes | — | auto-évaluation à 1 mois |
| Perte de données | 0 incident | — | suivi des snapshots/incidents |

## 9. Risks

| Risque | Prob. | Impact | Mitigation |
|---|---|---|---|
| Complexité WYSIWYG (le pari technique de la v1) | Haute | Haut | Spike d'archi sur une lib éprouvée (ProseMirror/Milkdown ou équivalent) avant `/epics` ; **repli défini** : bascule preview↔source (pattern KUDE), FR-5 promu P0 |
| Fidélité round-trip WYSIWYG ↔ source Markdown | Moyenne | Haut | Tests round-trip automatisés dès le début (NFR fiabilité) ; normalisations documentées |
| Écosystème ARM64 Windows (deps natives) | Basse | Moyen | Stack validée ARM64 à l'architecture ; KUDE (Tauri) tourne déjà sur la machine |
| Scope creep (projet perso, 19 idées retenues) | Moyenne | Moyen | Phasage v1/v1.5/v2 strict ; P2 coupables en premier si dérive |

## 10. Timeline & milestones

Pas de deadline externe — ambition « v1 complète et polie », la qualité prime. Jalons de progression :

| Jalon | Contenu | Critère de sortie |
|---|---|---|
| M0 — Architecture | stack, spike WYSIWYG, ADRs | `/gate readiness` PASS |
| M1 — Socle lecteur | FR-1, FR-2, FR-4 (ouvrir/lire/onglets, thème crème) | usage lecture quotidien possible |
| M2 — Éditeur | FR-3, FR-5 (WYSIWYG + source) | round-trip vert, édition quotidienne |
| M3 — Navigation | FR-6, FR-7, FR-8, FR-10 | dossier de notes navigable |
| M4 — Polish v1 | FR-9 complet, FR-11, FR-12, installateur | v1 « polie » installée et par défaut |

## 11. Open questions

1. **Lib WYSIWYG** : laquelle (ProseMirror/Milkdown, Tiptap, autre) s'intègre le mieux à la stack retenue ? → spike à `/architect-design`.
2. **Nom** : « Doku » est-il définitif (icône, nom d'installateur) ?
3. **Association `.txt`** : Doku doit-il vraiment prendre `.txt` par défaut (conflit Notepad) ou seulement le supporter à l'ouverture ?
4. **Snapshots** : emplacement (`.doku/` à côté des fichiers vs dossier AppData centralisé) — à trancher à l'architecture.
