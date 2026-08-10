# Plan: notes-ia-et-reecritures-structurelles

_Date: 2026-08-10 · Estimated scope: M_

## Goal
Deux gestes inspirés d'Open Notebook, dans la philosophie « gadget discret » : (A) **sauver une réponse de Doku-San en note `.md`** dans le dossier courant, avec une ligne de provenance honnête — la note devient un fichier ordinaire, indexable par le RAG et citable à son tour ; (B) **réécritures structurelles de la sélection** — deux nouveaux verbes dans le menu de sélection existant (16.2) : « En liste à puces » et « En cases à cocher », réutilisant tel quel l'aperçu diff Accepter/Refuser.

## Out of scope
- Transformations personnalisées (prompts nommés définis par l'utilisateur) → à cadrer via /sprint plan.
- Contrôle/visibilité du contexte par source → idem (matière à epic).
- Mode « → Tableau » et « → Titres + paragraphes » : extensions naturelles de (B), à ajouter plus tard si l'usage le demande.
- Frontmatter YAML pour la provenance : écarté au profit d'une ligne de citation visible (un bloc `---` rend mal dans la live preview et Doku n'interprète pas le frontmatter).

## Files

### Modified
- `src/lib/tauri.ts` — nouvelle fonction `createFileWithContent(path, content): Promise<boolean>` (variante de `createFileAt` : garde `exists` → false si le nom existe, sinon `writeTextFile` avec contenu). Aucun changement des fonctions existantes.
- `src/lib/copilot.svelte.ts` — nouvelle fonction exportée `saveMessageAsNote(msg: ChatMsg): Promise<string | null>` : résout le dossier cible (`app.explorerDir ?? parentPath(activeTab()?.path)` — même résolution que le mode dossier), construit le nom (`Doku-San — <question tronquée à ~40 car. nettoyée des caractères interdits Windows via les règles de explorer.ts>.md`, suffixe ` (2)`, ` (3)`… si conflit via `nameExists`), compose le contenu (ligne de provenance `> Note générée par Doku-San le <date> — d'après « <nom du doc actif ou dossier> ».` + ligne vide + `msg.content` brut), écrit via `createFileWithContent`, puis `refreshExplorer()` + `openPath(chemin)`. Retourne le chemin ou null (échec/hors Tauri). La question associée = le message `user` qui précède `msg` dans `copilot.messages`.
- `src/components/CopilotPanel.svelte` — bouton « Sauver en note » à côté du bouton copier existant (`.cop-copy`, ligne ~732) : icône `save` (déjà dans le subset — pas de régénération pour (A)), visible sur les réponses terminées non-`failed`/`config`/`notice`, masqué hors Tauri (`isTauri`) et sans dossier résoluble ; feedback : icône `check` 2 s après succès (motif `authCodeCopied` existant).
- `src/lib/copilot-service.ts` — `RephraseMode` étendu : `'bullets' | 'tasks'` ; `REPHRASE_TASK` +2 entrées (« Réorganise le passage en liste à puces Markdown, une idée par puce, sans rien ajouter ni omettre » / « Transforme le passage en liste de cases à cocher Markdown (`- [ ] …`), une action par ligne ») ; dans `buildRephrasePrompt`, la règle « Conserve la mise en forme Markdown » devient conditionnelle — pour les modes structurels elle contredirait la tâche, remplacée par « Le format cible remplace la mise en forme d'origine ; conserve la langue et le sens ».
- `src/components/DocumentView.svelte` — 2 boutons dans `.selection-rewrite-options` (après « Corriger », lignes ~570-581) : `format_list_bulleted` « En liste à puces » (`runSelectionAction('bullets')`), `checklist` « En cases à cocher » (`runSelectionAction('tasks')`). Aucun autre changement : `runSelectionAction` → `rephraseSelection(mode)` → aperçu diff → Accepter/Refuser fonctionnent déjà pour tout `RephraseMode`.
- `src/lib/copilot-service.test.ts` — tests : `buildRephrasePrompt('bullets'/'tasks')` contient la tâche cible et NE contient PAS « Conserve […] la mise en forme Markdown » ; les 4 modes existants la contiennent toujours.
- `src/assets/material-symbols-rounded.subset.woff2` + `material-symbols-manifest.json` — régénérés (`npm run subset:icons`, réseau requis) : l'icône `checklist` est nouvelle. Le garde-fou `icons.test.ts` échouera tant que ce n'est pas fait — c'est le flux documenté.

