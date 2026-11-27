// Travail d'export en cours (impression d'un PDF page à page, gravure d'annotations,
// conversion DOCX → PDF), lu par l'îlot de la barre de titre comme activité en direct.
// Contrat de store Svelte (`$exportJob`) écrit à la main, sans rune ni svelte/store : les
// modules d'export restent du TS pur, testable, et le serveur Vite n'a pas de dépendance à
// ré-optimiser.

export interface ExportJob {
  label: string
  done: number
  // 0 = progression inconnue (indicateur indéterminé).
  total: number
}

let current: ExportJob | null = null
const listeners = new Set<(job: ExportJob | null) => void>()

function set(job: ExportJob | null): void {
  current = job
  for (const listener of listeners) listener(job)
}

export const exportJob = {
  subscribe(listener: (job: ExportJob | null) => void): () => void {
    listeners.add(listener)
    listener(current)
    return () => listeners.delete(listener)
  },
}

export async function trackExport<T>(label: string, work: () => Promise<T>): Promise<T> {
  set({ label, done: 0, total: 0 })
  try {
    return await work()
  } finally {
    set(null)
  }
}

export function reportExportProgress(done: number, total: number): void {
  if (current) set({ ...current, done, total })
}
