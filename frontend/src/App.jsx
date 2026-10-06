import { useState, useEffect } from 'react'
import axios from 'axios'

const API_URL = '/api'

function App() {
  const [token, setToken] = useState(localStorage.getItem('token'))
  const [user, setUser] = useState(null)
  const [tasks, setTasks] = useState([])
  const [view, setView] = useState('login') // login, register, tasks
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [newTask, setNewTask] = useState({ title: '', description: '', priority: 1 })

  useEffect(() => {
    if (token) {
      fetchTasks()
      setView('tasks')
    }
  }, [token])

  const fetchTasks = async () => {
    try {
      const res = await axios.get(`${API_URL}/tasks`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      setTasks(res.data)
    } catch (err) {
      console.error(err)
      logout()
    }
  }

  const login = async (e) => {
    e.preventDefault()
    try {
      const res = await axios.post(`${API_URL}/auth/login?username=${username}&password=${password}`)
      localStorage.setItem('token', res.data.access_token)
      setToken(res.data.access_token)
      setView('tasks')
      fetchTasks()
    } catch (err) {
      alert('Login failed')
    }
  }

  const register = async (e) => {
    e.preventDefault()
    try {
      await axios.post(`${API_URL}/auth/register`, { username, password })
      alert('Registered! Please login.')
      setView('login')
    } catch (err) {
      alert('Registration failed')
    }
  }

  const logout = () => {
    localStorage.removeItem('token')
    setToken(null)
    setUser(null)
    setView('login')
  }

  const createTask = async (e) => {
    e.preventDefault()
    try {
      await axios.post(`${API_URL}/tasks`, newTask, {
        headers: { Authorization: `Bearer ${token}` }
      })
      setNewTask({ title: '', description: '', priority: 1 })
      fetchTasks()
    } catch (err) {
      alert('Failed to create task')
    }
  }

  const deleteTask = async (id) => {
    try {
      await axios.delete(`${API_URL}/tasks/${id}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      fetchTasks()
    } catch (err) {
      alert('Failed to delete task')
    }
  }

  if (view === 'login') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-gray-900">
        <form onSubmit={login} className="bg-white dark:bg-gray-800 p-8 rounded shadow-md w-full max-w-md">
          <h2 className="text-2xl font-bold mb-6 text-gray-800 dark:text-white">Login</h2>
          <input
            type="text"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full p-2 mb-4 border rounded dark:bg-gray-700 dark:text-white dark:border-gray-600"
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full p-2 mb-4 border rounded dark:bg-gray-700 dark:text-white dark:border-gray-600"
          />
          <button type="submit" className="w-full bg-blue-500 text-white p-2 rounded hover:bg-blue-600">Login</button>
          <p className="mt-4 text-center text-gray-600 dark:text-gray-400">
            No account? <span onClick={() => setView('register')} className="text-blue-500 cursor-pointer">Register</span>
          </p>
        </form>
      </div>
    )
  }

  if (view === 'register') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-gray-900">
        <form onSubmit={register} className="bg-white dark:bg-gray-800 p-8 rounded shadow-md w-full max-w-md">
          <h2 className="text-2xl font-bold mb-6 text-gray-800 dark:text-white">Register</h2>
          <input
            type="text"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full p-2 mb-4 border rounded dark:bg-gray-700 dark:text-white dark:border-gray-600"
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full p-2 mb-4 border rounded dark:bg-gray-700 dark:text-white dark:border-gray-600"
          />
          <button type="submit" className="w-full bg-green-500 text-white p-2 rounded hover:bg-green-600">Register</button>
          <p className="mt-4 text-center text-gray-600 dark:text-gray-400">
            Have an account? <span onClick={() => setView('login')} className="text-blue-500 cursor-pointer">Login</span>
          </p>
        </form>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900 text-gray-800 dark:text-gray-200">
      <header className="bg-white dark:bg-gray-800 shadow p-4 flex justify-between items-center">
        <h1 className="text-xl font-bold">OmniTask</h1>
        <button onClick={logout} className="text-red-500">Logout</button>
      </header>
      <main className="p-4 max-w-4xl mx-auto">
        <form onSubmit={createTask} className="mb-8 bg-white dark:bg-gray-800 p-4 rounded shadow">
          <h3 className="text-lg font-semibold mb-2">New Task</h3>
          <input
            type="text"
            placeholder="Title"
            value={newTask.title}
            onChange={(e) => setNewTask({ ...newTask, title: e.target.value })}
            className="w-full p-2 mb-2 border rounded dark:bg-gray-700 dark:border-gray-600"
            required
          />
          <textarea
            placeholder="Description"
            value={newTask.description}
            onChange={(e) => setNewTask({ ...newTask, description: e.target.value })}
            className="w-full p-2 mb-2 border rounded dark:bg-gray-700 dark:border-gray-600"
          />
          <select
            value={newTask.priority}
            onChange={(e) => setNewTask({ ...newTask, priority: parseInt(e.target.value) })}
            className="w-full p-2 mb-2 border rounded dark:bg-gray-700 dark:border-gray-600"
          >
            <option value={1}>Low Priority</option>
            <option value={2}>Medium Priority</option>
            <option value={3}>High Priority</option>
          </select>
          <button type="submit" className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600">Add Task</button>
        </form>

        <div className="space-y-4">
          {tasks.map(task => (
            <div key={task.id} className="bg-white dark:bg-gray-800 p-4 rounded shadow flex justify-between items-center">
              <div>
                <h4 className={`font-bold ${task.priority === 3 ? 'text-red-500' : task.priority === 2 ? 'text-yellow-500' : 'text-green-500'}`}>
                  {task.title}
                </h4>
                <p className="text-sm text-gray-600 dark:text-gray-400">{task.description}</p>
                <span className="text-xs bg-gray-200 dark:bg-gray-700 px-2 py-1 rounded mt-2 inline-block">{task.status}</span>
              </div>
              <button onClick={() => deleteTask(task.id)} className="text-red-500 hover:text-red-700">Delete</button>
            </div>
          ))}
        </div>
      </main>
    </div>
  )
}

export default App
