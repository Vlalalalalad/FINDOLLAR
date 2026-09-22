import { useRef, useState } from 'react'
import { Pencil, Undo2, Share2 } from 'lucide-react'
import clsx from 'clsx'
import { Modal, useConfirm } from './ui'
import { transactionTitle } from './TransactionRow'
import { formatMoney, isCrypto } from '../lib/currency'
import { useTheme } from '../context/ThemeContext'
import {
  drawGlassPanel,
  drawShareAdZone,
  drawShareBackground,
  drawShareIcon,
  fitText,
  shareFont,
  sharePalette,
  SHARE_CARD_H,
  SHARE_CARD_W,
  SHARE_AD_TOP,
  SHARE_CONTENT_TOP,
  SHARE_PAD,
  SHARE_DISPLAY,
  SHARE_SANS,
} from '../lib/shareCard'
import type { Account, Category, Transaction } from '../types/database'

function ownDelta(t: Transaction, accountId: string): number {
  if (t.is_cancelled) return 0
  if (t.account_id === accountId) return t.type === 'income' ? t.amount : -t.amount
  if (t.transfer_to_account_id === accountId) return t.amount
  return 0
}

// Баланс рахунку одразу після цієї операції — рахуємо наскрізно з усієї
// історії рахунку (той самий принцип, що й у useCapital), а "до" — це
// "після" мінус власний ефект цієї операції.
function balanceAfter(accountId: string, uptoId: string, allTransactions: Transaction[], startingBalance: number): number {
  const chain = allTransactions
    .filter(t => t.account_id === accountId || t.transfer_to_account_id === accountId)
    .sort((a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime() || a.created_at.localeCompare(b.created_at))

  let balance = startingBalance
  for (const t of chain) {
    balance += ownDelta(t, accountId)
    if (t.id === uptoId) break
  }
  return balance
}

// --- Картинка для «Надіслати»: механізм (canvas → png → navigator.share /
// завантаження) незмінний, дизайн — у спільній системі з lib/shareCard. ---

const ROW_H = 62
const PANEL_R = 28
const CATEGORY_Y = SHARE_CONTENT_TOP
const CATEGORY_H = 64
const AMOUNT_Y = CATEGORY_Y + CATEGORY_H + 20
const AMOUNT_SLOT_H = 140
const BALANCE_Y = AMOUNT_Y + AMOUNT_SLOT_H + 20
const BALANCE_PANEL_H = 108
const DETAILS_Y = BALANCE_Y + BALANCE_PANEL_H + 20
const DETAILS_H = ROW_H * 3
const NOTE_Y = DETAILS_Y + DETAILS_H + 20
const NOTE_H = SHARE_AD_TOP - NOTE_Y - 20

// Переносить текст по словах, надлишок (понад maxLines) обрізає з «…».
function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    const probe = line ? `${line} ${word}` : word
    if (line && ctx.measureText(probe).width > maxW) {
      lines.push(line)
      line = word
    } else {
      line = probe
    }
  }
  if (line) lines.push(line)
  if (lines.length > maxLines) {
    let last = lines.slice(maxLines - 1).join(' ')
    lines.length = maxLines - 1
    while (last.length > 1 && ctx.measureText(last + '…').width > maxW) last = last.slice(0, -1)
    lines.push(last + '…')
  }
  return lines
}

function drawArrow(ctx: CanvasRenderingContext2D, cx: number, cy: number, len: number, color: string) {
  const x0 = cx - len / 2
  const x1 = cx + len / 2
  ctx.strokeStyle = color
  ctx.lineWidth = 3
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.moveTo(x0, cy)
  ctx.lineTo(x1 - 2, cy)
  ctx.moveTo(x1 - 13, cy - 8)
  ctx.lineTo(x1 - 1, cy)
  ctx.lineTo(x1 - 13, cy + 8)
  ctx.stroke()
}

