import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

// Просим браузер не стирать данные сайта (вход, офлайн-очередь, снимки поездок) при нехватке места.
// Установленному на экран PWA это обычно разрешают без вопросов.
navigator.storage?.persist?.().catch(() => {})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
