import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import BoardSwitcher from './BoardSwitcher'

function UserIcon() {
  // Same visual style as the TaskCard trash icon: 24x24 stroke SVG, w-5 h-5.
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
    </svg>
  )
}

export default function Layout({
  isAdmin,
  onAdmin,
  onLogout,
  onProfile,
  onCurrencies,
  // board carousel props
  boards = [],
  activeBoardId = null,
  onSwitchBoard,
  onReorderBoard,
  onEditBoard,
  onCreateBoard,
  onPlanner,
  onFilterChange,
  activeBoard = null,
  maxBoards,
  children,
}) {
  const { t } = useTranslation()
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuClosing, setMenuClosing] = useState(false)
  const menuRef = useRef(null)
  const menuTimer = useRef(null)

  // Мобильный селектор фильтров (перенесён в хедер из App.jsx).
  const [filterMenuOpen, setFilterMenuOpen] = useState(false)
  const [filterMenuClosing, setFilterMenuClosing] = useState(false)
  const filterMenuTimer = useRef(null)
  const closeFilterMenu = () => {
    if (!filterMenuOpen || filterMenuClosing) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setFilterMenuOpen(false)
      return
    }
    setFilterMenuClosing(true)
    filterMenuTimer.current = setTimeout(() => {
      setFilterMenuClosing(false)
      setFilterMenuOpen(false)
    }, 140)
  }
  useEffect(() => () => clearTimeout(filterMenuTimer.current), [])

  const summary = summaryProp || {}
  const FILTERS = summary
    ? [
        { id: 'all', label: t('filters.all'), count: summary.total },
        { id: 'todo', label: t('filters.todo'), count: summary.todo },
        { id: 'in_progress', label: t('filters.in_progress'), count: summary.in_progress },
        { id: 'done', label: t('filters.done'), count: summary.done },
        { id: 'overdue', label: t('filters.overdue'), count: summary.overdue },
        { id: 'planned', label: t('filters.planned'), count: summary.planned ?? 0 },
      ]
    : []

  // Close the dropdown on any click outside of it.
  useEffect(() => {
    if (!menuOpen) return
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) closeMenu()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuOpen, menuClosing])

  return (
    <div
      className="min-h-screen md:h-dvh md:flex md:flex-col text-slate-800"
      style={{
        backgroundColor: '#35506b',
        backgroundImage: activeBoard?.color
          ? `linear-gradient(180deg, ${activeBoard.color}22 0%, rgba(53,80,107,0) 320px)`
          : undefined,
      }}
    >
      <header className="bg-[#22384d] shadow px-3 sm:px-4 py-3 flex items-center gap-2">
        {/* Логотип + название — скрываются на мобильных */}
        <button
          type="button"
          onClick={() => window.location.reload()}
          title={t('layout.refresh')}
          className="hidden md:flex shrink-0 items-center gap-2 rounded px-1 py-0.5 hover:bg-white/10 transition-colors cursor-pointer"
        >
          <img src="/ico.png" alt="OmniTask" className="w-7 h-7 rounded" />
          <span className="text-lg font-extrabold tracking-widest uppercase text-white">
            Omni<span className="text-sky-300">Task</span>
          </span>
        </button>

        {/* Планировщик: на десктопе — в шапке; на мобильных кнопка живёт
            в панели действий App.jsx (там же фильтры) — шапка не перегружается. */}
        <button
          type="button"
          onClick={onPlanner}
          title={t('layout.openPlanner')}
          className="hidden md:block shrink-0 rounded-lg bg-green-600 px-3 py-2 text-xs font-bold text-white shadow-sm transition-colors hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-300 focus:ring-offset-1 focus:ring-offset-[#22384d]"
        >
          {t('layout.planner')}
        </button>

        {/* Переключатель досок — центр хедера */}
        {boards.length ? (
          <BoardSwitcher
            boards={boards}
            activeId={activeBoardId}
            maxBoards={maxBoards}
            onSwitch={onSwitchBoard}
            onReorder={onReorderBoard}
            onEdit={onEditBoard}
          />
        ) : (
          <div className="flex-1" />
        )}

        <button
          type="button"
          onClick={onCreateBoard}
          disabled={boards.length >= (maxBoards ?? Infinity)}
          title={t('layout.newBoard')}
          className="shrink-0 rounded-lg border border-dashed border-white/40 px-2.5 py-1.5 text-xs font-semibold text-white/80 hover:border-white/70 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          <span className="sm:hidden">{t('layout.newBoardShort')}</span>
          <span className="hidden sm:inline">{t('layout.newBoardFull')}</span>
        </button>

        {/* Селектор фильтров: справа — мобильный dropdown; десктопные фильтры
            остаются на дашборде. */}
        <div className="md:hidden relative shrink-0">
          <button
            onClick={() => (filterMenuOpen ? closeFilterMenu() : (clearTimeout(filterMenuTimer.current), setFilterMenuClosing(false), setFilterMenuOpen(true)))}
            className="bg-card text-slate-700 px-3 py-2 rounded shadow-sm text-sm flex items-center gap-1 whitespace-nowrap"
          >
            {FILTERS.find((f) => f.id === activeFilter)?.label || 'Фильтры'}
            <span className={`text-[10px] transition-transform ${filterMenuOpen ? 'rotate-180' : ''}`}>▼</span>
          </button>
          {/* Full-screen invisible overlay: closes the menu on any tap
              outside of it and blocks the dashboard underneath. */}
          {(filterMenuOpen || filterMenuClosing) && (
            <div
              className="fixed inset-0 z-30"
              onClick={closeFilterMenu}
            />
          )}
          {(filterMenuOpen || filterMenuClosing) && (
            <div className={`absolute left-0 top-full mt-1 z-40 bg-white rounded shadow-lg py-1 min-w-[12rem] ${filterMenuClosing ? 'dropdown-out' : 'dropdown-in'}`}>
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  onClick={() => {
                    onFilterChange(f.id)
                    closeFilterMenu()
                  }}
                  className={`w-full text-left px-3 py-2 text-sm flex justify-between items-center hover:bg-slate-100 ${
                    activeFilter === f.id ? 'font-semibold text-[#22384d] bg-slate-100' : 'text-slate-700'
                  }`}
                >
                  <span>{f.label}</span>
                  <span className="text-xs text-slate-400">{f.count}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Профиль: иконка пользователя в стиле иконки «Корзины» + dropdown */}
        <div className="relative shrink-0" ref={menuRef}>
          <button
            onClick={() => (menuOpen ? closeMenu() : (clearTimeout(menuTimer.current), setMenuClosing(false), setMenuOpen(true)))}
            title={t('layout.profile')}
            className="w-9 h-9 flex items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors"
          >
            <UserIcon />
          </button>
          {(menuOpen || menuClosing) && (
            <div className={`absolute right-0 top-full mt-1 z-50 bg-white rounded-lg shadow-lg py-1 min-w-[13rem] ${menuClosing ? 'dropdown-out' : 'dropdown-in'}`}>
              <button
                onClick={() => {
                  closeMenu()
                  onProfile()
                }}
                className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 flex items-center gap-2"
              >
                <UserIcon /> {t('layout.profile')}
              </button>
              {isAdmin && (
                <button
                  onClick={() => {
                    closeMenu()
                    onAdmin()
                  }}
                  className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-100"
                >
                  {t('layout.adminPanel')}
                </button>
              )}
              <button
                onClick={() => {
                  closeMenu()
                  onCurrencies?.()
                }}
                className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-100"
              >
                {t('layout.currencySettings')}
              </button>
              <div className="border-t border-gray-100 my-1" />
              <button
                onClick={() => {
                  closeMenu()
                  onLogout()
                }}
                className="w-full text-left px-4 py-2 text-sm text-red-500 hover:bg-red-50"
              >
                {t('layout.logout')}
              </button>
            </div>
          )}
        </div>
      </header>
      {/* Канбан (ТЗv2 §1): рабочая область — во всю ширину окна браузера.
          Ограничение max-w осталось бы узким горлышком для горизонтального
          ряда колонок; единственное исключение — очень широкие экраны (2xl),
          где строки текста становятся слишком длинными. */}
      {/* На десктопе main — колонка на остаток высоты экрана: канбан-колонки
          растягиваются до низа вьюпорта, горизонтальная прокрутка списка
          оказывается внизу экрана, а не под самым длинным списком. */}
      <main className="p-4 w-full max-w-none xl:max-w-none 2xl:max-w-[2400px] 2xl:mx-auto md:flex md:flex-col md:flex-1 md:min-h-0">{children}</main>
    </div>
  )
}
