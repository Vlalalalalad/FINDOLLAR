import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { LogOut, Trash2, Eraser, AlertTriangle, Coins, Calendar, RefreshCw, Wallet, ArrowLeftRight, Tags, Calculator, ChartNoAxesCombined, ChevronRight } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useProfile } from '../hooks/useProfile'
import { useExchangeRates } from '../hooks/useExchangeRates'
import { useAccounts } from '../hooks'
import { Button, Card, Input, Label, Modal, useConfirm } from '../components/ui'
import { supabase } from '../lib/supabase'
import clsx from 'clsx'
import { AccountManager } from '../components/AccountSwitcher'
import { NotificationSettings } from '../components/planner/PlannerReminders'

const DELETE_PHRASE = 'ВИДАЛИТИ'

const PROFILE_TOOLS = [
  { to: '/accounts', label: 'Активи', icon: Wallet },
  { to: '/transactions', label: 'Операції', icon: ArrowLeftRight },
  { to: '/categories', label: 'Категорії', icon: Tags },
  { to: '/calculator', label: 'Калькулятор', icon: Calculator },
  { to: '/statistics', label: 'Статистика', icon: ChartNoAxesCombined },
]

function ProfileTools() {
  return (
    <Card>
      <h2 id="profile-tools-title" className="mb-3 font-display font-semibold text-text">Інструменти</h2>
      <nav aria-labelledby="profile-tools-title" className="flex flex-col gap-1">
        {PROFILE_TOOLS.map(item => (
          <Link
            key={item.to}
            to={item.to}
            className="flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm text-text transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          >
            <item.icon size={18} className="shrink-0 text-text-muted" />
            <span className="flex-1">{item.label}</span>
            <ChevronRight size={16} className="text-text-muted" />
          </Link>
        ))}
      </nav>
    </Card>
  )
}

