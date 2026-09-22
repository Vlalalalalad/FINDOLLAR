import bgDark from '../assets/share-bg-dark.png'
import bgLight from '../assets/share-bg-light.png'
import shareQr from '../assets/share-qr.png'

// Спільна основа ВСІХ карток для надсилання: фіксоване полотно
// 1080×1350 (4:5), спільний фоновий шар (зображення для темної та
// світлої теми, під усіма елементами) і єдина нижня рекламна зона.

export type ShareTheme = 'light' | 'dark'

export const SHARE_CARD_W = 1080
export const SHARE_CARD_H = 1350
// Фіксована сітка спільна для всіх типів карток. Це не залежить від
// наявності нотатки або кількості рядків у даних.
export const SHARE_CONTENT_TOP = 300
export const SHARE_CONTENT_BOTTOM = 1004
export const SHARE_PAD = 72
export const SHARE_AD_TOP = 1030
export const SHARE_AD_HEIGHT = 280

export const SHARE_SANS = 'Inter, system-ui, "Segoe UI", Roboto, sans-serif'
export const SHARE_DISPLAY = 'Manrope, Inter, system-ui, sans-serif'
// Верхній wordmark на наданому фоні зроблено Lato Black. Використовуємо
// той самий шрифт і накреслення в нижній рекламній зоні.
const SHARE_BRAND = 'Lato, sans-serif'
const SHARE_BRAND_WEIGHT = 900
// Розмір і координати лишаються такими, як у попередньому рекламному блоці.
const SHARE_BRAND_SIZE = 30
const SHARE_BRAND_LETTER_SPACING = -0.35
const SHARE_BRAND_GREEN = '#008746'

// Тема → кольори тексту, графіків і QR-коду. Саме зображення є єдиним
// фоновим шаром, тому палітра не містить кольорів плашок чи контейнерів.
export interface SharePalette {
  text: string
  muted: string
  primary: string
  danger: string
  balanceMuted: string
  balanceArrow: string
  qrDark: string
  glassFill: string
  glassStroke: string
  glassHighlight: string
  glassShadow: string
}

export function sharePalette(theme: ShareTheme): SharePalette {
  return theme === 'dark'
    ? {
        text: '#FFFFFF',
        muted: '#A6B0BC',
        primary: '#35B393',
        danger: '#E06A52',
        balanceMuted: '#A6B0BC',
        balanceArrow: '#35B393',
        qrDark: '#10161D',
        glassFill: 'rgba(12, 22, 30, 0.48)',
        glassStroke: 'rgba(255, 255, 255, 0.20)',
        glassHighlight: 'rgba(255, 255, 255, 0.30)',
        glassShadow: 'rgba(0, 0, 0, 0.26)',
      }
    : {
        text: '#2A251F',
        muted: '#746B61',
        primary: '#0E8F6E',
        danger: '#B5432E',
        balanceMuted: '#746B61',
        balanceArrow: '#0E8F6E',
        qrDark: '#2A251F',
        glassFill: 'rgba(255, 250, 241, 0.46)',
        glassStroke: 'rgba(116, 94, 68, 0.24)',
        glassHighlight: 'rgba(255, 255, 255, 0.62)',
        glassShadow: 'rgba(96, 72, 42, 0.18)',
      }
}

export function shareFont(weight: number, size: number, family: string) {
  return `${weight} ${size}px ${family}`
}

// Вписує текст у maxW: спершу зменшує шрифт до minSize, потім обрізає з «…».
export function fitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  weight: number,
  size: number,
  family: string,
  maxW: number,
  minSize = 16
): { text: string; size: number } {
  let s = size
  ctx.font = shareFont(weight, s, family)
  while (ctx.measureText(text).width > maxW && s > minSize) {
    s -= 2
    ctx.font = shareFont(weight, s, family)
  }
  let out = text
  if (ctx.measureText(out).width > maxW) {
    while (out.length > 1 && ctx.measureText(out + '…').width > maxW) out = out.slice(0, -1)
    out += '…'
  }
  return { text: out, size: s }
}

export function shareRoundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

