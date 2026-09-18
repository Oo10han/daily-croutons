<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { amountText, categories, money, parseAmount, totals, dailyTotals, type DailyTotal } from '../../shared/finance'
import LedgerCalendar from './LedgerCalendar.vue'
import type { Transaction, TransactionType } from '../../shared/types'

const props = defineProps<{ month: string; selected: string; refreshToken: number; disabled: boolean }>()
const emit = defineEmits<{ dates: [dates: string[]]; navigate: [date: string]; shift: [delta: number]; daily: [totals: Record<string, DailyTotal>]; loadState: [state: 'loading' | 'ready' | 'error'] }>()
const display = ref<'calendar' | 'list'>('calendar')
let requestedDay: string | null = null
const rows = ref<Transaction[]>([]), loading = ref(false), saving = ref(false)
const error = ref(''), message = ref(''), formError = ref('')
const scope = ref<'month' | 'day'>('month'), typeFilter = ref('all'), categoryFilter = ref('all'), search = ref('')
const editing = ref(false), deleting = ref<Transaction | null>(null), dialogElement = ref<HTMLElement | null>(null)
const draft = reactive({ id: undefined as string | undefined, date: '', type: 'expense' as TransactionType, amount: '', category: '餐饮', note: '' })
let initialDraft = '', request = 0, previousFocus: HTMLElement | null = null, confirming = false
const monthLabel = computed(() => `${props.month.slice(0, 4)} 年 ${Number(props.month.slice(5))} 月`)
const summary = computed(() => totals(rows.value))
const byDay = computed(() => dailyTotals(rows.value))
watch(byDay, value => emit('daily', value), { immediate: true })
function openDay(date: string) {
  // 从日历进入当天明细时清除旧筛选，显示当天的全部收入和支出。
  typeFilter.value = 'all'; categoryFilter.value = 'all'; search.value = ''
  requestedDay = date
  scope.value = 'day'; display.value = 'list'; emit('navigate', date)
}
const filterCategories = computed(() => typeFilter.value === 'all' ? [...new Set([...categories.expense, ...categories.income])] : categories[typeFilter.value as TransactionType])
const filtered = computed(() => rows.value.filter(row =>
  (scope.value === 'month' || row.date === props.selected) &&
  (typeFilter.value === 'all' || row.type === typeFilter.value) &&
  (categoryFilter.value === 'all' || row.category === categoryFilter.value) &&
  `${row.note} ${row.category} ${row.date}`.toLowerCase().includes(search.value.trim().toLowerCase())
))
const filterTotals = computed(() => totals(filtered.value))
const groups = computed(() => {
  const result = new Map<string, Transaction[]>()
  for (const row of filtered.value) result.set(row.date, [...(result.get(row.date) ?? []), row])
  return [...result].map(([date, items]) => ({ date, items, ...totals(items) }))
})
const distribution = computed(() => categories.expense.map(category => ({ category, amount: rows.value.filter(r => r.type === 'expense' && r.category === category).reduce((sum, r) => sum + r.amountCents, 0) })).filter(r => r.amount > 0).sort((a, b) => b.amount - a.amount))
const changed = computed(() => editing.value && JSON.stringify(draft) !== initialDraft)
watch([loading, error], () => emit('loadState', loading.value ? 'loading' : error.value ? 'error' : 'ready'), { immediate: true })
async function refresh() {
  // 月份快速切换时，只接收最后一次请求，避免旧月份覆盖当前列表。
  const id = ++request
  loading.value = true; error.value = ''
  try {
    const result = await window.journal.transactions.list(props.month)
    if (id !== request) return
    rows.value = result; emit('dates', result.map(r => r.date))
  } catch (e) { if (id === request) { rows.value = []; emit('dates', []); error.value = String(e) } }
  finally { if (id === request) loading.value = false }
}
watch(() => [props.month, props.refreshToken], () => { rows.value = []; emit('dates', []); void refresh() }, { immediate: true })
watch(typeFilter, () => { categoryFilter.value = 'all' })
watch(() => [props.month, props.selected], ([month, selected], [oldMonth, oldSelected]) => {
  // 跨月点击日期时，日期和月份可能先后更新，等两者对齐后再显示当天。
  if (requestedDay === selected && selected.startsWith(month)) { scope.value = 'day'; requestedDay = null }
  else if (month !== oldMonth) scope.value = 'month'
  else if (selected !== oldSelected && selected.startsWith(month)) scope.value = 'day'
})
async function focusDialog() { await nextTick(); dialogElement.value?.querySelector<HTMLElement>('input,button')?.focus() }
function open(row?: Transaction) {
  previousFocus = document.activeElement as HTMLElement
  Object.assign(draft, row ? { id: row.id, date: row.date, type: row.type, amount: amountText(row.amountCents), category: row.category, note: row.note } : { id: undefined, date: props.selected.startsWith(props.month) ? props.selected : `${props.month}-01`, type: 'expense', amount: '', category: '餐饮', note: '' })
  initialDraft = JSON.stringify(draft); formError.value = ''; editing.value = true
  void focusDialog()
}
function setType(type: TransactionType) { draft.type = type; if (!categories[type].includes(draft.category)) draft.category = categories[type][0] }
async function dismiss() {
  if (saving.value || confirming) return false
  confirming = true
  try {
    if (changed.value && !await window.journal.transactions.confirmDiscard()) return false
    editing.value = false; deleting.value = null; previousFocus?.focus(); return true
  } catch (e) { formError.value = String(e); return false } finally { confirming = false }
}
async function beforeClose() { return !saving.value && (!editing.value || await dismiss()) }
async function saveDraft() {
  if (!editing.value || saving.value || props.disabled) return
  saving.value = true; formError.value = ''
  try {
    const row = await window.journal.transactions.save({ id: draft.id, date: draft.date, type: draft.type, amountCents: parseAmount(draft.amount), category: draft.category, note: draft.note.trim() })
    // 数据库写入成功即关闭表单，刷新列表失败时不会重复创建同一笔账目。
    editing.value = false; message.value = draft.id ? '账目已更新' : '已记下一笔'; previousFocus?.focus()
    await refresh()
    if (!row.date.startsWith(props.month)) emit('navigate', row.date)
  } catch (e) { formError.value = e instanceof Error ? e.message : String(e) }
  finally { saving.value = false }
}
async function askDelete(row: Transaction) { previousFocus = document.activeElement as HTMLElement; deleting.value = row; formError.value = ''; await focusDialog() }
async function remove() {
  if (!deleting.value || saving.value) return
  saving.value = true
  try { await window.journal.transactions.remove(deleting.value.id); deleting.value = null; message.value = '账目已删除'; await refresh(); previousFocus?.focus() }
  catch (e) { formError.value = String(e) } finally { saving.value = false }
}
function keydown(event: KeyboardEvent) {
  if (!editing.value && !deleting.value) return
  if (event.key === 'Escape') { event.preventDefault(); void dismiss() }
  if (event.key === 'Tab') {
    const items = Array.from(dialogElement.value?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)') ?? [])
    const first = items[0], last = items[items.length - 1]
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
  }
}
onMounted(() => window.addEventListener('keydown', keydown))
onBeforeUnmount(() => { request++; window.removeEventListener('keydown', keydown) })
defineExpose({ beforeClose, saveDraft })
</script>

