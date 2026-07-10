// SnapshotService — versions locales à chaque sauvegarde (FR-12, ADR-0003).
// Logique pure et testable ; l'I/O (appData, mkdir, purge) vit dans tauri.ts.

const DAY_MS = 86_400_000
export const SNAPSHOT_MAX = 20
export const SNAPSHOT_MAX_AGE_MS = 30 * DAY_MS

// Clé de dossier = SHA-1 du chemin absolu normalisé (séparateurs unifiés, casse
// insensible façon Windows). Un fichier déplacé/renommé démarre un historique
// neuf — compromis assumé (ADR-0003). crypto.subtle : dispo en contexte sécurisé
// (localhost/tauri) et sous Node (tests).
export async function snapshotKey(absPath: string): Promise<string> {
  // NFC : deux chemins visuellement identiques (accents composés vs décomposés)
  // partagent le même historique.
  const norm = absPath.normalize('NFC').replace(/\\/g, '/').toLowerCase()
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(norm))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// Horodatage triable et compatible noms de fichiers Windows (`:` interdit).
// 2026-07-10T15:52:34.123Z -> 2026-07-10T15-52-34-123Z
export function snapshotStamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, '-')
}

// Reconstruit la date depuis le nom de snapshot. Tolère l'extension et un suffixe
// de dédoublonnage `~N` (collision d'horodatage à la ms). null si invalide.
export function parseStamp(name: string): Date | null {
  const base = name.replace(/\.[^.]+$/, '').replace(/~\d+$/, '')
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/.exec(base)
  if (!m) return null
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], +m[7])
  return Number.isNaN(t) ? null : new Date(t)
}

export interface SnapshotEntry {
  name: string
  time: number // ms epoch, dérivé du nom
}

// Élément affiché dans le panneau Historique (issu de meta.json, pas de relecture
// du fichier snapshot — cf. gros fichiers).
export interface SnapshotInfo {
  name: string
  time: number
  preview: string
}

// Sélectionne les snapshots à purger : au-delà des `maxCount` plus récents OU plus
// vieux que `maxAgeMs` (ADR-0003). Entrée non triée ; renvoie les noms à supprimer.
// Garde TOUJOURS le plus récent quel que soit son âge : le filet de sécurité ne se
// vide jamais entièrement (affinement de la purge stricte, coût nul).
export function selectPurgeable(
  entries: SnapshotEntry[],
  now: number,
  maxCount = SNAPSHOT_MAX,
  maxAgeMs = SNAPSHOT_MAX_AGE_MS,
): string[] {
  const sorted = [...entries].sort((a, b) => b.time - a.time) // plus récent d'abord
  const doomed: string[] = []
  sorted.forEach((e, i) => {
    if (i === 0) return // le plus récent est intouchable
    if (i >= maxCount || now - e.time > maxAgeMs) doomed.push(e.name)
  })
  return doomed
}

// Aperçu court pour le panneau Historique : 1re ligne non vide, marqueur de titre
// Markdown retiré, tronquée à `max`.
export function snapshotPreview(content: string, max = 80): string {
  const line = content
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0)
  const clean = (line ?? '').replace(/^#{1,6}\s+/, '')
  return clean.length > max ? clean.slice(0, max - 1) + '…' : clean
}
