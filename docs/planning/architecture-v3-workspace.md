# Architecture : bureau scindé et notes liées

_Date : 2026-08-13 · Statut : Reviewed · Références : `PRD-v3.md`, `ux-spec-v3.md`, `feasibility-v3-split-workspace.md`_

## Context

Doku doit afficher deux documents simultanément tout en conservant ses invariants actuels : le fichier est la source de vérité, une modification ne touche qu’un `DocTab`, les écritures restent atomiques et les formats binaires restent inaccessibles au chemin de sauvegarde. Le code actuel suppose une seule surface via `activeTab()`, `editorRef`, `editorSel`, `sourceMode` et `activeHeadingLine` globaux. L’architecture v3 introduit une couche de **volets d’affichage** sans dupliquer les buffers documentaires.

## Constraints

- **Scale** : deux surfaces maximum ; jusqu’à deux Markdown de 500 Ko interactifs, onglets ouverts inchangés en nombre.
- **Latency** : ouverture/fermeture du split ≤ 300 ms ; checkpoint p95 frappe ≤ 25 ms à M2, cible produit ≤ 16 ms.
- **Reliability** : zéro sauvegarde croisée ; zéro sérialisation d’un document non édité ; PDF toujours lecture seule.
- **Platform** : Tauri 2, Svelte 5, CodeMirror 6 ; Windows ARM64 et x64.
- **Security** : aucun lien de citation navigué par la webview ; chemins locaux validés par une primitive pure avant `openPath`.
- **Budget** : aucune dépendance UI ou stockage supplémentaire ; réutilisation de plugin-dialog/fs.

## High-level shape

```text
┌──────────────────────────── App.svelte ─────────────────────────────┐
│ TitleBar ── selectTab(tabId) ───────────────┐                      │
│                                             v                      │
│  ┌──────────────────── WorkspaceView.svelte ────────────────────┐  │
│  │ Pane(primary)             SplitDivider     Pane(secondary)   │  │
│  │ pane.tabId                                  pane.tabId        │  │
│  │      │                                           │           │  │
│  │ DocumentView(paneId, tabId)      DocumentView(paneId, tabId) │  │
│  │      │                                           │           │  │
│  │ EditorView registry[primary]       registry[secondary]       │  │
│  └──────┼───────────────────────────────────────────┼───────────┘  │
│         └────────────── transactions ────────────────┘              │
│                              │                                      │
│                              v                                      │
│                     tabs[] : DocTab                                 │
│                  source de vérité unique                            │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
                  ┌────────────┴────────────┐
                  v                         v
       writeTextFileAtomic(path)    localStorage session v2
          + saveTextDialog          (chemins + pane state)
```

Le modèle interdit qu’un même `tabId` soit affecté aux deux volets. CodeMirror confirme que plusieurs `EditorView` peuvent coexister mais ne se synchronisent pas automatiquement ; cette interdiction supprime tout protocole de synchronisation et les conflits de transaction.

## Components

| Component | Responsibility | Technology |
|---|---|---|
| `WorkspaceView` | Orchestrer les deux volets, l’état vide secondaire, le breakpoint, le ratio, la permutation et les menus rendus hors des zones clippées | Svelte 5 + CSS flex |
| `DocumentPane` | Mini-entête du volet, activation explicite et affectation d’un `tabId` | Svelte 5 |
| `SplitDivider` | Pointeur rAF, clavier, ARIA 25–75, orientation responsive | Svelte 5, Pointer Events |
| `DocumentView` paramétré | Rendre le `DocTab` fourni ; enregistrer sa vue/sélection sous `paneId`; ne plus lire implicitement `activeTab()` pour son contenu | Svelte 5 + CodeMirror 6 |
| `workspace.ts` | Invariants purs : affectation, activation, fermeture, permutation, bornage ratio, sérialisation/restauration | TypeScript pur testé |
| `editor-registry.ts` | Registre runtime `paneId → EditorView`, sélection et dernier focus ; aucun état persistant | TypeScript + runes pour sélection |
| `saveTabAs` | Capturer tab/content, demander un chemin, écrire atomiquement, puis seulement muter `DocTab` et index | stores + plugin-dialog/fs |
| `linked-note.ts` | Construire/parser une citation v1, hash/normalisation, relocalisation déterministe, validation de chemins | TypeScript pur testé |
| Session v2 | Restaurer les chemins puis affecter les IDs recréés aux volets ; ignorer les notes sans chemin | localStorage versionné |

## Data model

### Documents

`DocTab` reste la seule source de vérité pour `content`, `savedContent`, `path`, `kind`, `eol`, `rev` et `heavy`. Un volet ne détient jamais une copie de contenu.

### Workspace

```ts
export type PaneId = 'primary' | 'secondary'

export interface PaneState {
  tabId: number | null
  sourceMode: boolean
}

export interface WorkspaceState {
  split: boolean
  activePaneId: PaneId
  primary: PaneState
  secondary: PaneState
  ratio: number       // 25..75
}
```

Invariants :

1. `primary.tabId !== secondary.tabId` quand les deux sont non nuls.
2. `app.activeId === workspace[activePaneId].tabId` ; `activeId` reste un miroir de compatibilité pendant la migration, puis pourra disparaître.
3. `split === false` implique que `secondary.tabId` peut rester mémorisé pendant l’animation mais n’est ni actif ni monté après sa fin.
4. Toute opération asynchrone capture `{paneId, tabId, content}` avant son premier `await` et vérifie que le `DocTab` existe encore avant la mutation finale.
5. `sourceMode` appartient au volet ; la largeur de colonne reste un réglage global.

