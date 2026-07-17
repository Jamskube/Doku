import { isTauri } from './tauri'

export const OPENAI_MODEL = 'gpt-5.6-luna'

export interface OpenAiStatus {
  authenticated: boolean
  preferredModel: string
  preferredModelAvailable: boolean | null
  models: string[]
  error?: string
}

export interface OpenAiAuthStart {
  sessionId: string
  userCode: string
  verificationUrl: string
  expiresIn: number
  interval: number
}

export interface OpenAiAuthPoll {
  status: 'pending' | 'approved' | 'expired'
}

export interface OpenAiMessage {
  role: 'system' | 'developer' | 'user' | 'assistant'
  content: string
}

interface OpenAiStreamEvent {
  kind: 'delta' | 'done' | 'error'
  text?: string
}

interface OpenAiStreamOptions {
  reasoningEffort?: 'none' | 'low' | 'medium' | 'high'
}

function nativeOnly(): Error {
  return new Error('La connexion OpenAI est disponible uniquement dans l’application native.')
}

export async function getOpenAiStatus(): Promise<OpenAiStatus> {
  if (!isTauri) {
    return {
      authenticated: false,
      preferredModel: OPENAI_MODEL,
      preferredModelAvailable: null,
      models: [],
    }
  }
  const { invoke } = await import('@tauri-apps/api/core')
  return await invoke<OpenAiStatus>('openai_status')
}

export async function startOpenAiAuth(): Promise<OpenAiAuthStart> {
  if (!isTauri) throw nativeOnly()
  const { invoke } = await import('@tauri-apps/api/core')
  return await invoke<OpenAiAuthStart>('openai_auth_start')
}

export async function pollOpenAiAuth(sessionId: string): Promise<OpenAiAuthPoll> {
  if (!isTauri) throw nativeOnly()
  const { invoke } = await import('@tauri-apps/api/core')
  return await invoke<OpenAiAuthPoll>('openai_auth_poll', { sessionId })
}

export async function cancelOpenAiAuth(sessionId: string): Promise<void> {
  if (!isTauri) return
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('openai_auth_cancel', { sessionId })
}

export async function disconnectOpenAi(): Promise<void> {
  if (!isTauri) return
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('openai_disconnect')
}

export async function openOpenAiAuthPage(url: string): Promise<void> {
  if (!isTauri) throw nativeOnly()
  const { openUrl } = await import('@tauri-apps/plugin-opener')
  await openUrl(url)
}

async function streamOpenAi(
  input: OpenAiMessage[],
  onToken: (token: string) => void,
  signal?: AbortSignal,
  options: OpenAiStreamOptions = {},
): Promise<string> {
  if (!isTauri) throw nativeOnly()
  const { Channel, invoke } = await import('@tauri-apps/api/core')
  const requestId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
  const onEvent = new Channel<OpenAiStreamEvent>()
  let output = ''
  let streamError = ''

  onEvent.onmessage = (event) => {
    if (event.kind === 'delta' && event.text) {
      output += event.text
      onToken(event.text)
    } else if (event.kind === 'error') {
      streamError = event.text || 'La génération OpenAI a échoué.'
    }
  }

  const cancel = () => void invoke('cancel_openai', { requestId }).catch(() => {})
  if (signal?.aborted) return output
  signal?.addEventListener('abort', cancel, { once: true })
  try {
    await invoke('stream_openai', {
      request: {
        requestId,
        model: OPENAI_MODEL,
        input,
        reasoningEffort: options.reasoningEffort ?? 'low',
      },
      onEvent,
    })
    if (streamError && !signal?.aborted) throw new Error(streamError)
    return output
  } catch (error) {
    if (signal?.aborted) return output
    throw error
  } finally {
    signal?.removeEventListener('abort', cancel)
  }
}

export function openAiChat(
  messages: OpenAiMessage[],
  onToken: (token: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  return streamOpenAi(messages, onToken, signal, { reasoningEffort: 'low' })
}

export function openAiGenerate(
  prompt: string,
  onToken: (token: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  return streamOpenAi([{ role: 'user', content: prompt }], onToken, signal, { reasoningEffort: 'low' })
}
