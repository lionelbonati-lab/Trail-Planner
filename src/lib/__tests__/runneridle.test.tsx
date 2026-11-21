import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { RunnerIdle } from '../../components/SharePage'

describe('lien permanent sans rien en cours ni à venir', () => {
  it('message bien visible et résumé de la dernière sortie', () => {
    const s = Math.round(Date.parse('2026-11-21T08:00:00Z') / 1000)
    const html = renderToStaticMarkup(<RunnerIdle name="Lionel" timeZone="Europe/Paris" report={{ t: s + 3540, s, d: 9000, p: 'a=150', v: 2 }} />)
    expect(html).toContain('Suivi de Lionel')
    expect(html).toContain('Aucune course en cours ni à venir')
    expect(html).toContain('Dernière sortie · samedi 21/11')
    expect(html).toContain('9,0 km')
    expect(html).toContain('D+ 150 m')
  })

  it('sans aucun relevé : le message seul', () => {
    const html = renderToStaticMarkup(<RunnerIdle report={null} />)
    expect(html).toContain('Aucune course en cours ni à venir')
    expect(html).not.toContain('Dernière sortie')
  })
})
