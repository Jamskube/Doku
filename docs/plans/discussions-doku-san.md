# Plan: discussions-doku-san

_Date: 2026-08-20 · Estimated scope: L_

## Goal

Donner à Doku-San des **discussions durables et reprenables** depuis une nouvelle vue « Discussions » de la sidebar. Une discussion conserve son historique lisible, ses sources, son contexte explicite et un snapshot par chemins du bureau documentaire. La rouvrir recharge les messages puis restaure les documents visibles, le mode un/deux volets, l’affectation des documents, le volet actif et le ratio de séparation. L’interface reprend les principes éprouvés du navigateur de Sessions de DeepSeek Harness — lignes compactes plutôt que cartes, recherche qui se déploie dans l’en-tête, groupes repliables, cinq lignes visibles puis « Afficher plus », titre tronqué avec détail secondaire — tout en restant conforme au principe Doku « le document parle, le chrome s’efface ».

La discussion, la mémoire et le dossier restent trois concepts distincts : une discussion est une chronologie locale ; la mémoire durable reste rattachée au document ou au dossier choisi explicitement (ADR-0019) ; le parent `Desktop` ou tout autre dossier parcouru ne devient jamais implicitement un espace de discussion.

## Référence visuelle et comportementale

- Sources primaires à garder ouvertes pendant l’implémentation : [DeepSeek Harness — `ui-sidebar`](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-sidebar/README.md) et [DeepSeek Harness — `ui-workspace`](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-workspace/README.md). Le banc visuel Doku doit comparer ses états à cette topologie, pas à une réinterprétation de mémoire.
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
- `src/lib/copilot-conversation-repository.ts` — dépôt injecté et sérialisé : écritures par fichier, reconstruction de l’index, quarantaine des JSON invalides et recherche bornée sans dépendance Svelte.
- `src/lib/copilot-conversations.svelte.ts` — store runtime : index léger reconstructible, discussion active, brouillon non matérialisé, **file globale** de mutations, réconciliation au démarrage, chargement/sauvegarde/renommage/archivage/suppression et orchestration révisionnée de la restauration documentaire.
- `src/lib/copilot-conversations.test.ts` — stockage injecté, réconciliation après chaque état de crash, concurrence entre UUID distincts, échec de flush, bascules concurrentes, absence de doublon, brouillon invisible et restauration partielle.
- `src/components/CopilotConversationList.svelte` — panneau Sidebar fidèle au langage DeepSeek Harness adapté à Doku : en-tête/recherche, groupes temporels repliables, cinq lignes par défaut, « Afficher plus », état courant, métadonnées documentaires, menu renommer/archiver/supprimer et états vide/erreur.
- `docs/adr/0027-discussions-doku-san-durables.md` — décision sur l’identité, le stockage local, la séparation discussion/mémoire, le snapshot documentaire, les données sensibles et la fenêtre de contexte envoyée au modèle.

### Modified

