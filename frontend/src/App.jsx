import { useState, useEffect } from 'react'
import axios from 'axios'

const API_URL = '/api'

function App() {
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [token, setToken] = useState(localStorage.getItem('token'))
  const [user, setUser] = useState(null)
  const [tasks, setTasks] = useState([])
  const [view, setView] = useState('login') // login, register, tasks, admin
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [newTask, setNewTask] = useState({ title: '', description: '', priority: 1, deadline: '', tag: '' })
  const [theme, setTheme] = useState(localStorage.getItem('theme') || 'system')
  const [filterStatus, setFilterStatus] = useState('all')
  const [sortBy, setSortBy] = useState('deadline') // deadline, priority
  const [summary, setSummary] = useState(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [users, setUsers] = useState([])

  useEffect(() => {
    if (token) {
      checkAdminStatus()
      fetchTasks()
      fetchSummary()
      setView('tasks')
    }
  }, [token])

  const checkAdminStatus = async () => {
    try {
      const res = await axios.get(`${API_URL}/admin/users`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      setIsAdmin(true)
      setUsers(res.data)
    } catch (err) {
      setIsAdmin(false)
    }
  }

  const fetchUsers = async () => {
    try {
      const res = await axios.get(`${API_URL}/admin/users`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      setUsers(res.data)
    } catch (err) {
      console.error(err)
    }
  }

  const updateRole = async (userId, role) => {
    try {
      await axios.put(`${API_URL}/admin/users/${userId}?role=${role}`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      })
      fetchUsers()
    } catch (err) {
      alert('Failed to update role')
    }
  }

  const deleteUser = async (userId) => {
    try {
      await axios.delete(`${API_URL}/admin/users/${userId}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      fetchUsers()
    } catch (err) {
      alert('Failed to delete user')
    }
  }

  useEffect(() => {
    const root = window.document.documentElement
    root.classList.remove('light', 'dark')
    
    let effectiveTheme = theme
    if (theme === 'system') {
      effectiveTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    }
    
    root.classList.add(effectiveTheme)
    localStorage.setItem('theme', theme)
  }, [theme])

  useEffect(() => {
    if (token) {
      fetchTasks()
      fetchSummary()
      setView('tasks')
    }
  }, [token])

  const fetchSummary = async (tokenToUse = token) => {
    try {
      const res = await axios.get(`${API_URL}/summary`, {
        headers: { Authorization: `Bearer ${tokenToUse}` }
      })
      setSummary(res.data)
    } catch (err) {
      console.error(err)
    }
  }

  const fetchTasks = async (tokenToUse = token) => {
    try {
      let url = `${API_URL}/tasks`
      const params = []
      if (filterStatus !== 'all') params.push(`status=${filterStatus}`)
      if (params.length) url += `?${params.join('&')}`
      
      const res = await axios.get(url, {
        headers: { Authorization: `Bearer ${tokenToUse}` }
      })
      let data = res.data
      
      // Client-side sorting for now
      if (sortBy === 'deadline') {
        data.sort((a, b) => new Date(a.deadline || '9999-12-31') - new Date(b.deadline || '9999-12-31'))
      } else if (sortBy === 'priority') {
        data.sort((a, b) => b.priority - a.priority)
      }
      
      setTasks(data)
    } catch (err) {
      console.error(err)
      if (tokenToUse === token) {
        logout()
      }
    }
  }

  const login = async (e) => {
    e.preventDefault()
    try {
      const res = await axios.post(`${API_URL}/auth/login`, { username, password })
      const newToken = res.data.access_token
      localStorage.setItem('token', newToken)
      setToken(newToken)
      setView('tasks')
      await fetchTasks(newToken)
      await fetchSummary(newToken)
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
    window.location.reload() // Force reload to clear all state and effects
  }

  const createTask = async (e) => {
    e.preventDefault()
    try {
      await axios.post(`${API_URL}/tasks`, newTask, {
        headers: { Authorization: `Bearer ${token}` }
      })
      setNewTask({ title: '', description: '', priority: 1, deadline: '', tag: '' })
      setIsModalOpen(false)
      fetchTasks()
      fetchSummary()
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
      fetchSummary()
    } catch (err) {
      alert('Failed to delete task')
    }
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

  if (view === 'admin') {
    return (
      <div className="min-h-screen bg-gray-100 dark:bg-gray-900 text-gray-800 dark:text-gray-200">
        <header className="bg-white dark:bg-gray-800 shadow p-4 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <button onClick={() => setView('tasks')} className="text-blue-500 hover:underline">← Back to Dashboard</button>
            <h1 className="text-xl font-bold">Admin Panel</h1>
          </div>
          <button onClick={logout} className="text-red-500">Logout</button>
        </header>
        <main className="p-4 max-w-4xl mx-auto">
          <div className="bg-white dark:bg-gray-800 rounded shadow overflow-hidden">
            <table className="w-full text-left">
              <thead className="bg-gray-50 dark:bg-gray-700">
                <tr>
                  <th className="p-4">Username</th>
                  <th className="p-4">Role</th>
                  <th className="p-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id} className="border-t dark:border-gray-700">
                    <td className="p-4">{u.username}</td>
                    <td className="p-4">
                      <select 
                        value={u.role} 
                        onChange={(e) => updateRole(u.id, e.target.value)}
                        className="bg-gray-100 dark:bg-gray-700 border-none rounded text-xs p-1"
                      >
                        <option value="user">User</option>
                        <option value="admin">Admin</option>
                      </select>
                    </td>
                    <td className="p-4 text-right">
                      <button onClick={() => deleteUser(u.id)} className="text-red-500 text-xs hover:underline">Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900 text-gray-800 dark:text-gray-200">
      <header className="bg-white dark:bg-gray-800 shadow p-4 flex justify-between items-center">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-bold">OmniTask</h1>
          {isAdmin && (
            <button 
              onClick={() => setView('admin')} 
              className="text-xs bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200 px-2 py-1 rounded hover:bg-purple-200"
            >
              Admin
            </button>
          )}
          <select 
            value={theme} 
            onChange={(e) => setTheme(e.target.value)}
            className="bg-gray-100 dark:bg-gray-700 border-none rounded text-sm p-1"
          >
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </div>
        <button onClick={logout} className="text-red-500">Logout</button>
      </header>
      <main className="p-4 max-w-4xl mx-auto">
        {/* Dashboard */}
        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <div className="bg-white dark:bg-gray-800 p-4 rounded shadow text-center">
              <div className="text-2xl font-bold text-blue-500">{summary.total}</div>
              <div className="text-xs text-gray-500">Total</div>
            </div>
            <div className="bg-white dark:bg-gray-800 p-4 rounded shadow text-center">
              <div className="text-2xl font-bold text-yellow-500">{summary.todo}</div>
              <div className="text-xs text-gray-500">To Do</div>
            </div>
            <div className="bg-white dark:bg-gray-800 p-4 rounded shadow text-center">
              <div className="text-2xl font-bold text-purple-500">{summary.in_progress}</div>
              <div className="text-xs text-gray-500">In Progress</div>
            </div>
            <div className="bg-white dark:bg-gray-800 p-4 rounded shadow text-center">
              <div className="text-2xl font-bold text-red-500">{summary.overdue}</div>
              <div className="text-xs text-gray-500">Overdue</div>
            </div>
          </div>
        )}

        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold">My Tasks</h3>
          <button 
            onClick={() => setIsModalOpen(true)} 
            className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 flex items-center gap-2"
          >
            <span>+</span> New Task
          </button>
        </div>

        <div className="flex justify-between items-center mb-4">
          <div className="flex gap-2">
            <select 
              value={filterStatus} 
              onChange={(e) => { setFilterStatus(e.target.value); fetchTasks(); }}
              className="bg-white dark:bg-gray-800 border rounded p-1 text-sm"
            >
              <option value="all">All Statuses</option>
              <option value="todo">To Do</option>
              <option value="in_progress">In Progress</option>
              <option value="done">Done</option>
            </select>
            <select 
              value={sortBy} 
              onChange={(e) => { setSortBy(e.target.value); fetchTasks(); }}
              className="bg-white dark:bg-gray-800 border rounded p-1 text-sm"
            >
              <option value="deadline">Sort by Deadline</option>
              <option value="priority">Sort by Priority</option>
            </select>
          </div>
        </div>

        <div className="space-y-4">
          {tasks.map(task => (
            <div key={task.id} className="bg-white dark:bg-gray-800 p-4 rounded shadow flex justify-between items-start">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <h4 className={`font-bold ${task.priority === 3 ? 'text-red-500' : task.priority === 2 ? 'text-yellow-500' : 'text-green-500'}`}>
                    {task.title}
                  </h4>
                  {task.tag && <span className="text-xs bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 px-2 py-0.5 rounded">{task.tag}</span>}
                </div>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">{task.description}</p>
                <div className="flex items-center gap-4 text-xs text-gray-500">
                  <span>Status: {task.status}</span>
                  {task.deadline && <span className={new Date(task.deadline) < new Date() && task.status !== 'done' ? 'text-red-500 font-bold' : ''}>
                    Deadline: {new Date(task.deadline).toLocaleString()}
                  </span>}
                </div>
              </div>
              <button onClick={() => deleteTask(task.id)} className="text-red-500 hover:text-red-700 ml-4">Delete</button>
            </div>
          ))}
        </div>
      </main>

      {/* Task Creation Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-xl w-full max-w-2xl relative">
            <button 
              onClick={() => setIsModalOpen(false)} 
              className="absolute top-4 right-4 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            >
              ✕
            </button>
            <h3 className="text-xl font-bold mb-6">Create New Task</h3>
            <form onSubmit={createTask} className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <label className="block text-sm font-medium mb-1">Title</label>
                <input
                  type="text"
                  placeholder="Enter task title"
                  value={newTask.title}
                  onChange={(e) => setNewTask({ ...newTask, title: e.target.value })}
                  className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Deadline</label>
                <input
                  type="datetime-local"
                  value={newTask.deadline}
                  onChange={(e) => setNewTask({ ...newTask, deadline: e.target.value })}
                  className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Priority</label>
                <select
                  value={newTask.priority}
                  onChange={(e) => setNewTask({ ...newTask, priority: parseInt(e.target.value) })}
                  className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600"
                >
                  <option value={1}>Low</option>
                  <option value={2}>Medium</option>
                  <option value={3}>High</option>
                </select>
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium mb-1">Description</label>
                <textarea
                  placeholder="Enter task description"
                  value={newTask.description}
                  onChange={(e) => setNewTask({ ...newTask, description: e.target.value })}
                  className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Tag</label>
                <input
                  type="text"
                  placeholder="e.g. work, personal"
                  value={newTask.tag}
                  onChange={(e) => setNewTask({ ...newTask, tag: e.target.value })}
                  className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600"
                />
              </div>
              <div className="md:col-span-2 flex justify-end gap-2 mt-4">
                <button 
                  type="button" 
                  onClick={() => setIsModalOpen(false)} 
                  className="px-4 py-2 text-gray-500 hover:text-gray-700 dark:text-gray-400"
                >
                  Cancel
                </button>
                <button type="submit" className="bg-blue-500 text-white px-6 py-2 rounded hover:bg-blue-600">
                  Create Task
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