### Created
- `src/lib/notes.ts` — logique PURE testable de (A) : `noteFileName(question: string | null, existing: (name: string) => boolean): string` (troncature, nettoyage caractères interdits — réutilise les règles de `explorer.ts` —, suffixes de conflit, repli `Note Doku-San.md` si question vide) et `noteContent(answer: string, source: string | null, date: Date): string` (ligne de provenance + corps). `saveMessageAsNote` ne fait que l'orchestration I/O.
- `src/lib/notes.test.ts` — cas : nom depuis question longue/avec `:?/"` interdits, conflit → ` (2)`, question vide → repli, contenu avec et sans document source, date formatée fr.

### Deleted
— aucun.

## Order of operations
1. `src/lib/notes.ts` + tests (pure, aucune dépendance).
2. `createFileWithContent` dans tauri.ts.
3. `saveMessageAsNote` dans copilot.svelte.ts + bouton CopilotPanel → vérif navigateur (bouton masqué hors Tauri) puis natif (note créée, ouverte, visible dans l'explorateur).
4. Modes `bullets`/`tasks` dans copilot-service.ts + tests prompts.
5. Boutons du menu de sélection dans DocumentView + `npm run subset:icons` (icône `checklist`) — committer police + manifeste régénérés.
6. `npm run check` + `npm test` + vérification Playwright (menu de sélection : 6 verbes, deux thèmes) + test natif des réécritures sur une vraie sélection (qwen local ET OpenAI).

## Test strategy
- Unitaires : `notes.test.ts` (noms/contenu), `copilot-service.test.ts` (prompts des 2 modes, non-régression des 4 existants), `icons.test.ts` (garde le subset honnête).
- Navigateur (Playwright, port 1421, deux thèmes) : bouton « Sauver en note » absent en mode navigateur ; menu de sélection affiche les 6 verbes sans débordement (le popover est repositionné par `positionSelectionMenu` — vérifier près du bord bas).
- Natif (utilisateur) : sauver une réponse → fichier ouvert avec provenance ; « En cases à cocher » sur un paragraphe d'étapes → aperçu diff → accepter → cases cliquables dans la live preview (les checkboxes 4.x existent).

## Risks
- Le qwen 1.5b ajoute du bavardage autour de la liste (« Voici la liste : ») → la règle « Réponds UNIQUEMENT avec le texte réécrit » existe déjà et l'aperçu diff rend tout débordement visible AVANT insertion → accepter.
- Nom de fichier : question avec uniquement des caractères interdits → repli déterministe `Note Doku-San.md` + suffixes ; couvert par tests.
- `subset:icons` exige le réseau à la régénération → si indisponible au moment de l'exécution, remplacer `checklist` par une icône déjà présente (`check_circle`) et noter la dette.
- Le RAG n'indexe la nouvelle note qu'au prochain refresh d'index (comportement existant, checkpoints) → accepté, aucun mensonge (la note est simplement absente des réponses jusque-là).

## Open questions
- Faut-il aussi proposer « Sauver en note » sur les résumés/points clés (mêmes cartes assistant) ? Le plan dit oui par construction (même bouton sur toute réponse terminée) — confirmer que c'est voulu.
- Emplacement des notes : dossier courant à plat, ou sous-dossier `notes doku-san/` ? Le plan choisit le dossier courant (moins de magie) — à revalider à l'usage.

## Rollback
`git revert` des commits du plan — aucune migration ni état persistant nouveau (les notes déjà créées restent de simples fichiers .md inertes).
