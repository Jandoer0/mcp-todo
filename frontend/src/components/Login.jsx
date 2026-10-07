import { useState } from 'react'

export default function Login({ onLogin, onRegister, error }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState('login')

  const submit = (e) => {
    e.preventDefault()
    if (mode === 'login') onLogin(username, password)
    else onRegister(username, password)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-gray-900">
      <form
        onSubmit={submit}
        className="bg-white dark:bg-gray-800 p-8 rounded shadow-md w-full max-w-md"
      >
        <h2 className="text-2xl font-bold mb-6 text-gray-800 dark:text-white">
          {mode === 'login' ? 'Login' : 'Register'}
        </h2>
        <input
          type="text"
          id="username"
          name="username"
          placeholder="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="w-full p-2 mb-4 border rounded dark:bg-gray-700 dark:text-white dark:border-gray-600"
        />
        <input
          type="password"
          id="password"
          name="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full p-2 mb-4 border rounded dark:bg-gray-700 dark:text-white dark:border-gray-600"
        />
        <button
          type="submit"
          className="w-full bg-blue-500 text-white p-2 rounded hover:bg-blue-600"
        >
          {mode === 'login' ? 'Login' : 'Register'}
        </button>
        {error && <p className="mt-4 text-center text-red-500 text-sm">{error}</p>}
        <p className="mt-4 text-center text-gray-600 dark:text-gray-400 text-sm">
          {mode === 'login' ? 'Need an account? ' : 'Have an account? '}
          <span
            onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
            className="text-blue-500 cursor-pointer"
          >
            {mode === 'login' ? 'Register' : 'Login'}
          </span>
        </p>
      </form>
    </div>
  )
}
