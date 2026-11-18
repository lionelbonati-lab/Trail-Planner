import { Check, Copy, ExternalLink, Watch } from 'lucide-react'
import { useEffect, useState } from 'react'
import { climbEquivalence, descentEquivalence, EP_DESCENT_RANGE, EP_TARGET_ZONES, epPayload, epTargetRank } from '../lib/endurancepro'
import { APPS_DOC_PATH, WATCH_APPS } from '../lib/garminApps'
import { runnerUrl } from '../lib/share'
import { formatPace } from '../lib/time'
import type { Athlete, Race } from '../lib/types'
import { epVamThresholds } from '../lib/vam'
import { docUrl, galleryImages, parseWatchAppsDoc, type Block, type Inline, type WatchAppsDoc } from '../lib/watchAppsDoc'
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
  const copy = (text: string, key = text) =>
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(key)
      setTimeout(() => setCopied(null), 2000)
    })
  const code = athlete.epCode
  return (
    <div className="grid two">
      {signedIn && athlete.watchId && (
        <Card title="Code pour Garmin Connect" className="span2 connect-code" fold={false}>
          <div className="row">
            <code className="watch-code">{athlete.watchId}</code>
            <button className="primary" onClick={() => copy(athlete.watchId!)}>
              {copied === athlete.watchId ? <><Check /> Copié</> : <><Copy /> Copier</>}
            </button>
          </div>
          <Hint>
            Paramètres d’une application installée depuis le Store : Garmin Connect › ta montre › Activités et applications ›
            Trail Planner › Paramètres › Code montre.
          </Hint>
        </Card>
      )}

      {signedIn && athlete.watchId && (
        <Card title="Lien d’assistance permanent" className="span2 runner-link" fold={false}>
          <p className="small">
            À donner une seule fois à ton assistance : il montre la course que ta montre enregistre (champ Trail Planner, ou parcours
            choisi dans l’appli Companion) et, entre deux sorties, ta prochaine course (sinon ta dernière course et son résultat).
          </p>
          <div className="row">
            <button className="primary" onClick={() => copy(runnerUrl(athlete.watchId!), 'runner')}>
              {copied === 'runner' ? <><Check /> Copié</> : <><Copy /> Copier le lien</>}
            </button>
            <a href={`#/suivi/${athlete.watchId}`} target="_blank" rel="noreferrer">
              <ExternalLink className="inline" /> Ouvrir
            </a>
          </div>
        </Card>
      )}

      <WatchAppsCard />

      <Card title="Code de synchronisation" fold="open">
        {!signedIn ? (
          <p className="warn-text">Connecte-toi : la synchronisation avec la montre passe par ton compte.</p>
        ) : code ? (
          <>
            <div className="row ep-code">
              <strong className="ep-short" aria-label={`Code ${code.split('').join(' ')}`}>{`${code.slice(0, 4)} ${code.slice(4)}`}</strong>
              <button className="ghost" onClick={() => copy(code)}>{copied === code ? <><Check /> Copié</> : <><Copy /> Copier</>}</button>
            </div>
            <p className="small">Le même code pour toutes les applications, à saisir une seule fois sur la montre :</p>
            <ul className="small">
              <li><strong>Trail Planner</strong> : pendant une activité, appui long sur Haut › Champs Connect IQ › Trail Planner › Code montre.</li>
              <li><strong>EndurancePro</strong> : menu du champ › Allure › Trail Planner.</li>
              <li><strong>Trail Planner Companion</strong> (bêta) : appui long sur Haut › Propriétés › Code Trail Planner.</li>
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
          <p className="muted small">Le code long pour Garmin Connect est en haut de cet onglet.</p>
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
          <li>Si ton téléphone est avec toi, la montre envoie passages et position toutes les 5 min : ton assistance les voit sur le lien assistance de la course, ou sur ton lien permanent (en haut de cet onglet).</li>
        </ol>
      </Card>

      <EndurancePro athlete={athlete} onChange={onChange} signedIn={signedIn} onWatch={onWatch} />

      <CompanionSync athlete={athlete} onChange={onChange} signedIn={signedIn} />
    </div>
  )
}

/** Appli montre Trail Planner Companion (bêta) : synchronisation des parcours pour son écran de démarrage. */
function CompanionSync({ athlete, onChange, signedIn }: { athlete: Athlete; onChange: (a: Athlete) => void; signedIn: boolean }) {
  const on = !!athlete.appSync
  const toggle = (v: boolean) =>
    onChange({ ...athlete, appSync: v, watchId: athlete.watchId ?? (v ? crypto.randomUUID().replace(/-/g, '') : undefined) })
  return (
    <Card title={<>Trail Planner Companion <span className="badge beta-badge">Bêta</span></>} className="span2">
      <Hint>
        L’appli montre qui réunit EndurancePro, le champ Trail Planner, le profil qui te suit et la carte Garmin de ton parcours.
        Avec la synchronisation, son écran de démarrage propose tes courses à venir et les parcours de ta bibliothèque, à jour à
        chaque modification ici ; tu choisis, tu vois la fiche (carte, profil, distance, D+), tu démarres.
      </Hint>
      <label className="check">
        <input type="checkbox" checked={on} onChange={(e) => toggle(e.target.checked)} /> Synchroniser mes parcours avec l’appli
      </label>
      {on && !signedIn && <p className="warn-text">Connecte-toi : la synchronisation passe par ton compte.</p>}
      {on && signedIn && (
        <Hint>
          Sur la montre : appli Trail Planner Companion › appui long sur Haut › Propriétés › Code Trail Planner, saisis le code de
          synchronisation ci-dessus (le même que pour le champ et EndurancePro). La liste se met à jour à chaque lancement de l’appli,
          téléphone à proximité.
        </Hint>
      )}
      <p className="small">
        Version bêta, pas encore sur le Connect IQ Store : installation par câble du fichier compilé (
        <a href="https://github.com/lionelbonati-lab/Trail-Planner/tree/main/garmin/TrailPlannerCompanion" target="_blank" rel="noreferrer">
          mode d’emploi
        </a>
        ).
      </p>
    </Card>
  )
}

const BASE = import.meta.env.BASE_URL

/** Contenu de secours (fichier injoignable, hors ligne sans cache) : textes intégrés à l'app. */
const FALLBACK_DOC: WatchAppsDoc = {
  intro: [],
  apps: WATCH_APPS.map((a) => ({ name: a.name, type: a.kind, store: a.storeUrl, image: null, guide: a.guideUrl, status: null, body: [{ kind: 'p', parts: [{ kind: 'text', text: a.what }] }] })),
}

/** Contenu du cadre, lu dans public/montre/applications.md (modifiable sur GitHub). */
function useWatchAppsDoc(): WatchAppsDoc {
  const [doc, setDoc] = useState<WatchAppsDoc>(FALLBACK_DOC)
  useEffect(() => {
    let off = false
    fetch(`${BASE}${APPS_DOC_PATH}`, { cache: 'no-cache' })
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then((text) => {
        const d = parseWatchAppsDoc(text)
        if (!off && d.apps.length) setDoc(d)
      })
      .catch(() => undefined)
    return () => {
      off = true
    }
  }, [])
  return doc
}

function InlineParts({ parts }: { parts: Inline[] }) {
  return (
    <>
      {parts.map((p, i) =>
        p.kind === 'text' ? (
          p.text
        ) : p.kind === 'bold' ? (
          <strong key={i}>{p.text}</strong>
        ) : p.kind === 'link' ? (
          <a key={i} href={docUrl(p.href, BASE)} target="_blank" rel="noreferrer">{p.text}</a>
        ) : (
          <img key={i} className="watch-shot" src={docUrl(p.src, BASE)} alt={p.alt} loading="lazy" />
        ),
      )}
    </>
  )
}

function Blocks({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((b, i) =>
        galleryImages(b) ? (
          // Images à la suite : galerie qui défile, chaque capture s'ouvre en grand.
          <div key={i} className="watch-gallery">
            {galleryImages(b)!.map((img, k) => (
              <a key={k} href={docUrl(img.src, BASE)} target="_blank" rel="noreferrer">
                <img src={docUrl(img.src, BASE)} alt={img.alt} title={img.alt} loading="lazy" />
              </a>
            ))}
          </div>
        ) : b.kind === 'p' ? (
          <p key={i} className="small"><InlineParts parts={b.parts} /></p>
        ) : (
          <ul key={i} className="small">{b.items.map((it, k) => <li key={k}><InlineParts parts={it} /></li>)}</ul>
        ),
      )}
    </>
  )
}

