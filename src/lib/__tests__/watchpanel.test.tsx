import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ListLinkButtons } from '../../components/ListLinkButtons'
import { WatchPanel } from '../../components/WatchPanel'
import { DEFAULT_ATHLETE, newRace, normalizeAthlete } from '../defaults'

const noop = () => {}

describe('onglet Montre', () => {
  const race = { ...newRace('Trail du Jura', ''), id: 'r1' }

  it('connecté : sous-page Synchro d’abord, code en haut, où le saisir dans un (i), course sur la montre', () => {
    const athlete = normalizeAthlete({ ...DEFAULT_ATHLETE, watchId: 'abc123', epCode: '12345678', watchRaceId: 'r1' })
    const html = renderToStaticMarkup(<WatchPanel athlete={athlete} onChange={noop} signedIn onWatch={race} onOpen={noop} />)
    // Sous-pages : Synchro, Applications, EndurancePro ; Synchro ouverte.
    expect(html).toMatch(/role="tab" aria-selected="true" class="on">Synchro</)
    expect(html).toContain('>Applications<')
    expect(html).toContain('>EndurancePro<')
    // Code en premier, avant la course sur la montre.
    expect(html).toContain('1234 5678')
    expect(html.indexOf('1234 5678')).toBeLessThan(html.indexOf('Trail du Jura'))
    expect(html).toContain('aria-label="Où saisir le code"')
    expect(html).toContain('abc123')
    // Code pour Garmin Connect en tête de la sous-page, avant le lien permanent.
    expect(html.indexOf('Code pour Garmin Connect')).toBeGreaterThanOrEqual(0)
    expect(html.indexOf('Code pour Garmin Connect')).toBeLessThan(html.indexOf('1234 5678'))
    expect(html.indexOf('Code pour Garmin Connect')).toBeLessThan(html.indexOf('Lien d’assistance permanent'))
    // Lien d'assistance permanent du coureur.
    expect(html).toContain('href="#/suivi/abc123"')
    expect(html).toContain('Trail du Jura')
    // Consignes repliées dans les (i), plus affichées en clair.
    expect(html).not.toContain('Champs Connect IQ › Trail Planner › Code montre')
    expect(html).not.toContain('installation par câble')
    // Retirer la course de la montre (sortie libre) ; sortie libre : position masquée près du départ par défaut.
    const withRemove = renderToStaticMarkup(<WatchPanel athlete={athlete} onChange={noop} signedIn onWatch={race} onOpen={noop} onRemove={noop} />)
    expect(withRemove).toContain('>Retirer</button>')
    expect(withRemove).toMatch(/type="checkbox" checked=""\/> Sortie libre : masquer ma position/)
  })

  it('connecté sans code : bouton pour le créer ; sans compte : invitation à se connecter', () => {
    const athlete = normalizeAthlete(DEFAULT_ATHLETE)
    expect(renderToStaticMarkup(<WatchPanel athlete={athlete} onChange={noop} signedIn onWatch={null} onOpen={noop} />)).toContain('Créer mon code')
    const out = renderToStaticMarkup(<WatchPanel athlete={athlete} onChange={noop} signedIn={false} onWatch={null} onOpen={noop} />)
    expect(out).toContain('Connecte-toi')
    expect(out).not.toContain('Créer mon code')
  })

  it('ligne de liste : ⌚ actif pour la course sur la montre, lien assistance', () => {
    const on = renderToStaticMarkup(<ListLinkButtons race={race} onWatchId="r1" onWatch={noop} onShare={noop} />)
    expect(on).toContain('on-watch')
    // Actif : un second appui la retire de la montre.
    expect(on).toContain('aria-label="Retirer de la montre"')
    expect(on).toContain('Copier le lien assistance')
    const off = renderToStaticMarkup(<ListLinkButtons race={race} onWatchId="autre" onWatch={noop} onShare={noop} />)
    expect(off).not.toContain('on-watch')
  })
})
