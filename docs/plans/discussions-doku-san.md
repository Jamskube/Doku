# Plan: discussions-doku-san

_Date: 2026-08-20 · Estimated scope: L_

## Goal

Donner à Doku-San des **discussions durables et reprenables** depuis une nouvelle vue « Discussions » de la sidebar. Une discussion conserve son historique lisible, ses sources, son contexte explicite et un snapshot par chemins du bureau documentaire. La rouvrir recharge les messages puis restaure les documents visibles, le mode un/deux volets, l’affectation des documents, le volet actif et le ratio de séparation. L’interface reprend les principes éprouvés du navigateur de Sessions de DeepSeek Harness — lignes compactes plutôt que cartes, recherche qui se déploie dans l’en-tête, groupes repliables, cinq lignes visibles puis « Afficher plus », titre tronqué avec détail secondaire — tout en restant conforme au principe Doku « le document parle, le chrome s’efface ».

La discussion, la mémoire et le dossier restent trois concepts distincts : une discussion est une chronologie locale ; la mémoire durable reste rattachée au document ou au dossier choisi explicitement (ADR-0019) ; le parent `Desktop` ou tout autre dossier parcouru ne devient jamais implicitement un espace de discussion.

## Référence visuelle et comportementale

- DeepSeek Harness `ui-sidebar` fournit le shell : action « Nouvelle session », région scrollable, réglages en pied et repli vers un rail compact de 56 px. Doku conserve son propre rail de 46 px mais reprend la hiérarchie et la continuité du geste.
- DeepSeek Harness `ui-workspace` fournit le navigateur : lignes de Session groupées ou plates, cinq Sessions visibles par groupe, « Show more », recherche déployée dans l’en-tête, titre et Workspace en métadonnée, ligne vide non matérialisée, renommage et archivage.
- Adaptation Doku : les groupes sont temporels (`Aujourd’hui`, `7 derniers jours`, `Plus anciennes`) et non des dossiers automatiques. Chaque ligne affiche le titre, puis les noms des documents visibles au dernier tour. Le dossier parent n’est jamais une identité de discussion.
- À reprendre visuellement : rangées de 36–40 px sans contour ni carte, surface transparente au repos, fond tonal au survol, sélection discrète, ellipsis sur le titre, métadonnée courte, menu contextuel en fin de ligne seulement au survol/focus, recherche qui remplace temporairement le titre du panneau.
- À ne pas reprendre : statut d’approbation, sous-agents, drag-and-drop manuel, fork, Workspace explicite et indicateurs multicolores — ces notions n’existent pas dans Doku et ajouteraient du chrome sans fonction.

## Out of scope

- Synchronisation cloud ou entre machines : les discussions restent exclusivement locales.
- Exécution parallèle de plusieurs discussions : Doku conserve un seul flux de génération actif.
- Regroupement automatique par dossier parent, notamment `Desktop`, `Downloads` ou la racine explorée.
- Fork de discussion, drag-and-drop manuel, branches, sous-agents et statuts d’approbation de DeepSeek Harness.
- Résumé généré par un modèle pour nommer une discussion : le titre vient localement de la première question et peut être renommé.
- Recherche sémantique/vectorielle dans l’historique : la première version recherche localement dans les titres, noms de documents et texte des messages.
- Restauration du scroll et de la sélection dans chaque document ; le contrat actuel du bureau ne les promet déjà pas entre lancements.
- Copie du contenu des fichiers ouverts dans la discussion : le fichier sur disque reste la source de vérité et est relu à la restauration.
- Sauvegarde d’une note sans chemin comme document restaurable. La ligne indique « note non enregistrée non restaurable » sans recopier son buffer dans l’historique.

## Files

### Created

- `src/lib/copilot-conversation.ts` — schéma versionné pur `ConversationV1`, projection légère `ConversationSummary`, validation/migration, titre local, nettoyage des champs transitoires de `ChatMsg`, regroupement temporel, recherche locale bornée et construction d’une fenêtre d’historique envoyable au modèle.
- `src/lib/copilot-conversation.test.ts` — invariants du schéma, parsing défensif, titres, groupes temporels, recherche, nettoyage des états streaming/retry et fenêtre d’historique par paires complètes.
- `src/lib/copilot-conversations.svelte.ts` — store runtime : index léger, discussion active, brouillon non matérialisé, files d’écriture par identifiant, chargement/sauvegarde/renommage/archivage/suppression et orchestration de la restauration documentaire.
- `src/lib/copilot-conversations.test.ts` — stockage injecté, ordre des écritures, échec atomique, bascule entre discussions, absence de doublon, brouillon invisible et restauration partielle.
- `src/components/CopilotConversationList.svelte` — panneau Sidebar fidèle au langage DeepSeek Harness adapté à Doku : en-tête/recherche, groupes temporels repliables, cinq lignes par défaut, « Afficher plus », état courant, métadonnées documentaires, menu renommer/archiver/supprimer et états vide/erreur.
- `docs/adr/0027-discussions-doku-san-durables.md` — décision sur l’identité, le stockage local, la séparation discussion/mémoire, le snapshot documentaire, les données sensibles et la fenêtre de contexte envoyée au modèle.
- `.agent/visual/copilot-conversations/harness.html` — banc visuel de la vraie liste avec 0, 1, 6 et 25 discussions, titres longs, documents manquants et thèmes clair/sombre.

