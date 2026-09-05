# 0031. Répartition local / cloud assumée : le local garde la lecture, le cloud porte la création

**Date** : 2026-09-05 · **Status** : accepted · **Deciders** : Kubo (+ Claude) · **Tags** : ia, local, cloud, produit, ux

## Context

Doku se présente comme *local-first*. Le copilote a pourtant deux visages : le modèle local retenu (`qwen2.5:1.5b-instruct-q4_0`, « gadget discret » par décision, ADR-0016) et les fournisseurs cloud (OpenAI, MiniMax). Au fil des chantiers, toute création riche est devenue **cloud seulement** : mémoire de travail (ADR-0019), studio de diagrammes (ADR-0028), documents HTML/PDF (ADR-0029), correction PDF (ADR-0024, retirée). Le local garde chat, résumé et Q&A citée sur les notes (RAG), avec un prefill de plusieurs dizaines de secondes sur un long document.

La revue du 2026-09-05 (quatre angles) a jugé cette dualité floue : un utilisateur qui lit « local-first » découvre une version pauvre, et le code porte des dizaines de branchements par fournisseur.

## Decision

1. **Le partage est nommé et stable.** *Local* = lire et interroger : questions, résumés, recherche dans les notes avec citations, tout sans qu'un octet quitte l'appareil. *Cloud* = créer : mémoire, diagrammes, documents HTML/PDF, recherche Web. Aucune fonction de création ne sera portée sur le 1.5b ; aucune fonction de lecture ne deviendra cloud-only.
2. **Local-first signifie « la confidentialité par défaut », pas « tout en local ».** Le mode local reste le défaut à l'installation et le seul où « rien ne quitte cet appareil » ; le cloud est un choix explicite, dit à chaque envoi (bandeau du composeur).
3. **L'interface dit la frontière au lieu de la cacher** : une fonction cloud-only apparaît grisée avec « Modèle cloud requis », jamais absente ni muette (règle Epic 19).
4. Les branchements `provider === 'ollama'` restants sont acceptés tant qu'ils traduisent cette frontière ; ceux qui traduisent autre chose sont à supprimer au passage.

## Consequences

**Positive** : une phrase suffit à expliquer le produit ; plus de promesse implicite que le local « fera tout un jour ».
**Negative** : le 1.5b ne créera jamais de diagramme ni de document — c'est assumé, pas regretté (ADR-0016 : l'étau qualité/RAM de 16 Go n'a pas bougé).
**Risks** : un futur modèle local capable de création (les trois conditions de réouverture de l'ADR-0016) demanderait de rouvrir cet ADR, pas de le contourner.

## Related

- [ADR-0016](./0016-backend-npu-onnx-runtime-genai.md) — pourquoi le local reste petit
- [ADR-0019](./0019-memoire-travail-cloud-automatisee.md), [ADR-0028](./0028-diagrammes-bgraph-wasm.md), [ADR-0029](./0029-documents-generes-html-pdf.md) — les fonctions cloud-only
