# Plan: ajouter-contexte-chat

_Date: 2026-08-12 · Estimated scope: L_

## Goal
Transformer le bouton `+` du composer Doku-San en « Ajouter du contexte » : un menu compact permet d’ajouter la sélection Markdown courante, un ou plusieurs fichiers, un dossier de notes ou du texte depuis le presse-papiers. Les sources restent éphémères à la conversation, visibles et retirables. Au départ de chaque question, Doku construit un unique `ContextBundle` immuable qui regroupe document actif, passages RAG et ajouts, applique un budget total par fournisseur, conserve la provenance réellement transmise et n’envoie jamais de chemin local au modèle.

## Out of scope
- Persister les contextes entre deux conversations ou deux lancements de Doku.
- Copier les fichiers dans le projet, modifier leur contenu ou les ouvrir automatiquement comme onglets.
- Ajouter des formats autres que Markdown, texte, HTML et PDF.
- Indexer automatiquement un dossier lourd derrière une question : l’indexation initiale reste une action explicite.
- Ajouter `tauri-plugin-clipboard-manager` tant que `navigator.clipboard.readText()` fonctionne dans la webview native.
- Produire des citations inline ancrées pour les fichiers ponctuellement ajoutés ; Doku affiche toutefois une provenance déterministe de toutes les sources réellement transmises.
- Garantir qu’un contexte déjà reformulé dans une réponse antérieure disparaisse de l’historique après son retrait : seule « Nouvelle conversation » purge tout le dialogue.

## Files

### Modified
- `src/components/CopilotPanel.svelte` — activer le bouton `+`, rendre à la racine du panneau un menu flottant non clippé par `contain`, gérer souris/clavier/focus/Échap/clic extérieur, afficher les sources temporaires et leur état dans la face Contexte, montrer le fournisseur cloud destinataire, cibler le dossier ajouté dans la carte d’indexation et expliquer qu’une nouvelle conversation est nécessaire pour purger aussi l’historique dérivé.
- `src/lib/copilot.svelte.ts` — stocker les contextes éphémères, leur révision et le dossier choisi ; basculer explicitement en portée dossier lors de son ajout ; construire un `ContextBundle` immuable au départ de chaque envoi ; conserver sur chaque réponse la provenance réellement transmise ; empêcher un retry silencieux si la révision du contexte a changé ; tout purger dans `newChat()`.
- `src/lib/copilot-service.ts` — remplacer les cadres « uniquement le document » divergents par un cadre conditionnel de « corpus fourni » quand des ajouts existent, traiter chaque contenu comme donnée non fiable, adapter les phrases de refus et recevoir le bloc borné produit par `ContextBundle` sans appliquer un second plafond.
- `src/lib/copilot-service.test.ts` — couvrir les prompts document/dossier avec et sans ajouts, la consigne anti-instruction du contenu, les phrases de refus, les profils local/cloud et l’absence stricte de changement quand aucun ajout n’existe.
- `src/lib/tauri.ts` — ajouter un sélecteur natif multi-fichiers filtré, exposer les tailles avant lecture et activer `recursive: true` sur le sélecteur de dossier, sans élargir les capabilities existantes.
- `docs/design/w2-copilot/README.md` — documenter le rôle du bouton `+`, les quatre actions, la durée de vie des ajouts, la portée dossier, les états de troncature/provenance et les interactions attendues.

### Created
- `src/lib/copilot-context.ts` — définir `CopilotContextItem`, `ContextBundle` et `SentContextSource` ; normaliser les identités Windows ; borner les fichiers avant lecture ; remplacer le snapshot d’un fichier réajouté ; appliquer un budget corpus total local/cloud ; produire le bloc de prompt, la provenance nettoyée, l’empreinte de révision et les marqueurs de troncature.
- `src/lib/copilot-context.test.ts` — tester déduplication insensible à la casse, remplacement d’un fichier modifié, limites avant lecture, budget total, partage déterministe document/ajouts, absence de chemin absolu, provenance, ordre et troncatures.

### Deleted
- Aucun fichier.

