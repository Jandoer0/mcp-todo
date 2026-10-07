export default function AdminPanel({
  users,
  onUpdateRole,
  onDeleteUser,
  onBack,
  settings,
  onToggleRegistration,
  open,
}) {
  if (!open) return null

  const allowRegistration = settings?.allow_registration !== false

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col relative">
        <button
          onClick={onBack}
          className="absolute top-4 right-4 text-gray-500 hover:text-gray-700 dark:text-gray-400 z-10"
        >
          ✕
        </button>
        
        <header className="bg-gray-50 dark:bg-gray-700 p-4 border-b dark:border-gray-600">
          <h1 className="text-xl font-bold">Панель администратора</h1>
        </header>

        <main className="p-6 overflow-y-auto">
          <section className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4 mb-6 border dark:border-gray-600">
            <h2 className="font-semibold mb-3 text-sm uppercase tracking-wider text-gray-500">Настройки сервера</h2>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={allowRegistration}
                onChange={(e) => onToggleRegistration(e.target.checked)}
                className="w-5 h-5"
              />
              <span className="text-sm">
                Разрешить регистрацию новых пользователей
                <span className="block text-xs text-gray-500">
                  Если выключено, новые пользователи не смогут создать аккаунт.
                </span>
              </span>
            </label>
          </section>

          <div className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 overflow-hidden">
            <table className="w-full text-left">
              <thead className="bg-gray-50 dark:bg-gray-700">
                <tr className="text-xs uppercase text-gray-500">
                  <th className="p-4">Пользователь</th>
                  <th className="p-4">Роль</th>
                  <th className="p-4 text-right">Действия</th>
                </tr>
              </thead>
              <tbody className="divide-y dark:divide-gray-700">
                {users.map((u) => (
                  <tr key={u.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="p-4 font-medium">{u.username}</td>
                    <td className="p-4">
                      <select
                        value={u.role}
                        onChange={(e) => onUpdateRole(u.id, e.target.value)}
                        className="bg-gray-100 dark:bg-gray-600 border-none rounded text-xs p-1 outline-none"
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
    </div>
  )
}
