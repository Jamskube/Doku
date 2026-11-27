import { describe, it, expect, vi, afterEach } from 'vitest'
import { closeDialog, reopenDialog } from './dialog-close'

function fakeDialog() {
  const listeners = new Map<string, (e: Event) => void>()
  const classes = new Set<string>()
  const dlg = {
    open: true,
    closeCalls: 0,
    classList: {
      add: (c: string) => classes.add(c),
      remove: (c: string) => classes.delete(c),
      contains: (c: string) => classes.has(c),
    },
    addEventListener: (t: string, fn: (e: Event) => void) => listeners.set(t, fn),
    removeEventListener: (t: string) => listeners.delete(t),
    close() { this.open = false; this.closeCalls++ },
  }
  return { dlg, listeners, classes }
}

afterEach(() => vi.useRealTimers())

describe('closeDialog', () => {
  it('closes once on animationend of the dialog itself, not of a child', () => {
    vi.useFakeTimers()
    const { dlg, listeners, classes } = fakeDialog()
    closeDialog(dlg as unknown as HTMLDialogElement)
    expect(classes.has('closing')).toBe(true)
    expect(dlg.open).toBe(true)
    listeners.get('animationend')!({ target: {} } as unknown as Event)
    expect(dlg.open).toBe(true)
    listeners.get('animationend')!({ target: dlg } as unknown as Event)
    expect(dlg.closeCalls).toBe(1)
    expect(classes.has('closing')).toBe(false)
    vi.runAllTimers()
    expect(dlg.closeCalls).toBe(1)
  })

  it('falls back to a timer when no animation ends', () => {
    vi.useFakeTimers()
    const { dlg } = fakeDialog()
    closeDialog(dlg as unknown as HTMLDialogElement)
    closeDialog(dlg as unknown as HTMLDialogElement)
    vi.advanceTimersByTime(250)
    expect(dlg.closeCalls).toBe(1)
  })

  it('abandons the pending close when reopened during the exit', () => {
    vi.useFakeTimers()
    const { dlg } = fakeDialog()
    closeDialog(dlg as unknown as HTMLDialogElement)
    expect(reopenDialog(dlg as unknown as HTMLDialogElement)).toBe(true)
    vi.advanceTimersByTime(250)
    expect(dlg.open).toBe(true)
    expect(dlg.closeCalls).toBe(0)
  })

  it('ignores a closed or missing dialog', () => {
    const { dlg } = fakeDialog()
    dlg.open = false
    closeDialog(dlg as unknown as HTMLDialogElement)
    closeDialog(null)
    expect(dlg.closeCalls).toBe(0)
  })
})
