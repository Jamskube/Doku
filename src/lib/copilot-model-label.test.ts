import { describe, expect, it } from 'vitest'
import { shortModelName } from './copilot-model-label'

describe('shortModelName', () => {
  it('garde famille et taille, retire variante et quantification', () => {
    expect(shortModelName('qwen2.5:1.5b-instruct-q4_0')).toBe('qwen2.5 1.5b')
    expect(shortModelName('hf.co/LiquidAI/LFM2-2.6B-GGUF:Q4_0')).toBe('LFM2-2.6B')
    expect(shortModelName('granite-embedding:latest')).toBe('granite-embedding')
    expect(shortModelName('gpt-5.6-luna')).toBe('gpt-5.6-luna')
    expect(shortModelName('Aucun modèle actif')).toBe('Aucun modèle actif')
  })
})
