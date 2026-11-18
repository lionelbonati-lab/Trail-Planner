import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ListLinkButtons } from '../../components/ListLinkButtons'
import { WatchPanel } from '../../components/WatchPanel'
import { DEFAULT_ATHLETE, newRace, normalizeAthlete } from '../defaults'

const noop = () => {}

describe('onglet Montre', () => {
  const race = { ...newRace('Trail du Jura', ''), id: 'r1' }

  it('connecté : code à 8 chiffres, où le saisir, course sur la montre, applis', () => {
    const athlete = normalizeAthlete({ ...DEFAULT_ATHLETE, watchId: 'abc123', epCode: '12345678', watchRaceId: 'r1' })
    const html = renderToStaticMarkup(<WatchPanel athlete={athlete} onChange={noop} signedIn onWatch={race} onOpen={noop} />)
    expect(html).toContain('1234 5678')
    expect(html).toContain('Champs Connect IQ › Trail Planner › Code montre')
    expect(html).toContain('Allure › Trail Planner')
    expect(html).toContain('abc123')
    // Code pour Garmin Connect en tête de l'onglet, avant le lien permanent.
    expect(html.indexOf('Code pour Garmin Connect')).toBeGreaterThanOrEqual(0)
    expect(html.indexOf('Code pour Garmin Connect')).toBeLessThan(html.indexOf('Lien d’assistance permanent'))
    expect(html).toContain('Trail du Jura')
    expect(html).toContain('EndurancePro')
    expect(html).toContain('installation par câble')
    // Lien d'assistance permanent du coureur.
    expect(html).toContain('Lien d’assistance permanent')
    expect(html).toContain('href="#/suivi/abc123"')
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
