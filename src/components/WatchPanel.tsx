import { Check, Copy, ExternalLink, Watch } from 'lucide-react'
import { useEffect, useState } from 'react'
import { climbEquivalence, descentEquivalence, EP_DESCENT_RANGE, EP_TARGET_ZONES, epPayload, epTargetRank } from '../lib/endurancepro'
import { APPS_DOC_PATH, WATCH_APPS } from '../lib/garminApps'
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
  const copy = (text: string) =>
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(text)
      setTimeout(() => setCopied(null), 2000)
    })
  const code = athlete.epCode
  const [tab, setTabState] = useState<WatchTab>(() => readTab())
  const setTab = (t: WatchTab) => {
    setTabState(t)
    try {
      localStorage.setItem(TAB_KEY, t)
    } catch {
      /* stockage indisponible */
    }
  }
  return (
    <div className="watch-page">
      <div className="seg watch-tabs" role="tablist" aria-label="Montre">
        {(Object.keys(WATCH_TABS) as WatchTab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
            {WATCH_TABS[t]}
          </button>
        ))}
      </div>

      {tab === 'synchro' && (
        <div className="grid two">
          <Card title="Code montre" fold={false} actions={<Hint label="Où saisir le code">{CODE_HELP}</Hint>}>
            {!signedIn ? (
              <p className="warn-text">Connecte-toi pour synchroniser la montre.</p>
            ) : code ? (
              <div className="row ep-code">
                <strong className="ep-short" aria-label={`Code ${code.split('').join(' ')}`}>{`${code.slice(0, 4)} ${code.slice(4)}`}</strong>
                <button className="ghost" onClick={() => copy(code)}>{copied === code ? <><Check /> Copié</> : <><Copy /> Copier</>}</button>
              </div>
            ) : athlete.watchId || athlete.epSync ? (
              <p className="muted">Création du code…</p>
            ) : (
              <button className="primary" onClick={() => onChange({ ...athlete, watchId: crypto.randomUUID().replace(/-/g, '') })}>
                <Watch /> Créer mon code
              </button>
            )}
            {signedIn && athlete.watchId && (
              <details className="small">
                <summary>Code long (Garmin Connect)</summary>
                <div className="row">
                  <code className="watch-code">{athlete.watchId}</code>
                  <button className="ghost" onClick={() => copy(athlete.watchId!)}>{copied === athlete.watchId ? <><Check /> Copié</> : <><Copy /> Copier</>}</button>
                  <Hint label="Où saisir le code long">Garmin Connect › ta montre › Activités et applications › le champ › Paramètres › Code.</Hint>
                </div>
              </details>
            )}
          </Card>

          <Card title="Sur la montre" fold={false} actions={<Hint label="Changer de course et préparer la montre">{ON_WATCH_HELP}</Hint>}>
            {onWatch ? (
              <div className="row">
                <span><Watch className="inline" /> <strong>{onWatch.name}</strong> <span className="muted small">({onWatch.kind === 'route' ? 'parcours' : 'course'})</span></span>
                <button onClick={() => onOpen(onWatch)}>Ouvrir</button>
              </div>
            ) : (
              <p className="muted">Rien sur la montre.</p>
            )}
          </Card>
        </div>
      )}

      {tab === 'apps' && <WatchAppsCard />}

      {tab === 'ep' && <EndurancePro athlete={athlete} onChange={onChange} signedIn={signedIn} onWatch={onWatch} />}
    </div>
  )
}

type WatchTab = 'synchro' | 'apps' | 'ep'
const WATCH_TABS: Record<WatchTab, string> = { synchro: 'Synchro', apps: 'Applications', ep: 'EndurancePro' }
const TAB_KEY = 'tp-watch-tab'
/** Dernière sous-page ouverte sur cet appareil (Synchro la première fois). */
function readTab(): WatchTab {
  try {
    const t = localStorage.getItem(TAB_KEY)
    return t === 'apps' || t === 'ep' ? t : 'synchro'
  } catch {
    return 'synchro'
  }
}

