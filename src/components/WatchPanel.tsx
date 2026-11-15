import { Check, Copy, ExternalLink, Watch } from 'lucide-react'
import { useState } from 'react'
import { climbEquivalence, descentEquivalence, EP_DESCENT_RANGE, epPayload } from '../lib/endurancepro'
import { WATCH_APPS } from '../lib/garminApps'
import { formatPace } from '../lib/time'
import type { Athlete, Race } from '../lib/types'
import { epVamThresholds } from '../lib/vam'
import { colorForIndex, wholeRouteZone } from '../lib/zones'
import { Card, Hint } from './ui'

/**
 * Onglet Montre : applications Garmin (Connect IQ Store), code de synchronisation (seul endroit où il
 * s'affiche), course ou parcours sur la montre, synchronisation du profil vers EndurancePro.
 */
export function WatchPanel({
  athlete,
  onChange,
  signedIn,
  onWatch,
  onOpen,
}: {
  athlete: Athlete
  onChange: (a: Athlete) => void
  signedIn: boolean
  /** Course ou parcours envoyé à la montre. */
  onWatch: Race | null
  onOpen: (r: Race) => void
}) {
  const [copied, setCopied] = useState<string | null>(null)
  const copy = (text: string) =>
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(text)
      setTimeout(() => setCopied(null), 2000)
    })
  const code = athlete.epCode
  return (
    <div className="grid two">
      <Card title="Applications Garmin" className="span2" fold="open">
        <div className="watch-apps">
          {WATCH_APPS.map((app) => (
            <div key={app.name} className="watch-app">
              <div>
                <strong>{app.name}</strong> <span className="muted small">· {app.kind}</span>
              </div>
              <p className="small">{app.what}</p>
              {app.storeUrl ? (
                <a className="button primary" href={app.storeUrl} target="_blank" rel="noreferrer">
                  <ExternalLink /> Connect IQ Store
                </a>
              ) : (
                <span className="small">
                  <span className="muted">Pas encore sur le Connect IQ Store : </span>
                  <a href={app.guideUrl} target="_blank" rel="noreferrer">installation par câble</a>
                </span>
              )}
            </div>
          ))}
        </div>
        <Hint>
          Depuis le Store : installe l’application Connect IQ sur ton téléphone, ajoute le champ, il arrive sur la montre à la
          prochaine synchronisation. Ajoute-le ensuite à un écran de ton activité Trail (Paramètres › Écrans de données › Connect IQ).
        </Hint>
      </Card>

      <Card title="Code de synchronisation" fold="open">
        {!signedIn ? (
          <p className="warn-text">Connecte-toi : la synchronisation avec la montre passe par ton compte.</p>
        ) : code ? (
          <>
            <div className="row ep-code">
              <strong className="ep-short" aria-label={`Code ${code.split('').join(' ')}`}>{`${code.slice(0, 4)} ${code.slice(4)}`}</strong>
              <button className="ghost" onClick={() => copy(code)}>{copied === code ? <><Check /> Copié</> : <><Copy /> Copier</>}</button>
            </div>
            <p className="small">Le même code pour les deux applications, à saisir une seule fois sur la montre :</p>
            <ul className="small">
              <li><strong>Trail Planner</strong> : pendant une activité, appui long sur Haut › Champs Connect IQ › Trail Planner › Code montre.</li>
              <li><strong>EndurancePro</strong> : menu du champ › Allure › Trail Planner.</li>
            </ul>
          </>
        ) : athlete.watchId || athlete.epSync ? (
          <p className="muted">Création du code…</p>
        ) : (
          <button className="primary" onClick={() => onChange({ ...athlete, watchId: crypto.randomUUID().replace(/-/g, '') })}>
            <Watch /> Créer mon code
          </button>
        )}
        {signedIn && athlete.watchId && (
          <details className="small">
            <summary>Code long, pour les paramètres dans Garmin Connect (application installée depuis le Store)</summary>
            <div className="row">
              <code className="watch-code">{athlete.watchId}</code>
              <button className="ghost" onClick={() => copy(athlete.watchId!)}>{copied === athlete.watchId ? <><Check /> Copié</> : <><Copy /> Copier</>}</button>
            </div>
            <Hint>Garmin Connect › ta montre › Activités et applications › le champ › Paramètres › Code.</Hint>
          </details>
        )}
      </Card>

      <Card title="Sur la montre" fold="open">
        {onWatch ? (
          <div className="row">
            <span><Watch className="inline" /> <strong>{onWatch.name}</strong> <span className="muted small">({onWatch.kind === 'route' ? 'parcours' : 'course'})</span></span>
            <button onClick={() => onOpen(onWatch)}>Ouvrir</button>
          </div>
        ) : (
          <p className="muted">Aucune course ni aucun parcours sur la montre.</p>
        )}
        <Hint>
          Pour changer, touche <Watch className="inline" /> sur une ligne de la liste des courses ou des parcours (ou « Mettre sur la
          montre » dans un plan). La montre la récupère d’elle-même ; les modifications du plan suivent automatiquement.
        </Hint>
        <ol className="watch-steps small">
          <li>Avant le départ, ouvre l’activité Trail quelques minutes, téléphone à proximité : le champ télécharge le plan (contrôle toutes les 5 min).</li>
          <li>Ensuite, tout fonctionne sans réseau. Désactive le tour automatique : le bouton Lap valide le passage aux points.</li>
          <li>Si ton téléphone est avec toi, la montre envoie passages et position toutes les 5 min : ton assistance les voit sur le lien assistance.</li>
        </ol>
      </Card>

      <EndurancePro athlete={athlete} onChange={onChange} signedIn={signedIn} onWatch={onWatch} />
    </div>
  )
}

