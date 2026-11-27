// Question rapide à Doku-San depuis l'îlot de la barre de titre (mode « Siri »).
// Aucune plomberie de fournisseur ici : la question part par `sendChat`, comme depuis le
// panneau, dans une VRAIE discussion du store copilote — l'échange est enregistré dès le
// départ, « Continuer dans Doku-San » n'a donc qu'à ouvrir le panneau.
import { copilot, newChat, sendChat, stopChat, type ChatMsg } from './copilot.svelte'
import { conversations } from './copilot-conversations.svelte'
import { activeTab, openCopilot } from './stores.svelte'

export type QuickAskPhase = 'idle' | 'listening' | 'thinking' | 'answering' | 'done' | 'error'

const NO_MODEL = 'Aucun modèle actif — choisissez-en un dans Doku-San › Modèles.'

class QuickAskState {
  open = $state(false)
  question = $state('')
  error = $state('')
  // Phase de fond ; thinking → answering se lit sur la réponse elle-même (1er token).
  base = $state<QuickAskPhase>('idle')
  // Le tour assistant VIVANT du store copilote (proxy $state) : le flux s'y lit sans copie.
  reply = $state.raw<ChatMsg | null>(null)

  get phase(): QuickAskPhase {
    return this.base === 'thinking' && this.reply?.content ? 'answering' : this.base
  }

  get answer(): string {
    return this.base === 'error' ? '' : this.reply?.content ?? ''
  }
}

export const quickAsk = new QuickAskState()

// Jeton de course : une réponse qui revient après fermeture ne réécrit rien.
let run = 0
// Discussion ouverte par CETTE session de l'îlot : une question suivante la poursuit.
let session: string | null = null
// Échec de configuration (pas de modèle, compte absent) : « Continuer » mène aux Modèles.
let needsSetup = false

function inFlight(): boolean {
  return quickAsk.base === 'thinking'
}

export function openQuickAsk(): void {
  if (quickAsk.open) return
  run++
  session = null
  needsSetup = false
  quickAsk.open = true
  quickAsk.base = 'listening'
  quickAsk.question = ''
  quickAsk.error = ''
  quickAsk.reply = null
}

function reset(): void {
  run++
  quickAsk.open = false
  quickAsk.base = 'idle'
  quickAsk.question = ''
  quickAsk.error = ''
  quickAsk.reply = null
}

export function closeQuickAsk(): void {
  if (inFlight()) stopChat()
  reset()
}

function fail(message: string): void {
  quickAsk.error = message
  quickAsk.base = 'error'
}

async function prepareConversation(): Promise<void> {
  const busy = 'Doku-San répond déjà dans le panneau. Attendez la fin de sa réponse.'
  if (copilot.generating) throw new Error(busy)
  if (session && conversations.activeId === session) return
  if (!(await newChat())) throw new Error('La discussion en cours n’a pas pu être enregistrée.')
  if (copilot.generating) throw new Error(busy)
}

export async function submitQuickAsk(q: string): Promise<void> {
  const question = q.trim()
  if (!question || inFlight()) return
  const id = ++run
  quickAsk.open = true
  quickAsk.question = question
  quickAsk.error = ''
  quickAsk.reply = null
  quickAsk.base = 'thinking'
  needsSetup = false
  try {
    await prepareConversation()
    if (id !== run) return
    const before = copilot.messages.length
    const tab = activeTab()
    const done = sendChat(question, { name: tab?.name ?? null, text: tab?.content ?? '', kind: tab?.kind ?? 'md', path: tab?.path ?? null }, 'doc')
    // sendChat pousse question + réponse AVANT son premier await : le tour est déjà là.
    const reply = copilot.messages.length > before ? copilot.messages.at(-1) : undefined
    if (reply?.role !== 'assistant') throw new Error('Doku-San n’a pas pu prendre la question.')
    session = conversations.activeId
    quickAsk.reply = reply
    await done
    if (id !== run) return
    if (reply.config) {
      needsSetup = true
      fail(reply.config === 'model' ? NO_MODEL : reply.content)
    } else if (reply.failed) fail(reply.content || 'Doku-San n’a pas pu répondre.')
    else if (!reply.content) fail('Réponse interrompue.')
    else quickAsk.base = 'done'
  } catch (error) {
    if (id !== run) return
    fail(error instanceof Error ? error.message : 'Doku-San n’a pas pu répondre.')
  }
}

// Le panneau prend le relais de la MÊME discussion ; une réponse encore en flux continue
// d'y arriver (on referme l'îlot sans l'interrompre).
export function continueInCopilot(): void {
  openCopilot(needsSetup ? 'models' : 'chat')
  reset()
}
