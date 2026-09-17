const { _electron: electron } = require('playwright')
const { expect } = require('playwright/test')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

;(async () => {
  const { createServer } = await import('vite')
  const { default: vue } = await import('@vitejs/plugin-vue')
  const root = path.resolve(__dirname, '..')
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'little-days-dev-'))
  const server = await createServer({ configFile: false, root: path.join(root, 'src/renderer'), plugins: [vue()], server: { host: '127.0.0.1', port: 0 } })
  let app
  try {
    await server.listen()
    const env = { ...process.env, ELECTRON_RENDERER_URL: server.resolvedUrls.local[0], LITTLE_DAYS_DATA_DIR: temp }
    delete env.ELECTRON_RUN_AS_NODE
    app = await electron.launch({ args: [root], env })
    const page = await app.firstWindow()
    await expect(page.getByLabel('日记标题')).toBeEnabled()
    await page.getByLabel('日记正文').fill('开发模式也能读写 SQLite')
    await page.getByRole('button', { name: '保存日记', exact: true }).click()
    await expect(page.locator('.save-state')).toHaveText('已保存到本机')
    await page.reload()
    await expect(page.getByLabel('日记正文')).toHaveValue('开发模式也能读写 SQLite')
    console.log('PASS: Vue dev server, preload IPC sender validation, SQLite save/reload')
  } finally {
    if (app) await app.close()
    await server.close()
    fs.rmSync(temp, { recursive: true, force: true })
  }
})().catch(error => { console.error(error); process.exitCode = 1 })
