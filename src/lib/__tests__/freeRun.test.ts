import { describe, expect, it } from 'vitest'
import { appendTrack, freeAscent, freeRunShown, freeStats, isFreeRun, paceText, trackRoute } from '../freeRun'
import { reportFor } from '../share'

describe('sortie libre (rien sur la montre)', () => {
  const s = 1_800_000_000
  const r = { t: s + 3600, s, d: 10_000, lat: 45.1, lon: 6.2, bat: 81, p: 'a=420', v: 2 }

  it('relevé de sortie libre : chiffres, jamais pris pour une course', () => {
    expect(isFreeRun(r)).toBe(true)
    expect(isFreeRun({ ...r, v: 1 })).toBe(false)
    expect(freeAscent(r)).toBe(420)
    const st = freeStats(r, (r.t + 300) * 1000)
    expect(st).toMatchObject({ elapsed: 3600, dist: 10_000, ascent: 420, pace: 360, bat: 81, age: 300, live: true })
    expect(paceText(st.pace!)).toBe('6:00 /km')
    expect(freeStats(r, (r.t + 3600) * 1000).live).toBe(false)
    // Page d'une course : relevé ignoré (distance de l'activité, pas le long du parcours).
    expect(reportFor({ totalDist: 20_000 }, r, r.t * 1000)).toBeNull()
    // Lien permanent : montrée 12 h après le dernier relevé, plus ensuite.
    expect(freeRunShown(r, (r.t + 11 * 3600) * 1000)).toBe(true)
    expect(freeRunShown(r, (r.t + 13 * 3600) * 1000)).toBe(false)
  })

  it('trace : un point par relevé avec position, recommencée à la sortie suivante', () => {
    const a = appendTrack(null, r)!
    expect(a).toEqual({ s, pts: [{ t: r.t, lat: 45.1, lon: 6.2, d: 10_000 }] })
    // Même relevé réécrit : rien ; position masquée près du départ : rien.
    expect(appendTrack(a, r)).toBeNull()
    expect(appendTrack(a, { ...r, t: r.t + 300, lat: undefined, lon: undefined })).toBeNull()
    // Départ recalculé à une seconde près par la montre : même sortie.
    const b = appendTrack(a, { ...r, t: r.t + 300, s: s + 1, d: 11_000, lat: 45.11 })!
    expect(b.s).toBe(s)
    expect(b.pts.map((p) => p.d)).toEqual([10_000, 11_000])
    // Sortie du lendemain : nouvelle trace.
    expect(appendTrack(b, { ...r, s: s + 86400, t: s + 86400 + 600 })!.pts).toHaveLength(1)
    // Relevé d'une course : pas de trace.
    expect(appendTrack(null, { ...r, v: 1 })).toBeNull()
    // Carte : trace de la sortie et dernière position, dans l'ordre.
    const last = { ...r, t: r.t + 600, d: 12_000, lat: 45.12 }
    expect(trackRoute([b, { s: s - 86400, pts: [{ t: 1, lat: 0, lon: 0, d: 0 }] }], last)).toEqual([
      [10_000, 45.1, 6.2],
      [11_000, 45.11, 6.2],
      [12_000, 45.12, 6.2],
    ])
  })
})

describe('lien permanent : vue sortie libre', () => {
  it('chiffres, état et position masquée', async () => {
    const { renderToStaticMarkup } = await import('react-dom/server')
    const { createElement } = await import('react')
    const { FreeRunView } = await import('../../components/SharePage')
    const s = 1_800_000_000
    const r = { t: s + 5400, s, d: 15_300, bat: 64, p: 'a=812', v: 2 }
    const html = renderToStaticMarkup(createElement(FreeRunView, { codes: ['abc'], name: 'Lionel', report: r, nowMs: (r.t + 120) * 1000 }))
    expect(html).toContain('Sortie libre en cours')
    expect(html).toContain('Sortie de Lionel')
    expect(html).toContain('15,3 km')
    expect(html).toContain('812 m')
    expect(html).toContain('5:53 /km')
    expect(html).toContain('batterie 64 %')
    expect(html).toContain('Position masquée près du départ')
    const old = renderToStaticMarkup(createElement(FreeRunView, { codes: ['abc'], report: { ...r, lat: 45, lon: 6 }, nowMs: (r.t + 7200) * 1000 }))
    expect(old).toContain('Dernière sortie libre')
    expect(old).toContain('La trace se dessine')
  })
})
