export default function AdminPanel({
  users,
  onUpdateRole,
  onDeleteUser,
  onBack,
  settings,
  onToggleRegistration,
}) {
  const allowRegistration = settings?.allow_registration !== false

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900 text-gray-800 dark:text-gray-200">
      <header className="bg-white dark:bg-gray-800 shadow p-4 flex justify-between items-center">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="text-blue-500 hover:underline">
            ← На главную
          </button>
          <h1 className="text-xl font-bold">Панель администратора</h1>
        </div>
      </header>
      <main className="p-4 max-w-4xl mx-auto">
        <section className="bg-white dark:bg-gray-800 rounded shadow p-4 mb-6">
          <h2 className="font-semibold mb-2">Настройки сервера</h2>
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={allowRegistration}
              onChange={(e) => onToggleRegistration(e.target.checked)}
              className="w-5 h-5"
            />
            <span>
              Разрешить регистрацию новых пользователей
              <span className="block text-xs text-gray-500">
                Если выключено, новые пользователи не смогут создать аккаунт.
              </span>
            </span>
          </label>
        </section>

        <div className="bg-white dark:bg-gray-800 rounded shadow overflow-hidden">
          <table className="w-full text-left">
            <thead className="bg-gray-50 dark:bg-gray-700">
              <tr>
                <th className="p-4">Пользователь</th>
                <th className="p-4">Роль</th>
                <th className="p-4 text-right">Действия</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-t dark:border-gray-700">
                  <td className="p-4">{u.username}</td>
                  <td className="p-4">
                    <select
                      value={u.role}
                      onChange={(e) => onUpdateRole(u.id, e.target.value)}
                      className="bg-gray-100 dark:bg-gray-700 border-none rounded text-xs p-1"
                    >
                      <option value="user">Пользователь</option>
                      <option value="admin">Администратор</option>
                    </select>
                  </td>
                  <td className="p-4 text-right">
                    <button
                      onClick={() => onDeleteUser(u.id)}
                      className="text-red-500 text-xs hover:underline"
                    >
                      Удалить
                    </button>
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
