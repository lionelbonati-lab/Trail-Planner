import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { SharePage } from './components/SharePage.tsx'

/** Lien d'assistance (#/share/<id>) : page publique, sans compte. */
function Root() {
  const read = () => /^#\/share\/([\w-]+)/.exec(window.location.hash)?.[1] ?? null
  const [shareId, setShareId] = useState(read)
  useEffect(() => {
    const on = () => setShareId(read())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return shareId ? <SharePage shareId={shareId} /> : <App />
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