<template>
  <section class="ledger" :class="{ 'calendar-mode': display === 'calendar' }">
    <div class="ledger-heading"><div><div class="eyebrow">把每一笔，记得清清楚楚</div><h1>生活账本 <span>{{ monthLabel }}</span></h1></div><div class="ledger-heading-actions"><div class="ledger-view-tabs"><button :class="{ active: display === 'calendar' }" :aria-pressed="display === 'calendar'" @click="display = 'calendar'">收支日历</button><button :class="{ active: display === 'list' }" :aria-pressed="display === 'list'" @click="display = 'list'">收支明细</button></div><button class="save-button" :disabled="disabled || loading" @click="open()">＋ 记一笔</button></div></div>
    <div v-if="error" class="message error" role="alert">{{ error }} <button @click="refresh">重新加载</button></div>
    <div v-if="message" class="ledger-notice" role="status">{{ message }}</div>
    <div class="ledger-stats" :aria-busy="loading">
      <div><span>月支出</span><strong class="expense" data-testid="month-expense">{{ loading || error ? '—' : money(summary.expense) }}</strong><small>这个月的生活花费</small></div>
      <div><span>月收入</span><strong class="income" data-testid="month-income">{{ loading || error ? '—' : money(summary.income) }}</strong><small>每一份收入都值得记录</small></div>
      <div class="balance-card"><span>月收支差额</span><strong data-testid="month-balance">{{ loading || error ? '—' : money(summary.balance) }}</strong><small>收入 − 支出 · 非账户余额</small></div>
    </div>
    <LedgerCalendar v-if="display === 'calendar'" :month="month" :selected="selected" :totals="byDay" :loading="loading" :failed="!!error" :disabled="disabled" @select="openDay" @shift="emit('shift', $event)" />
    <div v-show="display === 'list'" class="ledger-content">
      <section class="ledger-list">
        <div class="ledger-list-header"><h2>收支明细</h2><div class="scope-tabs"><button :class="{ active: scope === 'month' }" @click="scope = 'month'">整月</button><button :class="{ active: scope === 'day' }" :disabled="!selected.startsWith(month)" @click="scope = 'day'">{{ Number(selected.slice(5,7)) }}/{{ Number(selected.slice(8)) }} 当天</button></div></div>
        <div class="ledger-filters"><select v-model="typeFilter" aria-label="收支筛选"><option value="all">全部收支</option><option value="expense">支出</option><option value="income">收入</option></select><select v-model="categoryFilter" aria-label="分类筛选"><option value="all">全部分类</option><option v-for="item in filterCategories" :key="item">{{ item }}</option></select><input v-model="search" aria-label="搜索账目" placeholder="搜索备注、分类…" /></div>
        <div class="filtered-summary">{{ filtered.length }} 笔 <span>支出 {{ money(filterTotals.expense) }} · 收入 {{ money(filterTotals.income) }}</span></div>
        <div class="transaction-scroll">
          <p v-if="loading" class="ledger-empty">正在读取账目…</p>
          <template v-else><section v-for="group in groups" :key="group.date" class="transaction-group"><div class="transaction-day"><span>{{ group.date.replaceAll('-', '.') }}</span><span>支 {{ money(group.expense) }} / 收 {{ money(group.income) }}</span></div><div v-for="row in group.items" :key="row.id" class="transaction-row" :data-id="row.id"><span class="category-icon" :class="row.type">{{ row.type === 'expense' ? '↗' : '↙' }}</span><div class="transaction-description"><strong>{{ row.category }}</strong><span :title="row.note">{{ row.note || (row.type === 'expense' ? '支出' : '收入') }}</span></div><strong class="transaction-amount" :class="row.type">{{ row.type === 'expense' ? '−' : '+' }}{{ money(row.amountCents) }}</strong><div class="transaction-actions"><button :disabled="disabled" :aria-label="`编辑账目 ${row.note || row.category}`" @click="open(row)">编辑</button><button :disabled="disabled" :aria-label="`删除账目 ${row.note || row.category}`" @click="askDelete(row)">删除</button></div></div></section><div v-if="!groups.length" class="ledger-empty"><span>☷</span><p>{{ rows.length ? '没有符合筛选条件的账目' : '这个月还没有账目' }}</p><small>点击「记一笔」，从今天的第一笔开始。</small></div></template>
        </div>
      </section>
      <aside class="category-panel"><h2>支出去哪了</h2><p>整月分类统计 · 人民币</p><div v-for="item in distribution" :key="item.category" class="category-stat"><div><span>{{ item.category }}</span><strong>{{ money(item.amount) }}</strong></div><div class="category-track"><i :style="{ width: `${item.amount / summary.expense * 100}%` }"></i></div><small>{{ (item.amount / summary.expense * 100).toFixed(1) }}%</small></div><p v-if="!distribution.length" class="ledger-empty">记下一笔支出后，<br>在这里查看分类占比。</p></aside>
    </div>
    <div class="bottom-note"><span>✦ 记下收支，也留一点余地给生活。</span><span>人民币 CNY · 本地保存</span></div>
    <Teleport to="body"><div v-if="editing || deleting" class="modal-backdrop" @click.self="dismiss"><section ref="dialogElement" class="ledger-modal" role="dialog" aria-modal="true" aria-labelledby="ledger-dialog-title">
      <template v-if="editing"><div class="ledger-modal-heading"><h2 id="ledger-dialog-title">{{ draft.id ? '编辑账目' : '记一笔' }}</h2><button aria-label="关闭记账表单" :disabled="saving" @click="dismiss">×</button></div><form @submit.prevent="saveDraft"><fieldset :disabled="saving"><div class="type-tabs"><button type="button" :aria-pressed="draft.type === 'expense'" :class="{ active: draft.type === 'expense' }" @click="setType('expense')">支出</button><button type="button" :aria-pressed="draft.type === 'income'" :class="{ active: draft.type === 'income' }" @click="setType('income')">收入</button></div><label class="amount-label">金额（元）<div><span>¥</span><input v-model="draft.amount" aria-label="账目金额" inputmode="decimal" placeholder="0.00" maxlength="10" required /></div></label><div class="form-two"><label>日期<input v-model="draft.date" aria-label="账目日期" type="date" min="1900-01-01" max="9999-12-31" required /></label><label>分类<select v-model="draft.category" aria-label="账目分类"><option v-for="item in categories[draft.type]" :key="item">{{ item }}</option></select></label></div><label>备注<textarea v-model="draft.note" aria-label="账目备注" maxlength="500" placeholder="这笔钱用在了哪里？（可选）"></textarea></label></fieldset><div v-if="formError" class="message error" role="alert">{{ formError }}</div><div class="ledger-modal-footer"><span>点击保存后计入账本</span><button type="button" :disabled="saving" @click="dismiss">取消</button><button class="save-button" :disabled="saving" type="submit">{{ saving ? '正在保存…' : '保存账目' }}</button></div></form></template>
      <template v-else-if="deleting"><h2 id="ledger-dialog-title">删除这笔账目？</h2><p class="delete-detail">{{ deleting.date }} · {{ deleting.category }} · {{ money(deleting.amountCents) }}<br>{{ deleting.note }}<br>删除后无法撤销，月度统计会同步更新。</p><div v-if="formError" class="message error" role="alert">{{ formError }}</div><div class="ledger-modal-footer"><button :disabled="saving" @click="dismiss">保留账目</button><button class="danger" :disabled="saving" @click="remove">确认删除账目</button></div></template>
    </section></div></Teleport>
  </section>
</template>
