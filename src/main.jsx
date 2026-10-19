import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'

import './index.css'
import { App } from './app/App.jsx'
import { SessionProvider } from './lib/session.jsx'
import { ToastProvider } from './components/ui/overlays.jsx'
import { SplashScreen } from './components/app/SplashScreen.jsx'
import { applyTheme, readTheme } from './lib/device.js'

applyTheme(readTheme())

/**
 * L'écran de lancement se superpose à l'application au lieu de la remplacer :
 * React monte, la session se rétablit et les données se chargent pendant
 * l'animation. Quand elle se retire, tout est déjà prêt.
 *
 * Il ne se montre qu'une fois par ouverture de l'application, pas à chaque
 * navigation : le rechargement d'un onglet le rejoue, un passage d'écran non.
 */
function Racine() {
  const [lancement, setLancement] = useState(true)

  return (
    <>
      <SessionProvider>
        <App />
      </SessionProvider>
      {lancement && <SplashScreen onTermine={() => setLancement(false)} />}
    </>
  )
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <Racine />
      </ToastProvider>
    </BrowserRouter>
  </StrictMode>,
)
