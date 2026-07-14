# 0012. Cycle de vie du sidecar Ollama : instance dédiée, port éphémère, modèles isolés, spawn paresseux

**Date** : 2026-07-14 · **Status** : accepted · **Deciders** : nicos (+ Claude) · **Tags** : ia, sidecar, ollama, process-lifecycle, arm64, csp

## Context

[ADR-0006](./0006-copilote-ia-ollama-sidecar-cpu.md) a tranché le **moteur** (Ollama en sidecar, CPU, free-GGUF) mais pas **comment** Doku l'instancie et le pilote. L'[architecture v2](../planning/architecture-v2-copilot.md) et le [gate readiness](../planning/PRD-v2.md) ont fait remonter cette décision comme **bloquante avant le premier code** (spike inclus). Points à figer :

- **Port** : `ollama serve` écoute par défaut sur `127.0.0.1:11434`. Si l'utilisateur a **déjà** Ollama installé/lancé, ce port est occupé → collision.
- **Instance** : réutiliser un Ollama déjà présent chez l'utilisateur, ou toujours lancer le nôtre (bundlé) ?
- **Stockage des modèles** : le dossier par défaut d'Ollama (`~/.ollama`) partagé, ou un dossier isolé à Doku ?
- **Démarrage / arrêt** : lancer le sidecar au démarrage de l'app ou à la première utilisation du copilote ? Le tuer comment, et gérer les orphelins (crash) ?

Contraintes acquises : démarrage à froid Doku **< 1,5 s** (NFR v1) ; **Rust minimal** (ADR-0004) ; **0 réseau à l'inférence** (8.3) ; **ARM64** natif ; app **auto-contenue** et **purgeable** (perso, mono-machine).

## Decision drivers

- **Pas de collision** avec un Ollama tiers déjà présent (le cas le plus probable chez un dev).
- **Contrôle total du cycle de vie** : Doku doit pouvoir démarrer/arrêter *son* moteur sans jamais tuer un process qui ne lui appartient pas.
- **Isolation & purge** : les modèles (Go) doivent vivre dans l'espace Doku (`%APPDATA%`, ADR-0003) et être supprimables sans toucher à l'écosystème Ollama de l'utilisateur.
- **Budget de démarrage** : ne pas payer le coût du moteur pour un utilisateur qui n'ouvre jamais le copilote.
- **Sécurité** : pas de capability shell générale (ADR-0004) — binaire déclaré, pas de commande arbitraire.

## Considered options

### Option A : port fixe 11434, réutiliser-ou-lancer
Si un Ollama tourne déjà sur 11434, s'y brancher ; sinon lancer le nôtre.
· Pros : pas de duplication de modèles si l'utilisateur a déjà Ollama ; simple à écrire.
· Cons : **collision/ambiguïté** (version inconnue, on ne contrôle pas le cycle de vie — interdit de tuer *son* process) ; **modèles partagés** (nos pulls polluent son `~/.ollama`, et inversement) ; garanties offline/isolation floues ; comportement non déterministe selon la machine.

