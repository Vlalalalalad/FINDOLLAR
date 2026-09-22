import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

// Mobile Safari/Chrome та F12 phone emulation можуть залишати натиснуту
// кнопку у focus після touchend. Знімаємо його лише з кнопок і лише для
// touch-подій, не втручаючись у click та клавіатурну навігацію на ПК.
const blurTouchedButton = (event: Event) => {
  const target = event.target
  if (target instanceof Element) target.closest('button')?.blur()
}

document.addEventListener('touchend', blurTouchedButton, { passive: true })
document.addEventListener('touchcancel', blurTouchedButton, { passive: true })

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
