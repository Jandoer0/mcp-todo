import { useState, useEffect } from 'react'

export default function Login({ onLogin, onRegister, error, allowRegistration = true }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState('login')

  // If self-registration is disabled, the only option is logging in.
  useEffect(() => {
    if (!allowRegistration) setMode('login')
  }, [allowRegistration])

  const submit = (e) => {
    e.preventDefault()
    if (mode === 'login') onLogin(username, password)
    else onRegister(username, password)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <form
        onSubmit={submit}
        className="bg-white p-8 rounded shadow-md w-full max-w-md"
      >
        <h2 className="text-2xl font-bold mb-6 text-gray-800">
          {mode === 'login' ? 'Вход' : 'Регистрация'}
        </h2>
        <input
          type="text"
          id="username"
          name="username"
          placeholder="Имя пользователя"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="w-full p-2 mb-4 border rounded"
        />
        <input
          type="password"
          id="password"
          name="password"
          placeholder="Пароль"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full p-2 mb-4 border rounded"
        />
        <button
          type="submit"
          className="w-full bg-blue-500 text-white p-2 rounded hover:bg-blue-600"
        >
          {mode === 'login' ? 'Войти' : 'Зарегистрироваться'}
        </button>
        {error && <p className="mt-4 text-center text-red-500 text-sm">{error}</p>}
        {allowRegistration ? (
          <p className="mt-4 text-center text-gray-600 text-sm">
            {mode === 'login' ? 'Нет аккаунта? ' : 'Уже есть аккаунт? '}
            <span
              onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
              className="text-blue-500 cursor-pointer"
            >
              {mode === 'login' ? 'Зарегистрироваться' : 'Войти'}
            </span>
          </p>
        ) : (
          <p className="mt-4 text-center text-gray-600 text-sm">
            Регистрация новых пользователей отключена администратором.
          </p>
        )}
      </form>
    </div>
  )
}