const CODE_HELP = (
  <>
    <p>Le même code pour les deux applications, à saisir une seule fois sur la montre :</p>
    <ul>
      <li><strong>Trail Planner</strong> : pendant une activité, appui long sur Haut › Champs Connect IQ › Trail Planner › Code montre.</li>
      <li><strong>EndurancePro</strong> : menu du champ › Allure › Trail Planner (00000000 l'efface).</li>
    </ul>
  </>
)

const ON_WATCH_HELP = (
  <>
    <p>
      Pour changer, touche <Watch className="inline" /> sur une course ou un parcours de la liste (ou « Mettre sur la montre » dans un plan).
      La montre la récupère d'elle-même ; les modifications du plan suivent.
    </p>
    <ol>
      <li>Avant le départ, ouvre l'activité Trail quelques minutes, téléphone à proximité : le champ télécharge le plan (toutes les 5 min).</li>
      <li>Ensuite, tout fonctionne sans réseau. Désactive le tour automatique : le bouton Lap valide le passage aux points.</li>
      <li>Téléphone avec toi : passages et position partent toutes les 5 min vers le lien assistance.</li>
    </ol>
  </>
)

const BASE = import.meta.env.BASE_URL

/** Contenu de secours (fichier injoignable, hors ligne sans cache) : textes intégrés à l'app. */
const FALLBACK_DOC: WatchAppsDoc = {
  intro: [],
  apps: WATCH_APPS.map((a) => ({ name: a.name, type: a.kind, store: a.storeUrl, image: null, guide: a.guideUrl, body: [{ kind: 'p', parts: [{ kind: 'text', text: a.what }] }] })),
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

/**
 * Applications Garmin : nom, captures d'écran et lien du Store visibles ; les textes du fichier modifiable
 * (introduction, description de chaque application) dans une bulle (i).
 */
function WatchAppsCard() {
  const doc = useWatchAppsDoc()
  return (
    <Card title="Applications Garmin" className="span2" fold={false} actions={doc.intro.length ? <Hint label="Installer les applications"><Blocks blocks={doc.intro} /></Hint> : undefined}>
      <div className="watch-apps">
        {doc.apps.map((app) => {
          const text = app.body.filter((b) => !galleryImages(b))
          const gallery = app.body.filter((b) => galleryImages(b))
          return (
            <div key={app.name} className="watch-app">
              <div className="watch-app-head">
                <strong>{app.name}</strong> {app.type && <span className="muted small">· {app.type}</span>}
                {text.length > 0 && <Hint label={`À propos de ${app.name}`}><Blocks blocks={text} /></Hint>}
              </div>
              {app.image && <img className="watch-shot" src={docUrl(app.image, BASE)} alt={`Écran de la montre : ${app.name}`} loading="lazy" />}
              <Blocks blocks={gallery} />
              {app.store ? (
                <a className="button primary" href={app.store} target="_blank" rel="noreferrer">
                  <ExternalLink /> Connect IQ Store
                </a>
              ) : (
                <span className="small">
                  <span className="muted">Pas encore sur le Store : </span>
                  <a href={app.guide ?? WATCH_APPS[0].guideUrl} target="_blank" rel="noreferrer">installation par câble</a>
                </span>
              )}
            </div>
          )
        })}
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
    <Card
      title="EndurancePro"
      className="span2"
      fold={false}
      actions={
        <Hint label="Synchronisation EndurancePro">
          <p>
            EndurancePro garde la colorisation et l'alarme de son allure cible (vert dans la cible, orange et alarme si tu vas trop vite) ;
            la cible peut être une allure, une zone ou un % de VC (réglage « Référence » du dossier Allure).
          </p>
          <p>
            Synchronisé, il reprend tout seul ta VC, tes zones, les équivalences montée (d'après ta VAM à VC ; défaut 100 m) et
            descente (d'après tes coefficients de descente ; défaut 330 m), tes zones VAM et la zone de la séance envoyée à la montre.
            La montre suit chaque mise à jour au lancement d'une activité, puis toutes les 30 min, téléphone connecté.
          </p>
          <p>
            Sur la montre : menu d'EndurancePro › Allure › <strong>Trail Planner</strong>, saisis le code de la page Synchro
            (00000000 l'efface) ; la ligne affiche ensuite « Synchro hh:mm ».
          </p>
          <p>
            Zone cible : une séance envoyée à la montre avec une zone sur tout le parcours (Z1 à Z{EP_TARGET_ZONES}) règle les alarmes
            d'allure (référence « Zone VC »), de FC et de VAM ; sinon elle reste celle réglée sur la montre. VAM : pas de couleur sous la
            première limite.
          </p>
        </Hint>
      }
    >
      <label className="check">
        <input type="checkbox" checked={on} onChange={(e) => toggle(e.target.checked)} /> Synchroniser avec ce profil
      </label>
      {on && !signedIn && <p className="warn-text">Connecte-toi pour synchroniser.</p>}
      <table className="table compact ep-table">
        <tbody>
          <tr><td>VC</td><td><strong>{formatPace(1000 / athlete.cs)}/km</strong> <span className="muted">({(athlete.cs * 3.6).toFixed(2)} km/h)</span></td></tr>
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
          <tr><td>Montée</td><td>{up ? <><strong>{up} m</strong> D+ = 1 km</> : '—'}</td></tr>
          <tr>
            <td>Descente</td>
            <td>
              {dn ? (
                <>
                  <strong>{dn} m</strong> D- = 1 km
                  {dn >= EP_DESCENT_RANGE[1] ? <span className="muted"> (plafond)</span> : dn <= EP_DESCENT_RANGE[0] ? <span className="muted"> (plancher)</span> : null}
                </>
              ) : (
                '—'
              )}
            </td>
          </tr>
          <tr>
            <td>VAM</td>
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
                    Z5 ≥ {vz[4]} m/h
                  </span>
                </>
              ) : (
                '—'
              )}
            </td>
          </tr>
          <tr>
            <td>Zone cible</td>
            <td>
              {k !== null && onWatch && (epTargetRank(athlete, onWatch) ?? 0) <= EP_TARGET_ZONES ? (
                <>
                  <strong>{athlete.zones[k].name}</strong> <span className="muted">(« {onWatch.name} »)</span>
                </>
              ) : k !== null && onWatch ? (
                <span className="muted">inchangée (« {onWatch.name} » en {athlete.zones[k].name}, hors Z1–Z{EP_TARGET_ZONES})</span>
              ) : (
                <span className="muted">réglée sur la montre</span>
              )}
            </td>
          </tr>
        </tbody>
      </table>
      {on && (
        <details className="small">
          <summary>Données envoyées</summary>
          <code className="watch-code">{epPayload(athlete, onWatch)}</code>
        </details>
      )}
    </Card>
  )
}