### Modified

- `src/lib/tauri.ts` — primitives confinées à `%APPDATA%/Doku/conversations/` : lire/écrire atomiquement `index.json`, lire/écrire/supprimer `<uuid>.json`, mettre de côté un JSON illisible et fournir un repli `localStorage` en mode navigateur. Validation stricte des UUID/noms avant tout segment de chemin.
- `src/lib/session.ts` — extraire et réutiliser un type pur `WorkspacePathSnapshot` et ses validateurs afin que la session globale et une discussion restaurent le même contrat `{split, activePaneId, primaryPath, secondaryPath, ratio}` sans dupliquer la logique.
- `src/lib/session.test.ts` — couverture du snapshot réutilisable, doublon de chemin, ratio hors bornes et restauration dégradée.
- `src/lib/stores.svelte.ts` — ajouter `captureWorkspacePathSnapshot()` et `restoreWorkspacePathSnapshot()` : ouvrir les chemins disponibles sans fermer les autres onglets, appliquer le bureau seulement après les lectures, conserver les onglets non ciblés et signaler les chemins absents.
- `src/lib/copilot.svelte.ts` — porter `activeConversationId`, matérialiser le brouillon au premier message accepté, persister uniquement les tours stabilisés, restaurer messages/contexte/options, utiliser une fenêtre d’historique bornée pour tous les fournisseurs et laisser la mémoire se recalculer depuis les documents restaurés. `newChat()` devient « sauvegarder puis nouveau brouillon ».
- `src/components/CopilotPanel.svelte` — brancher « Nouvelle conversation » sur l’action asynchrone durable, charger une discussion sans animation parasite, afficher un marqueur honnête si les anciens tours restent visibles mais sortent de la fenêtre envoyée au modèle, et bloquer une bascule pendant une génération sans l’arrêter silencieusement.
- `src/components/Sidebar.svelte` — ajouter l’entrée `forum`/« Discussions » au rail, rendre `CopilotConversationList` dans le panneau et conserver exactement la géométrie, le matériau et l’animation de largeur existants.
- `src/App.svelte` — initialiser l’index des discussions au démarrage et débouncer à 500 ms la capture du snapshot documentaire de la discussion active lorsque les onglets/volets changent ; forcer un flush avant une bascule explicite.
- `src/README.md` — documenter les nouveaux modules, le stockage local et la séparation conversation/mémoire/session globale.
- `docs/planning/architecture-v2-copilot.md` — fermer la question ouverte « persistance de l’historique », pointer vers ADR-0027 et décrire la projection sidebar/index.
- `docs/plans/README.md` — référencer ce plan.

### Deleted

_Aucun._

## Data contract

```ts
interface ConversationV1 {
  version: 1
  id: string
  title: string
  titlePinned: boolean
  createdAt: string
  updatedAt: string
  messages: PersistedChatMessage[]
  contextItems: PersistedContextItem[]
  scope: 'doc' | 'folder'
  contextFolder: { path: string; label: string } | null
  memoryFolder: { path: string; label: string } | null
  webSearchEnabled: boolean
  lastProvider: 'ollama' | 'openai' | 'minimax'
  workspace: WorkspacePathSnapshot
}

interface ConversationSummary {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  documentNames: string[]
  preview: string
  messageCount: number
  archived: boolean
}
```

Le résumé ne contient aucun chemin absolu ni texte complet de document. Le fichier de discussion peut contenir les messages, les petits extraits explicitement ajoutés depuis une sélection ou le presse-papiers et les preuves déjà visibles (citations/sources), car l’utilisateur demande précisément de reprendre ce contexte. Les fichiers ajoutés par chemin sont réouverts et relus au prochain envoi ; leur ancien contenu n’est pas dupliqué dans le JSON.

Les champs runtime (`streaming`, `status`, `retry`, contrôleurs, callbacks, erreurs de configuration transitoires) ne sont jamais sérialisés. Une réponse interrompue reste visible dans la session courante mais n’est persistée qu’en état terminal explicite `interrupted`, jamais comme réponse réussie.

