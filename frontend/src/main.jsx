import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
// i18next инициализируется до рендера: первый кадр уже должен быть на языке
// пользователя, без мигания исходной локали.
import './i18n/index.js'
import { SettingsProvider } from './i18n/settings.jsx'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <SettingsProvider>
      <App />
    </SettingsProvider>
  </React.StrictMode>,
)
