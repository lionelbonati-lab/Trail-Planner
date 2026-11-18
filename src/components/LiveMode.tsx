import { ArrowLeft, Check, LocateFixed, LogOut, Pencil } from 'lucide-react'
import { useEffect, useState } from 'react'
import { awayFrom, inferredDeparture, liveStatus, locate, plannedAt } from '../lib/live'
import { isFreeStart } from '../lib/plan'
import { isRavitoKind } from '../lib/splits'
import { formatClock, formatDuration, pastClockToMs, zonedToUtc } from '../lib/time'
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
  const free = isFreeStart(race)
  const now = useNow()
  const [awake, setAwake] = useState(true)
  const [gps, setGps] = useState<{ busy: boolean; text: string | null }>({ busy: false, text: null })
  useWakeLock(awake && !!race.live)
  const tz = race.env.timeZone

  const cutoffMs = (c: string) => (c ? zonedToUtc(c, tz).getTime() : null)
  const status = race.live && sim ? liveStatus(race.live, sim, now, (s) => cutoffMs(s.cp.cutoff)) : null

  if (!track || !sim) return <Card title={race.name} fold={false}><p className="warn">Impossible de lire le GPX de cette course.</p></Card>

  const plannedStart = zonedToUtc(race.env.start, tz).getTime()
  const setLive = (live: Race['live']) => onChange({ ...race, live })
  const mark = (cpId: string, iso: string | null) => {
    if (!race.live) return
    const passages = { ...race.live.passages }
    if (iso) passages[cpId] = iso
    else delete passages[cpId]
    setLive({ ...race.live, passages })
  }

  // Départ libre : départ déjà pris (oubli du bouton) → heure saisie, jamais dans le futur.
  const startedEarlier = () => {
    const txt = prompt('Heure de départ (hh:mm)', formatClock(new Date(), tz))
    if (txt === null || !txt.trim()) return
    const ms = pastClockToMs(txt, tz)
    if (ms === null) return alert('Format attendu : hh:mm')
    setLive({ startedAt: new Date(Math.min(ms, Date.now())).toISOString(), passages: {} })
  }

  if (!race.live || !status) {
    return (
      <div className="live">
        <button className="ghost" onClick={onExit}><ArrowLeft /> Plan</button>
        <Card title={`Mode course · ${race.name}`} fold={false}>
          {free ? (
            <p>
              Départ libre : arrivée vers {formatClock(new Date(now + sim.totalTime * 1000), tz)} si tu pars maintenant.{' '}
              <Hint label="Mode course">
                Les heures du plan se calent sur ton départ. Le chrono démarre au moment choisi ; tu notes ensuite chaque passage d'un appui.
              </Hint>
            </p>
          ) : (
            <p>
              Départ prévu {formatClock(new Date(plannedStart), tz, true)}.{' '}
              <Hint label="Mode course">Le chrono démarre au moment choisi ; tu notes ensuite chaque passage d'un appui.</Hint>
            </p>
          )}
          <div className="live-actions">
            <button className="primary big" onClick={() => setLive({ startedAt: new Date().toISOString(), passages: {} })}>▶ Départ maintenant</button>
            {free ? (
              <button className="big" onClick={startedEarlier}>Déjà parti à…</button>
            ) : (
              <button className="big" onClick={() => setLive({ startedAt: new Date(plannedStart).toISOString(), passages: {} })}>
                Départ à l'heure prévue ({formatClock(new Date(plannedStart), tz)})
              </button>
            )}
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
    const ms = pastClockToMs(txt, tz)
    if (ms === null) return alert('Format attendu : hh:mm')
    mark(cpId, new Date(ms).toISOString())
  }

  // Départ d'un ravito (« Reparti » oublié ou appuyé en retard) : saisi ou corrigé, vide pour l'effacer.
  const editLeft = (cpId: string) => {
    const cur = race.live?.departures?.[cpId]
    const txt = prompt('Reparti du ravito à (hh:mm) — vide pour effacer', formatClock(cur ? new Date(cur) : new Date(), tz))
    if (txt === null || !race.live) return
    const departures = { ...race.live.departures }
    if (!txt.trim()) delete departures[cpId]
    else {
      const ms = pastClockToMs(txt, tz)
      if (ms === null) return alert('Format attendu : hh:mm')
      const arrived = race.live.passages[cpId]
      if (arrived && ms < Date.parse(arrived)) return alert("L'heure de départ doit suivre l'heure d'arrivée au ravito.")
      departures[cpId] = new Date(ms).toISOString()
    }
    setLive({ ...race.live, departures })
  }

  // Départ appuyé en retard (ou trop tôt) : heure corrigée, passages gardés.
  const fixStart = () => {
    const txt = prompt('Heure de départ (hh:mm)', formatClock(new Date(t0), tz))
    if (txt === null || !txt.trim()) return
    const ms = pastClockToMs(txt, tz)
    if (ms === null) return alert('Format attendu : hh:mm')
    setLive({ ...race.live!, startedAt: new Date(Math.min(ms, Date.now())).toISOString() })
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
        // « Reparti » oublié : position au-delà du ravito (150 m, 300 m après une base de vie) → départ noté,
        // à l'heure déduite du chemin fait depuis, au rythme du coureur (corrigeable au crayon).
        let leftTxt = ''
        const cp = lastRow?.split.cp
        if (lastRow && cp && race.live && lastRow.actual !== null && isRavitoKind(cp.kind) && !race.live.departures?.[cp.id] && d > lastRow.split.to + awayFrom(cp.kind)) {
          const ms = inferredDeparture(t0 + lastRow.actual * 1000, plannedAt(sim, d) - lastRow.split.departure, status.ratio, Date.now())
          setLive({ ...race.live, departures: { ...race.live.departures, [cp.id]: new Date(ms).toISOString() } })
          leftTxt = ` · départ de ${cp.name} noté vers ${formatClock(new Date(ms), tz)}`
        }
        setGps({
          busy: false,
          text: `km ${(d / 1000).toFixed(1)} · ${signed(delta)} sur le plan${nxt ? ` · ${nxt.split.cp.name} dans ${((nxt.split.to - d) / 1000).toFixed(1)} km` : ''}${leftTxt} (précision ${Math.round(pos.coords.accuracy)} m)`,
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

      {/* Au ravito (dernier passage noté, pas encore reparti) : temps sur place et bouton « Reparti »,
          envoyé à l'assistance (temps réellement passé au ravito). */}
      {lastRow && race.live && isRavitoKind(lastRow.split.cp.kind) && lastRow.actual !== null && !race.live.departures?.[lastRow.split.cp.id] && (() => {
        const arrived = race.live.passages[lastRow.split.cp.id]
        const sinceMin = Math.max(0, Math.round((now - Date.parse(arrived)) / 60000))
        const planned = Math.round(lastRow.split.cp.stopMin)
        return (
          <section className="live-next live-at">
            <div className="live-label">Au ravito</div>
            <div className="live-next-name">{lastRow.split.cp.name}</div>
            <div className={`live-sub ${planned > 0 && sinceMin > planned ? 'warn-text' : ''}`}>
              Depuis {sinceMin} min{planned > 0 ? ` · arrêt prévu ${planned} min` : ''}
            </div>
            <button
              className="primary big"
              onClick={() => setLive({ ...race.live!, departures: { ...race.live!.departures, [lastRow.split.cp.id]: new Date().toISOString() } })}
            >
              <LogOut /> Reparti de {lastRow.split.cp.name}
            </button>
          </section>
        )
      })()}

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
                  {r.actual !== null && isRavitoKind(r.split.cp.kind) && (() => {
                    // Départ du ravito : heure et temps passé, crayon pour le saisir ou le corriger.
                    const left = race.live?.departures?.[r.split.cp.id]
                    const stay = left ? Math.round((Date.parse(left) - (t0 + r.actual! * 1000)) / 60000) : null
                    return (
                      <div className="small">
                        {left ? <>Reparti {formatClock(new Date(left), tz)} · arrêt {stay} min</> : <span className="muted">Départ non noté</span>}{' '}
                        <button className="ghost inline-btn" onClick={() => editLeft(r.split.cp.id)} title="Saisir ou corriger l'heure de départ du ravito" aria-label={`Modifier le départ de ${r.split.cp.name}`}>
                          <Pencil />
                        </button>
                      </div>
                    )
                  })()}
                </td>
                <td><button className="ghost" onClick={() => editTime(r.split.cp.id, r.actual)} title="Saisir ou corriger l'heure" aria-label="Modifier l'heure"><Pencil /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <div className="row">
        <button className="ghost" onClick={fixStart} title="Bouton de départ appuyé trop tard ou trop tôt"><Pencil /> Corriger l'heure de départ</button>
        <button className="ghost danger" onClick={() => confirm('Effacer le suivi (départ et passages) ?') && setLive(null)}>Réinitialiser le suivi</button>
      </div>
    </div>
  )
}
