# ADR-0027 — Discussions Doku-San durables et reprenables

- Status : accepted
- Date : 2026-08-20
- Tags : copilote, discussions, stockage, restauration, confidentialité

## Contexte

Une conversation Doku-San ne vaut pas seulement par ses messages : elle dépend des documents visibles, du mode un/deux volets, du contexte explicitement ajouté et des preuves consultées. Une simple liste de textes ne permettrait donc pas de reprendre réellement un travail. À l’inverse, rattacher automatiquement une conversation au dossier parent (`Desktop`, `Downloads`, etc.) confondrait navigation, mémoire et travail.

## Décision

Doku conserve localement chaque discussion dans un fichier canonique versionné sous le dossier applicatif `conversations/`. `index.json` est une projection reconstructible destinée à la sidebar ; il n’est jamais une seconde source de vérité.

Une discussion contient :

- les tours stabilisés du chat et leurs preuves bornées ;
- les éléments de contexte explicites, sans recopier le contenu complet des fichiers ;
- les options de portée, recherche Web et mémoire explicitement choisies ;
- un snapshot par chemins du bureau `{ split, volets, volet actif, ratio }`.

Le brouillon vide n’est matérialisé qu’au premier prompt accepté. Toute écriture est sérialisée, atomique, puis l’index est reconstruit. Un JSON illisible est isolé sans bloquer les autres discussions. Une bascule ou une fermeture est refusée si le dernier flush échoue.

À la reprise, Doku prépare les documents avant de muter l’interface. Un buffer non enregistré déjà ouvert reste prioritaire ; un fichier absent dégrade le bureau sans rendre le chat inaccessible. Les autres onglets ne sont jamais fermés.

La mémoire reste un mécanisme distinct, attaché au document ou au dossier choisi conformément à l’ADR-0019. Les preuves mémoire historiques sont affichables mais ne sont pas réinjectées comme mémoire actuelle. Le prochain rappel est recalculé uniquement pour OpenAI/MiniMax ; Ollama n’utilise pas la mémoire cloud.

## Confidentialité et limites

- aucune synchronisation ni télémétrie ;
- recherche locale bornée à 1 000 fichiers / 50 MiB ;
- sélection et presse-papiers plafonnés à 8 KiB par élément ;
- extraits de preuve plafonnés à 2 KiB et 32 KiB par message ;
- suppression individuelle, archivage réversible et purge globale distincte des documents et de la mémoire.

## Conséquences

La sidebar peut proposer des groupes temporels, une recherche et une reprise fidèle inspirés du navigateur de Sessions de DeepSeek Harness, sans importer ses concepts d’agents, branches ou approbations. L’historique complet reste lisible localement, tandis que chaque appel modèle n’envoie que les derniers couples complets tenant dans le budget du fournisseur et l’indique honnêtement dans le chat.

## Alternatives rejetées

- **Historique uniquement en mémoire** : aucune reprise après fermeture.
- **Un fichier Markdown par conversation dans le dossier du document** : pollue les projets et crée une association implicite au dossier parent.
- **Base de données** : complexité, migration et dépendance inutiles pour un index reconstructible.
- **Copier les documents dans la discussion** : duplication, données sensibles et versions périmées.
