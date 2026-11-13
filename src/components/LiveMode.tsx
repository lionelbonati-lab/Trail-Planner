import { ArrowLeft, Check, LocateFixed, Pencil } from 'lucide-react'
import { useEffect, useState } from 'react'
import { liveStatus, locate, plannedAt } from '../lib/live'
import { formatClock, formatDuration, zonedToUtc } from '../lib/time'
import type { Athlete, Race } from '../lib/types'
import { useRaceComputation } from './RacePlan'
import { Card, Hint } from './ui'

interface Props {
  race: Race
  athlete: Athlete
  onChange: (r: Race) => void
  onExit: () => void
}

/** Écart signé lisible : « +6 min » / « −3 min ». */
function signed(sec: number): string {
  const m = Math.round(sec / 60)
  if (Math.abs(m) < 60) return `${m > 0 ? '+' : m < 0 ? '−' : ''}${Math.abs(m)} min`
  return `${sec > 0 ? '+' : '−'}${formatDuration(Math.abs(sec))}`
}

function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(id)
  }, [ms])
  return now
}

/** Garde l'écran allumé tant que l'option est active (si le navigateur le permet). */
function useWakeLock(on: boolean) {
  useEffect(() => {
    if (!on || !('wakeLock' in navigator)) return
    let lock: { release(): Promise<void> } | null = null
    const request = () =>
      (navigator as unknown as { wakeLock: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock
        .request('screen')
        .then((l) => (lock = l))
        .catch(() => undefined)
    request()
    const onVis = () => document.visibilityState === 'visible' && request()
    document.addEventListener('visibilitychange', onVis)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      lock?.release().catch(() => undefined)
    }
  }, [on])
}

export function LiveMode({ race, athlete, onChange, onExit }: Props) {
  const { track, sim } = useRaceComputation(race, athlete)
  const now = useNow()
  const [awake, setAwake] = useState(true)
  const [gps, setGps] = useState<{ busy: boolean; text: string | null }>({ busy: false, text: null })
  useWakeLock(awake && !!race.live)
  const tz = race.env.timeZone

  const cutoffMs = (c: string) => (c ? zonedToUtc(c, tz).getTime() : null)
  const status = race.live && sim ? liveStatus(race.live, sim, now, (s) => cutoffMs(s.cp.cutoff)) : null

  if (!track || !sim) return <Card title={race.name}><p className="warn">Impossible de lire le GPX de cette course.</p></Card>

  const plannedStart = zonedToUtc(race.env.start, tz).getTime()
  const setLive = (live: Race['live']) => onChange({ ...race, live })
  const mark = (cpId: string, iso: string | null) => {
    if (!race.live) return
    const passages = { ...race.live.passages }
    if (iso) passages[cpId] = iso
    else delete passages[cpId]
    setLive({ ...race.live, passages })
  }

  if (!race.live || !status) {
    return (
      <div className="live">
        <button className="ghost" onClick={onExit}><ArrowLeft /> Plan</button>
        <Card title={`Mode course · ${race.name}`}>
          <p>Départ prévu {formatClock(new Date(plannedStart), tz, true)}. Le chrono démarre au moment choisi ; tu notes ensuite chaque passage d'un appui.</p>
          <div className="live-actions">
            <button className="primary big" onClick={() => setLive({ startedAt: new Date().toISOString(), passages: {} })}>▶ Départ maintenant</button>
            <button className="big" onClick={() => setLive({ startedAt: new Date(plannedStart).toISOString(), passages: {} })}>
              Départ à l'heure prévue ({formatClock(new Date(plannedStart), tz)})
            </button>
          </div>
          <Hint>Fonctionne sans réseau. Si tu es connecté, ton assistance voit tes passages en direct via le lien de partage.</Hint>
        </Card>
      </div>
    )
  }

  const t0 = Date.parse(race.live.startedAt)
  const next = status.rows.find((_, i) => i > status.lastIdx)
  const lastRow = status.lastIdx >= 0 ? status.rows[status.lastIdx] : null
  const clock = (s: number) => formatClock(new Date(t0 + s * 1000), tz)

  const editTime = (cpId: string, current: number | null) => {
    const def = formatClock(new Date(current !== null ? t0 + current * 1000 : Date.now()), tz)
    const txt = prompt('Heure de passage (hh:mm) — vide pour effacer', def)
    if (txt === null) return
    if (!txt.trim()) return mark(cpId, null)
    const m = /^(\d{1,2})[:h](\d{2})$/.exec(txt.trim())
    if (!m) return alert('Format attendu : hh:mm')
    // Date locale du jour (fuseau de la course), en reculant d'un jour si l'heure est dans le futur.
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
    let ms = zonedToUtc(`${day}T${m[1].padStart(2, '0')}:${m[2]}`, tz).getTime()
    if (ms > Date.now() + 3600000) ms -= 86400000
    mark(cpId, new Date(ms).toISOString())
  }

  const whereAmI = () => {
    if (!('geolocation' in navigator)) return setGps({ busy: false, text: 'Géolocalisation indisponible sur cet appareil.' })
    setGps({ busy: true, text: null })
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const from = lastRow ? lastRow.split.to : 0
        const d = locate(track, pos.coords.latitude, pos.coords.longitude, from)
        const delta = status.elapsed - plannedAt(sim, d)
        const nxt = status.rows.find((r) => r.split.to > d && r.actual === null)
        setGps({
          busy: false,
          text: `km ${(d / 1000).toFixed(1)} · ${signed(delta)} sur le plan${nxt ? ` · ${nxt.split.cp.name} dans ${((nxt.split.to - d) / 1000).toFixed(1)} km` : ''} (précision ${Math.round(pos.coords.accuracy)} m)`,
        })
      },
      (e) => setGps({ busy: false, text: `Position indisponible : ${e.message}` }),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 30000 },
    )
  }

  return (
    <div className="live">
      <div className="row">
        <button className="ghost" onClick={onExit}><ArrowLeft /> Plan</button>
        <strong>{race.name}</strong>
      </div>

      <section className="live-hero">
        <div className="live-label">Temps de course</div>
        <div className="live-clock">{formatDuration(status.elapsed, true)}</div>
        {lastRow && (
          <div className={`live-delta ${status.delta > 0 ? 'late' : 'early'}`}>
            {signed(status.delta)} au passage « {lastRow.split.cp.name} »
          </div>
        )}
        <div className="live-sub">Arrivée estimée {clock(status.finishEta)} ({formatDuration(status.finishEta)})</div>
      </section>

      {next && (
        <section className="live-next">
          <div className="live-label">Prochain point</div>
          <div className="live-next-name">{next.split.cp.name}</div>
          <div className="live-sub">
            km {(next.split.to / 1000).toFixed(1)} · +{Math.round(next.split.dPlus)} m / −{Math.round(next.split.dMinus)} m depuis le précédent
          </div>
          <div className="live-times">
            <span>Prévu <strong>{clock(next.planned)}</strong></span>
            <span>Estimé <strong>{clock(next.eta)}</strong></span>
            {next.cutoffMargin !== null && (
              <span className={next.cutoffMargin < 1800 ? 'danger' : ''}>Barrière : marge {signed(next.cutoffMargin).replace('+', '')}</span>
            )}
          </div>
          <button className="primary big" onClick={() => mark(next.split.cp.id, new Date().toISOString())}>
            <Check /> J'arrive à {next.split.cp.name}
          </button>
        </section>
      )}

      <div className="live-actions">
        <button onClick={whereAmI} disabled={gps.busy}>{gps.busy ? 'Localisation…' : <><LocateFixed /> Où suis-je ?</>}</button>
        <label className="toggle"><input type="checkbox" checked={awake} onChange={(e) => setAwake(e.target.checked)} /> Garder l'écran allumé</label>
      </div>
      {gps.text && <p className="hint">{gps.text}</p>}

      <Card title="Tous les points">
        <table className="table compact live-table">
          <thead>
            <tr><th>Point</th><th>Km</th><th>Prévu</th><th>Réel / estimé</th><th /></tr>
          </thead>
          <tbody>
            {status.rows.map((r) => (
              <tr key={r.split.cp.id} className={r.actual !== null ? 'done' : ''}>
                <td>{r.split.cp.name}</td>
                <td>{(r.split.to / 1000).toFixed(1)}</td>
                <td>{clock(r.planned)}</td>
                <td>
                  {r.actual !== null ? <strong>{clock(r.actual)}</strong> : <span className="muted">~{clock(r.eta)}</span>}
                  {r.actual !== null && <span className={`small ${r.actual > r.planned ? 'warn-text' : 'ok-text'}`}> {signed(r.actual - r.planned)}</span>}
                </td>
                <td><button className="ghost" onClick={() => editTime(r.split.cp.id, r.actual)} title="Saisir ou corriger l'heure" aria-label="Modifier l'heure"><Pencil /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <div className="row">
        <button className="ghost danger" onClick={() => confirm('Effacer le suivi (départ et passages) ?') && setLive(null)}>Réinitialiser le suivi</button>
      </div>
    </div>
  )
}
