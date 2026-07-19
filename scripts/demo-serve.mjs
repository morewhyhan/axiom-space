import 'dotenv/config'

import { existsSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'

const children = new Set()
const port = String(process.env.DEMO_PORT || process.env.PORT || 3000)

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with ${result.status ?? result.signal}`)
  }
}

function start(command, args) {
  const child = spawn(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  children.add(child)
  child.on('exit', () => children.delete(child))
  return child
}

function shutdown(signal) {
  for (const child of children) child.kill(signal)
  process.exit(signal === 'SIGINT' ? 130 : 143)
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))

if (!existsSync('.next/BUILD_ID')) {
  console.error('没有可用的生产构建。请先执行 pnpm build。')
  process.exit(1)
}

run('docker', ['compose', 'up', '-d', 'postgres', 'redis', 'qdrant', 'ollama', 'lightrag'])

console.log(`\nAXIOM 演示服务启动于 http://127.0.0.1:${port}`)
console.log(`服务启动后请在另一终端执行：DEMO_PORT=${port} pnpm demo:preflight\n`)

start('pnpm', ['run', 'jobs:worker'])
const web = start('pnpm', ['exec', 'next', 'start', '-H', '127.0.0.1', '-p', port])

web.on('exit', (code, signal) => {
  for (const child of children) {
    if (child !== web) child.kill('SIGTERM')
  }
  process.exit(code ?? (signal === 'SIGINT' ? 130 : 1))
})