- `src/lib/tauri.ts` — primitives confinées à `%APPDATA%/Doku/conversations/` : lister, lire, écrire atomiquement et supprimer `index.json`/`<uuid>.json`, reconnaître les `.doku-tmp`, mettre de côté un JSON illisible et fournir un repli `localStorage` en mode navigateur. Validation stricte des UUID/noms avant tout segment de chemin.
- `src/lib/session.ts` — extraire et réutiliser un type pur `WorkspacePathSnapshot` et ses validateurs afin que la session globale et une discussion restaurent le même contrat `{split, activePaneId, primaryPath, secondaryPath, ratio}` sans dupliquer la logique.
- `src/lib/session.test.ts` — couverture du snapshot réutilisable, doublon de chemin, ratio hors bornes et restauration dégradée.
- `src/lib/stores.svelte.ts` — ajouter `captureWorkspacePathSnapshot()`, une lecture non mutante `readOpenableDocument(path)` et un commit synchrone `commitWorkspaceRestore(...)` : préserver un onglet dirty du même chemin, ouvrir les autres candidats sans fermer les onglets existants et signaler les chemins absents.
- `src/lib/copilot.svelte.ts` — porter `activeConversationId`, matérialiser le brouillon au premier message accepté, persister uniquement les tours stabilisés, restaurer messages/contexte/options, appliquer un **budget total** par runtime au contexte assemblé et laisser la mémoire cloud se recalculer depuis les documents restaurés. `newChat()` devient « sauvegarder puis nouveau brouillon ».
- `src/components/CopilotPanel.svelte` — brancher « Nouvelle conversation » sur l’action asynchrone durable, charger une discussion sans animation parasite, afficher un marqueur honnête si les anciens tours restent visibles mais sortent de la fenêtre envoyée au modèle, et bloquer une bascule pendant une génération sans l’arrêter silencieusement.
- `src/components/Sidebar.svelte` — ajouter l’entrée « Discussions » au rail avec une icône de conversation **déjà présente dans le subset**, rendre `CopilotConversationList` dans le panneau et conserver exactement la géométrie, le matériau et l’animation de largeur existants.
- `src/components/SettingsDialog.svelte` — ajouter la purge explicite de toutes les discussions locales, distincte de la mémoire durable et des documents, avec confirmation et résultat détaillé.
- `src/App.svelte` — initialiser/réconcilier l’index au démarrage, débouncer à 500 ms la capture liée à l’UUID courant, suspendre cette capture pendant une restauration et attendre le flush conversation + snapshot dans `onCloseRequested` avant de détruire la fenêtre.
- `src-tauri/capabilities/default.json` — autoriser uniquement la suppression sous `$APPDATA/conversations/**` (fichiers canoniques, index, tmp et quarantaines), sans élargir le scope général.
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
  revision: number
  title: string
  titlePinned: boolean
  createdAt: string
  updatedAt: string
  archived: boolean
  messages: PersistedChatMessage[]
  contextItems: PersistedContextItem[]
  scope: 'doc' | 'folder'
  contextFolder: { path: string; label: string } | null
  memoryFolder: { path: string; label: string } | null
  webSearchEnabled: boolean
  lastProvider: 'ollama' | 'openai' | 'minimax'
  workspace: WorkspacePathSnapshot
}

type PersistedContextItem =
  | { kind: 'file'; path: string; label: string; signature: string | null }
  | { kind: 'folder'; path: string; label: string; signature: string | null }
  | { kind: 'selection' | 'clipboard'; label: string; text: string; truncated: boolean }