## Restore transaction

1. Refuser la bascule si `copilot.generating === true` et expliquer « Arrêtez la réponse avant de changer de discussion » ; ne jamais aborter silencieusement.
2. Flusher la discussion courante avec son dernier snapshot de bureau.
3. Lire et valider la discussion cible sans encore muter l’UI.
4. Relire tous les chemins du snapshot en réutilisant `openPath`/la détection de kind ; conserver les autres onglets déjà ouverts et toutes les notes dirty.
5. Construire le prochain `WorkspaceState` uniquement avec les chemins effectivement restaurés : deux chemins valides → split restauré ; un seul → volet simple ; aucun → bureau vide explicite. Un fichier manquant produit une bannière concise et n’empêche pas le chat de s’ouvrir.
6. Installer atomiquement messages, contexte, options de discussion et `activeConversationId`, puis appliquer le bureau.
7. Au prochain envoi seulement, rappeler la mémoire durable depuis les documents alors visibles. Les `memorySources` historiques restent des preuves du tour passé mais ne sont jamais réinjectées comme mémoire actuelle.

## Order of operations

1. Extraire `WorkspacePathSnapshot` de `session.ts`, ajouter ses tests et les deux fonctions capture/restauration dans `stores.svelte.ts`. Toute la fonctionnalité dépend d’un contrat documentaire unique.
2. Écrire `copilot-conversation.ts` et ses tests : schéma/migration, nettoyage, titre, groupes, recherche et fenêtre d’historique. Aucun store ni API native à ce stade.
3. Ajouter les primitives confinées de `tauri.ts`, puis `copilot-conversations.svelte.ts` avec dépendances injectables et tests d’écriture/bascule.
4. Intégrer le cycle de vie dans `copilot.svelte.ts` et `App.svelte` : brouillon, matérialisation au premier prompt, sauvegarde terminale, snapshot débouncé, flush avant bascule, restauration et budget d’historique.
5. Construire `CopilotConversationList.svelte` en reprenant la topologie DeepSeek Harness, puis l’insérer dans `Sidebar.svelte` sans changer le shell ni le rail existants.
6. Ajouter renommage, archivage, vue Archives et suppression confirmée. L’archive est réversible ; la suppression nomme explicitement la perte du chat mais jamais celle des documents ou mémoires.
7. Mettre à jour ADR-0027, l’architecture copilote et les README avec le comportement réellement implémenté.
8. Exécuter tests ciblés, check, build, banc visuel puis smoke natif de redémarrage/restauration.

## Acceptance criteria

1. **Given** une discussion avec un document visible, **When** je la rouvre depuis la sidebar après avoir affiché un autre document, **Then** les messages sont restaurés et le document de la discussion redevient visible sans fermer ni perdre les autres onglets.
2. **Given** une discussion sauvegardée avec deux volets, deux chemins distincts, le volet secondaire actif et un ratio 62/38, **When** je la rouvre, **Then** Doku restaure les deux documents dans les bons volets, le focus logique secondaire et le ratio borné correspondant.
3. **Given** un des deux fichiers déplacé ou supprimé, **When** je rouvre la discussion, **Then** le chat reste accessible, le seul document valide est affiché en volet simple et une bannière nomme le fichier absent sans associer silencieusement le document courant à la discussion.
4. **Given** une nouvelle conversation sans message, **When** je navigue ailleurs ou redémarre, **Then** aucune ligne vide n’apparaît dans la sidebar ; **When** le premier prompt est accepté, **Then** une seule discussion est matérialisée avec un titre local issu de cette question.
5. **Given** plus de cinq discussions dans un groupe temporel, **When** j’ouvre la vue Discussions, **Then** cinq lignes compactes sont visibles et « Afficher plus » révèle le reste ; fermer/réouvrir le groupe revient à cinq, comme le navigateur DeepSeek Harness.
6. **Given** une recherche saisie, **When** 250 ms s’écoulent, **Then** la liste devient plate et filtre titre, documents et messages ; effacer la requête restaure les groupes et leurs états sans perdre la discussion active.
7. **Given** une discussion très longue, **When** je continue à discuter, **Then** tout l’historique reste lisible sur disque et dans l’UI, mais seuls les derniers couples complets qui tiennent dans le budget sont envoyés au modèle avec un indicateur visible ; aucun demi-tour user/assistant n’est produit.
8. **Given** une mémoire document active, **When** je reprends une ancienne discussion, **Then** les souvenirs historiques affichés restent des preuves et le rappel du prochain tour est recalculé depuis les documents restaurés, sans créer de portée mémoire « conversation ».
9. **Given** Ollama, MiniMax ou OpenAI comme fournisseur courant, **When** je reprends une discussion, **Then** le même historique durable est disponible ; `lastProvider` est informatif et ne change jamais automatiquement le fournisseur ni les identifiants actifs.

