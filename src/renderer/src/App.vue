<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { moods, type DiaryInput, type DiarySummary, type Mood } from '../../shared/types'
import Ledger from './Ledger.vue'
import Health from './Health.vue'
import { money, type DailyTotal } from '../../shared/finance'

function dateKey(d: Date) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const today = dateKey(new Date())
const selected = ref(today)
const month = ref(new Date(new Date().getFullYear(), new Date().getMonth(), 1))
const title = ref(''), body = ref(''), mood = ref<Mood>('')
const records = ref<DiarySummary[]>([])
type Page = 'diary' | 'ledger' | 'health'
const view = ref<Page>('diary')
const ledger = ref<InstanceType<typeof Ledger> | null>(null)
const health = ref<InstanceType<typeof Health> | null>(null)
const healthDates = ref<string[]>([])
const pageTitle = computed(() => ({ diary: '日记', ledger: '生活账本', health: '饮食与体重' })[view.value])
const ledgerDates = ref<string[]>([]), refreshToken = ref(0)
const ledgerDaily = ref<Record<string, DailyTotal>>({})
const ledgerState = ref<'loading' | 'ready' | 'error'>('loading')
function dateTitle(date: string) {
  const total = ledgerDaily.value[date]
  if (view.value !== 'ledger' || !date.startsWith(monthKey.value)) return date
  if (ledgerState.value !== 'ready') return `${date} ${ledgerState.value === 'loading' ? '正在读取' : '读取失败'}`
  return `${date} 收入 ${money(total?.income ?? 0)}，支出 ${money(total?.expense ?? 0)}`
}
const monthKey = computed(() => dateKey(month.value).slice(0, 7))
const ready = ref(false), busy = ref(false), dirty = ref(false), saving = ref(false)
const error = ref(''), notice = ref(''), search = ref(''), deleteOpen = ref(false)
let revision = 0
let timer: ReturnType<typeof setTimeout> | undefined
let pending: Promise<void> = Promise.resolve()
let unsubscribe: (() => void) | undefined
const icons: Record<Mood, string> = { '': '○', 开心: '☀', 平静: '☁', 疲惫: '☾', 低落: '☂', 充实: '✦' }
const selectedDate = computed(() => new Date(selected.value + 'T12:00:00'))
const heading = computed(() => `${selectedDate.value.getMonth() + 1} 月 ${selectedDate.value.getDate()} 日`)
const weekday = computed(() => selectedDate.value.toLocaleDateString('zh-CN', { weekday: 'long' }))
const monthHeading = computed(() => `${month.value.getFullYear()} 年 ${month.value.getMonth() + 1} 月`)
const diaryDates = computed(() => new Set(records.value.map(d => d.date)))
const datesWithEntries = computed(() => view.value === 'diary' ? diaryDates.value : new Set(view.value === 'ledger' ? ledgerDates.value : healthDates.value))
const recent = computed(() => records.value.filter(d => `${d.date} ${d.title}`.toLowerCase().includes(search.value.toLowerCase())).slice(0, 20))
const monthCount = computed(() => records.value.filter(d => d.date.startsWith(dateKey(month.value).slice(0, 7))).length)
const wordCount = computed(() => body.value.replace(/\s/g, '').length)
const status = computed(() => error.value ? '保存遇到问题' : saving.value ? '正在保存…' : dirty.value ? '等待保存…' : '已保存到本机')
const cells = computed(() => {
  const first = new Date(month.value.getFullYear(), month.value.getMonth(), 1)
  const offset = (first.getDay() + 6) % 7
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(first.getFullYear(), first.getMonth(), i - offset + 1)
    return { key: dateKey(d), day: d.getDate(), outside: d.getMonth() !== first.getMonth() }
  })
})
async function refresh() { records.value = await window.journal.list() }
function report(e: unknown) { error.value = e instanceof Error ? e.message : String(e) }
function edited() {
  dirty.value = true; revision++; notice.value = ''; error.value = ''
  clearTimeout(timer)
  timer = setTimeout(() => { void flush().catch(report) }, 550)
}
function flush(): Promise<void> {
  clearTimeout(timer)
  // Snapshot is taken when the queued write starts, so rapid edits cannot overwrite newer content.
  pending = pending.catch(() => {}).then(async () => {
    if (!dirty.value) return
    const version = revision
    const input: DiaryInput = { date: selected.value, title: title.value, body: body.value, mood: mood.value }
    saving.value = true
    try {
      await window.journal.save(input)
      if (revision === version) dirty.value = false
      error.value = ''
      await refresh()
    } catch (e) { report(e); throw e }
    finally { saving.value = false }
  })
  return pending
}
async function load(date: string) {
  const entry = await window.journal.get(date)
  selected.value = date
  title.value = entry?.title ?? ''; body.value = entry?.body ?? ''; mood.value = entry?.mood ?? ''
  dirty.value = false; revision++; error.value = ''; deleteOpen.value = false
}
async function select(date: string) {
  if (busy.value || !ready.value) return
  busy.value = true
  try {
    await flush(); await load(date)
    const d = new Date(date + 'T12:00:00'); month.value = new Date(d.getFullYear(), d.getMonth(), 1)
  } catch (e) { report(e) } finally { busy.value = false }
}
function shiftMonth(delta: number) {
  const next = new Date(month.value.getFullYear(), month.value.getMonth() + delta, 1)
  if (next.getFullYear() >= 1900 && next.getFullYear() <= 9999) month.value = next
}
function setMood(value: Mood) { mood.value = mood.value === value ? '' : value; edited() }
async function saveNow() { try { await flush() } catch (e) { report(e) } }
// 各模块共用日历；切换前完成日记保存，并处理尚未提交的表单。
async function changeView(next: Page) {
  if (busy.value || !ready.value || next === view.value) return
  busy.value = true
  try { if (await ledger.value?.beforeClose() === false || await health.value?.beforeClose() === false) return; await flush(); view.value = next }
  catch (e) { report(e) } finally { busy.value = false }
}
async function backup(action: 'export' | 'import') {
  if (busy.value) return
  busy.value = true; notice.value = ''
  try {
    await flush()
    if (action === 'export') { if (await window.journal.exportBackup()) notice.value = '备份已导出，请妥善保存。' }
    else {
      const count = await window.journal.importBackup()
      if (count !== null) { await refresh(); await load(selected.value); refreshToken.value++; notice.value = `已恢复 ${count.diaries} 篇日记、${count.transactions} 笔账目、${count.meals} 条饮食、${count.weights} 条体重。` }
    }
  } catch (e) { report(e) } finally { busy.value = false }
}
async function remove() {
  busy.value = true
  try {
    await flush(); await window.journal.remove(selected.value); await refresh(); await load(selected.value)
    notice.value = '这一天的日记已删除。'
  } catch (e) { report(e) } finally { busy.value = false; deleteOpen.value = false }
}
function shortcut(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault()
    if (view.value === 'ledger') void ledger.value?.saveDraft()
    else if (view.value === 'health') void health.value?.saveDraft()
    else void saveNow()
  }
  if (event.key === 'Escape') deleteOpen.value = false
}
onMounted(async () => {
  window.addEventListener('keydown', shortcut)
  unsubscribe = window.journal?.onCloseRequest(async () => {
    if (busy.value) { notice.value = '请等待当前操作完成后再关闭。'; return }
    busy.value = true
    try {
      if (await ledger.value?.beforeClose() === false || await health.value?.beforeClose() === false) { busy.value = false; return }
      await flush(); window.journal.closeReady()
    }
    catch (e) { report(e); busy.value = false }
  })
  try {
    if (!window.journal) throw new Error('请通过桌面应用启动，以使用本地数据库。')
    await refresh(); await load(today); ready.value = true
  } catch (e) { report(e) }
})
onUnmounted(() => { clearTimeout(timer); unsubscribe?.(); window.removeEventListener('keydown', shortcut) })
</script>

