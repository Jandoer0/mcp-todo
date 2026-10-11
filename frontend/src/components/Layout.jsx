export default function Layout({ isAdmin, onAdmin, onLogout, children }) {
  return (
    <div className="min-h-screen bg-[#35506b] text-slate-800">
      <header className="bg-[#22384d] shadow px-4 py-3 flex items-center justify-between gap-2">
        {/* Логотип + название — кликабельны, обновляют страницу */}
        <button
          type="button"
          onClick={() => window.location.reload()}
          title="Обновить страницу"
          className="shrink-0 flex items-center gap-2 rounded px-1 py-0.5 hover:bg-white/10 transition-colors cursor-pointer"
        >
          <img src="/ico.png" alt="OmniTask" className="w-7 h-7 rounded" />
          <span className="text-lg font-extrabold tracking-widest uppercase text-white">
            Omni<span className="text-sky-300">Task</span>
          </span>
        </button>

        {/* Действия справа */}
        <div className="flex justify-end items-center gap-2 sm:gap-4 min-w-0">
          {isAdmin && (
            <button
              onClick={onAdmin}
              className="text-[11px] sm:text-xs bg-white/10 text-white px-2 py-1 rounded hover:bg-white/20 whitespace-nowrap"
            >
              Панель администратора
            </button>
          )}
          <button onClick={onLogout} className="text-red-300 text-sm font-medium hover:text-red-200 shrink-0">
            Выйти
          </button>
        </div>
      </header>
      <main className="p-4 max-w-4xl mx-auto">{children}</main>
    </div>
  )
}
