// Fermeture animée d'un <dialog> natif : `close()` retire la modale du top layer sur-le-champ,
// donc la sortie se joue AVANT, sous la classe `.closing` (keyframes doku-dialog-out, app.css).
// `animationend` seul ne suffit pas (onglet caché, animation annulée) : un minuteur garantit
// la fermeture. Câbler aussi `oncancel={(e) => { e.preventDefault(); closeDialog(dlg) }}`
// pour qu'Échap passe par la même sortie. Rouvrir pendant la sortie = retirer `.closing`
// (reopenDialog) : la fermeture en attente est alors abandonnée.
const EXIT_MS = 150

export function closeDialog(dlg: HTMLDialogElement | null | undefined, returnValue?: string): void {
  if (!dlg || !dlg.open || dlg.classList.contains('closing')) return
  dlg.classList.add('closing')
  let done = false
  const finish = () => {
    if (done) return
    done = true
    dlg.removeEventListener('animationend', onEnd)
    if (!dlg.classList.contains('closing')) return
    dlg.classList.remove('closing')
    if (dlg.open) dlg.close(returnValue)
  }
  const onEnd = (event: Event) => { if (event.target === dlg) finish() }
  dlg.addEventListener('animationend', onEnd)
  setTimeout(finish, EXIT_MS + 50)
}

export function reopenDialog(dlg: HTMLDialogElement | null | undefined): boolean {
  if (!dlg?.open || !dlg.classList.contains('closing')) return false
  dlg.classList.remove('closing')
  return true
}
