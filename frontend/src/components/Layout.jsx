export default function Layout({
  isAdmin,
  onAdmin,
  onLogout,
  theme,
  onThemeChange,
  children,
}) {
  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900 text-gray-800 dark:text-gray-200">
      <header className="bg-white dark:bg-gray-800 shadow p-4 flex justify-between items-center">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-bold">OmniTask</h1>
          {isAdmin && (
            <button
              onClick={onAdmin}
              className="text-xs bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200 px-2 py-1 rounded hover:bg-purple-200"
            >
              Панель администратора
            </button>
          )}
          <select
            value={theme}
            onChange={(e) => onThemeChange(e.target.value)}
            className="bg-gray-100 dark:bg-gray-700 border-none rounded text-sm p-1"
          >
            <option value="system">Системная</option>
            <option value="light">Светлая</option>
            <option value="dark">Тёмная</option>
          </select>
        </div>
        <button onClick={onLogout} className="text-red-500">
          Выйти
        </button>
      </header>
      <main className="p-4 max-w-4xl mx-auto">{children}</main>
    </div>
  )
}
