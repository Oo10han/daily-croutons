<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { mealSlots, type HealthMonth, type Meal, type MealSlot, type Weight } from '../../shared/types'
import { kilograms, parseWeight } from '../../shared/health'

const props = defineProps<{ month: string; selected: string; refreshToken: number; disabled: boolean }>()
const emit = defineEmits<{ dates: [dates: string[]]; navigate: [date: string] }>()
const data = ref<HealthMonth>({ meals: [], weights: [] })
const loading = ref(false), saving = ref(false), error = ref(''), message = ref(''), formError = ref('')
const formKind = ref<'meal' | 'weight' | null>(null), weightEditing = ref(false)
const deleting = ref<{ kind: 'meal' | 'weight'; key: string; title: string } | null>(null)
const dialogElement = ref<HTMLElement | null>(null)
const draft = reactive({ id: undefined as string | undefined, date: '', slot: '早餐' as MealSlot, food: '', weight: '', note: '' })
let initialDraft = '', request = 0, confirming = false, previousFocus: HTMLElement | null = null
const day = computed(() => props.selected.startsWith(props.month) ? props.selected : `${props.month}-01`)
const monthLabel = computed(() => `${props.month.slice(0, 4)} 年 ${Number(props.month.slice(5))} 月`)
const dailyMeals = computed(() => mealSlots.map(slot => ({ slot, entries: data.value.meals.filter(m => m.date === day.value && m.slot === slot) })))
const dailyWeight = computed(() => data.value.weights.find(w => w.date === day.value))
const latest = computed(() => data.value.weights.at(-1))
const weightHistory = computed(() => [...data.value.weights].reverse())
const difference = computed(() => {
  const weights = data.value.weights
  if (weights.length < 2) return '—'
  const grams = weights[weights.length - 1].grams - weights[0].grams
  return `${grams > 0 ? '+' : ''}${kilograms(grams)} kg`
})
// 横轴按真实日期定位；缺少记录的日期不补零，只有一个测量值时显示单个点。
const chart = computed(() => {
  const weights = data.value.weights
  if (!weights.length) return null
  const values = weights.map(w => w.grams / 1000)
  const low = Math.min(...values) - 0.2, high = Math.max(...values) + 0.2
  const days = new Date(Number(props.month.slice(0, 4)), Number(props.month.slice(5)), 0).getDate()
  const points = weights.map(w => ({ ...w, x: 56 + (Number(w.date.slice(8)) - 1) / (days - 1) * 568, y: 132 - (w.grams / 1000 - low) / (high - low) * 108 }))
  return { days, points, line: points.map(p => `${p.x},${p.y}`).join(' '), ticks: [high, (high + low) / 2, low] }
})
const changed = computed(() => !!formKind.value && JSON.stringify(draft) !== initialDraft)