// Спільний Liquid Glass для всіх інформаційних блоків. Прозора заливка
// залишає видимим фон, а м'яка рамка, верхній відблиск і тінь додають
// глибини без важких суцільних прямокутників.
export function drawGlassPanel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  p: SharePalette,
  tint?: string
) {
  ctx.save()
  ctx.shadowColor = p.glassShadow
  ctx.shadowBlur = 22
  ctx.shadowOffsetY = 8
  shareRoundRect(ctx, x, y, w, h, r)
  ctx.fillStyle = p.glassFill
  ctx.fill()
  if (tint) {
    // Тонкий акцентний відтінок змінює колір скла, але не перетворює його
    // на непрозору кольорову плашку.
    ctx.shadowColor = 'transparent'
    ctx.globalAlpha = 0.18
    shareRoundRect(ctx, x, y, w, h, r)
    ctx.fillStyle = tint
    ctx.fill()
  }
  ctx.shadowColor = 'transparent'
  ctx.globalAlpha = 1
  ctx.lineWidth = 2
  ctx.strokeStyle = p.glassStroke
  ctx.stroke()

  // Тонкий верхній відблиск є частиною скла, а не окремим декоративним шаром.
  ctx.globalAlpha = 0.9
  ctx.lineWidth = 1.5
  ctx.strokeStyle = p.glassHighlight
  shareRoundRect(ctx, x + 1, y + 1, w - 2, h - 2, Math.max(1, r - 1))
  ctx.stroke()
  ctx.restore()
}

// --- Спільний фоновий шар усіх карток: готові зображення (темна /
// світла тема) Малюється першим, під усіма елементами. Зображення
// масштабується як background-size: cover — заповнює весь формат
// 1080×1350; пропорції файлів майже 4:5, тож обрізка мінімальна.
// Сам файл не змінюється і не фільтрується.

const imageCache = new Map<string, HTMLImageElement>()

function loadShareImage(src: string): Promise<HTMLImageElement> {
  const cached = imageCache.get(src)
  if (cached) return Promise.resolve(cached)
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      imageCache.set(src, img)
      resolve(img)
    }
    img.onerror = () => reject(new Error('Share image failed to load'))
    img.src = src
  })
}

export async function drawShareBackground(ctx: CanvasRenderingContext2D, theme: ShareTheme) {
  // Єдиний базовий шар картки — надане користувачем зображення. Ніяких
  // запасних градієнтів, заливок чи декоративних шарів поверх нього.
  const img = await loadShareImage(theme === 'dark' ? bgDark : bgLight)
  const scale = Math.max(SHARE_CARD_W / img.naturalWidth, SHARE_CARD_H / img.naturalHeight)
  const dw = img.naturalWidth * scale
  const dh = img.naturalHeight * scale
  ctx.drawImage(img, (SHARE_CARD_W - dw) / 2, (SHARE_CARD_H - dh) / 2, dw, dh)
}

// --- Іконки рядків та бейджів: мінімалістичні штрихові, у стилі картки ---

export type ShareIcon = 'wallet' | 'swap' | 'calendar' | 'note' | 'person' | 'shield' | 'zap' | 'clock'

export function drawShareIcon(ctx: CanvasRenderingContext2D, icon: ShareIcon, cx: number, cy: number, color: string) {
  ctx.save()
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = 3.5
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  const rect = (x: number, y: number, w: number, h: number, r: number) => {
    shareRoundRect(ctx, x, y, w, h, r)
    ctx.stroke()
  }

  switch (icon) {
    case 'wallet':
      rect(cx - 22, cy - 15, 44, 32, 8)
      ctx.beginPath()
      ctx.moveTo(cx - 22, cy - 5)
      ctx.lineTo(cx + 22, cy - 5)
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(cx + 11, cy + 8, 3.5, 0, Math.PI * 2)
      ctx.fill()
      break
    case 'swap':
      ctx.beginPath()
      ctx.moveTo(cx - 19, cy - 8)
      ctx.lineTo(cx + 13, cy - 8)
      ctx.moveTo(cx + 6, cy - 15)
      ctx.lineTo(cx + 14, cy - 8)
      ctx.lineTo(cx + 6, cy - 1)
      ctx.moveTo(cx + 19, cy + 8)
      ctx.lineTo(cx - 13, cy + 8)
      ctx.moveTo(cx - 6, cy + 1)
      ctx.lineTo(cx - 14, cy + 8)
      ctx.lineTo(cx - 6, cy + 15)
      ctx.stroke()
      break
    case 'calendar':
      rect(cx - 20, cy - 15, 40, 33, 8)
      ctx.beginPath()
      ctx.moveTo(cx - 10, cy - 21)
      ctx.lineTo(cx - 10, cy - 11)
      ctx.moveTo(cx + 10, cy - 21)
      ctx.lineTo(cx + 10, cy - 11)
      ctx.moveTo(cx - 20, cy - 3)
      ctx.lineTo(cx + 20, cy - 3)
      ctx.stroke()
      break
    case 'note':
      rect(cx - 16, cy - 20, 32, 40, 8)
      ctx.beginPath()
      ctx.moveTo(cx - 7, cy - 8)
      ctx.lineTo(cx + 7, cy - 8)
      ctx.moveTo(cx - 7, cy)
      ctx.lineTo(cx + 7, cy)
      ctx.moveTo(cx - 7, cy + 8)
      ctx.lineTo(cx + 3, cy + 8)
      ctx.stroke()
      break
    case 'person':
      ctx.beginPath()
      ctx.arc(cx, cy - 10, 9, 0, Math.PI * 2)
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(cx, cy + 20, 15, Math.PI, 0)
      ctx.stroke()
      break
    case 'shield':
      ctx.beginPath()
      ctx.moveTo(cx, cy - 17)
      ctx.lineTo(cx + 13, cy - 11)
      ctx.lineTo(cx + 13, cy + 1)
      ctx.quadraticCurveTo(cx + 13, cy + 11, cx, cy + 17)
      ctx.quadraticCurveTo(cx - 13, cy + 11, cx - 13, cy + 1)
      ctx.lineTo(cx - 13, cy - 11)
      ctx.closePath()
      ctx.stroke()
      break
    case 'zap':
      ctx.beginPath()
      ctx.moveTo(cx + 3, cy - 16)
      ctx.lineTo(cx - 9, cy + 2)
      ctx.lineTo(cx - 2, cy + 2)
      ctx.lineTo(cx - 4, cy + 16)
      ctx.lineTo(cx + 9, cy - 2)
      ctx.lineTo(cx + 2, cy - 2)
      ctx.closePath()
      ctx.fill()
      break
    case 'clock':
      ctx.beginPath()
      ctx.arc(cx, cy, 14, 0, Math.PI * 2)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(cx, cy - 7)
      ctx.lineTo(cx, cy)
      ctx.lineTo(cx + 5, cy + 3)
      ctx.stroke()
      break
  }
  ctx.restore()
}

