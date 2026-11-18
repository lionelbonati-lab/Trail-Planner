// Page assistance : message à la montre (messages tout prêts ou texte libre de 60 caractères),
// affiché en plein écran sur la montre à son prochain contrôle (toutes les 5 min), avec reçu / lu.
import { Check, CheckCheck, MessageSquare, Send } from 'lucide-react'
import { useEffect, useState } from 'react'
import { formatClock } from '../lib/time'
import { cleanMessage, latestMessage, MESSAGE_MAX, messageWait, newMessageId, QUICK_MESSAGES, type WatchMessage } from '../lib/watchMessage'

/** Dernier message envoyé (documents msg/{code} de chaque code montre). */
function useLastMessage(codes: string[]): WatchMessage | null {
  const [docs, setDocs] = useState<Record<string, WatchMessage | null>>({})
  const key = codes.join(',')
  useEffect(() => {
    if (!key) return
    let cancelled = false
    const unsubs: (() => void)[] = []
    import('../lib/cloud').then((c) => {
      if (cancelled) return
      for (const code of key.split(',')) unsubs.push(c.subscribeWatchMessage(code, (m) => setDocs((d) => ({ ...d, [code]: m }))))
    })
    return () => {
      cancelled = true
      unsubs.forEach((u) => u())
    }
  }, [key])
  return latestMessage(codes.map((c) => docs[c] ?? null))
}

export function WatchMessageBox({ codes, timeZone, nowMs }: { codes: string[]; timeZone: string; nowMs: number }) {
  const last = useLastMessage(codes)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Compte à rebours d'un message par minute : rafraîchi chaque seconde tant qu'il court.
  const [tick, setTick] = useState(() => Date.now())
  const wait = messageWait(last, Math.max(nowMs, tick) / 1000)
  useEffect(() => {
    if (wait <= 0) return
    const id = setInterval(() => setTick(Date.now()), 1000)
    return () => clearInterval(id)
  }, [wait])

  const send = async (raw: string) => {
    const msg = cleanMessage(raw)
    if (!msg || busy || wait > 0) return
    setBusy(true)
    setError(null)
    try {
      const c = await import('../lib/cloud')
      await c.sendWatchMessage(codes, { id: newMessageId(), text: msg, t: Math.round(Date.now() / 1000) })
      setText('')
    } catch (e) {
      const m = (e as Error).message
      setError(/permission/i.test(m) ? 'Envoi refusé (un message par minute au plus, ou montre inconnue).' : `Envoi impossible : ${m}`)
    } finally {
      setBusy(false)
    }
  }
  const clock = (s: number) => formatClock(new Date(s * 1000), timeZone)
  const cleaned = cleanMessage(text)

  return (
    <section className="card watch-msg">
      <h3><MessageSquare className="inline" /> Message à la montre</h3>
      <p className="muted small">Affiché en plein écran sur la montre à son prochain contrôle (toutes les 5 min environ).</p>
      <div className="quick-msgs">
        {QUICK_MESSAGES.map((q) => (
          <button key={q} onClick={() => send(q)} disabled={busy || wait > 0}>{q}</button>
        ))}
      </div>
      <form
        className="row msg-form"
        onSubmit={(e) => {
          e.preventDefault()
          void send(text)
        }}
      >
        <input
          type="text"
          value={text}
          maxLength={MESSAGE_MAX}
          placeholder="Ton message (60 caractères)"
          aria-label="Message à la montre"
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" className="primary" disabled={busy || wait > 0 || !cleaned} aria-label="Envoyer à la montre">
          <Send /> Envoyer
        </button>
      </form>
      <div className="muted small msg-count">{cleaned.length} / {MESSAGE_MAX}{wait > 0 ? ` · prochain message dans ${wait} s` : ''}</div>
      {error && <p className="warn small">{error}</p>}
      {last && (
        <p className="msg-status small">
          « {last.text} » · envoyé à {clock(last.t)}
          {last.read ? (
            <span className="msg-read"> · <CheckCheck className="inline" /> lu à {clock(last.read)}</span>
          ) : last.got ? (
            <span> · <Check className="inline" /> reçu par la montre à {clock(last.got)}</span>
          ) : (
            <span className="muted"> · arrive sur la montre d'ici 5 min</span>
          )}
        </p>
      )}
    </section>
  )
}