export function Profile() {
  const { user, signOut } = useAuth()
  const { profile, loading: profileLoading, updateProfile } = useProfile()
  const { rates, ratesMap, setRate, loading: ratesLoading, refresh: refreshRatesList } = useExchangeRates()
  const { data: accounts, loading: accountsLoading } = useAccounts()
  const navigate = useNavigate()
  const { confirm, ConfirmDialog } = useConfirm()

  const [rateInputs, setRateInputs] = useState<Record<string, string>>({})
  const [savingCurrency, setSavingCurrency] = useState<string | null>(null)
  const [refreshingRates, setRefreshingRates] = useState(false)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const [refreshedJustNow, setRefreshedJustNow] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [clearError, setClearError] = useState<string | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [savingName, setSavingName] = useState(false)
  const [nameMessage, setNameMessage] = useState<string | null>(null)

  useEffect(() => {
    if (profile && profile.id === user?.id) setDisplayName(profile.full_name ?? '')
  }, [profile?.id, profile?.full_name, user?.id])

  const baseCurrency = profile?.base_currency ?? 'UAH'

  const currenciesInUse = useMemo(
    () =>
      Array.from(new Set(accounts.filter(a => !a.is_archived).map(a => a.currency)))
        .filter(c => c !== baseCurrency)
        .sort(),
    [accounts, baseCurrency]
  )

  if (profileLoading || ratesLoading || accountsLoading) {
    return (
      <div className="flex flex-col gap-6" aria-label="Завантаження профілю">
        <div className="h-8 w-28 rounded-lg bg-surface-2" />
        <ProfileTools />
        <AccountManager />
        <div className="h-28 rounded-xl border border-border bg-surface" />
        <div className="h-52 rounded-xl border border-border bg-surface" />
        <div className="h-32 rounded-xl border border-border bg-surface" />
      </div>
    )
  }

  const handleSaveRate = async (currency: string) => {
    const raw = rateInputs[currency]
    const value = Number(raw)
    if (!raw || !Number.isFinite(value) || value <= 0) return
    setSavingCurrency(currency)
    try {
      await setRate(currency, value)
    } finally {
      setSavingCurrency(null)
    }
  }

  const handleRefreshRates = async () => {
    setRefreshingRates(true)
    setRefreshError(null)
    setRefreshedJustNow(false)
    try {
      const { data, error } = await supabase.functions.invoke('fetch-rates')
      if (error) throw error
      if (data?.error) throw new Error(data.error)
      await refreshRatesList()
      setRefreshedJustNow(true)
    } catch (err) {
      setRefreshError(
        err instanceof Error
          ? err.message
          : 'Не вдалося оновити курси. Перевір, чи задеплоєна функція fetch-rates у Supabase.'
      )
    } finally {
      setRefreshingRates(false)
    }
  }

  const handleSignOut = async () => {
    await signOut()
    navigate('/auth')
  }

  const handleSaveName = async (event: FormEvent) => {
    event.preventDefault()
    if (!user || savingName) return
    setSavingName(true)
    setNameMessage(null)
    try {
      const normalized = displayName.trim()
      await updateProfile({ full_name: normalized || null })
      setDisplayName(normalized)
      setNameMessage('Назву збережено.')
    } catch (error) {
      setNameMessage(error instanceof Error ? error.message : 'Не вдалося зберегти назву.')
    } finally { setSavingName(false) }
  }

  const closeDeleteModal = () => {
    setDeleteOpen(false)
    setConfirmText('')
    setDeleteError(null)
  }

  // "Очистити дані" — використовує delete_my_data(), функцію в БД,
  // додану ще з першою реалізацією видалення акаунту (0002). Реально
  // видаляє всі рядки з БД (не архівує), логін лишається активним.
  const handleClearData = async () => {
    const ok = await confirm(
      'Видалити геть усі активи, операції, категорії, борги й курси валют? Логін лишиться — просто побачиш застосунок таким, яким він був одразу після реєстрації. Це незворотно.',
      { confirmLabel: 'Очистити все', danger: true }
    )
    if (!ok) return
    setClearing(true)
    setClearError(null)
    try {
      const { error } = await supabase.rpc('delete_my_data')
      if (error) throw error
      window.location.href = '/'
    } catch (err) {
      setClearing(false)
      setClearError(
        err instanceof Error
          ? err.message
          : 'Не вдалося очистити дані. Перевір, чи виконана міграція 0002 у Supabase.'
      )
    }
  }

  const handleDeleteAccount = async () => {
    setDeleting(true)
    setDeleteError(null)
    try {
      const { data, error } = await supabase.functions.invoke('delete-account')
      if (error) throw error
      if (data?.error) throw new Error(data.error)
      await signOut({ skipDeviceCleanup: true })
      navigate('/auth')
    } catch (err) {
      setDeleting(false)
      setDeleteError(
        err instanceof Error
          ? err.message
          : 'Не вдалося видалити акаунт. Перевір, чи задеплоєна функція delete-account у Supabase.'
      )
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-2xl font-bold text-text">Профіль</h1>

      <ProfileTools />
      <Card>
        <form className="flex flex-col gap-3" onSubmit={handleSaveName}>
          <div>
            <h2 className="font-display font-semibold text-text">Акаунт</h2>
            <p className="text-xs text-text-muted">{user?.email}</p>
          </div>
          <Label>Назва профілю
            <Input value={displayName} maxLength={80} autoComplete="off" disabled={savingName} onChange={event => { setDisplayName(event.target.value); setNameMessage(null) }} />
          </Label>
          <div className="flex items-center gap-3">
            <Button type="submit" variant="secondary" className="w-fit" disabled={savingName || displayName.trim() === (profile?.full_name ?? '')}>{savingName ? 'Збереження…' : 'Зберегти'}</Button>
            {nameMessage && <span role="status" className="text-sm text-text-muted">{nameMessage}</span>}
          </div>
        </form>
      </Card>

      <AccountManager />

      <Card>
        <NotificationSettings />
      </Card>

      <Card className="flex flex-col gap-3">
        {user?.created_at && (
          <div className="flex items-center gap-2">
            <Calendar size={16} className="text-text-muted" />
            <span className="text-sm text-text-muted">
              На платформі з {new Date(user.created_at).toLocaleDateString('uk-UA')}
            </span>
          </div>
        )}
      </Card>

      <Card className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 font-display font-semibold text-text">
              <Coins size={16} /> Курси валют
            </h2>
            <p className="mt-1 text-sm text-text-muted">
              Базова валюта — <b className="text-text">{baseCurrency}</b> (міняється стрілочкою біля «Загальний
              капітал» на Огляді). Курси оновлюються самі — НБУ для гривні, CoinGecko для крипти — щойно
              відкриваєш застосунок і курс застарів більш як на 12 год.
            </p>
          </div>
          <Button type="button" variant="secondary" onClick={handleRefreshRates} disabled={refreshingRates}>
            <RefreshCw size={15} className={clsx(refreshingRates && 'animate-spin')} />
            {refreshingRates ? 'Оновлюю...' : 'Оновити'}
          </Button>
        </div>

        {refreshError && <p className="text-sm text-danger">{refreshError}</p>}
        {refreshedJustNow && !refreshError && <p className="text-sm text-success">Курси оновлено.</p>}

        {ratesLoading ? (
          <p className="text-sm text-text-muted">Завантаження...</p>
        ) : currenciesInUse.length === 0 ? (
          <p className="text-sm text-text-muted">
            Усі твої активи вже в базовій валюті ({baseCurrency}) — курси поки не потрібні.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {currenciesInUse.map(currency => {
              const existing = ratesMap[currency]
              const rateRow = rates.find(r => r.currency === currency)
              const value = rateInputs[currency] ?? (existing != null ? String(existing) : '')
              return (
                <div key={currency} className="flex flex-col gap-1">
                  <div className="flex items-end gap-2">
                    <div className="flex-1">
                      <Label>1 {currency} =</Label>
                      <Input
                        type="number"
                        step="0.00000001"
                        min="0"
                        placeholder={`курс у ${baseCurrency}`}
                        value={value}
                        onChange={e => setRateInputs(prev => ({ ...prev, [currency]: e.target.value }))}
                      />
                    </div>
                    <span className="pb-2.5 text-sm text-text-muted">{baseCurrency}</span>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={savingCurrency === currency || !value}
                      onClick={() => handleSaveRate(currency)}
                    >
                      {savingCurrency === currency ? '...' : 'Зберегти вручну'}
                    </Button>
                  </div>
                  <span className="text-xs text-text-muted">
                    {rateRow
                      ? `оновлено ${new Date(rateRow.updated_at).toLocaleString('uk-UA')}`
                      : 'курс ще не задано — оновиться автоматично, або встав число і натисни "Зберегти вручну"'}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </Card>

      <Card className="flex flex-col gap-3">
        <h2 className="font-display font-semibold text-text">Сесія</h2>
        <Button variant="secondary" onClick={handleSignOut} className="w-fit">
          <LogOut size={16} /> Вийти з акаунту
        </Button>
      </Card>

      <Card className="flex flex-col gap-3">
        <h2 className="flex items-center gap-2 font-display font-semibold text-warning">
          <Eraser size={16} /> Очистити дані
        </h2>
        <p className="text-sm text-text-muted">
          Видаляє всі активи, операції, категорії, борги й курси валют — і починаєш з чистого аркуша. Логін і
          вхід лишаються — це не видалення акаунту, просто скидання даних.
        </p>
        {clearError && <p className="text-sm text-danger">{clearError}</p>}
        <Button variant="secondary" onClick={handleClearData} disabled={clearing} className="w-fit">
          <Eraser size={16} /> {clearing ? 'Очищення...' : 'Очистити дані'}
        </Button>
      </Card>

      <Card className="flex flex-col gap-3">
        <h2 className="flex items-center gap-2 font-display font-semibold text-danger">
          <AlertTriangle size={16} /> Небезпечна зона
        </h2>
        <p className="text-sm text-text-muted">
          Видаляє акаунт повністю — і всі дані (активи, операції, категорії, борги, курси), і сам логін. Це
          незворотно. Після видалення можна зареєструватись на ту саму пошту знову, але це буде вже зовсім
          новий, чистий акаунт — зі старого нічого не збережеться.
        </p>
        <Button variant="danger" onClick={() => setDeleteOpen(true)} className="w-fit">
          <Trash2 size={16} /> Видалити акаунт
        </Button>
      </Card>

      <Modal open={deleteOpen} onClose={closeDeleteModal} title="Видалити акаунт?">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-text">
            Це незворотно видалить акаунт цілком: усі активи, операції, категорії, борги, курси — і сам логін
            (пошту/пароль). Щоб підтвердити, введи <b className="font-mono">{DELETE_PHRASE}</b> нижче.
          </p>
          <Input value={confirmText} onChange={e => setConfirmText(e.target.value)} placeholder={DELETE_PHRASE} />
          {deleteError && <p className="text-sm text-danger">{deleteError}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={closeDeleteModal}>
              Скасувати
            </Button>
            <Button
              variant="danger"
              disabled={confirmText !== DELETE_PHRASE || deleting}
              onClick={handleDeleteAccount}
            >
              {deleting ? 'Видалення...' : 'Видалити назавжди'}
            </Button>
          </div>
        </div>
      </Modal>
      {ConfirmDialog}
    </div>
  )
}
