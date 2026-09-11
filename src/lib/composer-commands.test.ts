import { describe, expect, it } from 'vitest'
import { matchSlashCommand, slashQuery, suggestSlashCommands } from './composer-commands'

const action = (draft: string, terminal = false) => matchSlashCommand(draft, terminal)?.command.action

describe('commandes « / » du composeur', () => {
  it('arme un livrable et rend la demande sans la commande', () => {
    expect(matchSlashCommand('/pdf Fais un rapport', false)).toMatchObject({
      command: { action: { kind: 'mode', mode: 'pdf' } },
      rest: 'Fais un rapport',
    })
    expect(action('/schéma le flux audio')).toEqual({ kind: 'mode', mode: 'diagram' })
  })

  it('couvre aussi la recherche Web et le style, avec leur suite', () => {
    expect(matchSlashCommand('/web quelle météo demain', false)).toMatchObject({
      command: { action: { kind: 'web' } },
      rest: 'quelle météo demain',
    })
    expect(action('/bref explique la TVA')).toEqual({ kind: 'verbosity', value: 'brief' })
    expect(action('/détaillé explique la TVA')).toEqual({ kind: 'verbosity', value: 'detailed' })
  })

  it('accepte la commande seule quand elle est validée par Entrée', () => {
    expect(matchSlashCommand('/pdf', true)).toMatchObject({ rest: '' })
    expect(action('  /equilibre  ', true)).toEqual({ kind: 'verbosity', value: 'balanced' })
    expect(action('/presse-papiers', true)).toEqual({ kind: 'context', target: 'clipboard' })
  })

  it('n’ouvre jamais un dialogue en cours de phrase', () => {
    // `/fichiers mon texte` n'a aucun sens : la commande ouvre un sélecteur de fichiers.
    expect(matchSlashCommand('/fichiers mon texte', false)).toBeNull()
    expect(matchSlashCommand('/fichiers', true)).not.toBeNull()
  })

  it('ne bascule pas pendant la frappe, ni sur un mot qui commence pareil', () => {
    expect(matchSlashCommand('/p', false)).toBeNull()
    expect(matchSlashCommand('/pdf', false)).toBeNull()
    expect(matchSlashCommand('/pdfs mon rapport', false)).toBeNull()
    expect(matchSlashCommand('/inconnu vas-y', false)).toBeNull()
  })

  it('laisse intact ce qui n’est pas une commande en tête', () => {
    expect(matchSlashCommand('Explique /pdf à un débutant', false)).toBeNull()
    expect(matchSlashCommand('un chemin /usr/bin ?', false)).toBeNull()
  })
})

describe('autocomplétion', () => {
  it('reconnaît une commande en cours de frappe, et seulement là', () => {
    expect(slashQuery('/')).toBe('')
    expect(slashQuery('/p')).toBe('p')
    expect(slashQuery('/PDF')).toBe('pdf')
    expect(slashQuery('/presse-')).toBe('presse-')
    // Un espace clôt la commande : c'est `matchSlashCommand` qui prend le relais.
    expect(slashQuery('/pdf ')).toBeNull()
    expect(slashQuery('bonjour')).toBeNull()
    expect(slashQuery('a /pdf')).toBeNull()
  })

  it('propose les douze commandes sur une barre seule', () => {
    expect(suggestSlashCommands('').map((s) => s.token)).toEqual([
      'pdf', 'html', 'diagramme', 'reponse',
      'web', 'selection', 'fichiers', 'dossier', 'presse-papiers',
      'bref', 'equilibre', 'detaille',
    ])
  })

  it('affiche le nom QUI CORRESPOND, canonique ou alias', () => {
    // « p » ouvre trois portes : `pdf`, l'alias `page` de la page HTML, et `presse-papiers`.
    expect(suggestSlashCommands('p').map((s) => s.token)).toEqual(['pdf', 'page', 'presse-papiers'])
    expect(suggestSlashCommands('sch').map((s) => s.token)).toEqual(['schema'])
    expect(suggestSlashCommands('zz')).toEqual([])
  })
})
