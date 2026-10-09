import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { connectEngine } from './api'
import './styles.css'

/**
 * The dev harness replaces `window.scriptorium` with a fake engine. It only exists in development builds:
 * `import.meta.env.DEV` is false in production, so the bundler drops the import and the demo code with it.
 */
async function boot(): Promise<void> {
  if (import.meta.env.DEV && (window.scriptorium === undefined || new URLSearchParams(location.search).has('demo'))) {
    const { installFakeEngine } = await import('./demo/fake')
    installFakeEngine(new URLSearchParams(location.search))
  }
  connectEngine()
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>
  )
}

void boot()
