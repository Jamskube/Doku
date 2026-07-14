# AGENTS.md

Context for AI coding assistants. Read at the start of every session.

## Project goal
Doku — petite application pour **ouvrir, lire et éditer des fichiers Markdown**, avec extension prévue plus tard vers d'autres formats (**PDF**, etc.).

## Stack
- Language: TypeScript (frontend) + Rust minimal (hôte Tauri, zéro logique métier — ADR-0004)
- Framework: Tauri 2 + Svelte 5 + Vite — décidé, ADR-0001 accepted (`docs/adr/`)
- Contrainte machine : **Windows ARM64** — Surface Pro 11, Snapdragon X Elite, NPU (IA locale envisagée en v2) → la stack doit tourner nativement en ARM64
- Référence : `G:\KUDE` (mode lecture/édition Markdown + design system AIR) ; maquettes officielles dans `docs/design/w1/`
- Éditeur : CodeMirror 6 « live preview » (ADR-0002) — `src/lib/editor/`
- Database / ORM: aucune (fichiers locaux)
- Package manager: npm

## Setup commands
- Install : `npm install`
- Dev (UI navigateur, APIs Tauri neutralisées) : `npm run dev` → http://localhost:1420
- Dev (app native) : `npm run tauri dev` (première compile Rust longue)
- Build : `npm run build` · installateur : `npm run tauri build`
- Typecheck : `npm run check`

## Conventions
- Commentaires uniquement sur le code non évident (des identifiants bien nommés font le reste)
- Un README.md par dossier, maintenu en phase avec les fichiers
- Langue : documentation projet en français ; code et identifiants en anglais

## Architecture
| Folder | Purpose |
|---|---|
| `src/` | Frontend Svelte 5 (components/, lib/, lib/editor/, assets/) |
| `src-tauri/` | Hôte Rust minimal — plugins officiels uniquement (ADR-0004) |
| `spike/` | Spike S0 (comparatif moteurs WYSIWYG) — conservé comme référence |
| `docs/` | Documentation (planning, adr, design, journal, archives) |

## Patterns
- ALWAYS: garder le cœur « lecture/édition de documents » extensible — le Markdown est le premier format, pas le seul (PDF et autres suivront)
- ALWAYS: décider la stack via PRD + architecture avant d'écrire du code
- NEVER: créer des dossiers spécifiques à une technologie avant que la stack soit choisie

## Context & compaction
When compacting this session, always preserve: the list of modified files, the exact test/build commands, the current task and its next step.

## Memories & Lessons Learned

_Append via `/start learn <type>: <lesson>`. NEVER delete this section on update._

### Critical Warnings
<!-- things that broke or caused issues -->
- [2026-07-08] Ne jamais sérialiser le markdown utilisateur via ProseMirror/remark-stringify : réécriture systématique des fichiers (mesuré au spike S0 : 0/8 fichiers préservés — voir ADR-0002)

