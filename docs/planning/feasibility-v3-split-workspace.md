# Gate de faisabilité : bureau scindé Doku v3

_Date : 2026-08-13 · Référence : `PRD-v3.md` · Verdict : **GO**_

## Objectif falsifiable

Afficher deux documents Doku simultanément, dont deux Markdown de 500 Ko, sans mutation croisée et sans tâche de frappe dépassant 50 ms au p95 sur la machine ARM64 de référence. Le produit vise ensuite p95 ≤ 16 ms ; cette cible plus stricte doit être atteinte ou faire l’objet d’un mode secondaire allégé avant la sortie.

## Contraintes

- Tauri 2, Svelte 5 et CodeMirror 6 existants ; aucun second moteur d’édition.
- Les fichiers utilisateur restent la source de vérité ; aucune re-sérialisation Markdown.
- Le modèle actuel possède un `activeTab()`, un `editorRef` et une sélection globaux : ils ne sont pas multi-volets.
- Deux surfaces maximum ; Markdown/TXT éditables, HTML/PDF en lecture seule.
- Windows ARM64 et x64 restent les deux cibles de distribution.

## Assumptions audit

| Hypothèse | Classement | Preuve / action |
|---|---|---|
| Plusieurs `EditorView` indépendants peuvent coexister | Supported | CodeMirror documente une vue par instance et fournit un exemple officiel de split view ; spike local PASS ([référence](https://codemirror.net/examples/split/)) |
| Deux documents de 500 Ko restent sous le seuil produit | Supported avec garde-fou | M0 live-preview : p95 29,5 ms ; M2 avec aperçu suspendu pendant le split lourd : p95 18,6–20,0 ms sur cinq passages |
| Un registre de vues par volet remplace la référence globale | Plausible | Le code actuel centralise `editorRef`; extraction nécessaire avant le second montage |
| Un même buffer peut être édité dans les deux surfaces | Wishful et inutile | Explicitement interdit dans le PRD v3 |
| Une note sans chemin peut être sauvegardée avec les primitives actuelles | Plausible après ajout | `writeTextFileAtomic` existe ; le dialogue et la transition atomique de `DocTab` manquent encore |
| La provenance peut rester portable dans Markdown | Plausible | Format canonique v1 défini dans le PRD ; corpus hostile et relocalisation à tester |

## External evidence

- Le manuel CodeMirror définit chaque `EditorView` comme une surface possédant son propre `EditorState`, sa sélection et ses transactions ([Reference Manual](https://codemirror.net/docs/ref/)).
- L’exemple officiel de split view précise que plusieurs vues ne se synchronisent pas automatiquement ; Doku évite ce cas en interdisant le même onglet dans les deux volets du premier incrément ([Split View](https://codemirror.net/examples/split/)).
- Aucune nouvelle API native ou dépendance externe n’est requise pour le layout ; seul le flux Enregistrer sous réutilise le plugin-dialog déjà installé.

## Kill-test

**Hypothèse testée** : deux éditeurs de 500 Ko avec live-preview restent indépendants et interactifs.

- Setup : `spike/split-workspace.html`, deux `EditorView`, document `09-stress-500k.md`, 80 frappes synthétiques dans le volet principal.
- PASS si : second buffer inchangé, premier buffer modifié, p95 ≤ 50 ms.
- FAIL si : mutation croisée, frappe perdue ou p95 > 50 ms.
- Résultat : montage **73,9 ms** ; avg **19,2 ms** ; p95 **29,5 ms** ; max **37,4 ms** ; second buffer inchangé.
- Responsive : à 700 × 720, layout vertical et deux surfaces 676 × 280 px.
- Verdict : **PASS**.

**Checkpoint M2** : pour un document d’au moins 450 000 caractères en vue scindée, Doku conserve l’éditeur et le buffer canonique mais suspend les décorations live-preview jusqu’à la réunification. Cinq passages réels donnent un p95 compris entre **18,6 et 20,0 ms**, un maximum de **27,3 ms**, et zéro mutation du buffer secondaire. Le checkpoint 50 % est **PASS**.

## STOP/GO checkpoints

| Étape | GO si | STOP si | Action sur STOP |
|---|---|---|---|
| 15 % — fondation | Enregistrer sous annule/échoue/sauvegarde sans mutation d’état prématurée ; 100 alternances de focus = 0 sauvegarde croisée | un onglet ou buffer incorrect est écrit | bloquer le layout et corriger le modèle `activePaneId`/snapshot async |
| 50 % — interaction | deux documents de 500 Ko : p95 ≤ 25 ms, max < 50 ms ; layout clair/sombre et 700 px utilisable au clavier | p95 > 25 ms ou surfaces inaccessibles | mode secondaire lecture seule hors focus ou virtualisation avant notes liées |
| 80 % — intégration | corpus round-trip 100 %, 0 chemin hostile ouvert, 20 citations × 3 scénarios de relocalisation verts | sérialisation modifiée, faux passage ou chemin non sûr accepté | retirer capture/navigation de la release et livrer seulement le bureau scindé |

## Verdict

**GO** pour l’architecture et le premier incrément. La coexistence, le ciblage par `activePaneId`, la conservation de l’état lors d’un échange de volets et le budget de frappe sur deux documents lourds sont prouvés. Le dialogue natif Enregistrer sous doit encore recevoir son smoke test release avant commit ; les citations restent volontairement dans le lot suivant.