// --- Нижня рекламна зона: QR і текст у тому самому Liquid Glass стилі.

export async function drawShareAdZone(ctx: CanvasRenderingContext2D, p: SharePalette) {
  const x = SHARE_PAD
  const y = SHARE_AD_TOP
  const w = SHARE_CARD_W - SHARE_PAD * 2
  const h = SHARE_AD_HEIGHT
  const qrSize = 172

  drawGlassPanel(ctx, x, y, w, h, 32, p)

  // QR має власний білий фон, потрібний для сканування.
  try {
    const qrImage = await loadShareImage(shareQr)
    ctx.drawImage(qrImage, x + 34, y + 54, qrSize, qrSize)
  } catch {
    // Якщо зображення QR не завантажилось, текстова частина реклами все одно лишається.
  }

  // Текст праворуч від QR.
  const tx = x + 34 + qrSize + 42
  const textW = x + w - 34 - tx
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'

  // Не малюємо wordmark до завантаження Lato: інакше Canvas може один раз
  // використати fallback-шрифт, навіть якщо Google Font вже підключений CSS.
  if (typeof document !== 'undefined' && document.fonts) {
    await document.fonts.load(`${SHARE_BRAND_WEIGHT} ${SHARE_BRAND_SIZE}px ${SHARE_BRAND}`)
  }
  ctx.font = shareFont(SHARE_BRAND_WEIGHT, SHARE_BRAND_SIZE, SHARE_BRAND)
  const brandParts: Array<[string, string]> = [
    ['FINDO', p.text],
    ['$$', SHARE_BRAND_GREEN],
    ['AR', p.text],
  ]
  let bx = tx
  brandParts.forEach(([part, color], partIndex) => {
    ctx.fillStyle = color
    Array.from(part).forEach((character, characterIndex) => {
      ctx.fillText(character, bx, y + 54)
      bx += ctx.measureText(character).width
      const isLastCharacter = partIndex === brandParts.length - 1 && characterIndex === part.length - 1
      if (!isLastCharacter) bx += SHARE_BRAND_LETTER_SPACING
    })
  })

  const tagline = fitText(ctx, 'Керуйте боргами легко та без зайвого стресу!', 600, 26, SHARE_SANS, textW, 20)
  ctx.font = shareFont(600, tagline.size, SHARE_SANS)
  ctx.fillStyle = p.text
  ctx.fillText(tagline.text, tx, y + 100)

  const desc = fitText(ctx, 'Відстежуйте борги, ведіть облік та будуйте фінанси.', 400, 23, SHARE_SANS, textW, 18)
  ctx.font = shareFont(400, desc.size, SHARE_SANS)
  ctx.fillStyle = p.muted
  ctx.fillText(desc.text, tx, y + 134)
}
