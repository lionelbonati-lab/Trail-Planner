import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ShareView } from '../../components/SharePage'
import { DEFAULT_ATHLETE, newRace, normalizeAthlete } from '../defaults'
import { computePlan, scenarioWindows } from '../plan'
import { buildSnapshot } from '../share'
import { cleanMessage, latestMessage, MESSAGE_MAX, messageWait } from '../watchMessage'

describe('message à la montre', () => {
  it('texte nettoyé : une ligne, accents gardés, sans emoji, 60 caractères au plus', () => {
    expect(cleanMessage('  On est   au\nravito  ')).toBe('On est au ravito')
    expect(cleanMessage('Bien joué ! 💪🔥 Continue’')).toBe("Bien joué ! Continue'")
    expect(cleanMessage('Œufs, café, ça va ? « oui » “ok”')).toBe('Œufs, café, ça va ? « oui » "ok"')
    expect(cleanMessage('x'.repeat(80))).toHaveLength(MESSAGE_MAX)
    expect(cleanMessage('🙂')).toBe('')
  })

  it('dernier message des deux codes montre, avec les accusés de la montre', () => {
    const a = { id: 'm1', text: 'Bien joué !', t: 100 }
    const b = { id: 'm1', text: 'Bien joué !', t: 100, got: 400, read: 450 }
    expect(latestMessage([a, b])).toEqual({ id: 'm1', text: 'Bien joué !', t: 100, got: 400, read: 450 })
    // Nouveau message sur un code : les accusés de l'ancien ne comptent pas.
    const c = { id: 'm2', text: 'Appelle-nous', t: 200 }
    expect(latestMessage([c, b])).toEqual({ id: 'm2', text: 'Appelle-nous', t: 200 })
    expect(latestMessage([null, null])).toBeNull()
  })

  it('un message par minute', () => {
    expect(messageWait(null, 1000)).toBe(0)
    expect(messageWait({ id: 'm', text: 'x', t: 1000 }, 1015)).toBe(45)
    expect(messageWait({ id: 'm', text: 'x', t: 1000 }, 1061)).toBe(0)
  })

  it('page assistance : encadré seulement si la course est sur la montre', () => {
    const pts: string[] = []
    for (let d = 0; d <= 10000; d += 20) pts.push(`<trkpt lat="${45 + d / 111195}" lon="6"><ele>${500 + d / 40}</ele></trkpt>`)
    const race = newRace('Test', `<gpx><trk><trkseg>${pts.join('')}</trkseg></trk></gpx>`)
    const plain = normalizeAthlete({ ...DEFAULT_ATHLETE, name: 'L' })
    const onWatch = normalizeAthlete({ ...DEFAULT_ATHLETE, name: 'L', watchId: 'abcdef0123456789', watchRaceId: race.id })
    const snapOf = (a: typeof plain) => {
      const p = computePlan(race, a)!
      return buildSnapshot('uid', race, a, p.track, p.sim, scenarioWindows(p.track, a, p.opts))
    }
    const day = (sn: ReturnType<typeof snapOf>) => Date.parse(sn.start) - 3600000
    const sp = snapOf(plain)
    expect(renderToStaticMarkup(<ShareView snap={sp} report={null} nowMs={day(sp)} />)).not.toContain('Message à la montre')
    const sw = snapOf(onWatch)
    const html = renderToStaticMarkup(<ShareView snap={sw} report={null} nowMs={day(sw)} />)
    expect(html).toContain('Message à la montre')
    expect(html).toContain('On est au ravito')
    expect(html).toContain('maxLength="60"')
  })
})
