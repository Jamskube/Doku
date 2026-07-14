# PRD : Doku v2 — copilote IA local

**Date** : 2026-07-14 · **Status** : Draft · **Version** : 1.0 · **Base** : [PRD-v1.5](./PRD-v1.5.md) (feature-complete) · **ADR fondateur** : [ADR-0006](../adr/0006-copilote-ia-ollama-sidecar-cpu.md)

## 1. Overview

Doku v1.5 est feature-complete (lecture/édition md/txt/html, PDF, recherche, export, coller image). Le **cap v2** ajoute un **copilote IA 100 % local** : un panneau de discussion qui **résume**, **répond à des questions**, **reformule** et **corrige** le texte de l'utilisateur — sans cloud, sans fuite réseau à l'inférence. Le moteur est **Ollama en sidecar** (ADR-0006) : l'utilisateur **gère ses modèles lui-même** (télécharger / choisir / purger), à la manière d'Ollama. Le cap se livre en deux temps : **v2.0** (fondation + résumer + Q&A sur le doc courant), **v2.1** (RAG multi-notes + reformuler + corriger).

## 2. Problem statement

Doku sait lire et écrire des notes, mais tout le travail cognitif reste manuel. (1) **Digérer** une longue note (compte-rendu, article collé, PDF lu) oblige à tout relire — aucun résumé. (2) **Interroger** ses propres notes (« qu'est-ce que j'avais décidé sur X ? ») n'est possible que par recherche exacte de mots, pas par le sens. (3) **Améliorer** un texte (clarté, ton, orthographe) impose un aller-retour vers un outil externe — ce qui, pour un utilisateur qui tient à l'**offline** et à la **confidentialité** de ses notes, est précisément ce qu'il refuse. Les assistants cloud règlent (1)-(3) mais **envoient les notes sur un serveur** : inacceptable ici. Il manque une IA qui vit **dans** Doku et **ne sort jamais**.

## 3. Target users

Utilisateur unique, mêmes trois casquettes que les PRD précédents — ce que v2 apporte :

| Persona | Ce que v2 lui apporte |
|---|---|
| **Lecteur** | Résume un long doc ou un PDF ; pose des questions sur son contenu au lieu de tout relire |
| **Rédacteur** | Reformule un paragraphe (plus clair / plus court), corrige orthographe & grammaire — sans quitter la note |
| **Organisateur** | Interroge *le sens* de tout son dossier de notes (RAG), pas seulement les mots exacts |

Attribut transverse décisif : **confidentialité absolue** — l'utilisateur n'accepte l'IA que parce qu'elle est locale.

## 4. Functional requirements

### FR-1 : Sidecar Ollama (cycle de vie)
Description : embarquer et piloter `ollama.exe` (ARM64) comme sidecar Tauri, via son API HTTP locale.
User story : En tant qu'utilisateur, je veux que l'IA « juste marche » dans Doku, sans installer Ollama séparément.
Acceptance :
- Given Doku installé, When j'active le copilote pour la 1re fois, Then Doku démarre le sidecar (`ollama serve`) sur un **port dédié** et le pilote via `localhost` — **aucune installation manuelle** requise.
- Given le sidecar tourne, When je ferme Doku, Then le process est **tué proprement** (aucun process/port orphelin).
- Given le port est déjà occupé ou le sidecar ne démarre pas, When Doku tente de l'utiliser, Then un **message clair** s'affiche et l'app **ne plante pas** (le reste de Doku reste utilisable).
- Given l'hôte Rust (ADR-0004), When on implémente le sidecar, Then il se limite à **spawn + proxy HTTP** (aucune logique d'inférence in-process).
Priority : **P0** (infrastructure)

