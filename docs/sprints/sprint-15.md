# Sprint 15

**Goal** : **trancher le NPU par la mesure** — prouver (ou réfuter) que Foundry Local + QNN effondre le prefill (~45 s → ~1-2 s) sur ce Snapdragon X **Plus**, sans casser le 0-réseau, **avant** d'engager la réécriture du sidecar.
**Start** : 2026-07-24
**End** : 2026-07-24 (clos J+0)
**Status** : **Done — verdict NO-GO** (ADR-0016 `rejected`)

Sprint **spike-first** (Epic 17, backend d'inférence NPU). C'est le **dernier epic du backlog** : Epics 1–16 + 18 sont livrés (ledger 63/63), le produit est feature-complete côté v2.2. L'Epic 17 était une « piste » (urgence rétrogradée le 2026-07-16) ; le choix produit du 2026-07-24 est de **l'attaquer maintenant**, en sautant le préalable CPU (assumé). La livraison se mesure en **décision tranchée**, pas en nombre de stories : un **NO-GO documenté est une livraison**.

Rappels de cadrage :
- **0 réseau = contrainte dure** (NFR Confidentialité) : Foundry Local est 100 % local, mais son EP QNN + l'activation des modèles ONNX doivent être **re-prouvés** sans requête non-`localhost` (y compris au premier chargement).
- **Gain étroit par nature** : le NPU effondre le **prefill** mais **décode plus lentement** que le CPU en q4_0 (benchmark : NPU 19,5 t/s < CPU q4_0 36,3 t/s). Le spike doit confirmer que le gain prefill vaut la complexité.
- **Exclus** : OmniNeural-4B / Nexa (anglais + activation en ligne obligatoire = casse le 0-réseau). Modèle visé : vrai 4B texte FR (Qwen3-4B / Ministral-3) en ONNX.
- **Abstraction, pas remplacement** : viser une couche d'inférence commutable (Ollama ⇄ Foundry), pas un remplacement sec d'Ollama.

## Stories

| # | Story | Size | Status | Gate | Notes |
|---|-------|------|--------|------|-------|
| 17.1 | Spike Foundry Local : mesure prefill NPU vs CPU + re-preuve 0-réseau → ADR-0016 GO/NO-GO | M | ✅ **DONE — NO-GO** | **STOP** | Foundry hors jeu (EP QNN cassé, bug amont). Voie ORT-genai-QNN directe **trouvée et fonctionnelle**. Mesuré : prefill 4-6× plus rapide, decode 2× plus lent. Mur = étau qualité/RAM sur 16 Go. Verdict tranché par la donnée. |
| 17.2 | Abstraction couche d'inférence (Ollama ⇄ Foundry) + client OpenAI | L | ❌ **Annulée** | gate jamais ouverte | 17.1 = NO-GO → **jamais codée, par conception**. Ce n'est pas de la dette : c'est une branche fermée. Réouverture liée aux 3 conditions de l'ADR-0016. |

## Blockers
_None_

## Checkpoints STOP/GO
| ~% | Critère | Si STOP |
|---|---|---|
| 100 % (17.1) | Prefill mesuré (NPU vs CPU, chiffres), 0 réseau prouvé, faisabilité client OpenAI, **ADR-0016 avec verdict GO/NO-GO** | **NO-GO** = livraison valide : documenter que le gain prefill ne vaut pas la complexité → **repli sur le levier CPU** (câbler + mesurer `qwen2.5:3b-instruct-q4_0` comme défaut). 17.2 abandonnée, Epic 17 re-noté « piste, préalable CPU d'abord ». |
| — (17.2) | Ne démarre **que** sur un GO de 17.1 | Si 17.1 = NO-GO : 17.2 n'est pas ouverte du tout. |

## Progress Log
### 2026-07-24
- Sprint initialisé avec **2 stories** (Epic 17, backend NPU), décomposé spike-first. Ledger : +2 entrées (65 features, 2 ouvertes : 17.1, 17.2).
- **17.2 gated** : ne se code que si le spike 17.1 tranche GO. Un NO-GO documenté clôt le sprint honnêtement (repli levier CPU).
- Choix produit : préalable « épuiser le levier CPU » **sauté** (assumé) — le spike mesurera si le prefill justifie même le NPU. Direction Foundry Local (ONNX/QNN), pas OmniNeural/Nexa (casse le 0-réseau).
- **17.1 exécutée de bout en bout sur la machine réelle.** Trois découvertes : (1) **Foundry Local est hors jeu** — son EP QNN ne s'enregistre même pas (`AutoRegisterCertifiedEps: Failure`, `discoverEps()` ne voit que WebGpu) : bug amont confirmé, pas notre config ; (2) **la voie qui marche existe** — `onnxruntime-genai` + `onnxruntime-qnn` **en direct** (EP en plugin + `ADSP_LIBRARY_PATH`) : le modèle tourne réellement sur le HTP Hexagon, sidecar OpenAI streamé livré ; (3) **la mesure tranche** — prefill NPU 4-6× plus rapide (pente plate ~1,5 ms/tok), decode 2× plus lent.
- **Le mur n'est pas la vitesse, c'est un étau à trois branches sur 16 Go** : `1.5b-qnn` tient mais est **trop bête** (rejeté en natif) ; `7b-qnn` a un bon FR mais **swappe** (~5 Go, un OOM, bout-à-bout ~4× plus lent que le CPU 1.5b) ; **aucun 3B QNN FR n'existe** (catalogue 1,5B → 7B). Pas de point de fonctionnement → grille ADR-0016 : seuil 1 passe, seuils 2/4/5 échouent → **NO-GO**.
- **Sprint clos J+0 sur un NO-GO chiffré = livraison valide** (c'était le contrat du checkpoint). ADR-0016 gravée `rejected` avec les mesures + 3 conditions de réouverture. 17.2 annulée sans être ouverte.
- **Décision produit associée** : le repli prévu par l'ADR (basculer sur `qwen2.5:3b-instruct-q4_0`) est **lui aussi écarté** par l'utilisateur — trop lent, trop gourmand en RAM pour un copilote qui doit rester un **gadget discret**. **`qwen2.5:1.5b-instruct-q4_0` est confirmé comme le bon modèle** (statu quo assumé, pas par défaut). Aucun changement de code copilote.
- **Nettoyage** : le provider `'npu'` et l'onglet « NPU (essai) » sont **retirés du produit** (un NO-GO ne laisse pas un provider expérimental dans l'app). Le banc et le sidecar restent dans `spike/npu-17.1/` — reproductibles si une des conditions de réouverture se réalise. `svelte-check` 0 erreur, `vitest` 260/260.
- **Backlog vide** : Epics 1-16 + 18 livrés, Epic 17 clos par la mesure. Ledger 64/65 (17.2 annulée).
