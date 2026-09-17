import { _electron as electron } from 'playwright'

const app = await electron.launch({
  args: ['.', '--no-sandbox'],
  cwd: process.cwd()
})

const consoleMessages = []
const win = await app.firstWindow()
win.on('console', (msg) => consoleMessages.push(`[${msg.type()}] ${msg.text()}`))
win.on('pageerror', (err) => consoleMessages.push(`[pageerror] ${err.message}`))

await win.waitForLoadState('load')
await win.waitForTimeout(1000)

const title = await win.title()
const bodyText = await win.locator('body').innerText()
await win.screenshot({ path: '/tmp/demoassets/electron_ui.png' })

console.log('TITLE:', title)
console.log('BODY_SNIPPET:', bodyText.slice(0, 400).replace(/\n+/g, ' | '))
console.log('CONSOLE_MESSAGES:')
for (const m of consoleMessages) console.log('  ', m)

await app.close()
