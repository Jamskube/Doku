# Plan: fournisseur-minimax

_Date: 2026-08-10 · Estimated scope: M_

## Goal
Ajouter **MiniMax** comme fournisseur cloud du copilote, via son API **compatible OpenAI** (`https://api.minimax.io/v1`, auth par clé API). Décision utilisateur : carte **MiniMax préréglée** dans la vue Modèles (coller la clé, choisir le modèle — c'est tout), mais l'architecture dessous est **générique** (base URL paramétrable) pour accueillir d'autres services compatibles plus tard sans refonte. **Liste dynamique des modèles** (interrogée à la connexion), choix persisté.

Contexte établi (exploration) :
- Le provider « OpenAI » actuel n'est PAS un client compatible-OpenAI : c'est le backend Codex (OAuth ChatGPT, `chatgpt.com/backend-api/codex`). MiniMax exige un second chemin : POST `/v1/chat/completions` streamé, `Authorization: Bearer <clé>`.
- `openai.rs` possède déjà `write_secret`/`read_secret`/`delete` (Win32 `CredWriteW`/`CredReadW`, Credential Manager) — à extraire et réutiliser : la clé ne touche jamais la webview ni `settings.json`, et aucune ouverture de CSP n'est nécessaire (le réseau part de Rust).
- ⚠ Piège documenté (hermes-agent, scrubber dédié) : les modèles MiniMax M-series **streament des blocs `<think>…</think>` dans le contenu**. Sans filtrage, Doku-San affiche son monologue interne. Certains envoient aussi un champ `reasoning_content` séparé (à ignorer).
- Les flux existants (citations `[n]`, notes, budgets cloud `MAX_DOC_CHARS_CLOUD`) sont déjà agnostiques au fournisseur une fois le streaming en place.

## Out of scope
- Carte « fournisseur personnalisé » (base URL libre dans l'UI) — l'architecture le permet, l'UI viendra si le besoin se confirme.
- Endpoint Chine (`api.minimaxi.com`) — global seulement.
- Embeddings/RAG via MiniMax — le RAG dossier reste granite-embedding local (ADR-0015).
- Tout changement aux providers ollama/openai existants (hors refactor `secrets.rs`).

## Files

### Created
- `src-tauri/src/secrets.rs` — extraction de `write_secret`/`read_secret`/`delete_secret` depuis `openai.rs` (Win32 Credential Manager), partagés entre providers.
- `src-tauri/src/compat.rs` — provider compatible OpenAI générique :
  - registre des fournisseurs (pour l'instant : `minimax` → base `https://api.minimax.io/v1`, cible secret `Doku/MiniMax/api-key`) ;
  - `compat_set_key { provider, key }` — **valide la clé par un GET `/models` AVANT de la stocker** (clé invalide → erreur claire, rien d'écrit) ;
  - `compat_status { provider }` → `{ connected, models[] }` (GET `/models`; en échec réseau avec clé présente : `connected: true, models: []` — le repli UI s'applique) ;
  - `compat_disconnect { provider }` — supprime la clé ;
  - `stream_compat { requestId, provider, model, messages }` — POST `/chat/completions` `stream: true`, parse SSE (`data: …`, `[DONE]`, `choices[0].delta.content` ; `delta.reasoning_content` **ignoré**), deltas sur un `Channel` (kind delta/done/error — même forme que `stream_openai`), annulation via `cancel_compat` + map de requêtes (motif `openai.rs`).
- `src/lib/compat.ts` — miroir de `openai.ts` : types, wrappers `invoke`, `compatChat(provider, model, messages, onToken, signal)`. Applique le scrubber au flux.
- `src/lib/think-scrub.ts` + `think-scrub.test.ts` — scrubber **avec état** pour flux streamé (pur, testable) : supprime les blocs `<think>…</think>`/`<thinking>…` ouverts en tête de réponse, y compris quand la balise arrive **coupée entre deux deltas** ; ne touche pas à un texte qui *mentionne* la balise plus loin.
- `docs/adr/0018-fournisseur-cloud-compatible-openai.md` — étend l'amendement « 0 réseau » (8.3) fait pour OpenAI : second fournisseur cloud opt-in, clé au Credential Manager, envoi volontaire signalé dans l'UI.

### Modified
- `src-tauri/src/openai.rs` — utilise `secrets.rs` (comportement identique).
- `src-tauri/src/main.rs` — enregistre `mod secrets; mod compat;`, l'état d'annulation et les 5 commandes.
- `src/lib/stores.svelte.ts` — `CopilotProvider` += `'minimax'` ; validation du settings (ligne ~162) ; `app.minimaxModel` persisté.
- `src/lib/copilot.svelte.ts` — `ProviderRuntime` += `{ provider: 'minimax'; model: string }` ; `resolveRuntime` (statut → connecté + modèle choisi, sinon message de config) ; `chatWith` → `compatChat` ; tout ce qui teste `=== 'openai'` pour dire « cloud » passe à `!== 'ollama'` (badge, `docBudget`, chemin gros-doc découpé, libellés d'erreur) ; `config` chip `'minimax'` ; refresh du statut à la sélection du provider.
- `src/components/CopilotPanel.svelte` — 3ᵉ onglet fournisseur (« MiniMax · clé API · cloud ») ; vue MiniMax : champ clé (collage + « Connecter »), état connecté (modèles dynamiques en sélecteur, choix persisté ; **repli** : liste vide → champ texte libre pré-rempli `MiniMax-M2.5`), « Déconnecter », note de confidentialité (« envoi volontaire vers le cloud », même registre que la carte OpenAI) ; badge `cloud` et bandeaux de config généralisés.
- `src/lib/copilot-service.test.ts` ou test dédié — si des chemins `=== 'openai'` généralisés sont couverts.

## Order of operations
1. `secrets.rs` (extraction pure, `cargo check` + non-régression OpenAI)
2. `compat.rs` + enregistrement `main.rs`
3. `think-scrub.ts` + tests (pur, sans dépendance)
4. `compat.ts`
5. `stores.svelte.ts` → `copilot.svelte.ts` (généralisation cloud)
6. `CopilotPanel.svelte` (UI)
7. ADR-0018
8. Vérifs navigateur + natif (la clé/le réseau n'existent qu'en natif)

## Acceptance criteria
1. **Given** une clé MiniMax valide collée dans la carte, **when** « Connecter », **then** statut connecté + liste des modèles chargée dynamiquement, choix persisté entre sessions ; la clé est dans le Credential Manager Windows et **absente** de `settings.json`.
2. **Given** le provider MiniMax actif, **when** une question sur le document, **then** réponse streamée token par token, annulable < 500 ms, badge `cloud`, citations `[n]` cliquables — et **aucun** `<think>` visible.
3. **Given** une clé invalide, **when** « Connecter », **then** message d'erreur clair et rien n'est stocké.
4. **Given** « Déconnecter », **then** la clé est supprimée du Credential Manager et la carte revient à l'état déconnecté.
5. **Non-régression** : ollama et OpenAI inchangés (tests existants verts) ; aucun trafic réseau tant que MiniMax n'est ni connecté ni sélectionné.

## Test strategy
- `think-scrub.test.ts` : balise entière en un delta, coupée en plusieurs (`"<thi"`+`"nk>…"`), fermeture coupée, texte qui mentionne `<think>` sans l'ouvrir en tête, flux sans think.
- `cargo check` + suite vitest complète (non-régression 415).
- Navigateur : UI de la carte (états déconnecté/connexion/erreur — moteur mocké impossible : vérifier les états statiques et le wiring des boutons).
- **Natif (utilisateur)** : critères 1-5 avec une vraie clé MiniMax.

## Risks
- **Format SSE MiniMax** (variantes `reasoning_content`, usage chunks) → le parseur ignore ce qu'il ne connaît pas ; le scrubber couvre le `<think>` en contenu ; test natif tranche.
- **GET `/models` indisponible ou filtré** sur l'API compat → repli champ libre pré-rempli (accepté par le critère 1 seulement si la liste marche ; sinon le repli est le comportement documenté).
- **Rate-limit / erreurs 4xx-5xx** en cours de stream → event `error` → bandeau d'échec existant (`generationFailure` généralisé).
- Refactor `secrets.rs` casse l'OpenAI existant → couvert par l'ordre 1 (check + smoke avant la suite).

## Open questions
- Le nom exact du modèle par défaut du repli (`MiniMax-M2.5` d'après le catalogue hermes) — à confirmer sur la doc MiniMax au moment du dev.

## Rollback
Revert du commit ; la clé éventuellement stockée se supprime via « Déconnecter » ou `cmdkey /delete:Doku/MiniMax/api-key`.

## Critic feedback (intégré — 5 Major, tous à appliquer au CODE)

1. **Statut honnête** : `compat_status` distingue « clé refusée » (HTTP 401/403 → état carte « clé refusée — reconnectez ») de « réseau inaccessible » (transport → connecté-dégradé). Retour `{ keyPresent, connected, models, error }` (miroir d'`OpenAiStatus`). Un 401 en cours de stream doit faire rebasculer la carte au prochain refresh. (Epic 19 : jamais de fonctionnalité qui ment.)
2. **Validation de clé non single-point** : si GET `/models` n'existe pas sur la surface compat, repli de validation par `POST /chat/completions` à 1 token ; messages distincts « clé invalide » vs « réseau inaccessible — rien n'a été stocké ». Vérifier l'endpoint réel en début de dev.
3. **`DocumentView.svelte` ajouté aux fichiers modifiés** : `copilotNeedsSetup`/`setupNote` (~l.162-170) sont des ternaires ollama-vs-reste dont la branche « else » lit l'état OpenAI — en MiniMax, les verbes de sélection seraient bloqués sur « Compte OpenAI non connecté ».
4. **Scrubber — 4 exigences** : (a) `compatChat` renvoie l'accumulation **scrubée** (les consommateurs de la valeur de retour — résumé map/reduce, reformulation, notes — recevraient le monologue sinon) ; (b) une instance de scrubber **par requête**, jamais au niveau module ; (c) flush du préfixe ambigu retenu (`"<thi"`) à la fin du flux (cas de test dédié) ; (d) réponse entièrement dans un `<think>` non fermé → scrub à `''` : marquer le tour `failed` avec retry, sinon le splice-si-vide de `copilot.svelte.ts:597` (conçu pour l'abort) **supprime la question de l'utilisateur**.
5. **Un seul prédicat cloud** : exporter `isCloudProvider(p)` d'un module unique et l'employer partout (docBudget ×2 — store ET badge du panneau, effet de refresh à l'ouverture, `personaFor`, `generationFailure` — préfixe nommé par fournisseur, union `config` de `summarizeDoc`). Jamais N ternaires divergents (leçon S13 badge vs décision).

Minors intégrés : messages d'erreur de `secrets.rs` paramétrés (plus de « session OpenAI » sur une clé MiniMax) ; `compat_status` court-circuite AVANT tout réseau si aucune clé ; `choices[0]` défensif (chunk usage final à `choices: []`) + partage de `find_sse_boundary`/`parse_sse_event` avec `openai.rs` ; budget de contexte = champ du registre par fournisseur (M2.x 204k ≠ fenêtre OpenAI) ; ADR-0018 réconcilie explicitement AGENTS.md l.15 (« jamais de clé API ») + ADR-0013 rejetée — amendement d'AGENTS.md dans le même lot ; formulation exacte : la clé traverse l'IPC une fois, n'est jamais persistée côté webview ni renvoyée par aucune commande ; vérifier le ton du persona cloud (ADR-0014, réglé pour Luna) au smoke natif.
