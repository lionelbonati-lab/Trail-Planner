import { ArrowLeft, Check, ClipboardCopy, FileSpreadsheet, FileUp, Gauge, Pencil, Printer, RotateCcw, Smartphone, Trash2, Upload, Watch } from 'lucide-react'
import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { clockNear, compareReports, debriefCsv, debriefReport, debriefText, levelTarget, realTimeAt, signedGap, sortedDebriefs, type TimeSource } from '../lib/debrief'
import { importActivity } from '../lib/debriefImport'
import { download } from '../lib/exportGpx'
import { indexAt } from '../lib/gpx'
import { levelFromTime, type Effort, type LevelEstimate } from '../lib/level'
import { computePlan } from '../lib/plan'
import { simplifyRoute } from '../lib/routeGeo'
import { FINISH_ID } from '../lib/assist'
import { CHECKPOINT_LABELS, isRavitoKind } from '../lib/splits'
import { formatClock, formatDuration, formatPace } from '../lib/time'
import type { Athlete, Debrief, Race } from '../lib/types'
import { CourseProfile } from './CourseProfile'
import type { MapPoint } from './ShareMap'
import { Card, Hint } from './ui'

const ShareMap = lazy(() => import('./ShareMap'))

const gapClass = (sec: number | null) => (sec === null || Math.abs(sec) < 60 ? '' : sec > 0 ? 'late' : 'early')

const SOURCE: Record<TimeSource, { label: string; many: string; icon: typeof Watch }> = {
  watch: { label: 'relevé par la montre', many: 'relevés par la montre', icon: Watch },
  live: { label: 'noté en mode course', many: 'notés en mode course', icon: Smartphone },
  file: { label: "tiré de l'enregistrement importé", many: "tirés de l'enregistrement importé", icon: FileUp },
  edit: { label: 'corrigé à la main', many: 'corrigés à la main', icon: Pencil },
}

/** Copie dans le presse-papiers ; false si le navigateur la refuse. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/** Effort de la sortie pour l'estimation du niveau : « race » ou « z<indice> » (comme la carte Niveau). */
const effortOf = (v: string): Effort => (v === 'race' ? { kind: 'race' } : { kind: 'zone', index: Number(v.slice(1)) })

/**
 * Debrief d'une sortie : passages relevés (montre, mode course) comparés au plan d'alors, tronçons,
 * arrêts aux ravitos, profil et carte comme la page assistance, notes et niveau recalé.
 */
