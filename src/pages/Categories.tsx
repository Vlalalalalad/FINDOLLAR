import { useState, type FormEvent } from 'react'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import { useCategories } from '../hooks'
import { Button, Card, Input, Label, Modal, Select, useConfirm } from '../components/ui'
import { ColorPicker, COLOR_PRESETS } from '../components/ColorPicker'
import type { Category, CategoryType } from '../types/database'

export function Categories() {
  const { data: categories, loading, create, update, remove } = useCategories()
  const { confirm, ConfirmDialog } = useConfirm()
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Category | null>(null)
  const [form, setForm] = useState({ name: '', type: 'expense' as CategoryType, color: COLOR_PRESETS[0], parent_id: '' })

  const openCreate = (type: CategoryType) => {
    setEditing(null)
    setForm({ name: '', type, color: COLOR_PRESETS[0], parent_id: '' })
    setModalOpen(true)
  }

  const openEdit = (c: Category) => {
    setEditing(c)
    setForm({ name: c.name, type: c.type, color: c.color, parent_id: c.parent_id ?? '' })
    setModalOpen(true)
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    const values = { name: form.name, type: form.type, color: form.color, parent_id: form.parent_id || null }
    if (editing) await update(editing.id, values)
    else await create(values)
    setModalOpen(false)
    setEditing(null)
  }

  const handleDelete = async () => {
    if (!editing || !(await confirm('Видалити категорію?'))) return
    await remove(editing.id)
    setModalOpen(false)
    setEditing(null)
  }

  const renderGroup = (type: CategoryType, label: string) => {
    const topLevel = categories.filter(c => c.type === type && !c.parent_id)
    const childrenOf = (id: string) => categories.filter(c => c.parent_id === id)

    return (
      <Card>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display font-semibold text-text">{label}</h2>
          <Button variant="secondary" onClick={() => openCreate(type)}>
            <Plus size={14} /> Додати
          </Button>
        </div>
        {topLevel.length === 0 ? (
          <p className="text-sm text-text-muted">Немає категорій</p>
        ) : (
          <div className="flex flex-col gap-1">
            {topLevel.map(c => (
              <div key={c.id}>
                <button
                  type="button"
                  onClick={() => openEdit(c)}
                  className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-left transition-colors hover:bg-surface-2 active:bg-surface-2"
                >
                  <span className="flex min-w-0 items-center gap-2 text-sm text-text">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: c.color }} />
                    <span className="truncate">{c.name}</span>
                  </span>
                  <Pencil size={13} className="ml-2 shrink-0 text-text-muted" />
                </button>
                {childrenOf(c.id).map(sub => (
                  <button
                    type="button"
                    key={sub.id}
                    onClick={() => openEdit(sub)}
                    className="ml-6 flex items-center justify-between rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-surface-2 active:bg-surface-2"
                  >
                    <span className="flex min-w-0 items-center gap-2 text-xs text-text-muted">
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: sub.color }} />
                      <span className="truncate">{sub.name}</span>
                    </span>
                    <Pencil size={12} className="ml-2 shrink-0 text-text-muted" />
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </Card>
    )
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-3">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="h-14 animate-pulse rounded-xl bg-surface-2" />
        ))}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-2xl font-bold text-text">Категорії</h1>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {renderGroup('income', 'Дохід')}
        {renderGroup('expense', 'Витрати')}
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Редагувати категорію' : 'Нова категорія'}>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <Label>Назва</Label>
            <Input required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </div>
          <div>
            <Label>Тип</Label>
            <Select
              value={form.type}
              onChange={e => setForm(f => ({ ...f, type: e.target.value as CategoryType, parent_id: '' }))}
            >
              <option value="expense">Витрати</option>
              <option value="income">Дохід</option>
            </Select>
          </div>
          <div>
            <Label>Батьківська категорія (опційно)</Label>
            <Select value={form.parent_id} onChange={e => setForm(f => ({ ...f, parent_id: e.target.value }))}>
              <option value="">— Немає (категорія верхнього рівня) —</option>
              {categories
                .filter(c => c.type === form.type && !c.parent_id && c.id !== editing?.id)
                .map(c => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </Select>
          </div>
          <div>
            <Label>Колір</Label>
            <ColorPicker value={form.color} onChange={color => setForm(f => ({ ...f, color }))} />
          </div>
          {editing ? (
            <div className="grid grid-cols-2 overflow-hidden rounded-lg border border-border">
              <button type="submit" className="flex items-center justify-center gap-2 border-r border-border bg-primary px-3 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-dark">
                <Pencil size={14} /> Редагувати
              </button>
              <button type="button" onClick={handleDelete} className="flex items-center justify-center gap-2 bg-danger/10 px-3 py-2.5 text-sm font-semibold text-danger transition-colors hover:bg-danger/20">
                <Trash2 size={14} /> Видалити
              </button>
            </div>
          ) : (
            <Button type="submit">Створити</Button>
          )}
        </form>
      </Modal>
      {ConfirmDialog}
    </div>
  )
}
