# ADR-0028 — Diagrammes Doku-San avec bgraph en WebAssembly

**Statut :** accepté  
**Date :** 2026-08-27

## Contexte

Doku-San doit transformer le contexte documentaire en diagramme visible sans demander à l’utilisateur d’apprendre ou de manipuler un langage de diagramme. Les trois fournisseurs IA n’exposent pas les mêmes mécanismes d’appel d’outils. L’hôte Rust de Doku doit par ailleurs rester dépourvu de logique métier.

## Décision

- bgraph est compilé en WebAssembly et exécuté localement dans la webview.
- Doku orchestre un mode de sortie « Diagramme » indépendant des tool calls du fournisseur.
- Avec OpenAI et MiniMax, Doku utilise un studio multi-passe : un premier appel extrait un brief factuel et propose jusqu’à trois genres bgraph, deux ouvriers produisent les vues en parallèle, puis un critique indépendant sélectionne et peut raffiner une fois la meilleure vue.
- Le catalogue des trente genres autorisés, leurs libellés et leurs catégories restent détenus par Doku. Le modèle choisit un identifiant connu mais ne définit ni confiance ni métadonnées de confiance.
- Chaque ouvrier ne produit que la source bgraph de sa vue. Doku la valide, renvoie les diagnostics au modèle au plus deux fois, puis effectue le rendu local.
- Une validation visuelle déterministe refuse aussi les canevas extrêmes, les flux implicites en ligne, les libellés trop longs et les citations dans les boîtes ; ces défauts déclenchent la même boucle de recomposition.
- Les demandes d'architecture utilisent en priorité l'archétype `block`, avec groupes et placements explicites, plutôt que le graphe libre.
- Le brief, les variantes valides, la sélection et leurs sources bgraph sont persistés avec la discussion ; les SVG sont régénérés à l’affichage. Les anciens artefacts à source unique restent lisibles.
- Le SVG est filtré par allowlist et présenté comme une image locale, jamais injecté directement comme HTML dans la webview principale.

## Conséquences

- OpenAI et MiniMax privilégient la qualité éditoriale avec plusieurs appels cloud parallèles. Ollama conserve le pipeline local à vue unique comme repli compatible, sans contraindre la conception du studio cloud.
- Les discussions restent compactes et les diagrammes peuvent être régénérés avec une version ultérieure du moteur.
- L’utilisateur voit la recommandation du critique mais peut choisir instantanément une autre vue valide depuis la carte du diagramme.
- Le premier affichage d’un diagramme restauré attend le chargement du WASM.
- La distribution embarque `bgraph.wasm`, sous une licence non commerciale qui ne couvre pas seule cet usage (voir « Licence du moteur »).

## Licence du moteur

bgraph est publié sous la *bgraph Noncommercial License 1.0* (`src-tauri/resources/licenses/bgraph-LICENSE.txt`). Prise au pied de la lettre, elle interdirait l'intégration faite ici sur trois points : l'usage en entreprise est un usage commercial, un `build` redistribuable est une copie *publiée par le licensor* — pas un WASM que nous compilons nous-mêmes — et le source est déclaré confidentiel.

**Autorisation accordée.** L'auteur de bgraph (Bunchyearth23), collègue de travail du mainteneur de Doku, a autorisé de vive voix le 2026-08-28 l'utilisation et l'intégration de son travail dans Doku. Cette permission prime sur les termes publics puisqu'elle vient du licensor lui-même.

**Ce qui reste à faire.** L'autorisation est orale : la faire confirmer par écrit et l'archiver ici. Elle ne lève par ailleurs pas la confidentialité du source — `add-ons/` est gitignoré, le dépôt Doku étant public, et seul l'artefact `public/bgraph.wasm` est versionné.