## Test strategy

- `src/lib/copilot-conversation.test.ts` : schéma inconnu/corrompu, UUID invalide, champs transitoires écartés, titre vide/long, groupement aux frontières temporelles, recherche accent/casse, fenêtre d’historique sans paire orpheline, messages et sources conservés.
- `src/lib/copilot-conversations.test.ts` : brouillon invisible, première matérialisation unique, coalescence des sauvegardes, ancienne écriture lente incapable d’écraser la plus récente, index écrit après le fichier de discussion, rollback logique si l’un échoue, archive/désarchive/suppression confinée, restauration partielle.
- `src/lib/session.test.ts` : même snapshot utilisé par session globale et discussion, ratio 25–75, deux chemins identiques réduits à un, volet actif absent ramené sur le primaire.
- Tests existants `copilot-memory.test.ts`, `copilot-context.test.ts`, `workspace.test.ts`, `session.test.ts` et `copilot-service.test.ts` : aucune régression de portée mémoire, contexte automatique des deux documents ou assemblage de messages.
- Vérification commandes : `npm test -- --run src/lib/copilot-conversation.test.ts src/lib/copilot-conversations.test.ts src/lib/session.test.ts src/lib/workspace.test.ts src/lib/copilot-memory.test.ts src/lib/copilot-context.test.ts src/lib/copilot-service.test.ts`, `npm run check`, `npm run build`, `git diff --check`.
- Banc visuel `.agent/visual/copilot-conversations/` : 296 px et rail replié, clair/sombre, titres très longs, 5/6/25 discussions, recherche ouverte, menu de ligne, groupe fermé, état vide et discussion active. Vérifier que rien ne ressemble à une grille de cartes et qu’aucune ligne n’excède 40 px hors résultat de recherche à snippet.
- Smoke natif : créer une discussion un volet puis une discussion deux volets, fermer/reouvrir Doku, reprendre chacune ; déplacer un fichier entre les deux essais ; vérifier qu’une note dirty hors discussion demeure ouverte ; tester suppression et récupération d’une archive.

## Risks

- **Écritures concurrentes et perte du dernier état** → une file de promesses par discussion, révision monotone et index écrit seulement après le fichier de discussion ; un flush explicite précède toute bascule.
- **Historique trop gros pour le fournisseur** → conserver intégralement sur disque mais construire une fenêtre bornée de couples complets ; afficher la limite au lieu de tronquer silencieusement. Aucun appel de résumé supplémentaire dans cette version.
- **Confusion discussion/mémoire/document** → l’ADR et l’UI nomment les trois couches ; la discussion n’est jamais une clé mémoire et `lastProvider` n’est qu’une métadonnée.
- **Fichier manquant ou changé depuis le dernier tour** → relire le disque, restaurer partiellement avec bannière et ne jamais injecter l’ancien contenu comme s’il était actuel.
- **Perte d’une note dirty actuelle lors d’une restauration** → ne fermer aucun onglet ; ne faire que réaffecter les volets. Les onglets non ciblés restent accessibles dans le sélecteur existant.
- **Données sensibles dans les messages/clipboard** → stockage local explicite sous AppData, aucune synchronisation, action « Supprimer » réelle, paramètres de purge globale et documentation claire. Les résumés d’index n’embarquent ni chemins absolus ni contenu intégral.
- **JSON corrompu après crash** → écriture tmp+rename, fichier illisible mis de côté, index reconstructible en balayant les fichiers valides ; une discussion cassée n’empêche jamais les autres de charger.
- **UI sidebar trop dense** → reprendre les mesures et interactions du navigateur DeepSeek, mais retirer ses concepts agents ; cinq lignes par groupe, métadonnée unique et menu révélé seulement au survol/focus.
- **Navigation pendant un stream** → bascule bloquée avec raison visible ; aucun abort implicite ni mélange de deltas entre deux identifiants.
- **Régression navigateur/Tauri** → stockage injecté et fallback `localStorage` pour les tests, smoke natif obligatoire pour AppData et restauration réelle des chemins.

## Open questions

- Aucune décision utilisateur ne bloque la première version. Défauts retenus : groupes temporels, cinq lignes par groupe, brouillon non matérialisé, fournisseur courant conservé, autres onglets jamais fermés, archives accessibles depuis un filtre du panneau.

## Rollback

Un `git revert` retire l’index, le store et la vue ; les fichiers `%APPDATA%/Doku/conversations/*.json` restent inertes et récupérables, sans migration ni effet sur les documents, la mémoire ou la session globale existante.
