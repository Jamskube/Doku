# Plan — Documents générés par Doku-San

## Objectif

Permettre aux modèles cloud de créer et modifier un livrable HTML ou PDF à partir du contexte Doku, sans exposer son code source.

## Livraison

1. Ajouter un contrat d’artefact persistable et une extraction bornée du résultat cloud.
2. Assainir le HTML, interdire le réseau et afficher l’aperçu dans une iframe sandboxée.
3. Ajouter les modes Page HTML et Document PDF au compositeur Doku-San.
4. Exporter localement en HTML autonome ou via le dialogue d’impression PDF existant.
5. Restaurer et modifier l’artefact depuis une discussion enregistrée.
6. Rendre chaque version dans un cadre de contrôle, faire critiquer sa capture quand le fournisseur accepte les images, puis corriger au plus deux fois avant publication.
7. Injecter un studio éditorial commun aux fournisseurs cloud : typologie de livrable, densité, direction visuelle, composition sémantique et règles spécifiques écran/A4.

## Critères d’acceptation

- Étant donné OpenAI ou MiniMax, quand l’utilisateur choisit un format et formule une demande, alors une carte visuelle remplace le code du modèle.
- Étant donné un résultat contenant script ou URL distante, quand Doku le valide, alors aucun contenu actif ni chargement réseau n’atteint l’aperçu ou l’export.
- Étant donné une discussion restaurée, quand elle contient un document généré, alors l’aperçu et ses actions sont de nouveau disponibles.
- Étant donné un document HTML ou PDF généré, quand l’utilisateur choisit Modifier, alors Doku-San repart de cette version.
- Étant donné un document qui déborde, tronque du contenu ou échoue à la critique visuelle, quand la génération se termine, alors Doku le corrige et le rend de nouveau avant de l’afficher.
- Étant donné trois rendus encore bloquants, quand la boucle s’arrête, alors Doku affiche un échec honnête plutôt qu’un document présenté comme terminé.
- Étant donné une demande sans direction graphique explicite, quand le modèle prépare le document, alors il choisit un seul profil adapté au contenu et évite les automatismes visuels génériques.

## Hors périmètre

- Édition visuelle bloc par bloc du HTML.
- Export PDF silencieux sans dialogue système.
- Génération de document avec Ollama dans cette première version.