export function DebriefPage({
  race,
  athlete,
  debriefId,
  onChange,
  onAthleteChange,
  onBack,
}: {
  race: Race
  athlete: Athlete
  debriefId: string | null
  onChange: (r: Race) => void
  onAthleteChange: (a: Athlete) => void
  onBack: () => void
}) {
  const debrief = race.debriefs?.find((d) => d.id === debriefId)
  const plan = useMemo(() => computePlan(race, athlete), [race, athlete])
  const [effort, setEffort] = useState(race.kind === 'race' ? 'race' : 'z1')
  const [showMap, setShowMap] = useState(false)
  const [compareId, setCompareId] = useState('')
  const [info, setInfo] = useState<{ text: string; warn?: boolean } | null>(null)
  const [level, setLevel] = useState<{ est: LevelEstimate | null; busy: boolean; error: string | null }>({ est: null, busy: false, error: null })
  const set = (patch: Partial<Debrief>) =>
    debrief && onChange({ ...race, debriefs: (race.debriefs ?? []).map((d) => (d.id === debrief.id ? { ...d, ...patch } : d)) })
  // Ouvert : plus proposé en haut de la course.
  useEffect(() => {
    if (debrief && !debrief.seen) set({ seen: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- une fois à l'ouverture
  }, [debrief?.id])

  if (!debrief) {
    return (
      <Card title="Debrief introuvable" fold={false}>
        <p className="muted">Cette sortie n'existe plus.</p>
        <button onClick={onBack}><ArrowLeft /> Retour au parcours</button>
      </Card>
    )
  }

  const tz = race.env.timeZone
  const r = debriefReport(debrief)
  const long = r.plannedTotal > 20 * 3600 || (r.total ?? 0) > 20 * 3600
  const clock = (ms: number) => formatClock(new Date(ms), tz, long)
  const km = (m: number) => (m / 1000).toFixed(1).replace('.', ',')
  const sources = new Set(r.rows.map((x) => x.source).filter((x): x is TimeSource => !!x))
  const edits = debrief.edits ?? {}
  const notes = debrief.notes ?? {}
  const stopsKnown = r.stops.filter((s) => s.actual !== null)
  const target = levelTarget(r)
  // Comparaison avec une autre sortie sur ce parcours.
  const others = sortedDebriefs(race).filter((d) => d.id !== debrief.id)
  const other = others.find((d) => d.id === compareId)
  const cmp = other ? compareReports(r, debriefReport(other)) : null
  const shortDay = (ms: number) => new Intl.DateTimeFormat('fr-FR', { timeZone: tz, day: 'numeric', month: 'short', year: '2-digit' }).format(new Date(ms))
  const otherDay = other ? shortDay(debriefReport(other).start) : ''
  const fileName = `${race.name.replace(/[\\/:*?"<>|]+/g, ' ').trim()} - debrief ${new Date(r.start).toISOString().slice(0, 10)}`

  const editPassage = (id: string, name: string, ref: number, current: number | null) => {
    const txt = prompt(`Passage à ${name} (hh:mm) — vide pour l'effacer`, formatClock(new Date(current ?? ref), tz))
    if (txt === null) return
    let v: string | null = null
    if (txt.trim()) {
      const ms = clockNear(txt, tz, current ?? ref)
      if (ms === null) return alert('Format attendu : hh:mm')
      v = new Date(ms).toISOString()
    }
    set({ edits: { ...edits, passages: { ...edits.passages, [id]: v } } })
  }
  const editLeft = (id: string, name: string, arrived: number, current: number | null) => {
    const txt = prompt(`Reparti de ${name} à (hh:mm) — vide pour l'effacer`, formatClock(new Date(current ?? arrived), tz))
    if (txt === null) return
    let v: string | null = null
    if (txt.trim()) {
      const ms = clockNear(txt, tz, current ?? arrived)
      if (ms === null) return alert('Format attendu : hh:mm')
      if (ms < arrived) return alert("L'heure de départ doit suivre l'heure d'arrivée au ravito.")
      v = new Date(ms).toISOString()
    }
    set({ edits: { ...edits, departures: { ...edits.departures, [id]: v } } })
  }
  const undoPassage = (id: string) => {
    const passages = { ...edits.passages }
    delete passages[id]
    set({ edits: { ...edits, passages } })
  }
  const editStart = () => {
    const txt = prompt('Heure de départ (hh:mm)', formatClock(new Date(r.start), tz))
    if (txt === null || !txt.trim()) return
    const ms = clockNear(txt, tz, r.start)
    if (ms === null) return alert('Format attendu : hh:mm')
    set({ edits: { ...edits, start: new Date(ms).toISOString() } })
  }
  // Enregistrement de l'activité : complète cette sortie (sans écraser montre, mode course ni corrections).
  const importFile = async (files: FileList | null) => {
    const f = files?.[0]
    if (!f) return
    try {
      const res = importActivity(race, athlete, f.name, new Uint8Array(await f.arrayBuffer()), debrief.id)
      onChange(res.race)
      setInfo({ text: res.message })
    } catch (e) {
      setInfo({ text: (e as Error).message, warn: true })
    }
  }
  const copySummary = async () => {
    const ok = await copyText(debriefText(race.name, debrief, tz))
    setInfo({ text: ok ? 'Résumé copié : colle-le dans un message ou un e-mail.' : 'Copie refusée par le navigateur.', warn: !ok })
  }
  const remove = () => {
    if (!confirm('Supprimer ce debrief ? Les passages relevés et tes notes seront perdus.')) return
    onChange({ ...race, debriefs: (race.debriefs ?? []).filter((d) => d.id !== debrief.id) })
    onBack()
  }
  const estimate = () => {
    if (!plan || target === null) return
    setLevel({ est: null, busy: true, error: null })
    // Laisse s'afficher « Calcul… » : la recherche simule la sortie plusieurs dizaines de fois.
    setTimeout(() => {
      try {
        const est = levelFromTime(plan.track, athlete, plan.opts, target, effortOf(effort))
        setLevel({ est, busy: false, error: est ? null : 'Temps hors d’atteinte du modèle : vérifie les passages et l’effort choisi.' })
      } catch (e) {
        setLevel({ est: null, busy: false, error: (e as Error).message })
      }
    }, 30)
  }

  // Profil et carte du parcours (tracé actuel), écart au plan à chaque point.
  const stride = plan ? Math.max(1, Math.floor(plan.track.points.length / 300)) : 1
  const profile: [number, number][] = plan ? plan.track.points.filter((_, i) => i % stride === 0).map((p) => [p.dist, p.ele]) : []
  const route = plan ? simplifyRoute(plan.track.points) : []
  const mapPoints: MapPoint[] = r.rows.map((x) => ({
    dist: x.point.dist,
    kind: x.point.kind,
    done: x.actual !== null,
    text: `${x.point.name} · km ${km(x.point.dist)} · ${x.actual !== null ? `passé à ${clock(x.actual)} (${signedGap(x.delta!)})` : 'passage non relevé'}`,
  }))
  const passageAt = (d: number) => {
    const t = realTimeAt(r, d)
    return { when: t !== null ? clock(t) : 'pas de passage relevé', passed: t !== null }
  }

  return (
    <div className="plan debrief">
      <div className="crumbs no-print">
        <a href={`#/parcours/${race.id}`}><ArrowLeft className="inline" /> {race.name}</a>
      </div>
      <Card
        title={`Debrief · ${race.name}`}
        fold={false}
        actions={
          <>
            <button onClick={editStart} title="Départ appuyé en retard ou trop tôt"><Pencil /> Corriger le départ</button>
            <button className="ghost danger" onClick={remove}><Trash2 /> Supprimer</button>
          </>
        }
      >
        <p className="muted">
          Sortie du {new Intl.DateTimeFormat('fr-FR', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(r.start))}, départ{' '}
          {formatClock(new Date(r.start), tz)} · {km(r.rows[r.rows.length - 1]?.point.dist ?? 0)} km
        </p>
        <div className="kpis">
          <div className="kpi">
            <div className="kpi-label">Arrivée</div>
            <div className="kpi-value">{r.finish !== null ? clock(r.finish) : '—'}</div>
            <div className="kpi-sub">{r.finish !== null ? `prévue ${clock(r.start + r.plannedTotal * 1000)}` : 'pas relevée'}</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Temps</div>
            <div className="kpi-value">{r.total !== null ? formatDuration(r.total) : '—'}</div>
            <div className="kpi-sub">prévu {formatDuration(r.plannedTotal)}</div>
          </div>
          {r.total !== null && (
            <div className="kpi">
              <div className="kpi-label">Écart au plan</div>
              <div className={`kpi-value ${gapClass(r.total - r.plannedTotal)}`}>{signedGap(r.total - r.plannedTotal)}</div>
              <div className="kpi-sub">{r.total > r.plannedTotal ? 'plus lent que prévu' : 'plus rapide que prévu'}</div>
            </div>
          )}
          {stopsKnown.length > 0 && (
            <div className="kpi">
              <div className="kpi-label">Arrêts aux ravitos</div>
              <div className="kpi-value">{formatDuration(stopsKnown.reduce((a, s) => a + s.actual!, 0))}</div>
              <div className="kpi-sub">prévu {formatDuration(stopsKnown.reduce((a, s) => a + s.planned, 0))} ({stopsKnown.length} ravito{stopsKnown.length > 1 ? 's' : ''})</div>
            </div>
          )}
        </div>
        <p className="small muted">
          {sources.size
            ? `Passages ${[...sources].map((s) => SOURCE[s].many).join(', ')}. Touche une heure pour la corriger.`
            : 'Aucun passage relevé : saisis-les ou importe l’enregistrement.'}
        </p>
        <div className="row no-print debrief-tools">
          <label className="button" title="FIT ou GPX de ta montre : passages manquants et arrêts aux ravitos (rien n'est écrasé)">
            <Upload /> Compléter avec l'enregistrement
            <input type="file" accept=".gpx,.fit,application/gpx+xml" hidden onChange={(e) => { void importFile(e.target.files); e.target.value = '' }} />
          </label>
          <button onClick={() => window.print()} title="Feuille A4 : « Enregistrer en PDF » dans la fenêtre d'impression"><Printer /> PDF / imprimer</button>
          <button onClick={() => download(`${fileName}.csv`, debriefCsv(race.name, debrief, tz), 'text/csv;charset=utf-8')} title="Passages, tronçons et arrêts pour Excel ou Google Sheets"><FileSpreadsheet /> Tableur (CSV)</button>
          <button onClick={() => void copySummary()} title="Résumé texte à coller dans un message"><ClipboardCopy /> Copier le résumé</button>
        </div>
        {info && <p className={info.warn ? 'warn' : 'small ok-text'} role="status">{info.text}</p>}
        {others.length > 0 && (
          <label className="field no-print compare-pick">
            <span className="field-label">Comparer avec une autre sortie</span>
            <select value={compareId} onChange={(e) => setCompareId(e.target.value)} aria-label="Comparer avec une autre sortie">
              <option value="">— aucune —</option>
              {others.map((d) => {
                const o = debriefReport(d)
                return <option key={d.id} value={d.id}>{shortDay(o.start)}{o.total !== null ? ` · ${formatDuration(o.total)}` : ''}</option>
              })}
            </select>
          </label>
        )}
        {cmp?.total && (
          <p className="compare-total">
            Par rapport au {otherDay} ({formatDuration(cmp.total.other)}) : <strong className={gapClass(cmp.total.diff)}>{signedGap(cmp.total.diff).replace("à l'heure", 'même temps')}</strong>
          </p>
        )}
      </Card>

      {profile.length > 1 && (
        <Card title="Profil" fold={false}>
          <CourseProfile
            profile={profile}
            rows={r.rows.map((x) => ({ id: x.point.id, name: x.point.name, kind: x.point.kind, dist: x.point.dist, delta: x.delta }))}
            position={null}
            readout={(d) => {
              const t = realTimeAt(r, d)
              const p = plan!.track.points[indexAt(plan!.track.points, d)]
              return `km ${km(d)} · ${Math.round(p.ele)} m · ${t !== null ? `passé vers ${clock(t)}` : 'pas de passage relevé'}`
            }}
          />
          <Hint>Sous chaque point : avance (vert) ou retard (orange) sur le plan, recalé sur ton vrai départ.</Hint>
        </Card>
      )}

      {route.length >= 2 && (
        <Card title="Carte" fold={false} className="no-print">
          {/* Carte chargée à la demande (comme sur la page assistance). */}
          <label className="check map-toggle">
            <input type="checkbox" checked={showMap} onChange={(e) => setShowMap(e.target.checked)} /> Afficher la carte
          </label>
          {showMap && (
            <Suspense fallback={<div className="share-map share-map-loading" />}>
              <ShareMap route={route} points={mapPoints} runner={null} passageAt={passageAt} title="Parcours et passages" />
            </Suspense>
          )}
        </Card>
      )}

      <Card title="Temps de passage" fold={false}>
        <div className="scroll">
          <table className="table debrief-table">
            <thead>
              <tr><th>Point</th><th>Prévu</th><th>Réel</th><th>Écart</th>{cmp && <th>vs {otherDay}</th>}</tr>
            </thead>
            {r.rows.map((x) => {
              const g = cmp?.points.get(x.point.id)
              const Src = x.source ? SOURCE[x.source].icon : null
              const ravito = isRavitoKind(x.point.kind) || x.point.stop > 0
              return (
                <tbody key={x.point.id} className="debrief-point">
                  <tr>
                    <td>
                      <strong>{x.point.name}</strong>
                      <div className="small muted">
                        km {km(x.point.dist)}
                        {x.point.id !== FINISH_ID && CHECKPOINT_LABELS[x.point.kind] && CHECKPOINT_LABELS[x.point.kind] !== x.point.name ? ` · ${CHECKPOINT_LABELS[x.point.kind]}` : ''}
                      </div>
                    </td>
                    <td>{clock(x.planned)}</td>
                    <td>
                      <button className="link time-edit" onClick={() => editPassage(x.point.id, x.point.name, x.planned, x.actual)} title="Corriger l'heure de passage">
                        {x.actual !== null ? clock(x.actual) : '—'}
                      </button>
                      {Src && <Src className="inline src-icon" aria-label={SOURCE[x.source!].label} />}
                      {x.source === 'edit' && edits.passages?.[x.point.id] !== undefined && (
                        <button className="ghost inline-btn" onClick={() => undoPassage(x.point.id)} title="Revenir à l'heure relevée" aria-label="Revenir à l'heure relevée"><RotateCcw /></button>
                      )}
                      {ravito && x.actual !== null && x !== r.rows[r.rows.length - 1] && (
                        <div className="small">
                          <button className="link time-edit" onClick={() => editLeft(x.point.id, x.point.name, x.actual!, x.left)} title="Corriger l'heure de départ du ravito">
                            {x.left !== null ? `reparti ${clock(x.left)}` : 'reparti —'}
                          </button>
                        </div>
                      )}
                    </td>
                    <td className={`nowrap ${gapClass(x.delta)}`}>
                      {x.delta !== null ? signedGap(x.delta) : ''}
                      {/* Marge sur la barrière horaire du point. */}
                      {x.margin !== null && (
                        <div className={`small ${x.margin < 0 ? 'warn-text' : 'muted'}`} title="Barrière horaire">
                          {x.margin >= 0 ? `marge ${formatDuration(x.margin)}` : `hors délai ${formatDuration(-x.margin)}`}
                        </div>
                      )}
                    </td>
                    {cmp && (
                      <td className={`nowrap ${g ? gapClass(g.diff) : ''}`}>
                        {g ? signedGap(g.diff).replace("à l'heure", '=').replace(' min', '′') : '—'}
                        {g && <div className="small muted">{formatDuration(g.other)}</div>}
                      </td>
                    )}
                  </tr>
                  {/* Note du point sur toute la largeur (lisible sur téléphone). */}
                  <tr className="note-row">
                    <td colSpan={cmp ? 5 : 4}>
                      <input
                        type="text"
                        className="note-input"
                        value={notes[x.point.id] ?? ''}
                        placeholder="Ressenti, souci…"
                        aria-label={`Note pour ${x.point.name}`}
                        onChange={(e) => set({ notes: { ...notes, [x.point.id]: e.target.value } })}
                      />
                      {notes[x.point.id] && <span className="print-only">{notes[x.point.id]}</span>}
                    </td>
                  </tr>
                </tbody>
              )
            })}
          </table>
        </div>
      </Card>

      <Card title="Tronçons" fold={false}>
        <div className="scroll">
          <table className="table">
            <thead>
              <tr><th>Tronçon</th><th>Prévu</th><th>Réel</th><th>Écart</th><th>Allure</th>{cmp && <th>vs {otherDay}</th>}</tr>
            </thead>
            <tbody>
              {r.legs.map((l, i) => (
                <tr key={i}>
                  <td>
                    {l.from} → {l.to}
                    <div className="small muted">
                      {l.km.toFixed(1).replace('.', ',')} km · +{l.up} / −{l.down} m{l.withStop ? ' · arrêt au départ compris' : ''}
                    </div>
                  </td>
                  <td>{formatDuration(l.planned)}</td>
                  <td>{l.actual !== null ? formatDuration(l.actual) : '—'}</td>
                  <td className={`nowrap ${gapClass(l.actual !== null ? l.actual - l.planned : null)}`}>{l.actual !== null ? signedGap(l.actual - l.planned) : ''}</td>
                  <td className="nowrap">
                    {l.actual !== null && l.km > 0 ? `${formatPace(l.actual / l.km)}/km` : '—'}
                    <div className="small muted">prévu {l.km > 0 ? `${formatPace(l.planned / l.km)}/km` : '—'}</div>
                  </td>
                  {cmp && (() => {
                    const g = cmp.legs.get(l.id)
                    return (
                      <td className={`nowrap ${g ? gapClass(g.diff) : ''}`}>
                        {g ? signedGap(g.diff).replace("à l'heure", '=').replace(' min', '′') : '—'}
                        {g && <div className="small muted">{formatDuration(g.other)}</div>}
                      </td>
                    )
                  })()}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {r.stops.length > 0 && (
        <Card title="Arrêts aux ravitos" fold={false}>
          <div className="scroll">
            <table className="table">
              <thead>
                <tr><th>Ravito</th><th>Prévu</th><th>Réel</th><th>Écart</th></tr>
              </thead>
              <tbody>
                {r.stops.map((s) => (
                  <tr key={s.point.id}>
                    <td>{s.point.name}</td>
                    <td>{formatDuration(s.planned)}</td>
                    <td>{s.actual !== null ? formatDuration(s.actual) : '—'}</td>
                    <td className={`nowrap ${gapClass(s.actual !== null ? s.actual - s.planned : null)}`}>{s.actual !== null ? signedGap(s.actual - s.planned) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Hint>Temps réel : de l'arrivée au départ du ravito (« Reparti » du mode course, 2e tour Lap de la montre, ou corrigé ici).</Hint>
        </Card>
      )}

      <Card title="Bilan" fold={false}>
        <textarea
          className="debrief-note"
          rows={4}
          value={debrief.note ?? ''}
          placeholder="Ce qui a marché, ce qui a coincé (allure, nutrition, matériel, météo)…"
          aria-label="Bilan de la sortie"
          onChange={(e) => set({ note: e.target.value })}
        />
        {debrief.note && <p className="print-only debrief-note-print">{debrief.note}</p>}
      </Card>

      {target !== null && plan && (
        <Card title="Recaler mon niveau" fold={false} className="no-print">
          <Hint>
            L'app cherche le niveau qui redonne ton temps sur ce parcours, puis prédit tes prochains temps avec.
            Temps retenu : {formatDuration(target)}
            {target !== r.total ? ` (temps d'arrivée ${formatDuration(r.total!)}, arrêts réels remplacés par les arrêts prévus)` : ' (temps d’arrivée)'}.
          </Hint>
          <div className="row">
            <label className="field">
              <span className="field-label">Effort de cette sortie</span>
              <select value={effort} onChange={(e) => setEffort(e.target.value)} aria-label="Effort de la sortie">
                <option value="race">Course (à fond)</option>
                {athlete.zones.map((z, i) => (
                  <option key={z.name} value={`z${i}`}>Entraînement {z.name} ({Math.round(z.low * 100)}–{Math.round(z.high * 100)} % VC)</option>
                ))}
              </select>
            </label>
            <button className="primary" onClick={estimate} disabled={level.busy}><Gauge /> Estimer mon niveau</button>
            {level.busy && <span className="muted">Calcul…</span>}
          </div>
          {level.error && <p className="warn">{level.error}</p>}
          {level.est && (
            <div className="banner info level-result">
              <div>
                Temps prévu avec ce profil {formatDuration(level.est.predicted)} (réalisé {formatDuration(level.est.actual)}).
                <ul className="changes">{level.est.changes.map((c) => <li key={c}>{c}</li>)}</ul>
              </div>
              <span className="row tight">
                <button className="primary" onClick={() => { onAthleteChange(level.est!.athlete); setLevel({ est: null, busy: false, error: null }) }}><Check /> Appliquer au profil</button>
                <button className="ghost" onClick={() => setLevel({ est: null, busy: false, error: null })}>Annuler</button>
              </span>
            </div>
          )}
        </Card>
      )}

      <p className="no-print">
        <button className="ghost" onClick={onBack}><ArrowLeft /> Retour au parcours</button>
      </p>
    </div>
  )
}
