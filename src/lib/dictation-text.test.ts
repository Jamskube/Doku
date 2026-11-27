import { describe, expect, it } from 'vitest'
import { cleanDictation, collapseStutters, joinDictation, removeFillers } from './dictation-text'

describe('removeFillers (cas repris des tests de Handy)', () => {
  it('retire « euh » et rend la majuscule au mot suivant', () => {
    expect(removeFillers('Euh, donc je pense que oui.')).toBe(' Donc je pense que oui.')
    expect(removeFillers('Je pense, euh, que oui.')).toBe('Je pense,  que oui.')
  })
  it('ne touche pas aux mots qui contiennent un remplissage', () => {
    expect(removeFillers('Le heurtoir et la peuhl.')).toBe('Le heurtoir et la peuhl.')
    expect(removeFillers('humble hmmm')).toBe('humble hmmm')
  })
  it('ne retire pas une majuscule au milieu d’une phrase', () => {
    expect(removeFillers('Je dis Euh puis rien.')).toBe('Je dis  puis rien.')
  })
})

describe('collapseStutters', () => {
  it('trois répétitions ou plus → une', () => {
    expect(collapseStutters('je je je pense')).toBe('je pense')
    expect(collapseStutters('Je je JE je pense')).toBe('Je pense')
  })
  it('deux répétitions restent (« nous nous »)', () => {
    expect(collapseStutters('nous nous sommes vus')).toBe('nous nous sommes vus')
  })
})

describe('cleanDictation', () => {
  it('enchaîne nettoyage, ponctuation et espaces', () => {
    expect(cleanDictation('Euh, il faut faut faut appeler Camille, euh, demain.')).toBe('Il faut appeler Camille, demain.')
    expect(cleanDictation('  euh.  ')).toBe('')
  })
})

describe('joinDictation', () => {
  it('début de note, de ligne ou d’élément de liste : majuscule, sans espace', () => {
    expect(joinDictation('', 'bonjour.')).toBe('Bonjour.')
    expect(joinDictation('Titre\n', 'acheter du pain.')).toBe('Acheter du pain.')
    expect(joinDictation('# Courses\n- ', 'du pain')).toBe('Du pain')
  })
  it('milieu de phrase : espace et minuscule ; après un point : majuscule', () => {
    expect(joinDictation('Il faut appeler', 'Camille demain.')).toBe(' camille demain.')
    expect(joinDictation('Fini.', 'ensuite on part.')).toBe(' Ensuite on part.')
    expect(joinDictation('Fini. ', 'ensuite.')).toBe('Ensuite.')
  })
  it('sigles gardés, ponctuation collée', () => {
    expect(joinDictation('On parle de', 'SNCF et du reste.')).toBe(' SNCF et du reste.')
    expect(joinDictation('Oui', ', bien sûr.')).toBe(', bien sûr.')
  })
})
