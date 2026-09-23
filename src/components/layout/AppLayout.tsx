import { useLayoutEffect, useRef } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import {
  LayoutDashboard,
  HandCoins,
  User,
  Moon,
  Sun,
  Eye,
  EyeOff,
  CalendarDays,
} from 'lucide-react'
import clsx from 'clsx'
import { useTheme } from '../../context/ThemeContext'
import { usePlannerWorkspaceState } from '../../hooks/usePlannerWorkspace'
import { PlannerReminders, PlannerNavBadge } from '../planner/PlannerReminders'
import { PlannerAutoComplete } from '../planner/PlannerAutoComplete'
import { useAccountSwitcher } from '../AccountSwitcher'
import '../planner/planner.css'

const NAV_ITEMS = [
  { to: '/', label: 'Огляд', icon: LayoutDashboard, end: true },
  { to: '/plans', label: 'Плани', icon: CalendarDays, end: false },
  { to: '/debts', label: 'Борги', icon: HandCoins, end: false },
  { to: '/profile', label: 'Профіль', icon: User, end: false },
]

function Brand() {
  return (
    <span className="brand-wordmark text-lg font-extrabold tracking-tight text-text">
      FINDO<span className="brand-wordmark-dollar">$$</span>AR
    </span>
  )
}

export function AppLayout() {
  const { theme, toggleTheme, hideBalances, toggleHideBalances } = useTheme()
  const { pathname } = useLocation()
  const mainRef = useRef<HTMLElement>(null)
  const [, requestPlansHome] = usePlannerWorkspaceState('home-request', 0)
  const accountSwitcher = useAccountSwitcher()

  // Other tabs start at the top. Plans restores its own per-section offset
  // after its retained filters and list have rendered.
  useLayoutEffect(() => {
    if (pathname !== '/plans') mainRef.current?.scrollTo({ top: 0, left: 0, behavior: 'auto' })
  }, [pathname])

  return (
    <div className="app-shell bg-bg">
      <header className="sticky top-0 z-30 flex items-center justify-between bg-surface/90 px-4 py-3 backdrop-blur sm:px-6">
        <Brand />
        <div className="flex items-center gap-1.5">
          <button
            onClick={toggleHideBalances}
            className="rounded-lg p-2 text-text-muted transition-[color,background-color,transform] duration-150 ease-out hover:bg-surface-2 active:scale-95"
            aria-label={hideBalances ? 'Показати суми' : 'Приховати суми'}
          >
            {hideBalances ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
          <button onClick={toggleTheme} className="rounded-lg p-2 text-text-muted transition-[color,background-color,transform] duration-150 ease-out hover:bg-surface-2 active:scale-95" aria-label="Тема">
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </div>
      </header>

      <main key={pathname} ref={mainRef} className="app-main motion-page-enter mx-auto max-w-3xl px-4 pb-24 pt-6 sm:px-6 lg:px-8">
        <Outlet />
      </main>

      <PlannerReminders />
      <PlannerAutoComplete />

      <nav className="app-bottom-nav z-30" aria-label="Основна навігація">
          {NAV_ITEMS.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              {...(item.to === '/profile' ? accountSwitcher.bind : {})}
              data-account-trigger={item.to === '/profile' ? '' : undefined}
              aria-haspopup={item.to === '/profile' ? 'dialog' : undefined}
              aria-expanded={item.to === '/profile' ? accountSwitcher.open : undefined}
              style={item.to === '/profile' ? { touchAction: 'none', WebkitTouchCallout: 'none', WebkitUserSelect: 'none', userSelect: 'none' } : undefined}
              onClick={event => {
                if (item.to !== '/plans' || pathname !== '/plans' || event.button !== 0
                  || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
                event.preventDefault()
                requestPlansHome(value => value + 1)
              }}
              className={({ isActive }) =>
                clsx(
                  'flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-full text-[10px] font-medium leading-none outline-none transition-colors duration-200 ease-out focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/50',
                  isActive ? 'bg-primary/10 text-primary' : 'text-text-muted hover:bg-surface-2/50 hover:text-text'
                )
              }
            >
              {({ isActive }) => (
                <>
                  <item.icon
                    size={20}
                    className={clsx('transition-transform duration-200 ease-out', isActive && 'scale-105')}
                  />
                  <span className="inline-flex items-center">{item.label}{item.to === '/plans' && <PlannerNavBadge />}</span>
                </>
              )}
            </NavLink>
          ))}
      </nav>
      {accountSwitcher.overlay}
    </div>
  )
}
