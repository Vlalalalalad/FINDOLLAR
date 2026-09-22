/**
 * Форматує Date у рядок для <input type="datetime-local"> — обов'язково
 * за ЛОКАЛЬНИМИ компонентами часу (getHours/getMinutes), а не через
 * toISOString(), яка віддає UTC. Саме toISOString() тут була причиною
 * бага: браузер показує/приймає значення datetime-local як локальний
 * час без жодної конвертації, тож рядок в UTC "з'їжджав" на величину
 * часового поясу (для Києва — на 2-3 години).
 */
export function toLocalDatetimeInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * Перетворює значення з datetime-local (локальний час, точність до
 * хвилини) на ISO-мітку для збереження, підставляючи секунди/мілісекунди
 * ПОТОЧНОГО моменту. Це суто технічний прийом: якщо записати кілька
 * операцій підряд з однаковою хвилиною (типове "зараз"), вони не лягають
 * з однаковим occurred_at (що робить порядок сортування недетермінованим
 * і operації "стрибають"), а коректно шикуються в порядку введення.
 * Самі секунди ніде користувачу не показуються.
 */
export function localInputValueToIso(inputValue: string): string {
  const chosen = new Date(inputValue)
  const now = new Date()
  chosen.setSeconds(now.getSeconds(), now.getMilliseconds())
  return chosen.toISOString()
}

/** Заголовок групи записів за датою: "Сьогодні" / "Учора" / повна дата. */
export function dateGroupLabel(d: Date): string {
  const startOfDay = (x: Date) => {
    const y = new Date(x)
    y.setHours(0, 0, 0, 0)
    return y.getTime()
  }
  const today = startOfDay(new Date())
  const yesterday = today - 24 * 60 * 60 * 1000
  const day = startOfDay(d)
  if (day === today) return 'Сьогодні'
  if (day === yesterday) return 'Учора'
  return d.toLocaleDateString('uk-UA', { day: 'numeric', month: 'long', year: 'numeric' })
}

/** Понеділок поточного тижня (00:00), як прийнято в Україні/Європі. */
export function startOfWeek(d: Date): Date {
  const day = d.getDay() // 0 = неділя, 1 = понеділок...
  const diff = (day === 0 ? -6 : 1) - day
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + diff)
}
