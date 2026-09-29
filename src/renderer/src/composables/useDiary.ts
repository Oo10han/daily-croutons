import { onUnmounted, ref, type Ref } from 'vue'
import type { DiaryInput, DiarySummary, Mood } from '../../../shared/types'

// 日记编辑状态只通过业务 API 持久化。调用方切换日期、备份或关闭窗口前必须 await flush()。
export function useDiary(selected: Ref<string>) {
  const title = ref(''), body = ref(''), mood = ref<Mood>('')
  const records = ref<DiarySummary[]>([])
  const dirty = ref(false), saving = ref(false)
  const error = ref(''), notice = ref(''), deleteOpen = ref(false)
  let revision = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let pending: Promise<void> = Promise.resolve()

  async function refresh() { records.value = await window.journal.list() }
  function report(e: unknown) { error.value = e instanceof Error ? e.message : String(e) }
  function edited() {
    dirty.value = true; revision++; notice.value = ''; error.value = ''
    clearTimeout(timer)
    timer = setTimeout(() => { void flush().catch(report) }, 550)
  }
  function flush(): Promise<void> {
    clearTimeout(timer)
    // 在队列真正执行时取快照，防止排队期间的旧内容覆盖后续编辑。
    // 前一次失败不阻塞重试；只有版本号未变化时，才能清除未保存标记。
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

  // 正常关闭由 App 的关闭握手负责保存；这里只清理失效的防抖回调。
  onUnmounted(() => clearTimeout(timer))
  return { title, body, mood, records, dirty, saving, error, notice, deleteOpen, refresh, report, edited, flush, load }
}
