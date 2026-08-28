# Sources de reproduction — diagrammes

Sources bgraph extraites de discussions Doku réelles (`%APPDATA%/com.soundnodes.doku/conversations`)
le 2026-08-28, à l'étape 0 du plan `docs/plans/diagrammes-qualite.md`.

Elles servent de cas de test au chantier qualité : le contrôle doit signaler les
défauts des unes sans rien signaler sur les autres.

| Fichier | Genre | Défaut attendu |
|---|---|---|
| `1d2a8c88-block-1.bd` | block | 3 libellés d'arête masqués — **vue sélectionnée par l'utilisateur** |
| `a759fb64-block-1.bd` | block | 5 libellés masqués — **vue sélectionnée** |
| `ffc8c76b-block-1.bd` | block | 2 libellés masqués — **vue sélectionnée** |
| `1d2a8c88-state-3.bd` | state | 6 libellés masqués, tous sur `renewal` |
| `a759fb64-bpmn-2.bd` | bpmn | 2 arêtes `ortho` traversantes + une classe jamais appliquée |
| `1d2a8c88-network-1.bd` | network | **aucun** — témoin négatif |
| `a759fb64-gantt-1.bd` | gantt | **aucun** — témoin négatif |

Aucune n'est signalée par `bgraph_check` via le WASM aujourd'hui : l'export
s'arrête avant la passe géométrique (`wasm.rs:105`), qui est précisément ce que
l'étape 3 du plan corrige.
