import { describe, expect, it } from 'vitest'
import { NOTICE_DELAY, startDismissTimer, type DismissClock } from './auto-dismiss'

// Horloge pilotée à la main : un test de minuterie qui dort vraiment est un test lent
// ET instable. Ici le temps n'avance que quand on le décide.
function horloge() {
  let t = 0
  let seq = 1
  const taches = new Map<number, { quand: number; fn: () => void }>()
  const clock: DismissClock = {
    now: () => t,
    setTimeout: (fn, ms) => {
      const id = seq++
      taches.set(id, { quand: t + ms, fn })
      return id
    },
    clearTimeout: (id) => void taches.delete(id),
  }
  return {
    clock,
    avancer(ms: number) {
      const cible = t + ms
      for (;;) {
        const du = [...taches.entries()].filter(([, x]) => x.quand <= cible).sort((a, b) => a[1].quand - b[1].quand)[0]
        if (!du) break
        taches.delete(du[0])
        t = du[1].quand
        du[1].fn()
      }
      t = cible
    },
  }
}

describe('startDismissTimer', () => {
  it('efface la notification une fois le délai écoulé', () => {
    const h = horloge()
    let efface = 0
    startDismissTimer(5000, () => efface++, h.clock)
    h.avancer(4999)
    expect(efface).toBe(0)
    h.avancer(1)
    expect(efface).toBe(1)
  })

  it('n’efface qu’UNE fois', () => {
    const h = horloge()
    let efface = 0
    startDismissTimer(1000, () => efface++, h.clock)
    h.avancer(10_000)
    expect(efface).toBe(1)
  })

  it('SUSPEND le compte à rebours — une notification survolée ne part pas sous le curseur', () => {
    const h = horloge()
    let efface = 0
    const t = startDismissTimer(5000, () => efface++, h.clock)
    h.avancer(2000)
    t.pause()
    h.avancer(60_000) // l'utilisateur lit, longtemps
    expect(efface).toBe(0)
  })

  it('reprend sur le temps RESTANT, pas sur le délai complet', () => {
    const h = horloge()
    let efface = 0
    const t = startDismissTimer(5000, () => efface++, h.clock)
    h.avancer(4000)
    t.pause()
    h.avancer(10_000)
    t.resume()
    h.avancer(999)
    expect(efface).toBe(0) // il restait 1000 ms, pas 5000
    h.avancer(1)
    expect(efface).toBe(1)
  })

  it('supporte des suspensions répétées sans dériver', () => {
    const h = horloge()
    let efface = 0
    const t = startDismissTimer(3000, () => efface++, h.clock)
    for (let i = 0; i < 3; i++) {
      h.avancer(500)
      t.pause()
      h.avancer(5000)
      t.resume()
    }
    expect(efface).toBe(0) // 1500 ms consommées sur 3000
    h.avancer(1500)
    expect(efface).toBe(1)
  })

  it('pause et resume sont idempotents', () => {
    const h = horloge()
    let efface = 0
    const t = startDismissTimer(1000, () => efface++, h.clock)
    t.pause(); t.pause()
    h.avancer(5000)
    expect(efface).toBe(0)
    t.resume(); t.resume()
    h.avancer(1000)
    expect(efface).toBe(1)
  })

  it('stop empêche définitivement l’effacement — une notif fermée à la main ne revient pas', () => {
    const h = horloge()
    let efface = 0
    const t = startDismissTimer(1000, () => efface++, h.clock)
    t.stop()
    h.avancer(10_000)
    expect(efface).toBe(0)
    t.resume() // même une reprise tardive ne doit rien réarmer
    h.avancer(10_000)
    expect(efface).toBe(0)
  })

  it('rend le temps restant, y compris suspendu', () => {
    const h = horloge()
    const t = startDismissTimer(5000, () => {}, h.clock)
    h.avancer(2000)
    expect(t.remaining()).toBe(3000)
    t.pause()
    h.avancer(10_000)
    expect(t.remaining()).toBe(3000)
  })
})

describe('NOTICE_DELAY', () => {
  it('laisse plus de temps à une erreur qu’à un succès', () => {
    expect(NOTICE_DELAY.error).toBeGreaterThan(NOTICE_DELAY.warning)
    expect(NOTICE_DELAY.warning).toBeGreaterThan(NOTICE_DELAY.success)
  })

  it('laisse le temps de lire une phrase, sans camper à l’écran', () => {
    for (const d of Object.values(NOTICE_DELAY)) {
      expect(d).toBeGreaterThanOrEqual(4000)
      expect(d).toBeLessThanOrEqual(15_000)
    }
  })
})
