import { formatMoney } from './currency'
import {
  drawGlassPanel,
  drawShareAdZone,
  drawShareBackground,
  fitText,
  shareFont,
  sharePalette,
  SHARE_AD_TOP,
  SHARE_CARD_H,
  SHARE_CARD_W,
  SHARE_CONTENT_TOP,
  SHARE_DISPLAY,
  SHARE_PAD,
  SHARE_SANS,
} from './shareCard'
import type { Debt } from '../types/database'
import type { ShareTheme } from './shareCard'

export interface DebtCardData {
  debt: Pick<Debt, 'counterparty' | 'direction' | 'currency' | 'status'>
  remaining: number
  // Перша точка — початок циклу, наступні — залишок після змін.
  series: number[]
  // Час кожної точки в тій самій послідовності, що й series.
  seriesDates: string[]
  // Дата, що відповідає першій точці поточного циклу боргу.
  startDate: string
  tag: { label: string; color: string }
}

const PANEL_R = 28
const DIRECTION_Y = SHARE_CONTENT_TOP
const DIRECTION_H = 64
const NAME_Y = DIRECTION_Y + DIRECTION_H + 20
const NAME_H = 78
const AMOUNT_Y = NAME_Y + NAME_H + 20
const AMOUNT_SLOT_H = 140
const GRAPH_Y = AMOUNT_Y + AMOUNT_SLOT_H + 26
const GRAPH_H = SHARE_AD_TOP - GRAPH_Y - 44