async function shareAsImage(
  t: Transaction,
  title: string,
  accountName: string,
  toAccountName: string | null,
  before: number | null,
  after: number | null,
  theme: 'light' | 'dark'
) {
  const canvas = document.createElement('canvas')
  const W = SHARE_CARD_W
  const H = SHARE_CARD_H
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const PAD = 72
  const CW = W - PAD * 2
  const p = sharePalette(theme)

  const accent = t.type === 'income' ? p.primary : t.type === 'expense' ? p.danger : p.text
  const balanceArrowColor = t.type === 'income' ? p.primary : t.type === 'expense' ? p.danger : p.muted
  const categoryLabel = t.is_cancelled ? `${title} · Скасовано` : title
  const pillText = fitText(ctx, categoryLabel, 600, 31, SHARE_SANS, CW - 120, 20)
  const sign = t.type === 'expense' ? '\u2212' : t.type === 'income' ? '+' : ''
  const dateLabel = new Date(t.occurred_at).toLocaleString('uk-UA', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
  const noteText = (t.description ?? '').trim()

  const amount = fitText(ctx, sign + formatMoney(t.amount, t.currency, { full: isCrypto(t.currency) }), 800, 120, SHARE_DISPLAY, CW, 60)

  // Рядки деталей з іконками
  // Три рядки завжди резервуються. Для не-переказу середній рядок порожній,
  // тому дата та рекламна зона не підстрибують угору.
  const rows: Array<[string, string, import('../lib/shareCard').ShareIcon]> = [
    ['Актив', accountName, 'wallet'],
    [toAccountName ? 'На актив' : '', toAccountName ?? '', 'swap'],
    ['Дата операції', dateLabel, 'calendar'],
  ]

  // Фіксована сітка: позиції основних блоків не залежать від нотатки.
  let noteLines: string[] = []
  if (noteText) {
    ctx.font = shareFont(400, 30, SHARE_SANS)
    noteLines = wrapLines(ctx, noteText, CW - 122, 2)
  }
  // Єдиний базовий шар — надане фонове зображення.
  await drawShareBackground(ctx, theme)

  ctx.textBaseline = 'middle'

  // Категорія/тип і статус у компактній акцентній скляній панелі.
  ctx.font = shareFont(600, pillText.size, SHARE_SANS)
  const categoryTextW = ctx.measureText(pillText.text).width
  const categoryW = Math.min(CW, categoryTextW + 84)
  const categoryX = (W - categoryW) / 2
  drawGlassPanel(ctx, categoryX, CATEGORY_Y, categoryW, CATEGORY_H, PANEL_R, p, accent)
  ctx.fillStyle = accent
  ctx.textAlign = 'center'
  ctx.fillText(pillText.text, W / 2, CATEGORY_Y + CATEGORY_H / 2)

  // Сума — головний елемент картки.
  ctx.font = shareFont(800, amount.size, SHARE_DISPLAY)
  ctx.fillStyle = t.is_cancelled ? p.muted : accent
  ctx.textAlign = 'center'
  ctx.fillText(amount.text, W / 2, AMOUNT_Y + AMOUNT_SLOT_H / 2)
  if (t.is_cancelled) {
    const tw = ctx.measureText(amount.text).width
    ctx.strokeStyle = p.muted
    ctx.lineWidth = 6
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(W / 2 - tw / 2 - 10, AMOUNT_Y + AMOUNT_SLOT_H / 2)
    ctx.lineTo(W / 2 + tw / 2 + 10, AMOUNT_Y + AMOUNT_SLOT_H / 2)
    ctx.stroke()
  }

  // Баланс завжди має однакову скляну панель. Зелений — лише акцент стрілки.
  drawGlassPanel(ctx, PAD, BALANCE_Y, CW, BALANCE_PANEL_H, PANEL_R, p)
  if (before !== null && after !== null) {
    ctx.font = shareFont(600, 20, SHARE_SANS)
    ctx.fillStyle = p.muted
    ctx.textAlign = 'center'
    ctx.fillText('БАЛАНС РАХУНКУ', W / 2, BALANCE_Y + 24)

    const beforeStr = formatMoney(before, t.currency)
    const afterStr = formatMoney(after, t.currency)
    const ARROW_W = 62
    let bSize = 36
    let aSize = 42
    let bw = 0
    let aw = 0
    while (bSize > 22) {
      ctx.font = shareFont(600, bSize, SHARE_SANS)
      bw = ctx.measureText(beforeStr).width
      ctx.font = shareFont(700, aSize, SHARE_DISPLAY)
      aw = ctx.measureText(afterStr).width
      if (bw + ARROW_W + 48 + aw <= CW - 60) break
      bSize -= 2
      aSize -= 2
    }
    const rowCy = BALANCE_Y + 70
    let rx = W / 2 - (bw + 24 + ARROW_W + 24 + aw) / 2
    ctx.font = shareFont(600, bSize, SHARE_SANS)
    ctx.fillStyle = p.text
    ctx.textAlign = 'left'
    ctx.fillText(beforeStr, rx, rowCy)
    rx += bw + 24
    drawArrow(ctx, rx + ARROW_W / 2, rowCy, ARROW_W, balanceArrowColor)
    rx += ARROW_W + 24
    ctx.font = shareFont(700, aSize, SHARE_DISPLAY)
    ctx.fillStyle = p.text
    ctx.fillText(afterStr, rx, rowCy)
  } else {
    ctx.font = shareFont(400, 24, SHARE_SANS)
    ctx.fillStyle = p.muted
    ctx.textAlign = 'center'
    ctx.fillText('Баланс недоступний', W / 2, BALANCE_Y + BALANCE_PANEL_H / 2 + 8)
  }
  // Рядки деталей у спільній скляній панелі. Усі рядки мають однакову
  // висоту, а текст стоїть точно по вертикальному центру.
  drawGlassPanel(ctx, PAD, DETAILS_Y, CW, DETAILS_H, PANEL_R, p)
  // Для звичайної операції блок ділиться рівно навпіл між рахунком і датою.
  // Для переказу перші два однакові рядки — це рахунки, тому розділювач
  // ставимо саме між ними; дата залишається третім рядком нижче.
  const hasTransferRow = Boolean(toAccountName)
  const detailsHalfH = DETAILS_H / 2
  const detailsDividerYs = hasTransferRow
    ? [DETAILS_Y + ROW_H, DETAILS_Y + ROW_H * 2]
    : [DETAILS_Y + detailsHalfH]
  // Тонкі розділювачі між основними рядками блоку деталей.
  ctx.save()
  ctx.strokeStyle = p.glassStroke
  ctx.globalAlpha = 0.72
  ctx.lineWidth = 1.5
  detailsDividerYs.forEach(y => {
    ctx.beginPath()
    ctx.moveTo(PAD + 30, y)
    ctx.lineTo(PAD + CW - 30, y)
    ctx.stroke()
  })
  ctx.restore()
  rows.forEach(([label, value, icon], i) => {
    if (!label) return
    const cy = !hasTransferRow && i === 0
      ? DETAILS_Y + detailsHalfH / 2
      : !hasTransferRow && i === 2
        ? DETAILS_Y + detailsHalfH + detailsHalfH / 2
        : DETAILS_Y + i * ROW_H + ROW_H / 2
    drawShareIcon(ctx, icon, PAD + 38, cy, p.primary)
    const labelX = PAD + 74
    const valueRight = PAD + CW - 32
    ctx.font = shareFont(400, 30, SHARE_SANS)
    ctx.fillStyle = p.muted
    ctx.textAlign = 'left'
    ctx.fillText(label, labelX, cy)
    const labelW = ctx.measureText(label).width
    const fitted = fitText(ctx, value, 600, 32, SHARE_SANS, valueRight - labelX - labelW - 18, 24)
    ctx.font = shareFont(600, fitted.size, SHARE_SANS)
    ctx.fillStyle = p.text
    ctx.textAlign = 'right'
    ctx.fillText(fitted.text, valueRight, cy)
  })
  // Нотатка має власну glass-панель лише коли справді містить текст.
  // Порожня операція не отримує зайвої рамки.
  if (noteLines.length) {
    drawGlassPanel(ctx, PAD, NOTE_Y, CW, NOTE_H, PANEL_R, p)
    const lineHeight = 38
    const noteCenterY = NOTE_Y + NOTE_H / 2
    const firstLineY = noteCenterY - ((noteLines.length - 1) * lineHeight) / 2
    drawShareIcon(ctx, 'note', PAD + 38, NOTE_Y + NOTE_H / 2, p.primary)
    ctx.font = shareFont(400, 30, SHARE_SANS)
    ctx.fillStyle = p.text
    ctx.textAlign = 'left'
    noteLines.forEach((line, i) => {
      ctx.fillText(line, PAD + 74, firstLineY + i * lineHeight)
    })
  }

  // Нижня рекламна зона
  await drawShareAdZone(ctx, p)

  // Чекаємо завершення toBlob і самого поширення/завантаження. Без цього
  // handleShare завершувався раніше за генерацію та одразу скидав індикатор.
  await new Promise<void>(resolve => {
    canvas.toBlob(async blob => {
      try {
        if (!blob) return
        const file = new File([blob], 'operation.png', { type: 'image/png' })
        const nav = navigator as Navigator & {
          canShare?: (data: { files: File[] }) => boolean
          share?: (data: unknown) => Promise<void>
        }
        if (nav.share && nav.canShare?.({ files: [file] })) {
          try {
            await nav.share({ files: [file], title: 'Операція' })
          } catch {
            // Користувач закрив шторку поширення — це не помилка.
          }
          return
        }
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = 'operation.png'
        a.click()
        URL.revokeObjectURL(url)
      } catch {
        // Не перериваємо UI, якщо браузер не підтримує експорт.
      } finally {
        resolve()
      }
    }, 'image/png')
  })
}

export function TransactionDetail({
  transaction,
  accounts,
  categories,
  allTransactions,
  hideBalances,
  onClose,
  onEdit,
  onReverse,
}: {
  transaction: Transaction | null
  accounts: Account[]
  categories: Category[]
  allTransactions: Transaction[]
  hideBalances: boolean
  onClose: () => void
  onEdit: (t: Transaction) => void
  onReverse: (t: Transaction) => void
}) {
  const { confirm, ConfirmDialog } = useConfirm()
  const { theme } = useTheme()
  const [sharing, setSharing] = useState(false)
  const sharingRef = useRef(false)

  const t = transaction
  const categoryName = (id: string | null) => categories.find(c => c.id === id)?.name ?? ''
  const title = t ? transactionTitle(t, categoryName) : ''
  const account = t ? accounts.find(a => a.id === t.account_id) : undefined
  const accountDisplayName = account?.name ?? t?.account_name_snapshot ?? 'видалений актив'
  const canReverse = t ? !t.is_cancelled && t.account_id !== null && (t.type !== 'transfer' || t.transfer_to_account_id !== null) : false

  const after = t?.account_id ? balanceAfter(t.account_id, t.id, allTransactions, account?.starting_balance ?? 0) : null
  const before = t && after !== null ? after - ownDelta(t, t.account_id!) : null
  const toAccountDisplayName =
    t != null && t.type === 'transfer'
      ? (accounts.find(a => a.id === t.transfer_to_account_id)?.name ?? t.transfer_to_account_name_snapshot ?? 'видалений актив')
      : null

  const handleReverseClick = async () => {
    if (!t) return
    const ok = await confirm(
      `Скасувати операцію на ${formatMoney(t.amount, t.currency)}? Вона перестане враховуватись у балансі й статистиці, але лишиться в історії з позначкою «скасовано».`,
      { confirmLabel: 'Підтвердити', danger: false }
    )
    if (!ok) return
    onReverse(t)
  }

  const handleShare = async () => {
    if (!t || sharingRef.current) return
    sharingRef.current = true
    setSharing(true)
    try {
      // Даємо React можливість намалювати стан «Готую картку…» до
      // синхронної частини підготовки Canvas.
      await new Promise<void>(resolve => {
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve())
        else setTimeout(resolve, 0)
      })
      await shareAsImage(t, title, accountDisplayName, toAccountDisplayName, before, after, theme)
    } finally {
      sharingRef.current = false
      setSharing(false)
    }
  }

  return (
    <>
      <Modal open={Boolean(t)} onClose={onClose} title="Деталі операції">
        {t && (
          <div className="flex flex-col gap-5">
            <div className="text-center">
              <div className="text-sm text-text-muted">{title}</div>
              <div
                className={clsx(
                  'mt-1 font-mono text-3xl font-bold tabular-nums',
                  t.is_cancelled
                    ? 'text-text-muted line-through'
                    : t.type === 'income'
                      ? 'text-success'
                      : t.type === 'expense'
                        ? 'text-danger'
                        : 'text-text'
                )}
              >
                {hideBalances
                  ? '••••'
                  : (t.type === 'expense' ? '-' : t.type === 'income' ? '+' : '') +
                    formatMoney(t.amount, t.currency, { full: isCrypto(t.currency) })}
              </div>
              {t.is_cancelled && <div className="mt-1 text-xs font-semibold text-text-muted">Скасовано</div>}
            </div>

            <div className="flex flex-col divide-y divide-dashed divide-border overflow-hidden rounded-xl border border-border">
              <div className="flex items-center justify-between px-4 py-3 text-sm">
                <span className="text-text-muted">Актив</span>
                <span className="font-medium text-text">{accountDisplayName}</span>
              </div>
              {t.type === 'transfer' && (
                <div className="flex items-center justify-between px-4 py-3 text-sm">
                  <span className="text-text-muted">На актив</span>
                  <span className="font-medium text-text">
                    {accounts.find(a => a.id === t.transfer_to_account_id)?.name ??
                      t.transfer_to_account_name_snapshot ??
                      'видалений актив'}
                  </span>
                </div>
              )}
              {before !== null && (
                <div className="flex items-center justify-between px-4 py-3 text-sm">
                  <span className="text-text-muted">Баланс до</span>
                  <span className="font-mono font-medium text-text">
                    {hideBalances ? '••••' : formatMoney(before, t.currency)}
                  </span>
                </div>
              )}
              {after !== null && (
                <div className="flex items-center justify-between px-4 py-3 text-sm">
                  <span className="text-text-muted">Баланс після</span>
                  <span className="font-mono font-medium text-text">
                    {hideBalances ? '••••' : formatMoney(after, t.currency)}
                  </span>
                </div>
              )}
              <div className="flex items-center justify-between px-4 py-3 text-sm">
                <span className="text-text-muted">Дата операції</span>
                <span className="font-medium text-text">
                  {new Date(t.occurred_at).toLocaleString('uk-UA', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>
            </div>

            <div>
              <div className="mb-1.5 text-xs font-medium text-text-muted">Нотатки</div>
              <p className="text-sm text-text">{t.description || 'Без нотаток'}</p>
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onEdit(t)}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2.5 text-sm font-medium text-text-muted transition-colors hover:border-primary hover:text-primary"
                >
                  <Pencil size={15} /> Редагувати
                </button>
                {canReverse && (
                  <button
                    type="button"
                    onClick={handleReverseClick}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2.5 text-sm font-medium text-text-muted transition-colors hover:border-danger hover:text-danger"
                  >
                    <Undo2 size={15} /> Скасувати
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={handleShare}
                disabled={sharing}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2.5 text-sm font-medium text-text-muted transition-colors hover:border-primary hover:text-primary disabled:opacity-60"
              >
                <Share2 size={15} /> {sharing ? 'Готую картку…' : 'Надіслати'}
              </button>
            </div>
          </div>
        )}
      </Modal>
      {ConfirmDialog}
    </>
  )
}