### Option B : instance dédiée, port éphémère, modèles isolés, spawn paresseux *(choisie)*
Doku lance **toujours son propre** `ollama serve` (binaire bundlé `externalBin` ARM64), sur un **port libre choisi dynamiquement**, avec **`OLLAMA_MODELS` = `%APPDATA%\Doku\models\`**, **à la première activation du copilote** (pas au démarrage de l'app).
· Pros : **zéro collision** (port dédié, coexiste avec un Ollama tiers) ; **cycle de vie maîtrisé** (on ne tue que notre enfant) ; **modèles isolés & purgeables** ; version du moteur **connue** (celle qu'on bundle) ; **démarrage Doku intact** (moteur lancé à la demande) ; sécurité (binaire déclaré).
· Cons : **duplication disque** si l'utilisateur a déjà les mêmes modèles ailleurs ; il faut **choisir un port libre** + **nettoyer les orphelins** (crash) ; légère latence au 1er usage (spawn + chargement modèle).

### Option C : instance dédiée mais lancée au démarrage de l'app, port fixe
· Pros : moteur prêt d'emblée.
· Cons : **coût de démarrage** payé par tous (viole le budget < 1,5 s / gaspille RAM pour les non-utilisateurs) ; port fixe = collision.

## Decision

**Choisie : Option B.** Doku embarque `ollama.exe` (build **ARM64**) en `externalBin` et lance **sa propre** instance, isolée et contrôlée :

- **Port éphémère dédié** : l'hôte Rust **sonde un port TCP libre** sur `127.0.0.1` (bind sur `:0`, lit le port attribué, relâche), puis lance le sidecar avec `OLLAMA_HOST=127.0.0.1:<port>`. Le front reçoit ce port et n'appelle **que** cette adresse. → coexistence avec un Ollama tiers sur 11434.
- **Modèles isolés** : `OLLAMA_MODELS=%APPDATA%\Doku\models\` → pulls/purges confinés à l'espace Doku (cohérent ADR-0003), sans toucher `~/.ollama`.
- **Spawn paresseux** : le sidecar démarre à la **première activation du copilote**, pas au lancement de Doku (budget de démarrage préservé). Un **readiness-poll** (`GET /api/tags` jusqu'à 200, avec timeout) précède le premier appel ; échec → message clair, copilote désactivé, reste de l'app intact.
- **Arrêt & orphelins** : `kill` de l'enfant sur `WindowEvent::CloseRequested`. Un **pidfile** (`%APPDATA%\Doku\ollama.pid`) permet, au démarrage suivant, de détecter et **tuer un sidecar Doku résiduel** (crash antérieur) avant d'en lancer un neuf. Le port éphémère rend de toute façon une collision avec un résidu improbable.

Le **modèle conseillé par défaut** (onboarding) n'est **pas** tranché ici : c'est un choix produit/UX, hors de cette décision d'architecture (voir PRD-v2 Q1).

## Consequences

**Positive** : coexistence sans collision avec un Ollama tiers ; cycle de vie 100 % maîtrisé (jamais de process étranger tué) ; modèles isolés et purgeables ; version moteur déterministe ; démarrage Doku inchangé ; Rust reste une coquille (spawn + port + kill + proxy) → ADR-0004 préservé ; sécurité (binaire déclaré, pas de shell libre).

**Negative** : duplication disque possible si l'utilisateur a déjà les mêmes modèles hors Doku ; complexité ajoutée (sélection de port libre, pidfile, readiness-poll) ; le tout premier prompt paie spawn + chargement modèle.

**Risks** :
- **Race sur le port** (entre la sonde et le bind d'`ollama`) → fenêtre minime en `127.0.0.1` mono-utilisateur ; si `ollama` échoue à binder, retenter avec un nouveau port (borné).
- **Process orphelin** (crash de Doku) → pidfile + sweep au démarrage + kill à la fermeture.
- **`ollama serve` lent à être prêt** → readiness-poll avec timeout et message clair (pas de blocage UI).
- **CSP** : `connect-src` doit autoriser `http://127.0.0.1:<port>` — comme le port est dynamique, autoriser `http://127.0.0.1:*` (ou l'hôte loopback) côté CSP ; l'inférence reste locale, seul le pull sort (exception consentie, ADR-0006 / 8.3).
- **Taille de l'installateur** (binaire Ollama embarqué) → question ouverte PRD-v2 (embarquer vs télécharger au 1er lancement).

## Amendment (2026-07-14, story 13.2)

À l'implémentation (spike 13.1 + SidecarManager 13.2), deux points de la Decision ont évolué **sur mesure** :

- **Kill : Job Object Windows `KILL_ON_JOB_CLOSE` remplace le pidfile+sweep.** Le spike a révélé qu'`ollama.exe` spawne `llama-server.exe` en **grand-enfant** — un `kill` du seul parent le laisse orphelin. La solution retenue rattache le sidecar à un **Job Object** (`AssignProcessToJobObject`) : le noyau termine tout l'arbre dès la fermeture du dernier handle, **y compris au crash de Doku**. Cela **supersède** le pidfile+sweep prévu ici : nettoyage garanti par le noyau, **sans** la fenêtre orphelin-jusqu'au-prochain-lancement ni le **hasard de réutilisation de PID** (un PID enregistré pourrait, au lancement suivant, appartenir à un process tiers innocent que le sweep tuerait). `taskkill /F /T` du spike est également retiré.
- **`lib/ollama` (DLLs + `llama-server.exe`) livré via `bundle.resources`**, résolu par `OLLAMA_LIBRARY_PATH` = `resource_dir()` en release (et `CARGO_MANIFEST_DIR/binaries` en dev, où le sidecar tourne depuis `target/debug`). `externalBin` ne copiait que l'exe.
- **Egress 8.3** : `OLLAMA_NO_CLOUD=1` coupe le poll `model_recommendations` vers `ollama.com` (+ `OLLAMA_REMOTES=127.0.0.1` en ceinture). Un blocage pare-feu sur le binaire reste la garantie dure au déploiement.

## Related

- [ADR-0006](./0006-copilote-ia-ollama-sidecar-cpu.md) — choix du moteur (Ollama sidecar CPU) que cette décision met en œuvre
- [ADR-0004](./0004-io-fichiers-plugins-officiels.md) — « Rust minimal » ; ce choix le préserve (spawn + port + kill + proxy, pas d'inférence in-process)
- [ADR-0003](./0003-stockage-snapshots-appdata.md) — `%APPDATA%\Doku\` centralisé, étendu ici aux modèles (`models/`) et au pidfile
- `docs/planning/architecture-v2-copilot.md` (SidecarManager) · `docs/planning/PRD-v2.md` (FR-1, NFR réseau/perf, Q1/Q5)