// Дати виникнення боргу зберігаються як date-only (YYYY-MM-DD), а записи
// історії — як ISO timestamp. Для date-only не використовуємо Date.parse
// напряму: він трактує таку дату як UTC і може змістити її на сусідній день.
const parseSeriesTime = (value: string | undefined) => {
  if (!value) return null
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T12:00:00`).getTime()
    : Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

// Заокруглена ступінчаста траєкторія: між операціями значення тримається
// горизонтально, а перед кожною наступною точкою коротко й плавно переходить
// на новий рівень. Кінцева координата кожного переходу — сама точка, тому
// лінія гарантовано проходить через її центр.
function roundedStepLinePath(ctx: CanvasRenderingContext2D, pts: { x: number; y: number }[]) {
  if (!pts.length) return
  ctx.beginPath()
  ctx.moveTo(pts[0].x, pts[0].y)
  for (let i = 0; i < pts.length - 1; i++) {
    const from = pts[i]
    const to = pts[i + 1]
    const gap = Math.max(1, to.x - from.x)
    // Перехід короткий відносно проміжку, щоб не створювати діагональ
    // через увесь інтервал між операціями.
    const transitionW = Math.min(54, gap * 0.34)
    const transitionStart = to.x - transitionW
    ctx.lineTo(transitionStart, from.y)
    ctx.bezierCurveTo(
      transitionStart + transitionW * 0.62,
      from.y,
      to.x - transitionW * 0.36,
      to.y,
      to.x,
      to.y
    )
  }
}

async function drawDebtCard(ctx: CanvasRenderingContext2D, data: DebtCardData, theme: ShareTheme) {
  const W = SHARE_CARD_W
  const CW = W - SHARE_PAD * 2
  const p = sharePalette(theme)

  // Єдиний базовий шар — обране фонове зображення.
  await drawShareBackground(ctx, theme)
  ctx.textBaseline = 'middle'

  // Тип боргу — компактний акцентний тег. Ім'я боргу нижче має власний
  // незалежний блок і ніяк не впливає на ширину цього тегу.
  const directionText = data.debt.direction === 'i_owe' ? 'Я винен' : 'Мені винні'
  const directionColor = data.debt.direction === 'i_owe' ? p.danger : p.primary
  const directionFit = fitText(ctx, directionText, 700, 28, SHARE_SANS, CW - 96, 22)
  ctx.font = shareFont(700, directionFit.size, SHARE_SANS)
  const directionW = Math.min(CW, ctx.measureText(directionFit.text).width + 84)
  const directionX = (W - directionW) / 2
  drawGlassPanel(ctx, directionX, DIRECTION_Y, directionW, DIRECTION_H, PANEL_R, p, directionColor)
  ctx.fillStyle = directionColor
  ctx.textAlign = 'center'
  ctx.fillText(directionFit.text, W / 2, DIRECTION_Y + DIRECTION_H / 2)

  // Ім'я боргу — окремий текстовий елемент без власної рамки чи плашки.
  const nameFit = fitText(ctx, data.debt.counterparty, 800, 48, SHARE_DISPLAY, CW - 64, 32)
  ctx.font = shareFont(800, nameFit.size, SHARE_DISPLAY)
  ctx.fillStyle = p.text
  ctx.fillText(nameFit.text, W / 2, NAME_Y + NAME_H / 2)

  // Сума — вільний головний елемент без окремої рамки чи плашки.
  const amountFit = fitText(ctx, formatMoney(data.remaining, data.debt.currency), 800, 112, SHARE_DISPLAY, CW - 64, 56)
  ctx.font = shareFont(800, amountFit.size, SHARE_DISPLAY)
  ctx.fillStyle = p.text
  ctx.fillText(amountFit.text, W / 2, AMOUNT_Y + AMOUNT_SLOT_H / 2 + 4)

  // Графік завжди має зарезервоване місце, тому наявність історії не ламає сітку.
  // Візуально це окрема велика glass-панель із заголовком, напрямними
  // та часовою шкалою — дані читаються як історія,
  // а не як маленький стандартний sparkline.
  drawGlassPanel(ctx, SHARE_PAD, GRAPH_Y, CW, GRAPH_H, PANEL_R, p)
  const graphColor = data.tag.color || p.primary
  const graphX = SHARE_PAD
  const headerY = GRAPH_Y + 30
  ctx.font = shareFont(700, 20, SHARE_SANS)
  ctx.fillStyle = graphColor
  ctx.textAlign = 'left'
  ctx.fillText(data.tag.label.toUpperCase(), graphX + 34, headerY)

  if (data.series.length > 1) {
    const padL = 52
    const padR = 52
    const plotTop = GRAPH_Y + 96
    const plotBottom = GRAPH_Y + GRAPH_H - 62
    const plotW = CW - padL - padR
    const plotH = plotBottom - plotTop
    const min = Math.min(...data.series)
    const max = Math.max(...data.series)
    const span = max - min
    const vy = (v: number) => plotTop + plotH - (span < 0.01 ? plotH / 2 : ((v - min) / span) * plotH)
    const plotLeft = SHARE_PAD + padL
    const plotRight = SHARE_PAD + CW - padR
    const times = data.series.map((_, i) => parseSeriesTime(data.seriesDates[i] ?? data.startDate))
    const validTimes = times.filter((time): time is number => time !== null)
    const firstTime = validTimes.length ? Math.min(...validTimes) : Date.now()
    // Правий край шкали — поточний момент, а не остання операція. Майбутні
    // timestamp-и (якщо їх помилково збережено) притискаються до цього краю.
    const currentTime = Date.now()
    const endTime = Math.max(currentTime, firstTime + 1)
    const timeSpan = endTime - firstTime
    const fallbackStep = plotW / Math.max(1, data.series.length - 1)
    const minPointGap = Math.min(18, Math.max(4, fallbackStep * 0.25))
    const xPositions: number[] = []
    data.series.forEach((_, i) => {
      const time = times[i]
      const rawX = timeSpan > 0 && time !== null
        ? plotLeft + ((time - firstTime) / timeSpan) * plotW
        : plotLeft + fallbackStep * i
      const boundedX = Math.max(plotLeft, Math.min(plotRight, rawX))
      // Окремі події з однаковим timestamp отримують невеликий візуальний
      // проміжок, але всі різні дати/часи зберігають реальну пропорцію.
      const x = i > 0 && boundedX <= xPositions[i - 1]
        ? Math.min(plotRight, xPositions[i - 1] + minPointGap)
        : boundedX
      xPositions.push(x)
    })
    const eventPts = data.series.map((v, i) => ({ x: xPositions[i], y: vy(v) }))
    // До поточної дати після останньої операції значення не змінюється.
    // Додаємо технічну кінцеву точку без маркера, щоб лінія доходила до
    // правого краю графіка, а остання реальна операція не притискалась до
    // напису «ЗАРАЗ».
    const lastEventPoint = eventPts[eventPts.length - 1]
    const pts = lastEventPoint.x < plotRight - 0.5
      ? [...eventPts, { x: plotRight, y: lastEventPoint.y }]
      : eventPts

    // Легка сітка дає графіку структуру, але не перекриває фон.
    ctx.save()
    ctx.strokeStyle = p.glassStroke
    ctx.globalAlpha = 0.45
    ctx.lineWidth = 1
    for (let i = 0; i < 3; i++) {
      const gy = plotTop + (plotH * i) / 2
      ctx.beginPath()
      ctx.moveTo(SHARE_PAD + padL, gy)
      ctx.lineTo(SHARE_PAD + CW - padR, gy)
      ctx.stroke()
    }
    ctx.restore()

    // Заповнення під лінією — це м'яке підсилення самого графіка даних,
    // без декоративного градієнта чи важкої кольорової плашки.
    ctx.save()
    ctx.globalAlpha = 0.12
    ctx.fillStyle = graphColor
    roundedStepLinePath(ctx, pts)
    ctx.lineTo(pts[pts.length - 1].x, plotBottom)
    ctx.lineTo(pts[0].x, plotBottom)
    ctx.closePath()
    ctx.fill()
    ctx.restore()

    ctx.strokeStyle = graphColor
    ctx.lineWidth = 6
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    roundedStepLinePath(ctx, pts)
    ctx.stroke()

    eventPts.forEach((point, index) => {
      ctx.fillStyle = p.glassFill
      ctx.strokeStyle = graphColor
      ctx.lineWidth = index === pts.length - 1 ? 5 : 3
      ctx.beginPath()
      ctx.arc(point.x, point.y, index === pts.length - 1 ? 12 : 7, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
    })

    ctx.font = shareFont(500, 17, SHARE_SANS)
    ctx.fillStyle = p.muted
    ctx.textAlign = 'left'
    const startLabelTime = parseSeriesTime(data.seriesDates[0] ?? data.startDate)
    const startLabel = new Date(startLabelTime ?? Date.now()).toLocaleDateString('uk-UA', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
    ctx.fillText(startLabel, SHARE_PAD + padL, GRAPH_Y + GRAPH_H - 28)
    ctx.textAlign = 'right'
    ctx.fillText('ЗАРАЗ', SHARE_PAD + CW - padR, GRAPH_Y + GRAPH_H - 28)
  } else {
    ctx.font = shareFont(500, 24, SHARE_SANS)
    ctx.fillStyle = p.muted
    ctx.textAlign = 'center'
    ctx.fillText('Історія змін відсутня', W / 2, GRAPH_Y + GRAPH_H / 2 + 18)
  }

  // Дата стану належить графіку: її не дублюємо біля суми й не зміщуємо
  // в рекламну зону. Вона стоїть по центру на нижньому краї графіка.
  ctx.font = shareFont(400, 22, SHARE_SANS)
  ctx.fillStyle = p.muted
  ctx.textAlign = 'center'
  ctx.fillText(
    `станом на ${new Date().toLocaleDateString('uk-UA', { day: 'numeric', month: 'long', year: 'numeric' })}`,
    W / 2,
    GRAPH_Y + GRAPH_H - 18
  )
}

export async function shareDebtCard(data: DebtCardData, theme: ShareTheme): Promise<void> {
  const canvas = document.createElement('canvas')
  canvas.width = SHARE_CARD_W
  canvas.height = SHARE_CARD_H
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  await drawDebtCard(ctx, data, theme)
  await drawShareAdZone(ctx, sharePalette(theme))

  await new Promise<void>(resolve => {
    canvas.toBlob(async blob => {
      if (blob) {
        try {
          const file = new File([blob], 'debt-card.png', { type: 'image/png' })
          const nav = navigator as Navigator & {
            canShare?: (data: { files: File[] }) => boolean
            share?: (data: unknown) => Promise<void>
          }
          if (nav.share && nav.canShare?.({ files: [file] })) {
            try {
              await nav.share({ files: [file], title: 'Борг' })
            } catch {
              // Користувач закрив шторку поширення.
            }
          } else {
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = 'debt-card.png'
            a.click()
            URL.revokeObjectURL(url)
          }
        } catch {
          // Не перериваємо UI, якщо браузер не підтримує експорт.
        }
      }
      resolve()
    }, 'image/png')
  })
}
