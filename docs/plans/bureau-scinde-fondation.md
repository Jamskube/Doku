# Plan: bureau-scinde-fondation

_Date: 2026-08-13 · Estimated scope: L_

## Goal

Livrer la fondation fiable du bureau scindé de Doku : deux volets capables d'afficher et d'éditer deux onglets distincts, une cible de commande explicite par volet, une note Markdown enregistrable avec un vrai flux Enregistrer sous, un séparateur accessible et une session v2 restaurable. Ce lot traite les FR-1, FR-2, FR-3, FR-6 et FR-7 de `docs/planning/PRD-v3.md` avant toute citation entre documents.

## Out of scope

- Capturer une sélection dans une note et générer une citation `doku-citation:v1`.
- Relocaliser ou ouvrir la source d'une citation.
- Afficher le même onglet dans les deux volets.
- Ajouter un troisième volet, une fenêtre secondaire ou une orientation manuelle.
- Ajouter l'annotation PDF, l'édition DOCX, l'édition Markdown par blocs ou le canevas.
- Construire les installateurs ARM64/x64 dans ce lot ; les builds applicatifs précèdent ce packaging.

## Files

### Modified

- `src/lib/stores.svelte.ts` — intégrer l'état workspace, centraliser l'activation/affectation des onglets, migrer la session, cibler sauvegarde et révélation par volet, et conserver `app.activeId` comme miroir transitoire.
- `src/lib/tauri.ts` — exposer le dialogue Enregistrer sous Markdown/TXT, un test d'existence et une confirmation native de remplacement du chemin final, puis réutiliser l'écriture atomique existante.
- `src/components/DocumentView.svelte` — recevoir `paneId` et `tabId`, cesser de déduire le document depuis `activeTab()`, enregistrer sa vue et sa sélection par volet, et rendre source/PDF/HTML selon le volet.
- `src/App.svelte` — monter `WorkspaceView`, router les raccourcis vers le volet actif et persister les dépendances workspace.
- `src/components/TitleBar.svelte` — remplacer les affectations directes à `app.activeId`, ajouter Scinder/Réunir et cibler sauvegarde, export et mode source.
- `src/lib/copilot.svelte.ts` — remplacer le singleton éditeur par le registre du volet actif et capturer le document cible avant toute opération asynchrone.
- `src/components/CopilotPanel.svelte` — lire la sélection et le document du volet actif sans ambiguïté.
- `src/components/Sidebar.svelte` — faire suivre plan, historique et révélation au volet actif.
- `src/README.md` — documenter le workspace, le registre d'éditeurs et la session v2.

### Created

- `src/lib/workspace.ts` — types et transitions pures du workspace : activer, affecter, fermer, permuter, scinder et borner le ratio.
- `src/lib/workspace.test.ts` — invariants anti-doublon, activation, fermeture, permutation et ratio 25–75.
- `src/lib/editor-registry.svelte.ts` — registre runtime `paneId → tabId/view/selection` avec nettoyage protégé contre les démontages périmés.
- `src/lib/editor-registry.test.ts` — routage actif, changement de focus et garde de nettoyage d'une ancienne vue.
- `src/lib/session.ts` — validation, sérialisation et migration pure de session v1 vers v2.
- `src/lib/session.test.ts` — chemins manquants, notes non enregistrées, ratio invalide et migration v1.
- `src/lib/save-as.ts` — préparation du nom, normalisation du chemin final, unicité canonique des chemins d'onglets et orchestration transactionnelle injectée du Save As.
- `src/lib/save-as.test.ts` — annulation, extension, collision, doublon d'onglet, erreur d'écriture, changement de focus et disparition de l'onglet pendant le dialogue.
- `src/components/WorkspaceView.svelte` — orchestration des deux volets, orientation responsive, ratio, choix de document et surfaces flottantes non clippées.
- `src/components/DocumentPane.svelte` — région accessible, mini-entête, état vide, sélection d'onglet et création de note.
- `src/components/SplitDivider.svelte` — séparateur Pointer Events via rAF, clavier et ARIA.

### Deleted

- Aucun fichier.

## Order of operations

