# 0023. Licence : AGPL-3.0-or-later

Date : 2026-08-15 · Status : accepted · Deciders : Kubo · Tags : licence, agpl, docx, pdf, distribution, stratégie

## Context

Doku n'avait **aucun fichier `LICENSE`** depuis sa création — il était donc propriétaire par défaut, sans que ce soit une décision consciente. Deux études de faisabilité menées coup sur coup ont buté sur **le même mur, et c'était celui-là** :

- [ADR-0022](./0022-ecriture-pdf-pdf-lib.md) — **MuPDF.js** (Artifex), le moteur documentaire le plus complet pour extraire la structure d'un PDF, est en AGPL ou licence commerciale : écarté.
- La proposition de l'utilisateur — éditer un PDF en le convertissant en DOCX, puis le réexporter — a besoin de **SuperDoc**, seule bibliothèque JS qui édite du vrai `.docx` avec la fidélité de Word (travail direct sur le XML, ProseMirror/Yjs/JSZip, activement développé). Elle est en AGPLv3 ou licence commerciale : écartée pour la même raison.

L'utilisateur a validé le trajet par un test réel : PDF → convertisseur en ligne (Convertio) → DOCX → Google Docs, résultat très fidèle à l'original. Ce test a établi deux choses. La bonne : le **DOCX est le bon format cible**, parce qu'il possède les structures (tableaux, colonnes, cadres, polices, positionnement) que le Markdown n'a pas. La moins bonne : les deux moitiés difficiles du trajet — la conversion et l'édition fidèle — avaient été faites par des moteurs propriétaires, dont un **service en ligne**.

Or Doku est construit sur le principe 8.3, zéro réseau au repos, et son copilote cloud n'est admis que **par consentement explicite** (ADR-0014, ADR-0018). Envoyer chaque document entier chez un tiers pour le convertir est d'une autre nature qu'envoyer une question au copilote.

## Decision drivers

- Débloquer **les deux** moteurs dont l'édition de documents a besoin, d'un seul geste.
- Rester **hors ligne** : la conversion et l'édition doivent tourner sur la machine, sans que le document sorte.
- Aucun coût récurrent par document converti.
- Le copyright est détenu par un **auteur unique** (Kubo, 214 commits, aucun autre contributeur) — donc aucune permission tierce à recueillir, et le relicenciement futur reste possible.
- Doku est une **application de bureau**, pas un service réseau — la clause la plus contraignante de l'AGPL le concerne à peine.

## Considered options

### Option 1 : rester propriétaire, convertir en ligne
Garder la licence actuelle et déporter la conversion chez un service (Convertio, ConvertAPI) avec consentement explicite. · **Pros** : qualité Convertio conservée, aucun développement de convertisseur, précédent architectural des ADR-0014/0018. · **Cons** : **le document sort de la machine** — contraire à la promesse centrale du produit ; coût par conversion ; dépendance à un tiers pour une fonction de base ; inutilisable hors ligne.

### Option 2 : rester propriétaire, acheter les licences commerciales
Licence commerciale MuPDF.js **et** SuperDoc auprès d'Artifex et Harbour. · **Pros** : tout reste local, licence propriétaire préservée. · **Cons** : deux devis à négocier, coût récurrent inconnu, sans rapport avec l'échelle d'un projet personnel.

### Option 3 : passer Doku en AGPL-3.0-or-later
· **Pros** : MuPDF.js **et** SuperDoc s'ouvrent immédiatement et gratuitement ; tout reste local ; aucun coût ; cohérent avec un projet dont la valeur est l'usage, pas la vente de licences. · **Cons** : le code source devient publiquement réutilisable ; toute redistribution doit rester AGPL et fournir les sources ; ferme la porte à une revente propriétaire des versions ainsi publiées.

### Option 4 : renoncer à l'édition de documents
S'en tenir à l'annotation non destructive (ADR-0022, palier 1). · **Pros** : zéro décision de licence, fidélité totale préservée. · **Cons** : l'édition d'un PDF reste définitivement hors de portée de Doku.

## Decision

**Retenu : option 3 — `AGPL-3.0-or-later`.** Texte canonique FSF déposé verbatim dans `LICENSE` ; champ `license` renseigné dans `package.json` et `src-tauri/Cargo.toml` ; mention et renvoi dans le `README.md`.

