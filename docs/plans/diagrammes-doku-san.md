# Plan — Diagrammes générés par Doku-San

## Objectif

Permettre à l’utilisateur de demander un diagramme à partir du document et des sources déjà dans le contexte. Sur les fournisseurs cloud, Doku-San explore plusieurs représentations bgraph, les fait critiquer puis recommande la plus pertinente sans exposer son langage interne.

## Décision d’expérience

- Ajouter un mode de sortie **Diagramme** dans le composeur, au même niveau que le style de réponse.
- Le mode vaut pour le prochain envoi puis revient à la réponse normale.
- Pendant la génération, afficher une progression explicite, jamais le code bgraph en streaming.
- Afficher le résultat dans la conversation sous forme d’une surface de diagramme sobre avec les actions **Autres vues**, **Agrandir**, **Modifier** et **Exporter SVG**.
- Conserver le brief, les variantes, la sélection, la consigne et le titre avec la discussion afin que le studio se recharge et reste modifiable.

## Architecture

1. Compiler bgraph en WebAssembly et livrer le module avec les assets statiques de Doku.
2. Encapsuler le protocole mémoire WASM dans `src/lib/bgraph.ts` : chargement unique, validation, rendu et assainissement SVG.
3. Faire du diagramme un pipeline orchestré par Doku, indépendant des appels d’outils natifs des fournisseurs :
   - extraction cloud d’un brief factuel et proposition de deux ou trois angles issus du catalogue bgraph ;
   - génération parallèle des variantes à partir du brief et de la recette officielle de leur genre ;
   - extraction stricte du bloc attendu ;
   - validation locale ;
   - validation visuelle du ratio, du placement et de la densité textuelle ;
   - au plus deux corrections guidées par les diagnostics ;
   - comparaison par un appel critique indépendant, avec un raffinement ciblé optionnel ;
   - rendu local ou erreur honnête et rejouable.
4. Étendre le message et la conversation persistée avec un artefact Studio optionnel. Le format reste rétrocompatible : les discussions sans Studio et les diagrammes à source unique continuent de se charger.
5. Rendre le SVG comme une image locale après une allowlist stricte ; ne jamais injecter directement le SVG produit dans la webview principale.

## Fichiers principaux

- `public/bgraph.wasm` — moteur de validation et rendu local.
- `src/lib/bgraph.ts` — frontière WASM, contrat de génération et sécurité.
- `src/lib/bgraph.test.ts` — extraction, validation du contrat et assainissement.
- `src/lib/diagram-studio.ts` — catalogue, contrats bornés, prompts spécialisés et validation des décisions du modèle.
- `src/lib/copilot.svelte.ts` — orchestration multi-fournisseurs et persistance du résultat.
- `src/lib/copilot-conversation.ts` — schéma persistant rétrocompatible.
- `src/components/CopilotDiagram.svelte` — aperçu, agrandissement, modification et export.
- `src/components/CopilotPanel.svelte` — mode Diagramme dans le composeur et rendu des artefacts.

## Critique préalable

- **Risque : sortie invalide des petits modèles.** Mitigation : grammaire compacte, exemple valide, diagnostics du compilateur et deux corrections bornées.
- **Risque : SVG hostile ou requête réseau depuis la webview.** Mitigation : bgraph local, allowlist explicite des balises/attributs, retrait de toute URL puis affichage via une URL `data:` dans un élément `img`.
- **Risque : dépendance aux tool calls.** Mitigation : mode de sortie piloté par Doku et simple génération de texte pour les trois fournisseurs.
- **Risque : discussion trop lourde.** Mitigation : persister la source compacte, régénérer le SVG localement et borner la taille de l’artefact.
- **Risque : action supplémentaire trop visible.** Mitigation : puce compacte dans la rangée d’actions du composeur, sans bouton permanent dans le header.
- **Simplification :** une source bgraph est l’unique représentation canonique ; aucun éditeur technique ni format intermédiaire dans cette première version.
- **Sécurité :** aucune source LLM n’est rendue comme HTML ou SVG brut dans le DOM principal.
- **Alignement :** le moteur reste dans la webview via WASM ; l’hôte Rust Tauri conserve zéro logique métier conformément à ADR-0004.

## Critères d’acceptation

1. **Étant donné** un document ouvert et un fournisseur actif, **quand** l’utilisateur active Diagramme et envoie une demande, **alors** une carte de diagramme rendue apparaît sans code bgraph visible.
2. **Étant donné** une première source bgraph invalide ou illisible, **quand** le compilateur ou le contrôle de composition renvoie des diagnostics, **alors** Doku tente une correction bornée avant d’afficher une erreur explicite.
3. **Étant donné** OpenAI ou MiniMax, **quand** plusieurs vues valides sont produites, **alors** une critique indépendante en recommande une et les autres restent accessibles sans nouvelle génération.
4. **Étant donné** une discussion contenant un diagramme Studio, **quand** elle est fermée puis rouverte, **alors** la sélection et toutes ses variantes sont régénérées et affichées depuis leurs sources persistées.
5. **Étant donné** un diagramme affiché, **quand** l’utilisateur choisit une autre vue ou Modifier, **alors** la sélection est persistée ou le composeur reçoit une consigne liée à l’artefact courant ; Exporter télécharge le SVG sélectionné.

## Vérification

- `npm run check`
- `npm test`
- `npm run build`
- Test visuel du composeur et de la carte sur largeur normale et réduite, thèmes clair et sombre.