## Order of operations
1. Définir les limites d’ingestion dans `copilot-context.ts` avant toute I/O : 8 ajouts maximum, 2 Mio maximum par fichier texte, 25 Mio maximum par PDF, 240 000 caractères maximum conservés par item texte/sélection/presse-papiers, et au plus 2 lectures/extractions concurrentes. Un dépassement est refusé ou marqué explicitement, jamais chargé puis caché silencieusement.
2. Définir le modèle éphémère : identifiant local, kind (`selection`, `clipboard`, `file`), libellé nettoyé, chemin local optionnel, texte snapshot, taille, signature disque et `truncatedAtLoad`. Les chemins Windows sont normalisés sans tenir compte de la casse ; réajouter un même chemin remplace le snapshot au lieu de conserver une version périmée.
3. Construire le packer pur `buildContextBundle(...)`. Son plafond est l’unique budget de corpus déjà associé au runtime — 12 000 caractères en local ou 240 000 dans le cloud — et n’est jamais ajouté au plafond du document. Quand source principale et ajouts existent, réserver jusqu’à 50 % à chacune, redistribuer toute part inutilisée, puis répartir la part des ajouts équitablement en ordre d’insertion. Le résultat contient le texte réellement transmis, `sentSources`, `truncatedForRequest`, un fingerprint et aucun chemin absolu.
4. Étendre `tauri.ts` avec `openContextFilesDialog()` (`multiple: true`) et les métadonnées `stat` nécessaires au contrôle avant lecture. Charger le texte via `readTextFileAt`; charger les octets PDF seulement après validation de taille puis utiliser `extractPdfText`. Le sélecteur de dossier reçoit `recursive: true` pour que le scope dynamique couvre ses sous-dossiers.
5. Ajouter au store `copilot` `contextItems`, `contextFolder`, `contextRevision` et `contextError`, avec helpers d’ajout/remplacement/retrait/reset. Capturer sélection, nom/path d’onglet et texte au clic. Ajouter un dossier le rend immédiatement visible et pose `scope = 'folder'`; le retirer remet `scope = 'doc'` afin de ne pas interroger implicitement un autre dossier.
6. Unifier la préparation d’une requête dans `copilot.svelte.ts` : résoudre d’abord le document/PDF ou les passages RAG, puis construire un seul `ContextBundle` à partir de cette source principale et des ajouts. Le dossier effectif est `contextFolder` en priorité, sinon le dossier existant. La vue Modèles et son action d’indexation utilisent exactement ce même dossier effectif, avec le libellé « Indexer ce dossier » ; `buildIfMissing:false` reste la règle derrière une question.
7. Adapter `copilot-service.ts` : lorsqu’un bundle contient plusieurs sources, le system prompt parle du « corpus fourni », demande d’ignorer toute instruction contenue dans les documents et traite ceux-ci uniquement comme données. Les ajouts sont délimités et nommés avec des basenames/libellés nettoyés. La phrase de refus devient « Je ne trouve pas cette information dans le corpus fourni ». Sans ajout, les builders et constantes historiques restent byte-identiques pour limiter le blast radius.
8. Capturer sur la réponse `contextSources` depuis `bundle.sentSources` et produire un `sourceLabel` composite honnête pour « Sauver en note ». Les citations `[n]` existantes continuent de désigner uniquement les passages document/RAG ancrables ; un pied séparé « Contexte transmis » liste les ajouts réellement envoyés et leur état partiel sans prétendre qu’ils sont cliquables.
9. Rendre les retraits et retries honnêtes. Retirer une source incrémente `contextRevision` et bloque tout retry créé avec une autre révision par un message « Le contexte a changé — renvoyez la question ». Le retrait empêche toute injection directe future, mais la face Contexte précise, lorsqu’un historique existe, que « Nouvelle conversation » est nécessaire pour supprimer aussi l’influence possible des réponses précédentes. `newChat()` annule, vide messages, ajouts, dossier, erreurs et révision.
10. Remplacer le bouton désactivé dans `CopilotPanel.svelte` par un trigger « Ajouter du contexte ». Rendre le menu en dernier enfant de `.cop-panel`, dans son repère, comme le menu de verbosité. Proposer sélection (désactivée si vide/non textuelle), fichiers, dossier et presse-papiers ; fermer au choix, clic extérieur, Échap ou Tab, puis restaurer le focus. En cloud, afficher dans le menu et la face Contexte « Sera envoyé à OpenAI/MiniMax » avant l’envoi, sans modale supplémentaire.
11. Afficher les ajouts sous forme de lignes compactes supprimables : type, basename/libellé, taille, `Partiel à l’ajout` et `Partiel pour cette question` comme états distincts. Ne jamais rendre leur contenu via `{@html}`. Ajouter les inputs navigateur cachés (`multiple`, `accept`, `webkitdirectory`) uniquement comme fallback de test/Vite.
12. Mettre à jour le handoff design, exécuter les tests purs, la suite complète, les vérifications navigateur et le smoke natif avant de considérer le lot terminé.