### Runtime editor registry

```ts
Map<PaneId, {
  view: EditorView | null
  tabId: number
  selection: { from: number; to: number; text: string }
}>
```

Le registre ne contient aucun buffer canonique et n’est jamais sérialisé. `activeEditorView()` lit l’entrée de `workspace.activePaneId`. La sidebar, Doku-San et les commandes de formatage passent par cette fonction au lieu d’un singleton.

### Session v2

```ts
interface SessionV2 {
  version: 2
  tabs: string[]
  activePath: string | null
  workspace: {
    split: boolean
    activePaneId: PaneId
    primaryPath: string | null
    secondaryPath: string | null
    ratio: number
  }
}
```

La restauration relit d’abord tous les chemins, produit une table `path → tabId`, puis applique le workspace. Une session v1 est migrée en `split:false`, `primaryPath:activePath`. Les notes sans chemin ne sont ni sérialisées ni restaurées.

### Citation v1

La partie visible est un bloc Markdown standard. Le commentaire `doku-citation:v1` contient uniquement un chemin local, ligne/colonne/longueur, hash SHA-256 du texte normalisé et contexte borné. Il est traité comme donnée non fiable.

Relocalisation : position + hash → texte exact unique → texte exact + contexte → échec ou ambiguïté. Doku ne fait jamais de correspondance floue silencieuse.

## Data flows

### Sélection d’un onglet

```text
TitleBar click(tabId)
  → selectTab(tabId)
  → si tabId affiché ailleurs : activatePane(other)
  → sinon assignTab(activePaneId, tabId)
  → mirror activeId
  → DocumentView ciblé change d’état
```

### Sauvegarde

```text
Ctrl+S
  → capture activePaneId + tabId + content
  → path présent ? saveTab(snapshot) : saveTabAs(snapshot)
  → dialogue natif (si nécessaire)
  → writeTextFileAtomic(path, capturedContent)
  → retrouver tabId
  → path/name/savedContent/index/session seulement après succès
```

Changer de volet ou fermer l’onglet pendant le dialogue ne redirige jamais l’écriture. Si l’onglet a disparu après l’écriture, Doku n’affecte aucun autre onglet ; le fichier choisi reste la sortie explicite de l’utilisateur et une notification l’indique.

### Capture de citation

```text
selection(active pane) + secondary Markdown target
  → normalize + validate limit
  → buildCitationV1(source snapshot)
  → dispatch insertion in target editor registry
  → mutate target DocTab only through target EditorView transaction
```

## External dependencies

- `@tauri-apps/plugin-dialog` — dialogue Enregistrer sous, déjà installé ; fallback navigateur = chemin de démonstration sans I/O.
- `@tauri-apps/plugin-fs` — écriture atomique existante ; aucune permission supplémentaire.
- Web Crypto `crypto.subtle.digest('SHA-256')` — hash local ; fallback pur JS non requis sur WebView2 moderne.
- CodeMirror 6 — deux vues indépendantes, validées par le spike M0 et la documentation officielle.

## Cross-cutting

- **Auth** : aucune.
- **Security** : `linked-note.ts` rejette schéma URL, UNC (`\\server`), device paths (`\\?\`, `\\.\`), contrôles et extensions non prises en charge ; canonicalisation native avant ouverture ; aucune ancre HTML navigante.
- **Accessibility** : `SplitDivider` est un separator à valeur ; F6 active l’autre volet ; focus visible ; menus de volet rendus au niveau `WorkspaceView` pour éviter le clipping.
- **Observability** : `performance.mark` sur ouverture du split et frappe de stress en dev ; aucune télémétrie.
- **Deployment** : aucune nouvelle ressource native ; tests et builds ARM64/x64 existants.
- **Failure modes** :
  - onglet fermé → volet vide, commandes ignorées ;
  - save-as annulé → aucun état modifié ;
  - erreur I/O → buffer intact + bannière ;
  - source de citation absente/non sûre → ouverture refusée, note lisible ;
  - second gros document hors budget → volet secondaire lecture seule hors focus, décision au checkpoint M2.

## Decisions (link to ADRs)

- **ADR-0020** : `DocTab` unique + `PaneState` d’affichage, plutôt que dupliquer les buffers ou synchroniser deux vues.
- **ADR-0021** : citation Markdown visible + commentaire v1 facultatif, plutôt qu’une base de données propriétaire obligatoire.
- ADR-0002 reste applicable : CodeMirror live-preview conserve le Markdown comme source.
- ADR-0003 reste applicable : les fichiers AppData ne remplacent jamais les documents utilisateur.
- ADR-0004 reste applicable : dialogue/fs officiels, logique métier TypeScript.

## Open questions

Aucune question bloquante pour le plan. Le mode secondaire lecture seule hors focus n’est activé que si le checkpoint p95 ≤ 25 ms échoue dans le produit réel ; le spike actuel ne le justifie pas.

## Out of scope

- même `DocTab` édité simultanément dans les deux volets ;
- trois volets ou fenêtres documentaires secondaires ;
- annotations PDF écrites ou persistées ;
- édition DOCX ;
- canevas libre ;
- collaboration ou synchronisation réseau.
