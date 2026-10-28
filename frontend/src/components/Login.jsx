import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'

export default function Login({ onLogin, onRegister, error, allowRegistration = true, passwordMin = 6 }) {
  const { t } = useTranslation()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState('login')

  // If self-registration is disabled, the only option is logging in.
  useEffect(() => {
    if (!allowRegistration) setMode('login')
  }, [allowRegistration])

  const [localError, setLocalError] = useState('')

  const submit = (e) => {
    e.preventDefault()
    setLocalError('')
    const u = username.trim()
    const p = password
    if (!u || !p) {
      setLocalError(t('auth.fieldsRequired'))
      return
    }
    if (mode === 'register' && p.length < passwordMin) {
      setLocalError(t('auth.passwordTooShort', { min: passwordMin }))
      return
    }
    if (mode === 'login') onLogin(u, p)
    else onRegister(u, p)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <form
        onSubmit={submit}
        className="bg-white p-8 rounded shadow-md w-full max-w-md"
      >
        <h2 className="text-2xl font-bold mb-6 text-gray-800">
          {mode === 'login' ? t('auth.login') : t('auth.register')}
        </h2>
        <input
          type="text"
          id="username"
          name="username"
          placeholder={t('auth.username')}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className="w-full p-2 mb-4 border rounded"
        />
        <input
          type="password"
          id="password"
          name="password"
          placeholder={t('auth.password')}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full p-2 mb-4 border rounded"
        />
        {mode === 'register' && (
          <p className="-mt-2 mb-4 text-xs text-gray-500">
            {t('auth.passwordMin', { min: passwordMin })}
          </p>
        )}
        <button
          type="submit"
          disabled={!username.trim() || !password}
          className="w-full bg-blue-500 text-white p-2 rounded hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {mode === 'login' ? t('auth.loginButton') : t('auth.registerButton')}
        </button>
        {(error || localError) && <p className="mt-4 text-center text-red-500 text-sm">{error || localError}</p>}
        {allowRegistration ? (
          <p className="mt-4 text-center text-gray-600 text-sm">
            {mode === 'login' ? t('auth.noAccount') : t('auth.haveAccount')} 
            <span
              onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
              className="text-blue-500 cursor-pointer"
            >
              {mode === 'login' ? t('auth.registerLink') : t('auth.loginLink')}
            </span>
          </p>
        ) : (
          <p className="mt-4 text-center text-gray-600 text-sm">
            {t('auth.registrationClosed')}
          </p>
        )}
      </form>
    </div>
  )
}
