// File des notifications de l'app. `app.banner = …` reste l'API de tous les appelants,
// mais une nouvelle notification ne chasse plus celle qu'on est en train de lire : elle
// attend son tour. Seule la première de la file est affichée (dans l'îlot de la barre de titre).

export const NOTICE_QUEUE_CAP = 3

export interface QueuedNotice<T> {
  id: number
  notice: T
}

interface NoticeLike {
  tone: string
  title: string
  message: string
}

const same = (a: NoticeLike, b: NoticeLike) => a.tone === b.tone && a.title === b.title && a.message === b.message

/**
 * Ajoute (mutation en place : la file est un état Svelte). Doublon de la DERNIÈRE entrée :
 * son objet est remplacé sans nouvel id — affichée, elle garde sa carte et son minuteur
 * repart. Au-delà du plafond, la plus ancienne EN ATTENTE part, jamais celle affichée.
 */
export function enqueueNotice<T extends NoticeLike>(queue: QueuedNotice<T>[], notice: T, id: number): void {
  const last = queue.at(-1)
  if (last && same(last.notice, notice)) {
    last.notice = notice
    return
  }
  queue.push({ id, notice })
  while (queue.length > NOTICE_QUEUE_CAP) queue.splice(1, 1)
}

/** Retire une notification par son id (fermée, ou arrivée au bout de sa vie dans l'îlot). */
export function removeNotice<T>(queue: QueuedNotice<T>[], id: number): void {
  const index = queue.findIndex((entry) => entry.id === id)
  if (index >= 0) queue.splice(index, 1)
}
