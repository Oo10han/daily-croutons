import { onBeforeUnmount, onMounted, type Ref } from 'vue'

// 只复用键盘交互，不持有草稿。是否允许关闭（保存中、未保存修改）由业务页面决定。
export function useModalKeyboard(element: Ref<HTMLElement | null>, isOpen: () => boolean, dismiss: () => Promise<boolean>): void {
  function keydown(event: KeyboardEvent) {
    if (!isOpen()) return
    if (event.key === 'Escape') {
      event.preventDefault()
      void dismiss()
    }
    if (event.key !== 'Tab') return
    // 在当前弹窗的可用控件间循环，防止键盘焦点落到遮罩后的页面。
    const items = Array.from(element.value?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)') ?? [])
    const first = items[0], last = items.at(-1)
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
  }

  onMounted(() => window.addEventListener('keydown', keydown))
  onBeforeUnmount(() => window.removeEventListener('keydown', keydown))
}
