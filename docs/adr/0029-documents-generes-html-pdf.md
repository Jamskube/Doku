# ADR-0029 — Documents HTML et PDF générés par Doku-San

**Statut :** accepté  
**Date :** 2026-08-31

## Contexte

Doku-San doit pouvoir transformer un contexte documentaire en page HTML ou en document PDF sans exposer de code à l’utilisateur. Un document produit par un modèle cloud reste du contenu non fiable : il ne doit jamais obtenir les capacités de la webview principale ni déclencher de chargement réseau.

## Décision

- OpenAI et MiniMax disposent d’un mode de sortie « Page HTML » ou « Document PDF », distinct d’une réponse et d’un diagramme.
- Le modèle renvoie le document HTML brut dans une enveloppe privée `<doku-document title="…">…</doku-document>` — pas de JSON : un HTML encapsulé dans une chaîne JSON casse au premier guillemet ou retour ligne non échappé. Doku extrait l’enveloppe (l’ancien objet JSON reste accepté), borne sa taille, l’assainit et supprime toute ressource distante, y compris les liens SVG et les fonctions CSS `image-set()`, `image()` et `src()`.
- L’aperçu est rendu dans un `iframe sandbox` sans scripts, avec une CSP `default-src 'none'`.
- Le HTML est exporté comme fichier autonome local avec la même CSP.
- Le PDF n’est pas un binaire fabriqué par le modèle : Doku imprime localement le HTML validé avec le pipeline Chromium existant. L’aperçu et l’export partagent donc la même source canonique.
- Chaque génération reçoit le contrat « Doku Document Studio » : le modèle classe silencieusement le livrable, choisit une densité d’information et une seule direction visuelle, construit d’abord l’arc éditorial, puis applique les contraintes responsive ou A4. Les choix explicites de l’utilisateur restent prioritaires.
- Ce contrat adapte les principes éditoriaux de Beautiful Article v0.1.0, épinglé au commit `78b4d081493e2a4a1c199d074f63e57814ed7e30` sous licence MIT. Doku n’embarque ni son runtime React, ni ses scripts, ni ses ressources distantes : l’adaptation est un prompt TypeScript natif compatible avec le sandbox existant.
- Le HTML canonique assaini est persisté avec la discussion. La restauration applique uniquement le contrôle d’affichage ; les règles de génération nouvelles ne rendent pas les anciens artefacts illisibles.
- Une modification repart de l’artefact existant et reste une nouvelle génération explicite.
- Avant publication, Doku rend l’artefact hors écran dans son format cible et contrôle les débordements, les troncatures, les contrastes et la longueur ; une page HTML est contrôlée à 1200 px et à 390 px. Pour l’A4, l’aperçu, l’audit et l’impression partagent la même colonne de texte : les marges `@page` du contrat sont reproduites à l’écran par un padding de corps, et retirées à l’impression. OpenAI reçoit en plus une capture JPEG du rendu — obtenue nativement par un `<foreignObject>` SVG dessiné sur un canvas, donc par le moteur Chromium lui-même et sans bibliothèque qui réimplémente le CSS — et rend un verdict visuel structuré ; MiniMax M2.5, sans entrée image, reste explicitement sur le contrôle géométrique. Le rendu de contrôle reste un rendu écran : la pagination réelle de l’A4 n’est vue que par le dialogue d’impression.
- Un défaut bloquant déclenche au maximum deux corrections par le modèle, chacune suivie d’un nouveau rendu. Après trois rendus non conformes, aucun artefact n’est présenté comme terminé.
- Le reçu de contrôle (mode, nombre de passages, résumé et avertissements) est persisté avec l’artefact ; il n’est jamais recalculé lors d’une simple restauration de discussion.

## Conséquences

- L’utilisateur manipule un livrable visuel, jamais son code.
- Aucun script, formulaire, iframe, lien actif ou chargement distant ne survit au pipeline.
- L’export PDF ouvre le dialogue système d’impression ; Doku ne promet pas encore un enregistrement silencieux.
- Les modèles Ollama restent exclus de ce mode dans cette première version : la fonctionnalité cible explicitement les modèles cloud.
- Le contrôle visuel n’est pas simulé : la carte distingue « vérifié visuellement » d’un simple contrôle de mise en page lorsque le fournisseur ne reçoit pas d’image.
- Une compétence éditoriale améliore la probabilité d’un bon premier rendu mais ne remplace jamais le contrôle réel : le rendu hors écran reste l’unique porte de publication.
