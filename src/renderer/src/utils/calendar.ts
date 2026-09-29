// 日历按本地日期显示，不能用 toISOString() 的 UTC 日期，否则会在时区边界偏一天。
export function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

// 固定六周、周一开头，保留相邻月日期供导航；可选日期范围由调用方限制。
export function calendarCells(month: Date) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1)
  const offset = (first.getDay() + 6) % 7
  return Array.from({ length: 42 }, (_, i) => {
    const date = new Date(first.getFullYear(), first.getMonth(), i - offset + 1)
    return { key: dateKey(date), day: date.getDate(), outside: date.getMonth() !== first.getMonth() }
  })
}
