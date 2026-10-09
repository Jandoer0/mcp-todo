export default function Layout({ isAdmin, onAdmin, onLogout, children }) {
  return (
    <div className="min-h-screen bg-[#35506b] text-slate-800">
      <header className="bg-[#22384d] shadow p-4 grid grid-cols-3 items-center">
        {/* Левая ячейка (пустая для симметрии) */}
        <div />

        {/* Средняя ячейка: Название */}
        {/* Средняя ячейка: Название (на мобильных — слева, чтобы не перекрывалась кнопкой админки) */}
        <div className="flex justify-start md:justify-center">
          <h1 className="text-lg font-bold tracking-wide text-white">OmniTask</h1>
        </div>

        {/* Правая ячейка: Админка и Выход */}
        <div className="flex justify-end items-center gap-4">
          {isAdmin && (
            <button
              onClick={onAdmin}
              className="text-xs bg-white/10 text-white px-2 py-1 rounded hover:bg-white/20"
            >
              Панель администратора
            </button>
          )}
          <button onClick={onLogout} className="text-red-300 text-sm font-medium hover:text-red-200">
            Выйти
          </button>
        </div>
      </header>
      <main className="p-4 max-w-4xl mx-auto">{children}</main>
    </div>
  )
}