interface PersistedEvidence {
  kind: 'document' | 'web' | 'memory'
  locator: string
  label: string
  snippet: string
  hash: string | null
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

Le fichier de discussion est la **source canonique**, y compris pour `archived`; `index.json` n’est qu’une projection reconstructible. Le résumé ne contient aucun chemin absolu ni texte complet de document. Le fichier de discussion peut contenir les messages, des sélections/presse-papiers explicitement bornés et les preuves réellement citées. Un contexte `file`/`folder` ne persiste jamais son champ runtime `text` : il conserve chemin, libellé et signature, puis est relu au prochain envoi. Une preuve conserve un locateur (path/page ou URL), un hash et un court extrait borné — jamais l’ensemble des chunks d’un document complet.

Plafonds de sérialisation initiaux, validés aussi au parsing : 8 KiB par sélection/presse-papiers, 2 KiB par extrait de preuve, 32 KiB de preuves par message et 512 KiB de données contextuelles persistées par discussion. Toute coupe porte `truncated: true` et reste visible dans l’UI. Ces plafonds protègent le disque et la confidentialité ; ils sont distincts du budget envoyé au modèle.

Les champs runtime (`streaming`, `status`, `retry`, contrôleurs, callbacks, erreurs de configuration transitoires) ne sont jamais sérialisés. Une réponse interrompue reste visible dans la session courante mais n’est persistée qu’en état terminal explicite `interrupted`, jamais comme réponse réussie.

## Persistence and recovery protocol

1. Toutes les mutations passent dans une **file globale unique** : écrire atomiquement le fichier canonique de discussion, puis reconstruire/écrire atomiquement la projection `index.json`. Une file par UUID est insuffisante puisque l’index est partagé.
2. Au démarrage, balayer les seuls noms `<uuid>.json` valides, ignorer puis nettoyer les `.doku-tmp`, mettre les JSON invalides en quarantaine, reconstruire entièrement les résumés depuis les fichiers canoniques et remplacer l’index. Les entrées pendantes disparaissent et les fichiers orphelins réapparaissent correctement.
3. Une archive modifie `ConversationV1.archived` dans le fichier canonique avant réconciliation. Une suppression individuelle retire d’abord le fichier canonique, ses tmp/quarantaines associées, puis réconcilie l’index. Une purge retire tous les artefacts `conversations/`, sans toucher mémoire, documents, annotations ou session globale.
4. `flushActiveConversation()` est faillible. Son échec annule toute bascule ou fermeture : l’identifiant, les messages, le bureau et la fenêtre restent inchangés, avec la cause exploitable affichée.

## Restore transaction

1. Refuser la bascule si `copilot.generating === true` et expliquer « Arrêtez la réponse avant de changer de discussion » ; ne jamais aborter silencieusement.
2. Incrémenter `restoreRevision`, suspendre la capture débouncée du bureau, puis flusher la discussion courante avec son dernier snapshot. Si le flush échoue, annuler sans aucune mutation.
3. Lire et valider la discussion cible puis préparer chaque document avec `readOpenableDocument(path)`, sans appeler `openPath` et sans muter l’UI. Vérifier aussi l’existence des PDF/binaires.
4. Pour un même chemin déjà ouvert et dirty, conserver le buffer vivant sans relire le disque et marquer « version non enregistrée utilisée ». Pour les autres chemins, préparer un candidat relu depuis le disque. Ne jamais écraser un buffer dirty.
5. Construire le prochain `WorkspaceState` uniquement avec les candidats disponibles : deux chemins valides → split restauré ; un seul → volet simple ; aucun → bureau vide explicite. Un fichier manquant produit une bannière concise et n’empêche pas le chat de s’ouvrir.
6. Juste avant le commit, vérifier que la révision est toujours courante. Installer dans une seule phase synchrone le triplet messages/options/identifiant puis les onglets et le bureau. Une bascule plus récente invalide silencieusement la préparation plus ancienne.
7. Réactiver la capture en la liant explicitement au nouvel UUID ; tout callback débouncé porte l’UUID capturé et s’annule s’il n’est plus actif.
8. Au prochain envoi seulement, OpenAI/MiniMax rappellent la mémoire durable depuis les documents alors visibles conformément à ADR-0019. Ollama ne lit ni n’affiche ces souvenirs. Les `memorySources` historiques restent des preuves du tour passé et ne sont jamais réinjectées comme mémoire actuelle.

## Order of operations

1. Extraire `WorkspacePathSnapshot` de `session.ts`, ajouter ses tests et les primitives préparation/commit dans `stores.svelte.ts`. Toute la fonctionnalité dépend d’un contrat documentaire non mutant avant commit.
2. Écrire `copilot-conversation.ts` et ses tests : schéma canonique, contexte/preuves bornés, nettoyage, titre, groupes, recherche et budget total. Aucun store ni API native à ce stade.
3. Ajouter les primitives confinées de `tauri.ts` et la capability de suppression, puis `copilot-conversations.svelte.ts` avec dépendances injectables, file globale, réconciliation et tests de crash/bascule.
4. Intégrer le cycle de vie dans `copilot.svelte.ts` et `App.svelte` : brouillon, matérialisation au premier prompt, sauvegarde terminale, snapshot lié à l’UUID, flush avant bascule/fermeture, restauration révisionnée et budget total par runtime.
5. Construire `CopilotConversationList.svelte` en reprenant la topologie DeepSeek Harness, puis l’insérer dans `Sidebar.svelte` sans changer le shell ni le rail existants.
6. Ajouter renommage, archivage, vue Archives, suppression individuelle et purge globale dans les réglages. L’archive est canonique et réversible ; toute suppression nomme explicitement la perte du chat mais jamais celle des documents ou mémoires.
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
10. **Given** l’écriture de la discussion courante échoue, **When** je clique une autre discussion ou ferme Doku, **Then** la bascule/fermeture est annulée, l’état courant reste intégralement visible et la cause précise est affichée.
11. **Given** je clique A puis B tandis que la lecture de A est lente, **When** les deux préparations terminent, **Then** seul B peut committer et messages, options, identifiant et bureau proviennent tous de B ; aucun snapshot transitoire n’est écrit sous A ou B.
12. **Given** un chemin cible est déjà ouvert avec des modifications non enregistrées, **When** je reprends la discussion, **Then** ce buffer est conservé et utilisé avec un avertissement visible ; aucune relecture disque ne l’écrase.
13. **Given** `index.json` est absent, corrompu, incomplet ou pointe vers un fichier supprimé, **When** Doku démarre, **Then** l’index est reconstruit depuis les fichiers valides, l’état archivé reste exact, les orphelins redeviennent visibles et une discussion corrompue n’empêche pas les autres de charger.
14. **Given** un gros document, des ajouts, de la mémoire et un long historique, **When** un prompt part vers Ollama/OpenAI/MiniMax, **Then** l’assemblage complet respecte le budget du runtime, réserve la sortie et la question, puis ne conserve que des couples complets dans l’espace restant.
15. **Given** une réponse fondée sur un document complet, **When** la discussion est persistée, **Then** son JSON ne contient ni le document ni tous ses chunks : seulement les preuves réellement citées et bornées ; les contextes fichier/dossier ne contiennent aucun texte du fichier.
16. **Given** 1 000 discussions et une nouvelle requête de recherche, **When** la précédente recherche est encore active, **Then** elle est annulée, au plus 50 MiB/1 000 fichiers sont inspectés et un état progressif reste interactif ; au-delà, l’UI propose d’affiner la requête.
17. **Given** une suppression individuelle ou une purge globale, **When** je redémarre Doku, **Then** aucun fichier canonique, tmp, quarantaine ou entrée d’index visé ne réapparaît, tandis que documents, mémoire, annotations et session globale sont inchangés.

## Test strategy

- `src/lib/copilot-conversation.test.ts` : schéma inconnu/corrompu, UUID invalide, champs transitoires écartés, `archived` canonique, contexte/preuves plafonnés, absence de texte pour fichier/dossier, titre vide/long, groupes, recherche annulable et budget total sans paire orpheline pour chaque classe de runtime.
- `src/lib/copilot-conversations.test.ts` : brouillon invisible, première matérialisation unique, file globale, deux UUID concurrents, ancien write incapable d’écraser le nouveau, réconciliation avec index absent/corrompu/incomplet, canonical orphelin, entrée pendante, tmp, quarantaine et suppression interrompue ; échec de flush, A lent/B rapide, snapshot débouncé périmé, dirty préservé, restauration partielle et purge confinée.
- `src/lib/session.test.ts` : même snapshot utilisé par session globale et discussion, ratio 25–75, deux chemins identiques réduits à un, volet actif absent ramené sur le primaire.
- Tests existants `copilot-memory.test.ts`, `copilot-context.test.ts`, `workspace.test.ts`, `session.test.ts`, `copilot-service.test.ts` et `icons.test.ts` : aucune régression de portée mémoire, contexte automatique des deux documents, assemblage de messages ou subset d’icônes. Relancer `npm run subset:icons` seulement si une icône déjà subsettée ne peut pas être réutilisée.
- Vérification commandes : `npm test -- --run src/lib/copilot-conversation.test.ts src/lib/copilot-conversations.test.ts src/lib/session.test.ts src/lib/workspace.test.ts src/lib/copilot-memory.test.ts src/lib/copilot-context.test.ts src/lib/copilot-service.test.ts src/lib/icons.test.ts`, `npm run check`, `npm run build`, `git diff --check`.
- Banc visuel `.agent/visual/copilot-conversations/` : 296 px et rail replié, clair/sombre, titres très longs, 5/6/25 discussions, recherche ouverte, menu de ligne, groupe fermé, état vide et discussion active. Vérifier que rien ne ressemble à une grille de cartes et qu’aucune ligne n’excède 40 px hors résultat de recherche à snippet.
- Smoke natif : créer une discussion un volet puis une discussion deux volets, fermer immédiatement après une réponse et après un changement de ratio, relancer et reprendre chacune ; déplacer un fichier entre les essais ; vérifier une note dirty du même chemin et une autre hors discussion ; tester archive, suppression, purge et récupération après index supprimé.

## Risks

- **Écritures concurrentes et perte du dernier état** → une file globale couvre fichier canonique + catalogue ; `revision` empêche un état ancien de remplacer un état nouveau et l’index reste un cache entièrement réconciliable.
- **Historique trop gros pour le fournisseur** → calculer un budget total par runtime/modèle, réserver system/question/sortie puis document/RAG/ajouts/mémoire ; l’historique ne reçoit que le reliquat en couples complets. L’estimation conservatrice et les marges sont documentées avec les limites existantes (`240 000` caractères cloud, `16 384` tokens Ollama), sans appel de résumé supplémentaire.
- **Confusion discussion/mémoire/document** → l’ADR et l’UI nomment les trois couches ; la discussion n’est jamais une clé mémoire et `lastProvider` n’est qu’une métadonnée.
- **Fichier manquant, changé ou dirty** → relire le disque sauf si le même chemin possède un buffer dirty vivant ; dans ce cas le préserver et annoncer explicitement que la version non enregistrée sera utilisée.
- **Perte d’une note dirty actuelle lors d’une restauration** → ne fermer aucun onglet ; ne faire que réaffecter les volets. Les onglets non ciblés restent accessibles dans le sélecteur existant.
- **Données sensibles dans les messages/clipboard** → stockage local explicite sous AppData, plafonds de parsing/sérialisation, aucune synchronisation, suppression réelle et purge globale. L’index n’embarque ni chemins absolus ni contenu intégral ; fichier/dossier ne persiste jamais `text`.
- **JSON corrompu après crash** → écriture tmp+rename, fichier illisible mis en quarantaine, protocole de réconciliation déterministe au démarrage et suppression des tmp ; une discussion cassée n’empêche jamais les autres de charger.
- **UI sidebar trop dense** → reprendre les mesures et interactions du navigateur DeepSeek, mais retirer ses concepts agents ; cinq lignes par groupe, métadonnée unique et menu révélé seulement au survol/focus.
- **Navigation pendant un stream ou deux restaurations** → bascule bloquée pendant génération ; ailleurs, `restoreRevision` et suspension du snapshot garantissent qu’une préparation périmée ne peut committer aucun fragment.
- **Fermeture avant le debounce/write** → `onCloseRequested` attend le dernier snapshot et la file globale ; en cas d’échec, la fenêtre reste ouverte avec la cause profonde.
- **Recherche plein texte coûteuse** → travail asynchrone annulable, plafond 1 000 discussions/50 MiB par requête et invitation à affiner plutôt qu’un scan illimité bloquant.
- **Régression navigateur/Tauri** → stockage injecté et fallback `localStorage` pour les tests, smoke natif obligatoire pour AppData et restauration réelle des chemins.

## Open questions

- Aucune décision utilisateur ne bloque la première version. Défauts retenus : groupes temporels, cinq lignes par groupe, brouillon non matérialisé, fournisseur courant conservé, autres onglets jamais fermés, archives accessibles depuis un filtre du panneau.

## Critic feedback

Revue indépendante effectuée le 2026-08-20 : aucun finding Critical, 12 Major et 2 Minor. Tous les Major ont modifié le plan avant exécution :

- `archived` et `revision` vivent désormais dans le fichier canonique ; l’index est une projection reconstruite, pas une seconde source de vérité.
- Une file globale et un protocole de réconciliation couvrent les courses entre discussions et tous les états intermédiaires d’un crash.
- Un flush échoué annule bascule/fermeture ; une révision de restauration empêche A lent de remplacer B et suspend les snapshots transitoires.
- `openPath` est remplacé dans la préparation par une lecture non mutante ; un buffer dirty est préservé et signalé explicitement.
- Le budget porte sur l’assemblage complet et varie par classe de runtime, pas sur l’historique seul.
- Les contextes et preuves ont des schémas discriminés et des plafonds ; aucun document complet ni tableau de chunks n’est recopié dans la discussion.
- Suppression/purge, capability Tauri et flush à la fermeture font maintenant partie du scope et des critères.
- La recherche a un plafond, une annulation et un jeu de charge ; l’icône réutilise le subset existant et `icons.test.ts` rejoint la vérification.
- Le rappel mémoire à la reprise est explicitement limité aux fournisseurs cloud OpenAI/MiniMax, conformément à ADR-0019 ; Ollama ne lit ni n’affiche ces souvenirs.

## Rollback

Un `git revert` retire l’index, le store et la vue ; les fichiers `%APPDATA%/Doku/conversations/*.json` restent inertes et récupérables, sans migration ni effet sur les documents, la mémoire ou la session globale existante.
