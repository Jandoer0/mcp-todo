export default function Layout({ isAdmin, onAdmin, onLogout, children }) {
  return (
    <div className="min-h-screen bg-[#35506b] text-slate-800">
      <header className="bg-[#22384d] shadow px-4 py-3 flex items-center justify-between gap-2">
        {/* Название — всегда слева */}
        <h1 className="text-lg font-bold tracking-wide text-white shrink-0">OmniTask</h1>

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