### Gotchas
<!-- non-obvious behaviors discovered -->
- [2026-07-08] CodeMirror 6 ne rend que le viewport : tout test DOM/Playwright sur l'éditeur doit d'abord scroller la cible en vue ; un conteneur scrollable externe garde son scrollTop entre `setState`
- [2026-07-08] tauri-build exige `icons/icon.ico` même avec `bundle.active: false` — et l'erreur ne tombe qu'en toute fin de compilation (~350/370 crates)
- [2026-07-08] Svelte 5 élague les sélecteurs CSS scopés « inutilisés » : une classe posée en JS (`classList`) est invisible pour le compilateur → toujours déclarer via `class:` dans le template (le warning `css_unused_selector` est un vrai signal)
- [2026-07-09] CodeMirror 6 : `state.doc.toString()` renvoie **toujours** du `\n` ; le facet `lineSeparator` n'agit que sur le découpage, pas la sérialisation. Pour préserver le round-trip (fichiers CRLF), détecter la fin de ligne du fichier et la restituer soi-même (`detectLineEnding` + `serializeDoc`, `src/lib/editor/editor.ts`)
- [2026-07-09] Icône barre des tâches Windows = **double cache** : l'icône est gravée dans l'exe **au build** (ajouter `println!("cargo:rerun-if-changed=icons/icon.ico")` dans `build.rs`, sinon `tauri dev` ne la ré-embarque pas) ET Windows cache la miniature (`ie4uinit.exe -show`, ou reset Explorer). Toujours rebuild propre + vider le cache avant de conclure
- [2026-07-09] Tauri v2 : **ne jamais rappeler `window.close()` depuis un handler `onCloseRequested`** — la ré-entrance ne se propage pas (surtout en profil **release** : la fenêtre ne se ferme plus). Après confirmation, utiliser `window.destroy()` (+ permission `core:window:allow-destroy`)
- [2026-07-09] Certains comportements natifs (fermeture de fenêtre, `windows_subsystem`) **diffèrent entre dev (debug) et release** → smoke-tester en **build release** avant de marquer « done » une story fenêtre/OS (le bug de fermeture ci-dessus n'apparaissait qu'en release)
- [2026-07-09] **DOMPurify est incompatible avec happy-dom** (sanitization dégradée : déstructure le HTML au lieu de le nettoyer) → tester avec **jsdom** (`// @vitest-environment jsdom`)
- [2026-07-09] CodeMirror 6 : **ne pas muter le DOM d'un `WidgetType` via `replaceWith`** — CM6 réconcilie et clobber la modif (le widget disparaît). Retourner un **conteneur stable** (span) et muter son contenu/classe (ex. `<img>` → placeholder à l'erreur de chargement dans `live-preview.ts`)
- [2026-07-09] La CLI Tauri v2 **auto-ajoute les features requises à `Cargo.toml`** (ex. `protocol-asset` quand `assetProtocol` est activé dans `tauri.conf.json`) lors d'un `tauri dev`/`build` → penser à committer `Cargo.toml`/`Cargo.lock` après, sinon un build neuf casse
- [2026-07-10] Tauri `getCurrentWindow().onFocusChanged` se déclenche **au focus ET au blur** — filtrer sur `payload.focused`, sinon le handler tourne deux fois par cycle
- [2026-07-10] Un critère PRD précis (« au focus ») peut trancher un choix d'implémentation en faveur du plus simple : pour le rechargement sur modif externe, une **relecture au focus** suffit et évite un watcher `plugin-fs` (donc zéro Rust) — lire le critère à la lettre avant de sur-concevoir
- [2026-07-10] `minimalSetup` (paquet `codemirror`) embarque `defaultKeymap` — dont **`Mod-/` → `toggleComment`**. Si un raccourci applicatif utilise Ctrl+/ (bascule source), l'éditeur focus **commente la ligne** en plus → perte de données. Neutraliser via `Prec.highest(keymap.of([{ key: 'Mod-/', run: () => true }]))`. **Tester les gestes destructifs avec l'éditeur focus** (une vérif sans focus ne déclenche pas le keymap CM et masque le bug)
- [2026-07-10] Tauri v2 `security.csp` (`tauri.conf.json`) durcit le réseau **sans code Rust** mais **n'est PAS testable en dev navigateur** (ne s'applique qu'en natif). Rester ciblé : `connect-src 'self' ipc: http://ipc.localhost` bloque le phone-home (fetch/XHR/WS) ; **éviter** `default-src`/`script-src`/`frame-src` (risque de casser IPC / asset-protocol / `srcdoc`) ; smoke-tester en natif (ouvrir/sauver/aperçu HTML)
- [2026-07-10] `/impeccable critique` (dual-agent, contexte neuf) rattrape des bugs que l'auto-vérification manque — utile après une story dont on a soi-même écrit la vérif
- [2026-07-10] Dans un lecteur qui rend des documents utilisateur, une **image distante** (`<img src=http…>`) et un **meta-refresh / ancre HTML** sont des vecteurs **phone-home** (fuite IP, beacon, voire NTLM via UNC `\\host`) que la CSP `connect-src` **ne bloque PAS** (elle ne couvre ni `<img>` ni la navigation). Défense : bloquer côté JS (n'autoriser que `data:` + fichier local), ajouter `img-src`/`default-src` à la CSP, et `sanitizeHtml` (strip meta/base, ancres externes inertes) — vérifié via monitoring réseau (0 requête distante sur doc hostile)
- [2026-07-10] **Ne jamais laisser tourner un `npm run dev` (navigateur) pendant un smoke natif.** `vite.config` a `strictPort: true` sur 1420 → le `tauri dev` de l'utilisateur ne peut pas prendre le port, et la webview native charge le serveur parasite au cache de deps périmé → `Failed to fetch dynamically imported module @tauri-apps/plugin-*` (masqué par un message d'erreur applicatif générique). Pour une vérif navigateur en parallèle : port séparé (`npm run dev -- --port 1421`) puis **couper** le serveur
- [2026-07-10] Sur une feature **data/destructive**, enchaîner `critic` (sur le **plan**, contexte neuf, avant code) **puis** `code-reviewer` (sur le **diff**, après) rattrape deux classes de défauts distinctes : le critic cadre les risques d'architecture (ex. scope de suppression trop large), le reviewer trouve les défauts d'implémentation (ex. `meta.json` non atomique / non réconcilié)
- [2026-07-10] « Snapshot avant remplacement » (restauration de version) : ne snapshotter l'état courant **que s'il est dirty** — sinon il est déjà dans l'historique (dernière save ou version en cours) et le re-snapshotter crée un doublon à chaque clic (pollution signalée au smoke)
- [2026-07-10] Windows/PowerShell : `git commit -m @'…'@` (here-string) casse sur les parenthèses/guillemets du message (pathspec error). Écrire le message dans un fichier et `git commit -F <fichier>` pour tout message multi-lignes
- [2026-07-10] CodeMirror 6 : un **`ViewPlugin` ne peut PAS fournir de décoration `replace` block-level / traversant plusieurs lignes** (il ne voit que le viewport, pas de garantie de couverture bloc). Pour un widget-bloc (ex. rendre un tableau GFM), passer par un **`StateField`** (`provide: EditorView.decorations.from(field)`) — c'est le seul moyen d'obtenir un `Decoration.replace({ block: true })` fiable (`tableField` dans `live-preview.ts`)
- [2026-07-10] CodeMirror 6 : un **block-replace doit être aligné sur des frontières de ligne** — sinon CM6 jette (`Decorations that replace line breaks may not be specified via plugins` / incohérence de rendu). Les nœuds bloc Lezer (Table, etc.) **démarrent après l'indentation** (donc en milieu de ligne pour un bloc indenté) → ne jamais ancrer sur `node.from`/`node.to` bruts, mais sur `doc.lineAt(node.from).from` et `doc.lineAt(node.to).to`
- [2026-07-10] CodeMirror 6 : le **clic sur un `WidgetType` se capte via un listener `mousedown` attaché DANS `toDOM(view)`** (motif `CheckboxWidget` officiel), pas via un `EditorView.domEventHandlers` global — ce dernier ne voit pas fiablement le clic sur le DOM du widget. Le listener peut appeler `view.dispatch({ selection })` + `view.focus()` pour révéler la source (clic-pour-éditer), et `ignoreEvent() { return true }` laisse l'event atteindre le widget
- [2026-07-13] Piloter l'éditeur CM6 **après avoir ouvert un onglet** (saut à une ligne/occurrence depuis la recherche, etc.) : l'onglet se monte de façon **asynchrone** (`view.setState` dans un `$effect` Svelte), donc un appel direct juste après `openPath` cible l'ancien contenu. Poser une **intention dans l'état** (`app.pendingReveal = {path,line,col,length}`) et la consommer dans un `$effect` de `DocumentView` **déclaré APRÈS** l'effet de switch d'onglet (ordre de déclaration = ordre d'exécution Svelte → contenu prêt). Le saut lui-même = sélection + `EditorView.scrollIntoView` + décoration transitoire via un `StateField`/`StateEffect` (`src/lib/editor/search-flash.ts`)
- [2026-07-13] Recherche plein-texte : les offsets d'un **extrait fenêtré** (ligne tronquée avec ellipses `…`) ne sont PAS la position dans le document — porter séparément la **colonne brute dans la ligne** (`col`) pour le saut éditeur, distincte du `start` relatif au snippet. Autre piège : `String.toLowerCase()` peut **changer la longueur** (ex. U+0130 « İ » → 2 chars) et désaligner tous les offsets si on cherche sur une copie minuscule puis découpe sur l'original → si `content.length !== lower.length`, retomber sur une correspondance casse-sensible pour CE document (offsets garantis exacts, jamais de surlignage faux)
- [2026-07-13] **DOMPurify conserve les `<img src>` RELATIFS** (`pic.png`) mais **strippe les chemins ABSOLUS** (`G:\…`, non-URL). Pour un export HTML **portable** (ouvert hors iframe/CSP), inliner les images en `data:` **AVANT** `sanitizeHtml` (pré-résolution + base64) — ne jamais compter sur la sanitize pour préserver un chemin local. Corollaire : une image bloquée (réseau/UNC) laissée telle quelle n'est arrêtée que par la CSP → la neutraliser **à la source** (retourner `null` → image supprimée), comme `live-preview::imageSrc`
- [2026-07-13] Webview Tauri/Vite : sérialiser un `.docx` (lib `docx`) via **`Packer.toBlob(doc)` → `blob.arrayBuffer()` → `Uint8Array`**, JAMAIS `Packer.toBuffer` (dépend du `Buffer` Node → casse sous Vite). Écrire les octets via plugin-fs **`writeFile`** (binaire, permission `fs:allow-write-file`), pas `writeTextFile` ; version atomique tmp+rename = `writeFileAtomic`
- [2026-07-13] **Ajouter un kind de document BINAIRE** (ex. PDF, `content=''`) : (1) brancher le kind **AVANT** toute lecture texte (`openPath`/`restoreSession`/`openFileDialog` → `openTab(name,path,'',kind)`), sinon `readTextFile`/`detectUnsupported` rejette le binaire ; (2) **garder `saveTab`** en 1re ligne (`if (tab.kind === '<binaire>') return false`) — sans ça un **Ctrl+S écrit `content=''` sur le fichier et le DÉTRUIT** (le save n'est PAS gaté sur « modifié »). Vérifier que les autres chemins d'écriture (snapshot, reload externe, `invalidateSearchDoc`) sont inatteignables pour ce kind (un binaire `content===savedContent===''` n'est jamais `isDirty`)
- [2026-07-13] **pdfjs-dist v6** : `getDocument` a **retiré** les options `isEvalSupported`/`enableScripting` (erreur de type si passées). Le rendu **canvas seul** (getDocument/getPage/render, **sans** monter de `ScriptingManager` ni de couche annotation) n'exécute JAMAIS le JS embarqué du PDF → lecture seule sûre, pas de vecteur `/URI`. Worker via l'import **`?worker` de Vite** (`pdf.worker.min.mjs?worker` → `GlobalWorkerOptions.workerPort`) = asset local offline en chunk séparé ; octets en **`data:Uint8Array`** (0 range-request → aucun réseau distant même si CMaps/WASM 404) ; CSP `+worker-src 'self' blob:` (ne s'applique qu'en natif)
- [2026-07-14] **Rendu canvas HiDPI net** (ex. page PDF) : dimensionner le backing-store à `cssWidth × devicePixelRatio` et la taille CSS à `cssWidth`, MAIS aussi **réserver la gouttière de scrollbar en amont** (`scrollbar-gutter: stable` sur le conteneur scrollable). Sinon la scrollbar verticale apparaît **après** la mesure de `clientWidth`, rétrécit la largeur utile, et un `max-width:100%` rééchantillonne le canvas déjà pixellisé d'un **facteur non-entier** → flou léger diffus. Le `clientWidth` mesuré avec la gouttière réservée est stable quel que soit le débordement (`PdfView.svelte`)
- [2026-07-14] **Coller une image du presse-papier** (CM6 `EditorView.domEventHandlers({ paste })`) : extraire le `File` via `item.getAsFile()` **SYNCHRONEMENT** avant tout `await` — `event.clipboardData.items` devient inerte dès la fin du dispatch synchrone (le `File`/`Blob` survit aux `await`, pas le `DataTransferItem`). Retourner **`true`** = pris en charge (CM ne colle pas de texte ; `preventDefault()` seul ne suffit PAS en CM6) ; **`false`** = laisser CM coller le texte normalement (pas d'image → fall-through). L'insertion `view.dispatch(state.replaceSelection('![](nom)'))` se fait dans une IIFE async après l'écriture fichier

### Workarounds
<!-- working solutions to known issues -->
- [2026-07-08] `fs:default` (plugin-fs Tauri) ne couvre pas la lecture/écriture hors dossiers app → déclarer explicitement `fs:allow-read-text-file`, `fs:allow-write-text-file`, `fs:allow-rename` avec un scope dans `capabilities/default.json`
- [2026-07-10] Pousser un contenu externe dans un éditeur CM6 **caché-par-onglet** (cache d'`EditorState` par onglet) sans remount : ajouter un compteur `rev` sur l'onglet, le lire dans le `$effect` Svelte, et `setState(makeState(...))` quand `rev` change (invalider aussi le cache des onglets inactifs rechargés). Le `$effect` ne re-render que sur changement d'id d'onglet — `rev` est le hook minimal pour le forcer sur un reload disque
- [2026-07-10] L'outil Write peut matérialiser ` `/`�` en **caractères de contrôle littéraux** (invisibles en source, fragiles, cassent l'appariement exact d'Edit). Pour un littéral de contrôle voulu, réécrire l'argument via un script node en **codes de caractères** (lecture/écriture `latin1`, ex. `String.fromCharCode(39,92,117,48,48,48,48,39)` = `' '`) et vérifier avec `charCodeAt`
- [2026-07-10] Feature qui **supprime/écrase** des fichiers → défense en profondeur : (1) scoper la capability destructive au sous-arbre applicatif (`fs:allow-remove` → `$APPDATA/snapshots/**`, **jamais** `**`) ; (2) garde runtime dans le code (ne supprimer que des noms validés — ex. `parseStamp` OK, jamais `meta.json`). Le scope seul OU le code seul ne suffisent pas ; c'est la combinaison qui protège le « zéro perte ». Créer un fichier : `readTextFileAt` d'abord (ouvrir s'il existe, jamais écraser)
- [2026-07-13] Vérif Playwright d'une app qui **persiste son état** (localStorage `doku-settings` : thème, sidebar, vue…) : l'état **survit entre sessions de test** (même profil navigateur MCP) et peut inverser un raccourci **toggle** — ex. la sidebar « search » laissée ouverte au test précédent → `Ctrl+Maj+F` la **ferme** au lieu de l'ouvrir. Vider le storage en tête de run (ou en tenir compte). Autre friction : un bouton **adjacent à l'éditeur CM** peut faire échouer le clic Playwright (`<div class="cm-scroller"> intercepts pointer events`) → repli fiable `browser_evaluate(() => element.click())` qui déclenche le vrai handler DOM/Svelte
- [2026-07-13] Piloter **`window.print()` sans exposer le bridge IPC/FS Tauri** (export PDF via dialogue d'impression) : rendre le doc dans un **iframe `sandbox="allow-modals allow-same-origin"` SANS `allow-scripts`** (le parent appelle `frame.contentWindow.print()` ; `allow-modals` autorise le dialogue ; l'absence d'`allow-scripts` neutralise tout script même si DOMPurify est contourné) + CSP `default-src 'none'` injectée dans le doc. Piège WebView2 **#5199** : ne jamais disposer la webview/iframe **pendant** l'impression (teardown différé). Ne se valide qu'en **natif** (impression WebView2 ≠ navigateur dev)

### Performance Notes
<!-- perf learnings -->
- [2026-07-10] Sur gros fichier (≥ ~1,5 Mo), le gel de l'UI **ne vient pas** du live-preview CodeMirror (viewport-scopé, donc peu coûteux) mais des passes **O(doc) rappelées souvent** : `docHeadings` au scroll (scroll-spy) et le panneau Plan. Correctif : flag `heavy` (taille > seuil) → mode source léger + scroll-spy/Plan gatés `!heavy`. **Mesurer/lire avant d'optimiser** — le coupable supposé n'était pas le bon
- [2026-07-13] **Lazy-loader une grosse dépendance** d'une feature secondaire (ex. `docx` ~100 Ko gzip pour l'export DOCX) via un **`import('…')` dynamique au point d'usage** (dans le handler du bouton, pas un import statique) → Vite la sort du **bundle principal** en chunk séparé chargé à la demande. Vérifiable au `npm run build` (chunk `docx-*.js` distinct, `index-*` inchangé). Même esprit que les plugins Tauri importés dynamiquement dans `tauri.ts`
