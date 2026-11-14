import { Check, Gauge, Upload } from 'lucide-react'
import { useState } from 'react'
import { readActivity } from '../lib/activity'
import { DEFAULT_ENV } from '../lib/defaults'
import { isDefaultLevel, levelFromActivity, levelFromTime, type Effort, type LevelEstimate } from '../lib/level'
import { computePlan } from '../lib/plan'
import { formatDuration, parseDuration } from '../lib/time'
import type { Athlete, Race } from '../lib/types'
import { Card, Hint } from './ui'

/** Effort de la sortie de référence, codé pour le menu : « race » ou « z<indice> ». */
const effortOf = (v: string): Effort => (v === 'race' ? { kind: 'race' } : { kind: 'zone', index: Number(v.slice(1)) })

/**
 * Niveau sans test VC : à partir de l'enregistrement d'une course ou d'un entraînement (GPX / FIT),
 * ou d'un temps réalisé sur une course ou un parcours de l'app. Proposé ouvert tant que le profil
 * n'a jamais été réglé.
 */
export function LevelCard({ athlete, races, onChange }: { athlete: Athlete; races: Race[]; onChange: (a: Athlete) => void }) {
  const [source, setSource] = useState<'file' | 'time'>('file')
  const [effort, setEffort] = useState('race')
  const [raceId, setRaceId] = useState(races[0]?.id ?? '')
  const [time, setTime] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ est: LevelEstimate; what: string } | null>(null)

  const run = (what: string, compute: () => LevelEstimate | null) => {
    setBusy(true)
    setError(null)
    setResult(null)
    // Laisse s'afficher « Calcul… » : la recherche simule la sortie plusieurs dizaines de fois.
    setTimeout(() => {
      try {
        const est = compute()
        if (est) setResult({ est, what })
        else setError('Temps hors d’atteinte du modèle : vérifie le temps (ou le fichier) et l’effort choisi.')
      } catch (e) {
        setError((e as Error).message)
      } finally {
        setBusy(false)
      }
    }, 30)
  }

  const fromFile = async (files: FileList | null) => {
    const f = files?.[0]
    if (!f) return
    let bytes: Uint8Array
    try {
      bytes = new Uint8Array(await f.arrayBuffer())
    } catch (e) {
      return setError((e as Error).message)
    }
    run(f.name.replace(/\.(gpx|fit)$/i, ''), () => {
      const act = readActivity(f.name, bytes)
      return levelFromActivity(act, athlete, DEFAULT_ENV, effortOf(effort))
    })
  }

  const fromTime = () => {
    const race = races.find((r) => r.id === raceId)
    const target = parseDuration(time)
    if (!race) return setError('Choisis une course ou un parcours.')
    if (!target || target < 300) return setError('Temps attendu au format h:mm:ss (par exemple 3:25:00).')
    run(race.name, () => {
      const plan = computePlan(race, athlete)
      if (!plan) throw new Error('Impossible de lire le GPX de ce parcours.')
      return levelFromTime(plan.track, athlete, plan.opts, target, effortOf(effort))
    })
  }

  return (
    <Card title="Estimer mon niveau sans test VC" className="span2" fold={isDefaultLevel(athlete) ? 'open' : 'closed'}>
      <Hint>
        Pas encore de test VC ? Pars d’une course ou d’un entraînement déjà fait : l’app cherche le niveau qui redonne ton temps,
        puis prédit tes temps de passage avec. Le plus juste : l’enregistrement d’une course récente, sur un terrain proche de
        celle que tu prépares. Un test VC reste plus précis ensuite.
      </Hint>
      {isDefaultLevel(athlete) && <p className="small"><strong>Ton profil est encore celui par défaut</strong> (VC 4'15/km) : les temps prévus ne sont pas encore les tiens.</p>}
      <div className="seg">
        <button className={source === 'file' ? 'on' : ''} onClick={() => setSource('file')}>Avec l’enregistrement</button>
        <button className={source === 'time' ? 'on' : ''} onClick={() => setSource('time')}>Avec mon temps</button>
      </div>
      <div className="fields">
        <label className="field">
          <span className="field-label">Effort de cette sortie</span>
          <select value={effort} onChange={(e) => setEffort(e.target.value)} aria-label="Effort de la sortie">
            <option value="race">Course (à fond)</option>
            {athlete.zones.map((z, i) => (
              <option key={z.name} value={`z${i}`}>
                Entraînement {z.name} ({Math.round(z.low * 100)}–{Math.round(z.high * 100)} % VC{z.use ? ` · ${z.use.toLowerCase()}` : ''})
              </option>
            ))}
          </select>
        </label>
        {source === 'time' && (
          <>
            <label className="field">
              <span className="field-label">Course ou parcours</span>
              <select value={raceId} onChange={(e) => setRaceId(e.target.value)} aria-label="Course ou parcours">
                {races.length === 0 && <option value="">Aucun : importe d’abord son GPX</option>}
                {races.map((r) => <option key={r.id} value={r.id}>{r.name}{r.kind === 'route' ? ' (parcours)' : ''}</option>)}
              </select>
            </label>
            <label className="field">
              <span className="field-label">Temps réalisé</span>
              <input type="text" inputMode="numeric" placeholder="h:mm:ss" value={time} onChange={(e) => setTime(e.target.value)} aria-label="Temps réalisé" />
            </label>
          </>
        )}
      </div>
      <div className="row">
        {source === 'file' ? (
          <label className="button primary" aria-disabled={busy}>
            <Upload /> Importer GPX ou FIT
            <input type="file" accept=".gpx,.fit,application/gpx+xml" hidden disabled={busy} onChange={(e) => { fromFile(e.target.files); e.target.value = '' }} />
          </label>
        ) : (
          <button className="primary" onClick={fromTime} disabled={busy || !races.length}><Gauge /> Estimer</button>
        )}
        {busy && <span className="muted">Calcul…</span>}
      </div>
      <Hint>
        {source === 'file'
          ? 'Enregistrement de ta montre (GPX ou FIT horodaté) : temps en mouvement, arrêts exclus. Effort de course : VAM par pente, descente et durabilité sont aussi mesurées.'
          : 'Temps d’arrivée, arrêts compris : les arrêts prévus dans le plan de ce parcours sont comptés. Niveau global (VC et VAM ensemble).'}
      </Hint>
      {error && <p className="warn">{error}</p>}
      {result && (
        <div className="banner info level-result">
          <div>
            <strong>{result.what}</strong> : temps prévu avec ce profil {formatDuration(result.est.predicted)} (réalisé {formatDuration(result.est.actual)}).
            <ul className="changes">{result.est.changes.map((c) => <li key={c}>{c}</li>)}</ul>
          </div>
          <span className="row tight">
            <button className="primary" onClick={() => { onChange(result.est.athlete); setResult(null) }}><Check /> Appliquer au profil</button>
            <button className="ghost" onClick={() => setResult(null)}>Annuler</button>
          </span>
        </div>
      )}
    </Card>
  )
}
