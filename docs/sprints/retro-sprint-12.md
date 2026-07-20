# Retrospective: Sprint 12

**Date**: 2026-07-20
**Velocity**: 7 completed / 7 planned (100 %) — 5 cœur + 2 stretch

## Stats
- Stories completed: **7/7** (14.0 M · 14.1 M · 14.2 M · 14.3 S · 13.5 S · 16.1 M · 16.2 S) — ledger **57/57**, **v2.0 + rédaction livrées, sprint clos à J+4 sur 7** (fin prévue 23/07)
- Stories carried over: 0 · Blockers: 0
- Rythme réel : les 5 stories cœur + 16.1 validées natif **le jour 1** (16/07) ; 16.2 livrée le 20/07 — absorbée entre-temps par le **brief w3** (4ᵉ verbe + aperçu diff en place, remplace l'UI Proposition du panneau)
- Commits fenêtre : 20 (8 `feat` · 1 `fix` · 9 `docs` · 2 autres)
- Revues : critic **Block** sur 14.1 (3 vecteurs réseau, contenu LLM en webview principale → allowlist DOMPurify + CSP durcie) ; 16.2 : critic « ship with changes » (3 HIGH : reload externe hors transaction, virtualisation CM6 du widget, catch non gardé) + code-reviewer **Approve** (0 Critical/Major)
- **Hors sprint** (volume > sprint, ~3 200 insertions) : refonte interface (menu contextuel de sélection, menu `⋯`, vue pleine page), **provider OpenAI optionnel** (connexion de compte, ADR-0013/0014, persona cloud), session `/impeccable` (critique 27/40 → correctifs P0-P2)
- Vélocité : S8=4 · S9=4 · S10=3 · S11=4 · **S12=7** (1er sprint au format recalibré 1 semaine / 6-8)

## What Went Well 👍
- **Le format 1 semaine / 6-8 stories a tenu** (action n°1 de la rétro S11) : 7/7 dans la cible, aucun débordement, stretchs comprises.
- **Le design hors sprint a PORTÉ le sprint au lieu de le gonfler** : la maquette w2 a redéfini 14.0 avant le code, et le brief w3 (confirmé le 17/07) a absorbé 16.2 — l'utilisateur a construit lui-même le popover de sélection hors sprint, la story n'a eu qu'à livrer le diff en place. La préférence actée en rétro S1 est devenue un mécanisme de découpage.
- **La boucle critic (plan) → code-reviewer (diff) → validation native tient sur du terrain neuf** : le Block de 14.1 a fermé 3 vecteurs réseau AVANT le natif (la garantie 0-réseau reposait sur DOMPurify seul), et les 3 HIGH de 16.2 (setState sans transaction, widget vidé par la virtualisation, catch non gardé par l'id) étaient tous invisibles depuis le contexte d'écriture.
- **Remonter 16.1/16.2 en stretch a payé** : la rédaction est livrée sans attendre v2.1, et le RAG (le gros chantier risqué) est isolé, seul, dans le sprint 13.

## What Didn't Go Well 👎
- **Rien de bloquant** (choix utilisateur : « rien de notable » — 0 blocker, 0 carry-over). Deux observations froides pour mémoire :
  - **La boîte de temps ne mord toujours pas** : cœur du sprint fini au jour 1, checkpoints STOP/GO jamais sollicités — 2ᵉ sprint de suite. Le format 1 semaine est reconduit tel quel (décision utilisateur), le point reste sous observation.
  - **Le hors-sprint a dépassé le sprint en volume** et le provider OpenAI est entré sans entrée ledger ni boucle de revue tracée. Assumé (c'est le mode de travail choisi) ; noté ici uniquement pour que le ledger ne soit pas pris pour l'inventaire complet de ce que fait l'app.

## What Surprised Us 💡
- **`qwen2.5:1.5b-instruct-q4_0` tient mieux que prévu** : le modèle « gadget » (935 Mo) valide reformuler ET corriger en natif — c'est un vrai défaut viable, pas juste un modèle de démo.
- **CM6 encaisse tout** : replace inline multi-lignes (StateField), widget auto-peuplé, diff en place, cohabitation avec les widgets-blocs du live-preview — le chantier w3 est passé sans casse ni contournement.

## Action Items for Next Sprint
| Action | Priority |
|--------|----------|
| Planifier le sprint 13 sur l'**Epic 15 (RAG)** seul, spike 15.1 en tête de sprint (pattern S11 : la valeur du spike = la liste des surprises) | High |
| Reconduire le format 1 semaine / 6-8 stories tel quel (décision utilisateur : rien à changer) | Low |

## Lessons Learned
→ `/start learn perf: qwen2.5:1.5b-instruct-q4_0 (935 Mo, « gadget ») valide en natif reformuler ET corriger (16.1/16.2) — viable comme modèle par défaut pour les tâches de réécriture courtes, pas seulement pour la démo ; garder le 3b pour la qualité Q&A/résumé`
→ `/start learn gotcha: aperçu « en place » CM6 (proposition par-dessus une sélection) : Decoration.replace inline multi-lignes via StateField (jamais ViewPlugin) + widget qui se RE-PEUPLE dans toDOM (la virtualisation détruit le DOM hors viewport — un conteneur rempli uniquement de l'extérieur revient vide) + auto-dismiss atomique dans update() sur tout docChanged sans effet marqueur (la transaction d'accept porte l'effet, c'est ce qui la distingue d'une édition étrangère) ; re-valider sliceDoc===original dans l'$effect de sync car un setState (reload externe) ne passe par AUCUNE transaction`