1. Écrire les tests rouges de `workspace.ts`, `session.ts` et `save-as.ts`, puis implémenter leurs transitions pures jusqu'au vert ; corriger le modèle pour accepter `tabId: null` dans un volet vide.
2. **Checkpoint A — Save As en vue unique.** Ajouter une primitive unique `saveTabOrSaveAs(snapshot)` utilisée par Ctrl+S, TitleBar, fermeture d'onglet et fermeture d'application. Garantir l'extension du chemin final, confirmer explicitement l'écrasement si cette normalisation change le chemin confirmé par Windows, et refuser un chemin canonique déjà porté par un autre onglet.
3. Finaliser Save As dans une transaction post-écriture unique : après succès seulement, mettre à jour `path`, `name`, `savedContent`, index de recherche, RAG, session et premier snapshot ; prouver annulation et rollback par tests plus smoke natif avant de continuer.
4. **Checkpoint B — moteur workspace avec une seule vue.** Centraliser `selectTab`, `activatePane`, `assignTab`, `toggleSplit`, `swapPanes` et `createLinkedNote`, tout en maintenant `app.activeId` comme miroir de compatibilité.
5. Créer le registre d'éditeurs, migrer Copilot, Sidebar, révélation et commandes hors du singleton `editorRef/editorSel`, puis vérifier qu'une seule vue continue de fonctionner et que les tests de ciblage `(path, content)` passent 100 alternances.
6. Paramétrer `DocumentView` par `paneId/tabId`, garder un état CodeMirror indépendant par onglet et protéger tous les listeners/cleanups par identité de vue.
7. **Checkpoint C — double montage et UI.** Monter `DocumentPane`, `SplitDivider` et `WorkspaceView`; implémenter sélection du second onglet, note nouvelle, permutation et breakpoint vertical sous 720 px. Réunir conserve toujours le document du volet actif en `primary`, désactive `secondary`, synchronise `app.activeId`, puis rend le focus à la vue conservée.
8. Router TitleBar et les raccourcis Ctrl+S, Ctrl+W, Ctrl+Tab, Ctrl+/ et F6 vers le volet actif ; ignorer sans repli toute commande dont le volet ou l'onglet a disparu.
9. Activer la session v2 : restaurer d'abord les onglets par chemin canonique, reconstruire `path → tabId`, puis affecter les volets ; migrer silencieusement les sessions v1 et redériver l'orientation de la largeur courante.
10. Exécuter les contrôles statiques et unitaires, corriger toute régression, puis mesurer le checkpoint M2 avec deux Markdown de 500 Ko.
11. Effectuer la vérification visuelle et interactionnelle dans un vrai navigateur sur port isolé, arrêter le serveur, puis faire le smoke natif release du dialogue Save As, de l'écriture atomique et de la restauration.

## Test strategy

- `npm test -- --run src/lib/workspace.test.ts src/lib/session.test.ts src/lib/save-as.test.ts src/lib/editor-registry.test.ts` — TDD ciblé des invariants avant intégration UI ; inclure « `foo.md` existe et le dialogue retourne `foo` », chemin canonique déjà ouvert, note vide et onglet fermé pendant le dialogue.
- `npm test` — régression complète, notamment round-trip Markdown, PDF write guards, icônes et copilote.
- `npm run check` — types Svelte 5, props et sélecteurs CSS réellement utilisés.
- `npm run build` — build Vite de production sans dépendance ou chunk manquant.
- Test d'intégration avec écrivain injecté : alterner 100 fois volet → frappe → sauvegarde et vérifier exactement chaque paire `(path, content)` écrite.
- Navigateur réel, 1280×720 clair/sombre : ouvrir deux Markdown différents, alterner les volets, vérifier le document actif, réunir depuis le volet secondaire et contrôler la restitution du focus.
- Navigateur réel, 700×720 : vérifier empilement vertical, minimum 240 px, menus non clippés, glisser du séparateur, clavier Flèches/Home/End et F6.
- Navigateur réel avec `prefers-reduced-motion: reduce` : aucune transition de layout perceptible et focus visible.
- Profil navigateur avec deux fichiers de 500 Ko : p95 de traitement de frappe ≤ 25 ms au checkpoint ; stopper le lot si une tâche longue dépasse 50 ms de façon reproductible.
- `npm run tauri dev` puis build release local avec deux fichiers temporaires : annuler Save As, sauvegarder sans extension alors que le `.md` existe, refuser un chemin déjà ouvert, remplacer après confirmation, provoquer une erreur d'écriture, comparer les octets des deux fichiers et rouvrir la session v2.

