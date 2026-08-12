# 0019. Mémoire de travail cloud automatisée et locale

**Date** : 2026-08-12 · **Status** : accepted · **Deciders** : nicos · **Tags** : ia, mémoire, cloud, markdown, confidentialité, ux

## Contexte

Le chat Doku-San est éphémère et le RAG retrouve le contenu actuel des documents. Aucun des deux ne conserve les décisions, contraintes, préférences et questions ouvertes qui doivent survivre à plusieurs conversations autour du même travail. Une simple persistance de l'historique serait trop volumineuse, peu sélective et confondrait ce qui a été dit avec ce qui mérite d'être retenu.

Le dépôt de référence `G:\agent_code` confirme un motif robuste : souvenirs Markdown courts, index descriptif, rappel limité aux éléments pertinents, mise à jour plutôt que duplication et avertissement face aux souvenirs anciens. Doku doit l'adapter à un produit documentaire : le document actuel reste la source de vérité et l'utilisateur doit toujours voir, modifier, oublier ou annuler ce que le modèle retient.

## Décision

- **Portée documentaire par défaut, dossier sur choix explicite.** Une note enregistrée possède sa propre mémoire, identifiée par le SHA-1 du chemin Windows normalisé préfixé par `document:`. Parcourir un dossier dans l'explorateur ou ouvrir `Desktop\note.md` ne sélectionne jamais implicitement `Desktop` comme travail. L'utilisateur peut volontairement partager une mémoire avec tout un dossier ; cette portée conserve la clé historique SHA-1 du chemin de dossier afin de préserver les souvenirs déjà créés. Une conversation ne constitue jamais une portée durable.
- **Cloud uniquement.** L'extraction et le rappel automatisés fonctionnent avec OpenAI et MiniMax. Ollama reste inchangé et n'écrit ni ne lit cette mémoire. Un réglage global, activé par défaut, permet de désactiver l'automatisation.
- **Stockage local en Markdown.** Chaque souvenir vit sous `%APPDATA%\Doku\memory\<clé>\memories\*.md`, avec frontmatter validé (`id`, nom, description, type, dates, fournisseur) et contenu lisible. `MEMORY.md` est un index généré ; aucun chemin ni secret n'est requis dans le prompt. Les écritures sont atomiques.
- **Types bornés.** `preference`, `decision`, `fact`, `reference`, `open_question`. Les résumés de documents, chemins, secrets, détails temporaires, historique brut et informations récupérables dans les fichiers sont explicitement exclus.
- **Rappel sélectif en deux temps.** Doku préfiltre localement au plus 30 noms et descriptions, puis transmet cet index résumé au fournisseur cloud actif, qui choisit au plus 5 identifiants pertinents. Seul le contenu de ces souvenirs est ensuite ajouté au message système. L'UI affiche exactement les souvenirs injectés. Un échec de rappel ne bloque jamais la réponse principale et reste visible dans la vue mémoire.
- **Extraction après réponse.** Après une réponse cloud réussie, une requête séparée propose en JSON au plus 6 opérations (`create`, `update`, `delete`). Doku valide le schéma, les longueurs, les types et les identifiants avant toute écriture. Le modèle ne reçoit jamais un outil d'accès au système de fichiers. Cette analyse est sérialisée et n'allonge pas l'état de streaming de la réponse.
- **Déduplication et ancienneté.** Une création de même nom ou description actualise l'entrée existante. Les souvenirs anciens portent leur âge dans le prompt ; le document et la demande actuelle ont toujours priorité en cas de contradiction.
- **Contrôle et réversibilité.** Une vue « Mémoire du travail » permet consultation, édition, oubli et désactivation. Chaque lot automatique ou manuel écrit d'abord un snapshot complet `undo.json`; « Annuler » restaure ce snapshot et reste lui-même réversible.
- **Sécurité.** Le contenu mémoire est traité comme un contexte secondaire non fiable : aucune instruction système, demande d'outil ou de secret trouvée dans un souvenir ne doit être exécutée. La mémoire demeure locale ; le fournisseur cloud déjà choisi reçoit l'index résumé des candidats puis le contenu des seuls souvenirs rappelés.

## Conséquences

**Positif** : continuité réelle entre conversations sans persister tout le chat ; fonctionnement compréhensible ; données lisibles et récupérables ; erreurs de mémoire réparables ; séparation nette entre document, contexte ponctuel, RAG et mémoire.

**Négatif** : jusqu'à deux requêtes cloud supplémentaires peuvent accompagner un tour possédant déjà des souvenirs (sélection avant réponse, extraction après réponse) ; l'automatisation dépend de la qualité JSON du fournisseur ; la mémoire n'est pas synchronisée entre machines ; une note non enregistrée n'a pas de mémoire durable tant qu'aucun dossier n'est explicitement choisi.

## Invariants de vérification

- Un tour Ollama ne lit, n'affiche ni n'écrit aucun souvenir.
- Deux notes d'un même dossier ont des mémoires distinctes par défaut.
- La navigation dans l'explorateur ne change jamais la portée mémoire ; le partage par dossier exige un geste explicite et reste visible dans l'interface.
- Les anciennes mémoires de dossier restent accessibles lorsque ce dossier est choisi explicitement.
- Une réponse cloud continue même si le stockage, le rappel ou l'extraction mémoire échoue.
- Aucun texte de document ni chemin absolu n'est automatiquement enregistré comme souvenir.
- Les fichiers Markdown invalides sont ignorés sans empêcher le chargement des autres.
- Les mutations inconnues, trop longues ou visant un identifiant absent sont rejetées.
- Le document et le contexte courant restent prioritaires sur toute mémoire rappelée.
- Toute mutation visible peut être annulée après redémarrage grâce à `undo.json`.