C'est l'option qui satisfait le driver le plus structurant du projet — **le document ne quitte jamais la machine** — sans introduire de coût ni de dépendance commerciale. Les options 1 et 2 achètent la licence propriétaire au prix, respectivement, de la promesse centrale du produit et d'un budget sans rapport avec un projet personnel.

Deux précisions qui rendent la décision moins lourde qu'elle n'en a l'air :

1. **Le relicenciement reste ouvert.** Kubo étant l'unique titulaire du copyright, il peut à tout moment publier les versions **futures** sous une autre licence, ou pratiquer le double licence. Seules les versions déjà publiées sous AGPL le restent définitivement.
2. **La clause réseau (§13) ne mord presque pas.** Elle impose de fournir les sources aux utilisateurs qui interagissent avec le programme **à travers un réseau**. Doku est une application de bureau qui n'expose aucun service ; le sidecar Ollama écoute uniquement en loopback.

Les dépendances actuelles sont toutes permissives (MIT, Apache-2.0, BSD : Tauri, Svelte, CodeMirror, pdf.js, Ollama, `docx`, `@cantoo/pdf-lib`) — l'AGPL les absorbe sans conflit. L'inverse n'était pas vrai, d'où ce changement.

## Consequences

**Positives** : MuPDF.js et SuperDoc deviennent utilisables, donc le trajet PDF → DOCX → édition → PDF devient techniquement possible **entièrement hors ligne** ; aucun coût ; le mur rencontré deux fois en deux jours tombe pour de bon ; la licence est enfin un choix explicite plutôt qu'un défaut subi.

**Négatives** : le code source de Doku est réutilisable par des tiers sous AGPL ; une éventuelle revente propriétaire des versions publiées est fermée ; l'AGPL rebute certains contributeurs et certains employeurs.

**Risques → parades** :
- *L'AGPL débloque la possibilité, pas la qualité* → même par cette route, la conversion PDF→DOCX sera d'un niveau proche de `pdf2docx` : très correcte sur une mise en page simple, **en dessous de Convertio** sur un document complexe. À mesurer sur les documents réels avant de promettre quoi que ce soit dans l'interface.
- *SuperDoc est bâti sur ProseMirror*, que l'ADR-0002 avait écarté pour le Markdown (réécriture systématique des fichiers, mesurée au spike S0). Le risque ne se reporte pas — il s'agit d'un `kind` de document distinct, sans passage par du Markdown — mais Doku aurait alors **deux moteurs d'édition** (CM6 pour le Markdown, ProseMirror pour le DOCX). Coût de maintenance à assumer explicitement.
- *Ajouter le DOCX comme format éditable est un chantier en soi* → nouveau `kind: 'docx'`, chemin de lecture, chemin de sauvegarde, conversion retour vers PDF. La licence ne fait que rendre le chantier possible ; elle ne le réduit pas.
- *Dépendances futures incompatibles* → l'AGPL est le maillon le plus contraignant de la chaîne ; toute dépendance ajoutée devra être compatible (permissive ou GPL/AGPL), jamais propriétaire à clause restrictive.

## Validation

- `LICENSE` présent à la racine, texte AGPL-3.0 canonique verbatim (661 lignes).
- `license` renseigné dans `package.json` et `src-tauri/Cargo.toml`.
- Mention dans `README.md` avec renvoi à cet ADR.
- Aucune dépendance actuelle en conflit — les licences des dépendances directes sont permissives.

## Related

- [ADR-0022](./0022-ecriture-pdf-pdf-lib.md) — avait écarté MuPDF.js **pour cause de licence** ; cette décision lève l'obstacle et ouvre le réexamen de l'extraction de structure PDF.
- [ADR-0002](./0002-moteur-wysiwyg-cm6-live-preview.md) — ProseMirror écarté pour le Markdown ; SuperDoc le réintroduirait pour le DOCX seulement.
- [ADR-0014](./0014-connexion-compte-openai-codex.md) · [ADR-0018](./0018-fournisseur-cloud-compatible-openai.md) — le précédent du cloud consenti, jugé insuffisant ici (un document entier n'est pas une question).
- [`docs/planning/feasibility-pdf-edition.md`](../planning/feasibility-pdf-edition.md) — l'étude qui a fait apparaître le mur.
