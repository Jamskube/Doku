// Espace maintenue = dictée (ADR-0034, façon « push-to-talk » de Handy). Une frappe brève tape
// toujours une espace : la touche n'est retenue que le temps de savoir si elle est maintenue,
// et une autre touche pendant ce temps (frappe rapide) tape l'espace aussitôt.
import { Prec, type Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'

export const HOLD_MS = 300

export interface HoldSpaceHandler {
  enabled(): boolean
  start(): void
  stop(): void
}

// Posé par le module de dictée : l'éditeur n'importe rien de la voix (ni moteur ni copilote).
let handler: HoldSpaceHandler | null = null

export function setHoldSpaceHandler(next: HoldSpaceHandler | null): void {
  handler = next
}

let timer: ReturnType<typeof setTimeout> | null = null
let holding = false

const typeSpace = (view: EditorView) => view.dispatch(view.state.replaceSelection(' '), { userEvent: 'input.type' })

function settle(view: EditorView): void {
  if (timer) {
    clearTimeout(timer)
    timer = null
    typeSpace(view)
  }
  if (holding) {
    holding = false
    handler?.stop()
  }
}

const plainSpace = (e: KeyboardEvent) => e.key === ' ' && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey

export const holdSpace: Extension = Prec.highest(
  EditorView.domEventHandlers({
    keydown(e, view) {
      if (timer || holding) {
        if (e.key === ' ') {
          e.preventDefault() // répétition automatique de la touche maintenue
          return true
        }
        if (timer) settle(view) // autre touche avant le délai : l'espace part, la touche suit
        return false
      }
      if (!plainSpace(e) || e.repeat || view.composing || !handler?.enabled()) return false
      e.preventDefault()
      timer = setTimeout(() => {
        timer = null
        holding = true
        handler?.start()
      }, HOLD_MS)
      return true
    },
    keyup(e, view) {
      if (e.key !== ' ' || (!timer && !holding)) return false
      settle(view)
      return true
    },
    blur(_e, view) {
      // Le focus part (clic ailleurs, Alt+Tab) : jamais de micro qui reste ouvert.
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      if (holding) settle(view)
      return false
    },
  }),
)