/** Synchronisation du datafield Garmin EndurancePro : VC, zones, équivalence montée, zone d'alarme. */
function EndurancePro({ athlete, onChange, signedIn, onWatch }: { athlete: Athlete; onChange: (a: Athlete) => void; signedIn: boolean; onWatch: Race | null }) {
  const on = !!athlete.epSync
  const up = climbEquivalence(athlete)
  const dn = descentEquivalence(athlete)
  const k = onWatch && onWatch.kind !== 'race' ? wholeRouteZone(onWatch.zones, athlete) : null
  const sorted = [...athlete.zones].sort((a, b) => a.low - b.low).slice(0, 7)
  const vz = epVamThresholds(athlete)
  const toggle = (v: boolean) =>
    onChange({ ...athlete, epSync: v, watchId: athlete.watchId ?? (v ? crypto.randomUUID().replace(/-/g, '') : undefined) })
  return (
    <Card title="EndurancePro : synchronisation du profil" className="span2">
      <Hint>
        EndurancePro garde la colorisation et l'alarme de son allure cible (vert dans la cible, orange et alarme quand tu vas trop
        vite) ; la cible peut être une allure, une zone de VC ou un % de VC (réglage « Référence » du dossier Allure). Avec la
        synchronisation, il reprend tout seul ta VC, tes zones, les équivalences montée et descente (déduites de ta VAM et de tes coefficients de descente), tes zones VAM et la zone de la séance
        envoyée à la montre : à chaque mise à jour ici, la montre suit (au lancement d'une activité, puis toutes les 30 min, téléphone
        connecté).
      </Hint>
      <label className="check">
        <input type="checkbox" checked={on} onChange={(e) => toggle(e.target.checked)} /> Synchroniser EndurancePro avec ce profil
      </label>
      {on && !signedIn && <p className="warn-text">Connecte-toi : la synchronisation passe par ton compte.</p>}
      {on && signedIn && (
        <Hint>
          Sur la montre : menu d'EndurancePro › Allure › <strong>Trail Planner</strong>, saisis le code de synchronisation ci-dessus
          (00000000 l'efface). La ligne affiche ensuite « Synchro hh:mm » à chaque mise à jour. Une séance envoyée à la montre avec
          une zone sur tout le parcours devient la cible (référence « Zone VC »).
        </Hint>
      )}
      <table className="table compact">
        <tbody>
          <tr><td>Vitesse critique</td><td><strong>{formatPace(1000 / athlete.cs)}/km</strong> <span className="muted">({(athlete.cs * 3.6).toFixed(2)} km/h)</span></td></tr>
          <tr>
            <td>Zones</td>
            <td>
              {sorted.map((z, i) => (
                <span key={i} className="ep-zone">
                  <i className="zone-swatch" style={{ background: colorForIndex(athlete.zones.indexOf(z), athlete) }} />
                  {z.name.replace(/^Zone\s*/i, 'Z')} {Math.round(z.low * 100)}–{Math.round(z.high * 100)} %
                </span>
              ))}
            </td>
          </tr>
          <tr>
            <td>Équivalence montée</td>
            <td>{up ? <><strong>{up} m</strong> de D+ = 1 km à plat <span className="muted">(d'après ta VAM à VC ; défaut EndurancePro : 100 m)</span></> : '—'}</td>
          </tr>
          <tr>
            <td>Équivalence descente</td>
            <td>
              {dn ? (
                <>
                  <strong>{dn} m</strong> de D- = 1 km à plat{' '}
                  <span className="muted">
                    (d'après tes coefficients de descente{dn >= EP_DESCENT_RANGE[1] ? ' : en moyenne, la descente te ralentit peu, valeur au plafond du réglage' : dn <= EP_DESCENT_RANGE[0] ? ' : valeur au plancher du réglage' : ''} ; défaut EndurancePro : 330 m)
                  </span>
                </>
              ) : (
                '—'
              )}
            </td>
          </tr>
          <tr>
            <td>Couleurs VAM</td>
            <td>
              {vz ? (
                <>
                  {['Z1', 'Z2', 'Z3', 'Z4'].map((name, i) => (
                    <span key={name} className="ep-zone">
                      <i className="zone-swatch" style={{ background: colorForIndex(i) }} />
                      {name} {vz[i]}–{vz[i + 1]}
                    </span>
                  ))}
                  <span className="ep-zone">
                    <i className="zone-swatch" style={{ background: colorForIndex(4) }} />
                    Z5 dès {vz[4]} m/h
                  </span>
                  <span className="muted"> (pas de couleur sous {vz[0]} m/h)</span>
                </>
              ) : (
                '—'
              )}
            </td>
          </tr>
          <tr>
            <td>Zone cible</td>
            <td>
              {k !== null && onWatch ? (
                <><strong>{athlete.zones[k].name}</strong> <span className="muted">(« {onWatch.name} », envoyée à la montre)</span></>
              ) : (
                <span className="muted">inchangée (réglée sur la montre) : envoie à la montre une séance avec une zone sur tout le parcours pour la régler d'ici</span>
              )}
            </td>
          </tr>
        </tbody>
      </table>
      {on && <p className="muted small">Données publiées : <code>{epPayload(athlete, onWatch)}</code></p>}
    </Card>
  )
}
