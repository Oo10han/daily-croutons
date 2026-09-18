<script setup lang="ts">
import { computed } from 'vue'
import { money, type DailyTotal } from '../../shared/finance'

const props = defineProps<{
  month: string
  selected: string
  totals: Record<string, DailyTotal>
  loading: boolean
  disabled: boolean
  failed: boolean
}>()
const emit = defineEmits<{ select: [date: string]; shift: [delta: number] }>()
function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
const today = dateKey(new Date())
const monthTitle = computed(() => `${props.month.slice(0, 4)} 年 ${Number(props.month.slice(5))} 月`)
const cells = computed(() => {
  const first = new Date(`${props.month}-01T12:00:00`)
  const offset = (first.getDay() + 6) % 7
  return Array.from({ length: 42 }, (_, i) => {
    const date = new Date(first.getFullYear(), first.getMonth(), i - offset + 1)
    const key = dateKey(date)
    return { key, day: date.getDate(), outside: !key.startsWith(props.month), total: props.totals[key] }
  })
})
function label(cell: typeof cells.value[number]) {
  if (cell.outside) return `查看 ${cell.key}`
  if (props.loading) return `${cell.key} 正在读取`
  if (props.failed) return `${cell.key} 读取失败`
  return `${cell.key} 收入 ${money(cell.total?.income ?? 0)}，支出 ${money(cell.total?.expense ?? 0)}，点击查看当天明细`
}
</script>

<template>
  <section class="income-calendar" aria-label="每日收支日历" :aria-busy="loading">
    <header class="income-calendar-heading">
      <div><button aria-label="收支日历上个月" :disabled="disabled || month === '1900-01'" @click="emit('shift', -1)">‹</button><strong>{{ monthTitle }}</strong><button aria-label="收支日历下个月" :disabled="disabled || month === '9999-12'" @click="emit('shift', 1)">›</button></div>
      <span><i class="income">收</i> 收入 <i class="expense">支</i> 支出 · 元</span>
    </header>
    <div class="income-calendar-scroll">
      <div class="income-weekdays"><span v-for="day in ['一', '二', '三', '四', '五', '六', '日']" :key="day">{{ day }}</span></div>
      <div class="income-days">
        <button v-for="cell in cells" :key="cell.key" :data-date="cell.key" :aria-label="label(cell)" :title="label(cell)" :aria-pressed="selected === cell.key" :disabled="disabled || loading || cell.key < '1900-01-01' || cell.key > '9999-12-31'" :class="{ outside: cell.outside, chosen: selected === cell.key, today: today === cell.key }" @click="emit('select', cell.key)">
          <span class="income-date">{{ cell.day }}<small v-if="today === cell.key">今天</small></span>
          <template v-if="!cell.outside && !loading && !failed && cell.total">
            <span class="income-day-amount income"><span>收</span><b>{{ money(cell.total.income).replace('¥', '') }}</b></span>
            <span class="income-day-amount expense"><span>支</span><b>{{ money(cell.total.expense).replace('¥', '') }}</b></span>
          </template>
          <span v-else-if="!cell.outside" class="income-empty">{{ loading ? '…' : failed ? '未读取' : '—' }}</span>
        </button>
      </div>
    </div>
    <footer>点击日期查看当天明细 <span>显示整月全部账目</span></footer>
  </section>
</template>