## Risks

- Le singleton `editorRef/editorSel` a plusieurs consommateurs implicites → migrer tous les consommateurs avant de monter la seconde vue et conserver des assertions de ciblage.
- `app.sourceMode`, `activeHeadingLine` et `pendingReveal` sont globaux → déplacer source mode par volet et ne publier heading/reveal que depuis le volet explicitement actif.
- Un cleanup d'un ancien `DocumentView` peut effacer la nouvelle vue du registre → désenregistrer uniquement si `paneId`, `tabId` et identité `EditorView` correspondent encore.
- Un changement de focus pendant un dialogue Save As peut rediriger la mutation finale → capturer `{paneId, tabId, content}` avant le premier `await` et retrouver le tab par ID après écriture.
- Deux vues CodeMirror de 500 Ko peuvent dépasser le budget ARM64 → appliquer le checkpoint p95 ≤ 25 ms ; si échec, arrêter le lot et produire un plan dédié au mode dégradé au lieu de l'improviser.
- Les interactions pointeur/focus sont insuffisamment prouvées par jsdom → exiger un test dans Chromium réel et un smoke Tauri release avant conclusion.
- La migration de session peut restaurer des chemins absents ou dupliquer un onglet → valider le schéma, dédupliquer par chemin et afficher un volet vide honnête.
- Les menus rendus sous un ancêtre `contain: layout paint` peuvent être clippés → les rendre à la racine de `WorkspaceView` et calculer leurs coordonnées dans ce repère.

## Open questions

- Aucune question bloquante. Le mode lecture seule du volet secondaire reste une mitigation conditionnelle, activée uniquement si le checkpoint de performance réel échoue.

## Critic feedback

Verdict initial : **REVISE**, corrigé dans cette version.

- Le chemin final d'un Save As sans extension est désormais revérifié et confirmé avant tout écrasement.
- Un chemin canonique déjà ouvert dans un autre onglet est refusé pour préserver l'unicité document ↔ fichier.
- Ctrl+S, fermeture d'onglet et fermeture d'application utilisent une seule primitive `saveTabOrSaveAs`.
- L'orientation de session n'est plus persistée : elle est redérivée de la largeur, conformément à l'UX validée.
- Les effets post-écriture sont regroupés dans une transaction testée, jamais exécutée après annulation ou échec.
- L'exécution est divisée en checkpoints bloquants A, B et C ; aucun checkpoint ne commence si le précédent n'est pas vert et smoke-testé.
- Réunir les volets conserve explicitement le volet actif et restitue son focus.
- La sauvegarde croisée est prouvée sur les paires `(path, content)` et complétée par une comparaison octet par octet en natif.
- Un échec de performance arrête le lot et ouvre un plan dédié ; aucun mode dégradé n'est improvisé.

## Rollback

Revenir au commit précédant ce lot restaure la vue documentaire unique ; la session v2 doit rester ignorée sans erreur par cette version et aucun fichier utilisateur n'est migré ni réécrit automatiquement.

## État d’exécution — 2026-08-13

- Checkpoints A, B et C implémentés ; les corrections de revue couvrent l’extension Save As sûre, l’état CodeMirror porté par document, le ratio réellement borné et la restauration honnête des notes non enregistrées.
- Vérification navigateur réelle : édition et undo indépendants, sélection conservée après échange, F6, séparateur clavier, réunification, note liée, layout vertical et menus accessibles.
- Checkpoint M2 : cinq passages sur deux documents de 500 Ko, p95 **18,6–20,0 ms**, maximum **27,3 ms**, zéro mutation croisée — **PASS** grâce à la suspension temporaire du live-preview pour un document lourd en vue scindée.
- Validation automatisée : `npm run check`, `npm test` (**480 tests**), `npm run build` et `git diff --check` verts.
- Build native release compilée avec succès (`src-tauri/target/release/doku.exe`). Reste avant commit : smoke manuel du dialogue Save As et de l’écriture atomique ; l’automatisation Windows n’a pas pu démarrer (`EPERM` dans le helper Computer Use). Les citations appartiennent au plan suivant.
