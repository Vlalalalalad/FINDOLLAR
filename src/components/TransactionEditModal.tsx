import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Button, Input, Label, Modal, Select, Textarea } from './ui'
import { isCrypto } from '../lib/currency'
import { toLocalDatetimeInputValue, localInputValueToIso } from '../lib/datetime'
import type { Account, Category, Mood, Transaction, TransactionType } from '../types/database'
import { categoryPresentation } from '../lib/transactions'

const MOODS: { value: Mood; emoji: string; label: string }[] = [
  { value: 'great', emoji: '🟢', label: 'Кайф / заслужено' },
  { value: 'neutral', emoji: '🟡', label: 'Норм / необхідність' },
  { value: 'regret', emoji: '🔴', label: 'Шкодую / імпульс' },
]

const emptyForm = {
  type: 'expense' as TransactionType,
  account_id: '',
  transfer_to_account_id: '',
  category_id: '',
  amount: '',
  currency: 'UAH',
  description: '',
  mood: '' as Mood | '',
  occurred_at: toLocalDatetimeInputValue(new Date()),
}

export function TransactionEditModal({
  open,
  onClose,
  transaction,
  prefillAccountId,
  prefillType,
  accounts,
  categories,
  onSave,
}: {
  open: boolean
  onClose: () => void
  transaction: Transaction | null
  prefillAccountId?: string
  prefillType?: TransactionType
  accounts: Account[]
  categories: Category[]
  onSave: (id: string | null, values: Record<string, unknown>) => Promise<void>
}) {
  const [form, setForm] = useState(emptyForm)
  const initialized = useRef<string | null>(null)
  const typeCategories = form.type === 'transfer' ? [] : categories.filter(category => category.type === form.type)
  const fallback = form.type === 'transfer' ? null : categoryPresentation(categories, form.type, null)
  const categoryValue = typeCategories.some(category => category.id === form.category_id)
    ? form.category_id : fallback?.id ?? ''

  // Форма перезаповнюється щоразу, коли модалку відкривають — або
  // даними операції, що редагується, або порожнім бланком із
  // підказаним рахунком/типом (кнопки "Поповнити"/"Зняти" на картці
  // рахунку).
  useEffect(() => {
    if (!open) { initialized.current = null; return }
    const identity = transaction?.id ?? `new:${prefillAccountId ?? ''}:${prefillType ?? ''}`
    if (initialized.current === identity) return
    initialized.current = identity
    if (transaction) {
      setForm({
        type: transaction.type,
        account_id: transaction.account_id ?? '',
        transfer_to_account_id: transaction.transfer_to_account_id ?? '',
        category_id: transaction.category_id ?? '',
        amount: String(transaction.amount),
        currency: transaction.currency,
        description: transaction.description ?? '',
        mood: transaction.mood ?? '',
        occurred_at: toLocalDatetimeInputValue(new Date(transaction.occurred_at)),
      })
    } else {
      const acc = accounts.find(a => a.id === prefillAccountId) ?? accounts[0]
      setForm({
        ...emptyForm,
        occurred_at: toLocalDatetimeInputValue(new Date()),
        type: prefillType ?? 'expense',
        account_id: acc?.id ?? '',
        currency: acc?.currency ?? 'UAH',
      })
    }
  }, [open, transaction, prefillAccountId, prefillType, accounts])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()

    // Дату/час не чіпали при редагуванні (та сама хвилина, що й було) —
    // лишаємо оригінальну мітку часу як є, щоб операція не "стрибнула"
    // в списку просто через редагування опису чи суми.
    const dateUnchangedOnEdit =
      transaction && toLocalDatetimeInputValue(new Date(transaction.occurred_at)) === form.occurred_at
    const occurred_at = dateUnchangedOnEdit ? transaction!.occurred_at : localInputValueToIso(form.occurred_at)

    await onSave(transaction?.id ?? null, {
      type: form.type,
      account_id: form.account_id,
      transfer_to_account_id: form.type === 'transfer' ? form.transfer_to_account_id : null,
      category_id: form.type === 'transfer' ? null : form.category_id || null,
      amount: Number(form.amount),
      currency: form.currency,
      description: form.description || null,
      mood: form.type === 'expense' ? form.mood || null : null,
      occurred_at,
    })
  }

  return (
    <Modal open={open} onClose={onClose} title={transaction ? 'Редагувати операцію' : 'Нова операція'}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="grid grid-cols-3 gap-2">
          {(['expense', 'income', 'transfer'] as TransactionType[]).map(type => (
            <button
              type="button"
              key={type}
              onClick={() => setForm(f => ({ ...f, type, category_id: type === f.type ? f.category_id : '' }))}
              className={`rounded-lg border px-3 py-2 font-display text-sm font-semibold ${
                form.type === type ? 'border-primary bg-primary/10 text-primary' : 'border-border text-text-muted'
              }`}
            >
              {type === 'expense' ? 'Витрата' : type === 'income' ? 'Дохід' : 'Переказ'}
            </button>
          ))}
        </div>

        <div>
          <Label>{form.type === 'transfer' ? 'З активу' : 'Актив'}</Label>
          <Select
            required
            value={form.account_id}
            onChange={e => {
              const acc = accounts.find(a => a.id === e.target.value)
              setForm(f => ({ ...f, account_id: e.target.value, currency: acc?.currency ?? f.currency }))
            }}
          >
            {accounts.map(a => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </div>

        {form.type === 'transfer' && (
          <div className="motion-soft-enter">
            <Label>На актив</Label>
            <Select
              required
              value={form.transfer_to_account_id}
              onChange={e => setForm(f => ({ ...f, transfer_to_account_id: e.target.value }))}
            >
              <option value="">Оберіть актив</option>
              {accounts
                .filter(a => a.id !== form.account_id && a.currency === form.currency)
                .map(a => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
            </Select>
            {accounts.filter(a => a.id !== form.account_id && a.currency === form.currency).length === 0 ? (
              <p className="mt-1.5 text-xs text-warning">
                Немає інших активів у валюті {form.currency} — переказ можливий лише між активами з однаковою
                валютою, щоб сума не губилась на конвертації без курсу.
              </p>
            ) : (
              <p className="mt-1.5 text-xs text-text-muted">
                Перекази наразі можливі лише між активами в одній валюті.
              </p>
            )}
          </div>
        )}

        {form.type !== 'transfer' && (
          <div className="motion-soft-enter">
            <Label>Категорія</Label>
            <Select value={categoryValue} onChange={e => setForm(f => ({ ...f, category_id: e.target.value }))}>
              {!fallback?.id && <option value="">{fallback?.name}</option>}
              {typeCategories.map(category => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </Select>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Сума</Label>
            <Input
              type="number"
              step={isCrypto(form.currency) ? '0.00000001' : '0.01'}
              min="0"
              required
              value={form.amount}
              onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
            />
          </div>
          <div>
            <Label>Дата і час</Label>
            <Input
              type="datetime-local"
              required
              value={form.occurred_at}
              onChange={e => setForm(f => ({ ...f, occurred_at: e.target.value }))}
            />
          </div>
        </div>

        <div>
          <Label>Опис</Label>
          <Textarea
            rows={2}
            value={form.description}
            onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            placeholder="Необов'язково"
          />
        </div>

        {form.type === 'expense' && (
          <div className="motion-soft-enter">
            <Label>Індекс настрою</Label>
            <div className="flex gap-2">
              {MOODS.map(m => (
                <button
                  type="button"
                  key={m.value}
                  onClick={() => setForm(f => ({ ...f, mood: f.mood === m.value ? '' : m.value }))}
                  className={`flex flex-1 flex-col items-center gap-1 rounded-lg border px-2 py-2 text-xs ${
                    form.mood === m.value ? 'border-primary bg-primary/10' : 'border-border text-text-muted'
                  }`}
                >
                  <span className="text-lg">{m.emoji}</span>
                  {m.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {transaction?.is_cancelled && (
          <p className="rounded-lg bg-surface-2 px-3 py-2 text-xs text-text-muted">
            Цю операцію скасовано — вона не впливає на баланс і статистику.
          </p>
        )}

        <Button type="submit">{transaction ? 'Зберегти' : 'Створити'}</Button>
      </form>
    </Modal>
  )
}
