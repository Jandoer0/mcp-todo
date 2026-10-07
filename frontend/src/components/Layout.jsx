export default function Layout({
  isAdmin,
  onAdmin,
  onManageLists,
  onLogout,
  theme,
  onThemeChange,
  timezone,
  onTimezoneChange,
  children,
}) {
  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900 text-gray-800 dark:text-gray-200">
      <header className="bg-white dark:bg-gray-800 shadow p-4 flex justify-between items-center">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-bold">OmniTask</h1>
          <button
            onClick={onManageLists}
            className="text-xs bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200 px-2 py-1 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
          >
            Списки
          </button>
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
          <select
            value={timezone}
            onChange={(e) => onTimezoneChange(e.target.value)}
            title="Часовой пояс"
            className="bg-gray-100 dark:bg-gray-700 border-none rounded text-sm p-1"
          >
            {TIMEZONES.map((tz) => (
              <option key={tz.value} value={tz.value}>
                {tz.label}
              </option>
            ))}
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

const TIMEZONES = [
  { value: 'Europe/Moscow', label: 'Москва (UTC+3)' },
  { value: 'Europe/Kiev', label: 'Киев (UTC+2)' },
  { value: 'Europe/Minsk', label: 'Минск (UTC+3)' },
  { value: 'Europe/Samara', label: 'Самара (UTC+4)' },
  { value: 'Asia/Yekaterinburg', label: 'Екатеринбург (UTC+5)' },
  { value: 'Asia/Omsk', label: 'Омск (UTC+6)' },
  { value: 'Asia/Novosibirsk', label: 'Новосибирск (UTC+7)' },
  { value: 'Asia/Krasnoyarsk', label: 'Красноярск (UTC+8)' },
  { value: 'Asia/Irkutsk', label: 'Иркутск (UTC+9)' },
  { value: 'Asia/Vladivostok', label: 'Владивосток (UTC+11)' },
  { value: 'Europe/Berlin', label: 'Берлин (UTC+1)' },
  { value: 'Europe/London', label: 'Лондон (UTC+0)' },
  { value: 'America/New_York', label: 'Нью-Йорк (UTC-5)' },
  { value: 'America/Los_Angeles', label: 'Лос-Анджелес (UTC-8)' },
  { value: 'Asia/Tokyo', label: 'Токио (UTC+9)' },
  { value: 'Australia/Sydney', label: 'Сидней (UTC+11)' },
  { value: 'UTC', label: 'UTC (UTC+0)' },
]
