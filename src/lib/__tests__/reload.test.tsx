import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { isChunkError } from '../reload'

describe('rechargement après un nouveau déploiement', () => {
  it('reconnaît les erreurs de fichier de code introuvable (Chrome, Safari, Firefox)', () => {
    expect(isChunkError(new TypeError('Failed to fetch dynamically imported module: https://x/assets/ShareMap-abc.js'))).toBe(true)
    expect(isChunkError(new TypeError('Importing a module script failed.'))).toBe(true)
    expect(isChunkError(new TypeError('error loading dynamically imported module'))).toBe(true)
    expect(isChunkError(new TypeError("Cannot read properties of undefined (reading 'dist')"))).toBe(false)
  })

  it('la page d’erreur remplace la page blanche', async () => {
    const { ErrorBoundary } = await import('../../components/ErrorBoundary')
    const b = new ErrorBoundary({ children: null })
    b.state = ErrorBoundary.getDerivedStateFromError(new TypeError("Cannot read properties of undefined (reading 'dist')"))
    const html = renderToStaticMarkup(b.render() as never)
    expect(html).toContain('La page a rencontré une erreur')
    expect(html).toContain("TypeError: Cannot read properties of undefined (reading &#x27;dist&#x27;)")
    expect(html).toContain('Recharger')
  })
})