async function refresh() {
  const id = ++request
  loading.value = true; error.value = ''
  try {
    const result = await window.journal.health.list(props.month)
    if (id !== request) return
    data.value = result
    emit('dates', [...new Set([...result.meals.map(m => m.date), ...result.weights.map(w => w.date)])])
  } catch (e) {
    if (id === request) { data.value = { meals: [], weights: [] }; emit('dates', []); error.value = String(e) }
  } finally { if (id === request) loading.value = false }
}
watch(() => [props.month, props.refreshToken], () => {
  data.value = { meals: [], weights: [] }; emit('dates', []); void refresh()
}, { immediate: true })
async function focusDialog() {
  await nextTick()
  dialogElement.value?.querySelector<HTMLElement>('input:not(:disabled),textarea,button')?.focus()
}
function openMeal(slot: MealSlot = '早餐', row?: Meal) {
  previousFocus = document.activeElement as HTMLElement
  Object.assign(draft, { id: row?.id, date: row?.date ?? day.value, slot: row?.slot ?? slot, food: row?.food ?? '', weight: '', note: row?.note ?? '' })
  initialDraft = JSON.stringify(draft); formKind.value = 'meal'; formError.value = ''; void focusDialog()
}
function openWeight(row?: Weight) {
  previousFocus = document.activeElement as HTMLElement
  const current = row ?? dailyWeight.value
  Object.assign(draft, { id: undefined, date: current?.date ?? day.value, slot: '早餐', food: '', weight: current ? kilograms(current.grams) : '', note: current?.note ?? '' })
  initialDraft = JSON.stringify(draft); weightEditing.value = !!current
  formKind.value = 'weight'; formError.value = ''; void focusDialog()
}
async function dismiss() {
  if (saving.value || confirming) return false
  confirming = true
  try {
    if (changed.value && !await window.journal.health.confirmDiscard()) return false
    formKind.value = null; deleting.value = null; previousFocus?.focus(); return true
  } catch (e) { formError.value = String(e); return false } finally { confirming = false }
}
async function beforeClose() { return !saving.value && (!formKind.value || await dismiss()) }
async function saveDraft() {
  if (!formKind.value || saving.value || props.disabled) return
  saving.value = true; formError.value = ''
  try {
    const date = draft.date
    if (formKind.value === 'meal') {
      await window.journal.health.saveMeal({ id: draft.id, date, slot: draft.slot, food: draft.food, note: draft.note.trim() })
    } else {
      await window.journal.health.saveWeight({ date, grams: parseWeight(draft.weight), note: draft.note.trim() })
    }
    // 关闭已写入的表单，再刷新列表，避免重复点击产生多条饮食记录。
    formKind.value = null; message.value = '记录已保存'; previousFocus?.focus()
    await refresh(); emit('navigate', date)
  } catch (e) { formError.value = e instanceof Error ? e.message : String(e) }
  finally { saving.value = false }
}
async function askDelete(kind: 'meal' | 'weight', key: string, title: string) {
  previousFocus = document.activeElement as HTMLElement
  deleting.value = { kind, key, title }; formError.value = ''; await focusDialog()
}
async function remove() {
  if (!deleting.value || saving.value) return
  saving.value = true
  try {
    const row = deleting.value
    if (row.kind === 'meal') await window.journal.health.removeMeal(row.key)
    else await window.journal.health.removeWeight(row.key)
    deleting.value = null; message.value = '记录已删除'; await refresh(); previousFocus?.focus()
  } catch (e) { formError.value = String(e) } finally { saving.value = false }
}
function keydown(event: KeyboardEvent) {
  if (!formKind.value && !deleting.value) return
  if (event.key === 'Escape') { event.preventDefault(); void dismiss() }
  if (event.key !== 'Tab') return
  const items = Array.from(dialogElement.value?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)') ?? [])
  const first = items[0], last = items.at(-1)
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
}
onMounted(() => window.addEventListener('keydown', keydown))
onBeforeUnmount(() => { request++; window.removeEventListener('keydown', keydown) })
defineExpose({ beforeClose, saveDraft })
</script>