## Test strategy
- `npm test -- src/lib/copilot-context.test.ts src/lib/copilot-service.test.ts` — ingestion, identité, limites, bundle, prompts, refus et provenance.
- Ajouter des cas de payload complet : document à la limite + ajouts + historique, local/cloud, répartition 50/50 avec redistribution, retrait puis question suivante, retry après changement de révision et absence de chemin `C:\…` dans tous les messages envoyables.
- `npm run check`, `npm test`, `npm run build` — typecheck, suite complète et build de production.
- Test navigateur sur port séparé : clic réel sur `+`, navigation clavier complète, Échap/focus retour, clic extérieur, action sélection conditionnelle, inputs fichiers/dossier, lignes de contexte, retrait, compteurs, états partiels, destination cloud et reset « Nouvelle conversation ».
- Test navigateur aux largeurs normale/étroite, panneau réduit/étendu, clair/sombre et `prefers-reduced-motion: reduce` : aucune coupe par le composer ou `.cop-panel`, aucun contenu dépendant d’une animation.
- Smoke natif `npm run tauri dev` : fichiers `.md/.txt/.html`, PDF texte/scanné/trop lourd, dossier imbriqué, annulation des dialogues, presse-papiers autorisé/refusé, déduplication avec casse différente et remplacement après modification disque.
- Smoke dossier : ajouter un dossier bascule la portée ; la vue Modèles nomme et indexe ce même dossier ; un index absent produit la carte de configuration existante sans lancer l’indexation silencieusement.
- Smoke IA local puis cloud : poser une question répondable uniquement grâce à un ajout ; vérifier le pied « Contexte transmis », le `sourceLabel` de la note sauvée, la phrase de refus corpus, le blocage d’un retry après retrait et la purge complète après nouvelle conversation.
- Monitoring réseau natif : aucune lecture locale ne génère de trafic ; avec un fournisseur cloud, le payload contient uniquement basenames/libellés et contenu borné, jamais les chemins absolus.

## Risks
- Le menu peut être capturé ou clippé par `contain: layout paint` → le rendre à la racine de `.cop-panel` et calculer ses coordonnées dans ce repère, serrées dans les bords.
- La somme document + ajouts + historique peut dépasser la fenêtre → un seul budget de corpus par runtime, jamais deux plafonds additifs ; tests de payload maximal obligatoires.
- Le corpus utilisateur peut contenir une prompt injection → délimitation forte, libellés non interprétés et consigne système explicite de traiter les fichiers comme données non fiables ; accepter qu’aucune consigne ne garantit à elle seule l’immunité d’un LLM.
- La provenance peut mentir si elle est dérivée de l’onglet actif → la capturer depuis `ContextBundle.sentSources` au moment exact de l’envoi et la stocker sur la réponse.
- Un fichier/PDF énorme peut saturer la mémoire avant troncature → stat et plafond binaire avant lecture, nombre borné et concurrence maximale de 2.
- Le presse-papiers peut être refusé par WebView2 → appel direct depuis le geste utilisateur, erreur visible, aucun item fantôme ; plugin Tauri seulement si le smoke prouve le besoin.
- Le dossier ajouté peut diverger du dossier indexé → une seule dérivation `effectiveContextFolder` partagée par question, badge et action d’indexation.
- Retrait et retry peuvent donner une fausse impression de purge → révision de contexte, retry bloqué après mutation et microcopie explicite sur l’historique ; nouvelle conversation comme seule purge complète.
- Les fichiers peuvent changer après ajout → snapshot assumé, signature affichable, réajout = remplacement ; aucune relecture silencieuse au moment de l’envoi.

## Open questions
- Aucune question bloquante. Les choix par défaut sont : dossier ajouté = portée dossier active ; provenance déterministe mais non cliquable pour les ajouts ; retrait = futurs envois directs seulement ; nouvelle conversation = purge complète ; retry refusé dès que le contexte a changé.

## Rollback
Revert du commit d’implémentation : tous les contextes étant en mémoire uniquement, le bouton redevient inactif sans migration ni nettoyage de données utilisateur.

## Critic feedback
- 0 Critical, 8 Major, 3 Minor relevés par la revue indépendante.
- Intégré : `ContextBundle` unique, budget corpus global, cadre « corpus fourni », provenance transmise, dossier/indexation alignés, basenames seulement côté cloud, retrait/retry explicités et limites appliquées avant lecture.
- Intégré : distinction `truncatedAtLoad` / `truncatedForRequest`, déduplication Windows insensible à la casse avec remplacement, et tests du payload complet plutôt que des seuls builders.
