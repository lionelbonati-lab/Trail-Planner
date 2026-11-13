import { useState } from 'react'
import { computeCs, predictTime, PROTOCOLS } from '../lib/cs'
import { csFromTrials } from '../lib/sessions'
import { formatDuration, formatPace, parseDuration } from '../lib/time'
import type { Athlete } from '../lib/types'
import { Card, Hint } from './ui'

interface Row {
  time: string
  dist: string
}

const proto = PROTOCOLS[0]

export function CsCalculator({ athlete, onChange }: { athlete: Athlete; onChange: (a: Athlete) => void }) {
  const [rows, setRows] = useState<Row[]>(
    proto.trials.map((t) => ({ time: formatDuration(t.value, true).replace(/^0:/, ''), dist: '' })),
  )
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))

  const trials = rows
    .map((r) => ({ time: parseDuration(r.time) ?? 0, dist: parseFloat(r.dist.replace(',', '.')) || 0 }))
    .filter((t) => t.time > 0 && t.dist > 0)
  const res = computeCs(trials)

  const apply = () => {
    if (!res) return
    onChange({
      ...athlete,
      cs: res.cs,
      dPrime: Math.max(0, res.dPrime),
      history: [
        {
          id: crypto.randomUUID(),
          date,
          protocol: proto.id,
          trials,
          cs: res.cs,
          dPrime: res.dPrime,
          r2: res.r2,
        },
        ...athlete.history,
      ],
    })
  }

  return (
    <div className="grid two">
      <Card title={`Test ${proto.label}`}>
        <Hint>{proto.description}</Hint>
        <table className="table">
          <thead>
            <tr>
              <th>Essai</th>
              <th>Durée (m:ss)</th>
              <th>Distance (m)</th>
              <th>Allure</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const t = parseDuration(r.time) ?? 0
              const d = parseFloat(r.dist.replace(',', '.')) || 0
              return (
                <tr key={i}>
                  <td>{i + 1}</td>
                  <td>
                    <input
                      type="text"
                      value={r.time}
                      onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, time: e.target.value } : x)))}
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={r.dist}
                      placeholder="ex. 1050"
                      onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, dist: e.target.value } : x)))}
                    />
                  </td>
                  <td>{t > 0 && d > 0 ? formatPace(t / (d / 1000)) : '—'}</td>
                  <td>
                    {rows.length > 2 && (
                      <button className="ghost" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                        ✕
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <button className="ghost" onClick={() => setRows([...rows, { time: '', dist: '' }])}>
          + Ajouter un essai
        </button>
        {athlete.csTrials.length > 0 && (
          <button
            className="ghost"
            onClick={() => {
              const fit = csFromTrials(athlete.csTrials)
              const used = fit?.used ?? [...athlete.csTrials].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3)
              setRows(used.sort((a, b) => a.seconds - b.seconds).map((t) => ({ time: formatDuration(t.seconds, true).replace(/^0:/, ''), dist: String(t.dist) })))
            }}
            title="Reprend les distances de tes tests importés dans Séances → Test VC"
          >
            Charger mes tests
          </button>
        )}
      </Card>

      <Card title="Résultat">
        {res ? (
          <>
            <div className="kpis">
              <Kpi label="VC" value={`${formatPace(1000 / res.cs)}/km`} sub={`${(res.cs * 3.6).toFixed(2)} km/h`} />
              <Kpi label="D′" value={`${Math.round(res.dPrime)} m`} />
              <Kpi
                label="R²"
                value={res.r2.toFixed(4)}
                sub={res.csSe !== null ? `± ${formatPace(1000 / res.cs - 1000 / (res.cs + res.csSe))} sur VC` : undefined}
              />
            </div>
            {res.r2 < 0.99 && trials.length > 2 && (
              <p className="warn">R² faible : un des essais n'est probablement pas maximal ou mal mesuré.</p>
            )}
            {res.dPrime < 50 && <p className="warn">D′ très faible : vérifie les distances saisies.</p>}
            <table className="table compact">
              <thead>
                <tr>
                  <th>Prédiction</th>
                  {[1500, 3000, 5000, 10000].map((d) => (
                    <th key={d}>{d >= 1000 ? `${d / 1000} km` : `${d} m`}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Temps</td>
                  {[1500, 3000, 5000, 10000].map((d) => (
                    <td key={d}>{formatDuration(predictTime(res.cs, res.dPrime, d), true)}</td>
                  ))}
                </tr>
              </tbody>
            </table>
            <Hint>Les prédictions sont fiables entre 2 et 30 min d'effort environ.</Hint>
            <div className="row">
              <label className="field inline">
                <span className="field-label">Date du test</span>
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </label>
              <button className="primary" onClick={apply}>
                Appliquer au profil et enregistrer
              </button>
            </div>
          </>
        ) : (
          <p className="muted">Saisis au moins deux essais (durée et distance).</p>
        )}
      </Card>

      <Card title="Historique des tests" className="span2">
        {athlete.history.length === 0 ? (
          <p className="muted">Aucun test enregistré.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>VC</th>
                <th>km/h</th>
                <th>D′</th>
                <th>R²</th>
                <th>Essais</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {athlete.history.map((h) => (
                <tr key={h.id}>
                  <td>{h.date}</td>
                  <td>{formatPace(1000 / h.cs)}/km</td>
                  <td>{(h.cs * 3.6).toFixed(2)}</td>
                  <td>{Math.round(h.dPrime)} m</td>
                  <td>{h.r2.toFixed(3)}</td>
                  <td className="muted">{h.trials.map((t) => `${formatDuration(t.time, true)} → ${t.dist} m`).join(' · ')}</td>
                  <td>
                    <button
                      className="ghost"
                      onClick={() => onChange({ ...athlete, history: athlete.history.filter((x) => x.id !== h.id) })}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  )
}

export function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  )
}
