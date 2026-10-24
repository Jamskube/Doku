// Suivi du bas d'un fil de conversation (Kube Thread). Logique sans DOM réel : le
// composant branche `onScroll` sur le défilement et `pin` sur un ResizeObserver.
export const NEAR_BOTTOM_PX = 96
export const SMOOTH_SETTLE_MS = 700

export interface ScrollBox {
  scrollTop: number
  readonly scrollHeight: number
  readonly clientHeight: number
  scrollTo(options: ScrollToOptions): void
}

export function createStickToBottom(
  box: ScrollBox,
  onFollowChange: (following: boolean) => void,
  now: () => number = () => performance.now(),
) {
  let following = true
  let settleUntil = 0
  let lastTop = box.scrollTop

  function setFollowing(next: boolean) {
    if (next === following) return
    following = next
    onFollowChange(next)
  }

  return {
    get following() {
      return following
    },
    onScroll() {
      const top = box.scrollTop
      const movedUp = top < lastTop
      lastTop = top
      // Pendant notre propre défilement doux, les positions intermédiaires sont « loin ».
      if (now() < settleUntil) return
      const distance = box.scrollHeight - box.clientHeight - top
      // Contenu qui rétrécit : le navigateur rabat scrollTop vers le haut, mais on reste
      // collé au bas — ce n'est pas l'utilisateur qui remonte.
      if (distance < 1) return setFollowing(true)
      // Kube suit tant qu'on est à moins de 96 px ; au trackpad, chaque petit pas vers le
      // haut serait aussitôt ramené en bas par le flux. Remonter décroche donc toujours.
      if (movedUp) return setFollowing(false)
      setFollowing(distance <= NEAR_BOTTOM_PX)
    },
    // Croissance du contenu (flux, rendu final) ou du dock : garde l'épingle.
    pin() {
      if (following) box.scrollTop = box.scrollHeight
    },
    scrollToBottom(smooth: boolean) {
      setFollowing(true)
      if (smooth) {
        settleUntil = now() + SMOOTH_SETTLE_MS
        box.scrollTo({ top: box.scrollHeight, behavior: 'smooth' })
      } else {
        settleUntil = 0
        box.scrollTop = box.scrollHeight
      }
    },
  }
}