<template>
  <div class="shell">
    <aside class="sidebar">
      <div class="brand"><span class="brand-mark">日</span><div><strong>小日子</strong><small>LITTLE DAYS</small></div></div>
      <button class="nav-item" :class="{ active: view === 'diary' }" :disabled="busy || !ready" aria-label="我的日记" @click="changeView('diary')"><span>▤</span> 我的日记 <span class="nav-count">{{ records.length }}</span></button>
      <button class="nav-item" :class="{ active: view === 'ledger' }" :disabled="busy || !ready" aria-label="生活账本" @click="changeView('ledger')"><span>￥</span> 生活账本</button>
      <button class="nav-item" :class="{ active: view === 'health' }" :disabled="busy || !ready" aria-label="饮食与体重" @click="changeView('health')"><span>♧</span> 饮食与体重</button>
      <section class="calendar" aria-label="日历">
        <div class="calendar-header"><strong>{{ monthHeading }}</strong><div><button aria-label="上个月" @click="shiftMonth(-1)">‹</button><button aria-label="下个月" @click="shiftMonth(1)">›</button></div></div>
        <div class="weekdays"><span v-for="day in ['一','二','三','四','五','六','日']" :key="day">{{ day }}</span></div>
        <div class="days"><button v-for="cell in cells" :key="cell.key" :title="dateTitle(cell.key)" :aria-label="cell.key" :aria-pressed="cell.key === selected" :class="{ outside: cell.outside, selected: cell.key === selected, today: cell.key === today, recorded: datesWithEntries.has(cell.key) }" :disabled="busy || !ready || cell.key < '1900-01-01' || cell.key > '9999-12-31'" @click="select(cell.key)">{{ cell.day }}</button></div>
        <div class="calendar-foot"><span>{{ view === 'diary' ? `本月记录了 ${monthCount} 天` : view === 'ledger' ? `本月 ${ledgerDates.length} 笔账目` : `本月记录了 ${healthDates.length} 天` }}</span><button :disabled="busy || !ready" @click="select(today)">回到今天 ↗</button></div>
      </section>
      <section class="history"><div class="section-label">翻翻以前 <span>{{ records.length }} 篇</span></div><input v-model="search" aria-label="查找日记" placeholder="按标题或日期查找…" class="search" />
        <div class="history-list"><button v-for="entry in recent" :key="entry.date" :class="{ active: entry.date === selected }" :disabled="busy || !ready" @click="select(entry.date)"><span class="entry-date">{{ entry.date.replaceAll('-', '.') }} <span>{{ icons[entry.mood] }}</span></span><strong>{{ entry.title || '未命名日记' }}</strong></button><p v-if="!recent.length" class="empty">{{ search ? '没有找到匹配的日记' : '写下第一篇，故事从这里开始。' }}</p></div>
      </section>
      <div class="sidebar-bottom"><span class="local-dot"></span> 本地手账 · 无需联网 <small>v0.4</small></div>
    </aside>
    <main>
      <header class="topbar"><span>我的手账 <span class="slash">/</span> {{ pageTitle }}</span><div><button :disabled="busy || !ready" @click="backup('import')">恢复备份</button><button class="outline" :disabled="busy || !ready" @click="backup('export')">↥ 导出备份</button></div></header>
      <div class="workspace">
        <div v-show="view === 'diary'" class="page-heading"><div><div class="eyebrow">{{ selectedDate.getFullYear() }} · 慢慢记录，好好生活</div><h1>{{ heading }} <span>{{ weekday }}</span></h1></div><span class="date-badge">{{ selected === today ? '今天' : '往日时光' }}</span></div>
        <div v-if="error" class="message error" role="alert">{{ error }} <button v-if="dirty" @click="saveNow">重试保存</button></div>
        <div v-if="notice" class="message" role="status">{{ notice }}</div>
        <article v-show="view === 'diary'" class="paper">
          <div class="paper-top"><span class="paper-label">DAILY JOURNAL</span><span class="save-state" role="status"><i :class="{ pending: dirty || saving, failed: !!error }"></i>{{ ready ? status : '正在读取…' }}</span></div>
          <fieldset :disabled="busy || !ready">
            <input v-model="title" class="title-input" aria-label="日记标题" maxlength="120" placeholder="给今天起个名字…" @input="edited" />
            <div class="mood-row"><span>今天的心情</span><button v-for="item in moods.filter(Boolean)" :key="item" :aria-pressed="mood === item" :class="{ chosen: mood === item }" @click="setMood(item)"><span>{{ icons[item] }}</span>{{ item }}</button></div>
            <div class="writing-area"><textarea v-model="body" aria-label="日记正文" maxlength="100000" placeholder="今天有什么值得记住的小事？&#10;&#10;一顿好吃的饭、一段路上的风景，&#10;或者，只是此刻的心情。" spellcheck="false" @input="edited"></textarea></div>
          </fieldset>
          <footer class="paper-footer"><span>{{ wordCount.toLocaleString() }} 字 <span class="footer-dot">·</span> 随写随存</span><div><button class="delete-button" :disabled="busy || !ready || (!diaryDates.has(selected) && !dirty)" @click="deleteOpen = true">删除日记</button><button class="save-button" :disabled="busy || !ready || saving || !dirty" @click="saveNow">保存日记</button></div></footer>
        </article>
        <div v-show="view === 'diary'" class="bottom-note"><span>✦ 平凡的一天，也值得被记住。</span><span>Ctrl / ⌘ + S 保存</span></div>
        <Ledger v-if="ready" v-show="view === 'ledger'" ref="ledger" :month="monthKey" :selected="selected" :refresh-token="refreshToken" :disabled="busy" @dates="ledgerDates = $event" @daily="ledgerDaily = $event" @load-state="ledgerState = $event" @navigate="select" @shift="shiftMonth" />
        <Health v-if="ready" v-show="view === 'health'" ref="health" :month="monthKey" :selected="selected" :refresh-token="refreshToken" :disabled="busy" @dates="healthDates = $event" @navigate="select" />
      </div>
    </main>
    <div v-if="deleteOpen" class="modal-backdrop" @click.self="deleteOpen = false"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="delete-title"><h2 id="delete-title">删除这一天的日记？</h2><p>{{ selected }} 的标题、正文和心情都会删除。此操作无法撤销；需要保留时，请先导出备份。</p><div><button autofocus @click="deleteOpen = false">保留日记</button><button class="danger" :disabled="busy" @click="remove">确认删除</button></div></section></div>
  </div>
</template>