### FR-2 : Gestion des modèles (télécharger / choisir / purger)
Description : UI pour lister les modèles installés, en télécharger de nouveaux (pull), choisir l'actif, voir leur taille et les supprimer.
User story : En tant qu'utilisateur, je veux charger et changer de modèle moi-même, pour garder la main sur ce qui tourne (exigence-cœur ADR-0006).
Acceptance :
- Given le panneau modèles, When je l'ouvre, Then je vois les modèles **installés** (nom, taille sur disque) et le **modèle actif**.
- Given un nom de modèle (ex. `llama3.2:3b`), When je lance le **téléchargement**, Then Doku effectue un **pull** avec **progression visible**, et le pull est une **action réseau explicite, initiée par moi** (jamais automatique).
- Given plusieurs modèles installés, When j'en choisis un comme **actif**, Then les usages (résumé, chat…) l'utilisent, et le choix **persiste** entre sessions.
- Given un modèle devenu inutile, When je le **purge**, Then son fichier est supprimé de `%APPDATA%\Doku\models\` et l'espace est récupéré (confirmation avant suppression).
- Given aucun modèle installé, When j'ouvre le copilote, Then Doku m'**oriente vers le téléchargement** d'un modèle conseillé (dégradation propre, pas d'erreur brute).
Priority : **P0**

### FR-3 : Panneau copilote (chat + streaming + annuler)
Description : nouvelle vue de la sidebar hébergeant une conversation ; réponses affichées en streaming, interruptibles.
User story : En tant qu'utilisateur, je veux dialoguer avec l'IA dans un panneau, pour lui demander des choses sur ma note.
Acceptance :
- Given le copilote, When je l'ouvre (ex. `Ctrl+Maj+I` / bouton sidebar), Then un **panneau de discussion** s'affiche (cohérent avec les vues recherche/plan/historique existantes).
- Given une question saisie, When j'envoie, Then la réponse s'affiche **en streaming** (token par token) et je peux **annuler** la génération en cours (interruption **< 500 ms**).
- Given une génération en cours, When je change d'onglet/de doc, Then la génération n'est pas perturbée et son résultat reste attaché à la conversation.
- Given une réponse produite, When elle contient du Markdown, Then elle est **rendue** (pas de markdown brut) et **copiable**.
Priority : **P0** (infrastructure)

### FR-4 : Résumer le document
Description : produire un résumé du document courant (ou de la sélection).
User story : En tant que lecteur, je veux résumer une longue note ou un PDF, pour en saisir l'essentiel sans tout relire.
Acceptance :
- Given un doc md/txt/html/PDF affiché, When je déclenche « Résumer », Then le copilote produit un **résumé** du contenu (ou de la **sélection** si non vide), en streaming.
- Given un doc trop long pour la fenêtre de contexte du modèle, When je résume, Then Doku **segmente** (résumé par morceaux puis synthèse) plutôt que de tronquer silencieusement, ou signale clairement la limite.
- Given un PDF, When je le résume, Then le **texte** en est extrait (couche texte du PDF ; si le PDF est une image scannée sans texte, message clair « pas de texte extractible »).
Priority : **P0**

### FR-5 : Q&A sur le document courant
Description : répondre à des questions en langage naturel sur le contenu du document ouvert.
User story : En tant que lecteur, je veux poser des questions sur ma note ouverte, pour retrouver un point précis par le sens.
Acceptance :
- Given un doc affiché, When je pose une question dans le panneau, Then la réponse est **ancrée sur le contenu du doc courant** (le doc est fourni comme contexte au modèle).
- Given une info absente du doc, When je la demande, Then le copilote **le signale** (« je ne trouve pas cela dans ce document ») plutôt que d'inventer.
- Given la contrainte offline, When une réponse est générée, Then **aucune requête réseau** ne sort (vérifiable par monitoring).
Priority : **P0**

### FR-6 : RAG — questionner tout le dossier de notes (multi-notes)
Description : recherche sémantique + réponse sur l'ensemble d'un dossier de notes (embeddings + récupération de passages pertinents).
User story : En tant qu'organisateur, je veux interroger *le sens* de toutes mes notes, pour retrouver ce que j'ai écrit ailleurs sans connaître les mots exacts.
Acceptance :
- Given un dossier de notes, When je pose une question en mode « dossier », Then Doku récupère les **passages pertinents** (embeddings locaux, index en `%APPDATA%`) et génère une réponse **citant les notes sources** (nom de fichier cliquable).
- Given des notes modifiées/ajoutées/supprimées, When l'index existe, Then il est **mis à jour** (ré-indexation incrémentale, pas de recalcul complet à chaque question).
- Given l'indexation d'un gros dossier, When elle tourne, Then elle est **hors-ligne**, bornée en ressources (tablette ARM) et **n'empêche pas** l'usage de Doku.
- Given un embedding, When il est calculé, Then il l'est **localement** (modèle d'embedding via le sidecar) — aucune sortie réseau.
Priority : **P1** (v2.1 — le plus gros chantier ; voir Risques)

### FR-7 : Reformuler une sélection
Description : réécrire un passage sélectionné (plus clair, plus court, autre ton) et l'appliquer au texte.
User story : En tant que rédacteur, je veux reformuler un paragraphe, pour l'améliorer sans le réécrire à la main.
Acceptance :
- Given du texte sélectionné en édition, When je choisis « Reformuler » (+ variante : clarifier / raccourcir / ton), Then le copilote propose une réécriture.
- Given une proposition, When je l'accepte, Then elle **remplace** la sélection (ou s'insère après, au choix) ; When je la refuse, Then le texte d'origine est **intact** (aucune perte).
Priority : **P1** (v2.1)

### FR-8 : Corriger orthographe & grammaire
Description : passe de correction sur la sélection ou le document.
User story : En tant que rédacteur, je veux corriger les fautes d'une note, pour la finaliser proprement.
Acceptance :
- Given un texte (sélection ou doc), When je lance « Corriger », Then le copilote renvoie une version corrigée orthographe/grammaire **sans changer le sens ni la mise en forme Markdown**.
- Given une correction, When je l'applique, Then je peux la **relire/annuler** (Ctrl+Z restaure) — aucune modification silencieuse irréversible.
Priority : **P1** (v2.1)

## 5. Non-functional requirements

| Catégorie | Exigence | Cible mesurable | Mesure |
|---|---|---|---|
| Confidentialité / réseau | Zéro requête réseau à l'inférence & à l'indexation | 0 requête sortante non-`localhost` pendant génération/embedding ; seul le **pull** sort | Monitoring réseau (comme story 8.3) |
| Performance (génération) | Latence 1er token & débit acceptables (modèle 3-4B chargé) | 1er token **< 5 s** ; débit **≥ 10 tok/s** (CPU Snapdragon X Elite) | Chrono in-app |
| Performance (chargement) | 1er prompt après changement de modèle | **< 15 s** (chargement en RAM) | Chrono |
| Réactivité | Annulation d'une génération | **< 500 ms** | Test manuel/auto |
| Architecture | Rust minimal préservé (ADR-0004) | Hôte = spawn sidecar + proxy HTTP uniquement ; 0 inférence in-process | Revue code |
| Compatibilité | ARM64 natif, aucune émulation | `ollama.exe` build ARM64 ; démarre sur Surface Pro 11 | Smoke natif |
| Empreinte disque | Modèles gérés & purgeables | Taille par modèle affichée ; purge effective ; app démarre **sans** modèle | Vérif UI |
| Robustesse | Le sidecar ne fait jamais planter Doku | Port occupé / crash sidecar → message clair, app utilisable ; 0 process orphelin à la fermeture | Test |
| Sécurité CSP | Réconcilier le sidecar avec la CSP stricte | `connect-src` autorise le port sidecar `localhost` ; pull = exception explicite consentie | Revue conf + smoke |

## 6. Scope

**IN — v2.0** (fondation utilisable) : FR-1 (sidecar), FR-2 (gestion modèles), FR-3 (panneau chat), FR-4 (résumer), FR-5 (Q&A doc courant).
**IN — v2.1** (extension) : FR-6 (RAG dossier), FR-7 (reformuler), FR-8 (corriger).

**OUT (différé / autre ADR)** :
- **NPU** (accélération Hexagon) — structurellement incompatible avec le free-GGUF (ADR-0006) ; rouvrira **son propre ADR** si l'autonomie batterie devient un objectif produit.
- **Cloud / API distante** — viole l'offline, écarté d'emblée.
- **Agents / outils / exécution d'actions** (le copilote agit sur des fichiers, lance des commandes) — hors périmètre lecture/écriture-assistée.
- **Génération d'images, voix, fine-tuning** — hors sujet v2.
- **Persistance longue de l'historique de chat** entre sessions — à évaluer (P2, cf. questions ouvertes).

**Assumptions (impact si faux)** :
- Le build **Ollama ARM64 Windows** est stable en sidecar *(faux → repli llama.cpp = build hell, re-gater ADR-0006)*.
- Un modèle **3-4B** tient en RAM et tourne à vitesse « chat » sur la machine *(faux → UX trop lente, réviser les modèles conseillés / cibles perf)*.
- L'utilisateur **télécharge un modèle une fois** et accepte l'empreinte disque (Go) *(faux → besoin d'une UX d'empreinte plus poussée)*.
- Pour le RAG (v2.1), un **modèle d'embedding local** de qualité suffisante tourne via le sidecar *(faux → RAG à repenser, d'où son statut P1 séparé)*.

## 7. User journeys

**Parcours primaire — résumer une note (v2.0)** :
| Étape | Action utilisateur | Réponse système | Cas limites |
|---|---|---|---|
| 1 | Ouvre le copilote (1re fois) | Sidecar démarre ; si 0 modèle → invite au téléchargement | Port occupé → message clair |
| 2 | Télécharge un modèle conseillé | Pull avec progression ; devient le modèle actif | Pull interrompu → reprise/erreur claire |
| 3 | Sur une note ouverte, clique « Résumer » | Résumé en streaming, ancré sur le doc | Doc très long → segmentation ; PDF sans texte → message |
| 4 | Lit / copie le résumé | Réponse rendue en Markdown, copiable | — |

**Parcours secondaire — Q&A dossier (v2.1)** : ouvre le mode « dossier » → 1re fois : indexation (progress) → pose une question → réponse citant les notes sources cliquables.

## 8. Success metrics

| Métrique | Cible | Baseline | Mesure |
|---|---|---|---|
| Copilote utilisable hors-ligne | 0 requête réseau à l'inférence | (v1.5 : pas de copilote) | Monitoring réseau |
| Temps jusqu'au 1er résumé (modèle déjà installé) | < 10 s bout-en-bout | — | Chrono |
| Débit génération | ≥ 10 tok/s | — | Chrono in-app |
| Pull d'un modèle réussi & actif | 100 % sur réseau nominal | — | Test |
| Stabilité sidecar | 0 process orphelin après 20 cycles ouvrir/fermer | — | Test |

## 9. Risks

| Risque | Prob. | Impact | Mitigation |
|---|---|---|---|
| **RAG (FR-6) sous-estimé** (embeddings, index incrémental, qualité, perf ARM) | Haute | Haut | Isolé en **v2.1** / P1 ; spike embeddings+index avant tout code ; v2.0 livrable sans lui |
| Cycle de vie sidecar (port, orphelin) | Moyenne | Moyen | Port dédié, kill propre à la fermeture, health-check au démarrage |
| Latence/1er token trop lents (CPU-only) | Moyenne | Haut | Modèles conseillés 3-4B testés ; cibles NFR ; streaming + annulation pour l'UX perçue |
| Empreinte disque modèles (Go dans %APPDATA%) | Moyenne | Moyen | UI taille + purge (FR-2) ; app fonctionne sans modèle |
| CSP vs sidecar/pull | Faible | Moyen | `connect-src` scoped au port local ; pull = action explicite documentée (réconcilier 8.3) |
| Ollama ARM64 instable en sidecar | Faible | Haut | Smoke natif tôt (spike sidecar) ; sinon re-gater ADR-0006 |
| Modèle qui invente (hallucination Q&A) | Moyenne | Moyen | Prompt ancré « réponds depuis le doc, sinon dis-le » ; citations sources en RAG |

## 10. Timeline & milestones

- **Spike sidecar** (avant tout) : `ollama.exe` ARM64 en `externalBin`, `serve` + `/api/generate` pilotés depuis Doku, smoke natif + CSP. → confirme l'hypothèse-clé.
- **v2.0** : FR-1 → FR-5 (fondation + résumer + Q&A doc). = copilote utilisable.
- **Spike RAG** : embeddings locaux + index incrémental (perf/qualité ARM) → ADR dédié.
- **v2.1** : FR-6 → FR-8 (RAG dossier + reformuler + corriger). = copilote complet.

## 11. Open questions

1. **Modèle conseillé par défaut** (à proposer au 1er lancement) : `llama3.2:3b` ? `qwen2.5:3b` ? `phi-3.5` ? (critère : qualité FR/EN vs vitesse sur X Elite).
2. **Historique de chat** : éphémère (par session) ou persisté ? Où (par doc ? global ?) — impacte l'UX du panneau.
3. **Modèle d'embedding** pour le RAG (v2.1) : lequel tourne bien via le sidecar en ARM64 ?
4. **Actions sur la sélection** (menu contextuel Reformuler/Corriger) : surface UX P1 en plus du chat — à cadrer en v2.1.
5. **Budget disque modèles** : seuil d'alerte / quota dans l'UI ?
