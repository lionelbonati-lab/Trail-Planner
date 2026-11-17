import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { RunnerPage, SharePage } from './components/SharePage.tsx'

/**
 * Lien d'assistance d'une course (#/share/<id>) ou lien permanent du coureur (#/suivi/<code montre>) :
 * pages publiques, sans compte.
 */
function Root() {
  const read = () => {
    const m = /^#\/(share|suivi)\/([\w-]+)/.exec(window.location.hash)
    return m ? { kind: m[1], id: m[2] } : null
  }
  const [link, setLink] = useState(read)
  useEffect(() => {
    const on = () => setLink(read())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  if (link?.kind === 'suivi') return <RunnerPage code={link.id} />
  return link ? <SharePage shareId={link.id} /> : <App />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
// Installation (PWA) : service worker en production uniquement.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('Service worker', e))
  })
}