/** Applications Garmin : textes, liens du Store et captures d'écran venant du fichier modifiable. */
function WatchAppsCard() {
  const doc = useWatchAppsDoc()
  return (
    <Card title="Applications Garmin" className="span2" fold="open">
      <Blocks blocks={doc.intro} />
      <div className="watch-apps">
        {doc.apps.map((app) => (
          <div key={app.name} className="watch-app">
            <div>
              <strong>{app.name}</strong> {app.status && <span className="badge beta-badge">{app.status}</span>}{' '}
              {app.type && <span className="muted small">· {app.type}</span>}
            </div>
            {app.image && <img className="watch-shot" src={docUrl(app.image, BASE)} alt={`Écran de la montre : ${app.name}`} loading="lazy" />}
            <Blocks blocks={app.body} />
            {app.store ? (
              <a className="button primary" href={app.store} target="_blank" rel="noreferrer">
                <ExternalLink /> Connect IQ Store
              </a>
            ) : (
              <span className="small">
                <span className="muted">Pas encore sur le Connect IQ Store : </span>
                <a href={app.guide ?? WATCH_APPS[0].guideUrl} target="_blank" rel="noreferrer">installation par câble</a>
              </span>
            )}
          </div>
        ))}
      </div>
    </Card>
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
          une zone sur tout le parcours (Z1 à Z5) devient la zone cible de toutes les alarmes : allure (référence « Zone VC »), FC et VAM.
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
            <td>Zone cible<br /><span className="muted small">allure, FC et VAM</span></td>
            <td>
              {k !== null && onWatch && (epTargetRank(athlete, onWatch) ?? 0) <= EP_TARGET_ZONES ? (
                <>
                  <strong>{athlete.zones[k].name}</strong> <span className="muted">(« {onWatch.name} », envoyée à la montre) : les alarmes d'allure (référence Zone VC), de FC et de VAM se déclenchent au-dessus de cette zone</span>
                </>
              ) : k !== null && onWatch ? (
                <span className="muted">
                  inchangée : « {onWatch.name} » est en {athlete.zones[k].name}, or la zone cible d'EndurancePro va de Z1 à Z{EP_TARGET_ZONES} (zones que la
                  FC et la VAM ont aussi)
                </span>
              ) : (
                <span className="muted">
                  inchangée (réglée sur la montre, Z1 à Z{EP_TARGET_ZONES}) : envoie à la montre une séance avec une zone sur tout le parcours pour la
                  régler d'ici ; elle règle les alarmes d'allure, de FC et de VAM
                </span>
              )}
            </td>
          </tr>
        </tbody>
      </table>
      {on && <p className="muted small">Données publiées : <code>{epPayload(athlete, onWatch)}</code></p>}
    </Card>
  )
}