<template>
  <section class="health-page">
    <header class="health-heading">
      <div><div class="eyebrow">好好吃饭，记录日常</div><h1>饮食与体重 <span>{{ monthLabel }}</span></h1></div>
      <div class="health-buttons">
        <button class="outline" :disabled="disabled || loading" @click="openWeight()">记录体重</button>
        <button class="save-button" :disabled="disabled || loading" @click="openMeal()">＋ 记录饮食</button>
      </div>
    </header>
    <div v-if="error" class="message error" role="alert">{{ error }} <button @click="refresh">重新加载</button></div>
    <div v-if="message" class="health-notice" role="status">{{ message }}</div>
    <div class="health-scroll">
      <div class="health-stats">
        <div><span>本月最近体重</span><strong aria-label="本月最近体重">{{ latest ? `${kilograms(latest.grams)} kg` : '—' }}</strong><small>{{ latest?.date ?? '记录后显示' }}</small></div>
        <div><span>较本月首次记录</span><strong aria-label="体重变化">{{ difference }}</strong><small>{{ data.weights.length }} 天体重记录</small></div>
        <div><span>本月饮食记录</span><strong aria-label="本月饮食数量">{{ data.meals.length }} <em>条</em></strong><small>{{ new Set(data.meals.map(m => m.date)).size }} 天留下了饮食记录</small></div>
      </div>
      <section class="weight-chart health-card">
        <div class="health-card-heading"><h2>体重趋势</h2><span>本月 · kg</span></div>
        <svg v-if="chart" viewBox="0 0 660 165" role="img" aria-label="本月体重趋势图">
          <g v-for="(tick, index) in chart.ticks" :key="index">
            <line x1="56" x2="624" :y1="24 + index * 54" :y2="24 + index * 54" class="chart-grid" />
            <text x="43" :y="28 + index * 54" text-anchor="end">{{ tick.toFixed(2) }}</text>
          </g>
          <polyline v-if="chart.points.length > 1" :points="chart.line" class="chart-line" />
          <circle v-for="point in chart.points" :key="point.date" :cx="point.x" :cy="point.y" r="4" class="chart-point"><title>{{ point.date }} · {{ kilograms(point.grams) }} kg</title></circle>
          <text x="56" y="156">1 日</text><text x="340" y="156" text-anchor="middle">{{ Math.round((chart.days + 1) / 2) }} 日</text><text x="624" y="156" text-anchor="end">{{ chart.days }} 日</text>
        </svg>
        <div v-else class="health-empty chart-empty">{{ loading ? '正在读取…' : '还没有体重记录，记下第一次测量吧。' }}</div>
      </section>
      <div class="health-columns">
        <section class="health-card meal-panel">
          <div class="health-card-heading"><h2>这一天吃了什么</h2><span>{{ day.replaceAll('-', '.') }}</span></div>
          <div v-for="group in dailyMeals" :key="group.slot" class="meal-group">
            <div class="meal-slot"><strong>{{ group.slot }}</strong><button :disabled="disabled || loading" :aria-label="`添加${group.slot}`" @click="openMeal(group.slot)">＋</button></div>
            <p v-if="!group.entries.length" class="meal-placeholder">还没有记录</p>
            <article v-for="row in group.entries" :key="row.id" class="meal-entry">
              <p>{{ row.food }}</p><small v-if="row.note">{{ row.note }}</small>
              <div class="health-row-actions"><button :disabled="disabled" :aria-label="`编辑饮食 ${row.food}`" @click="openMeal(row.slot, row)">编辑</button><button :disabled="disabled" :aria-label="`删除饮食 ${row.food}`" @click="askDelete('meal', row.id, `${row.date} · ${row.slot} · ${row.food}`)">删除</button></div>
            </article>
          </div>
        </section>
        <section class="health-card weight-panel">
          <div class="health-card-heading"><h2>体重记录</h2><span>本月 {{ data.weights.length }} 天</span></div>
          <p v-if="!weightHistory.length" class="health-empty">还没有记录</p>
          <article v-for="row in weightHistory" :key="row.date" class="weight-entry">
            <div><time>{{ row.date }}</time><strong>{{ kilograms(row.grams) }} <small>kg</small></strong></div>
            <p v-if="row.note">{{ row.note }}</p>
            <div class="health-row-actions"><button :disabled="disabled" :aria-label="`编辑体重 ${row.date}`" @click="openWeight(row)">编辑</button><button :disabled="disabled" :aria-label="`删除体重 ${row.date}`" @click="askDelete('weight', row.date, `${row.date} · ${kilograms(row.grams)} kg`)">删除</button></div>
          </article>
        </section>
      </div>
      <div class="bottom-note"><span>用日历查看不同日期的饮食记录</span><span>体重每日一条 · 饮食可多条</span></div>
    </div>
    <Teleport to="body">
      <div v-if="formKind || deleting" class="modal-backdrop" @click.self="dismiss">
        <section ref="dialogElement" class="ledger-modal health-modal" role="dialog" aria-modal="true" aria-labelledby="health-dialog-title">
          <template v-if="formKind">
            <div class="ledger-modal-heading"><h2 id="health-dialog-title">{{ formKind === 'meal' ? (draft.id ? '编辑饮食' : '记录饮食') : '记录体重' }}</h2><button aria-label="关闭记录表单" :disabled="saving" @click="dismiss">×</button></div>
            <form @submit.prevent="saveDraft">
              <fieldset :disabled="saving">
                <div class="form-two">
                  <label>日期<input v-model="draft.date" aria-label="记录日期" type="date" min="1900-01-01" max="9999-12-31" :disabled="formKind === 'weight' && weightEditing" required /></label>
                  <label v-if="formKind === 'meal'">餐次<select v-model="draft.slot" aria-label="餐次"><option v-for="slot in mealSlots" :key="slot">{{ slot }}</option></select></label>
                  <label v-else>体重（kg）<input v-model="draft.weight" aria-label="体重数值" inputmode="decimal" placeholder="例如 60.50" maxlength="6" required /></label>
                </div>
                <label v-if="formKind === 'meal'">吃了什么<textarea v-model="draft.food" aria-label="饮食内容" maxlength="2000" placeholder="例如：一碗燕麦、一个鸡蛋、一杯牛奶" required></textarea></label>
                <label>备注<textarea v-model="draft.note" aria-label="记录备注" maxlength="500" :placeholder="formKind === 'meal' ? '份量或其他想记下的内容（可选）' : '例如：晨起测量（可选）'"></textarea></label>
              </fieldset>
              <div v-if="formError" class="message error" role="alert">{{ formError }}</div>
              <p v-if="formKind === 'weight'" class="health-form-hint">每天保留一条体重，再次保存会更新该日记录。</p>
              <div class="ledger-modal-footer"><button type="button" :disabled="saving" @click="dismiss">取消</button><button class="save-button" :disabled="saving" type="submit">{{ saving ? '正在保存…' : '保存记录' }}</button></div>
            </form>
          </template>
          <template v-else-if="deleting">
            <h2 id="health-dialog-title">删除这条{{ deleting.kind === 'meal' ? '饮食' : '体重' }}记录？</h2><p class="delete-detail">{{ deleting.title }}</p>
            <div v-if="formError" class="message error" role="alert">{{ formError }}</div>
            <div class="ledger-modal-footer"><button :disabled="saving" @click="dismiss">保留记录</button><button class="danger" :disabled="saving" @click="remove">确认删除记录</button></div>
          </template>
        </section>
      </div>
    </Teleport>
  </section>
</template>
