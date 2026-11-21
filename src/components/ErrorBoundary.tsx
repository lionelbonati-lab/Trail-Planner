// Filet de sécurité : une erreur d'affichage ne laisse plus une page blanche. Fichier de code introuvable
// (nouvelle version déployée pendant que la page était ouverte) : rechargement automatique, une fois ;
// sinon message avec l'erreur et bouton « Recharger ».
import { Component, type ReactNode } from 'react'
import { isChunkError, reloadOnce } from '../lib/reload'

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    console.error('Erreur d’affichage', error, info.componentStack)
    if (isChunkError(error)) reloadOnce()
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <main className="share">
        <section className="card crash">
          <h2>La page a rencontré une erreur</h2>
          <p className="muted">
            {isChunkError(error)
              ? 'Une nouvelle version de Trail Planner vient d’être mise en ligne : recharge la page.'
              : 'Recharge la page. Si l’erreur revient, envoie le message ci-dessous à Lionel.'}
          </p>
          <pre className="crash-msg">{`${error.name}: ${error.message}`}</pre>
          <button className="primary" onClick={() => window.location.reload()}>Recharger</button>
        </section>
      </main>
    )
  }
}
