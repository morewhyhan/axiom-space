import 'dotenv/config'

import { execFileSync } from 'node:child_process'

const webBaseUrl = process.env.DEMO_BASE_URL || `http://127.0.0.1:${process.env.DEMO_PORT || 3000}`
const timeoutMs = Number(process.env.DEMO_PREFLIGHT_TIMEOUT_MS || 20_000)
const warmupTimeoutMs = Number(process.env.DEMO_PREFLIGHT_WARMUP_TIMEOUT_MS || 300_000)

const checks = [
  { name: 'AXIOM 页面', url: `${webBaseUrl}/`, warmup: true },
  { name: 'AXIOM API', url: `${webBaseUrl}/api/health`, warmup: true },
  { name: 'Agent API', url: `${webBaseUrl}/api/agent/health`, warmup: true },
  { name: 'Qdrant 语义索引', url: `${process.env.QDRANT_BASE_URL || 'http://127.0.0.1:6333'}/readyz` },
  { name: 'Ollama 向量模型', url: `${process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434'}/api/tags` },
  { name: 'LightRAG 图谱增强', url: `${process.env.LIGHTRAG_BASE_URL || 'http://127.0.0.1:9621'}/health` },
]

function formatDuration(startedAt) {
  return `${Date.now() - startedAt}ms`
}

async function fetchReady(check, requestTimeoutMs = timeoutMs) {
  const startedAt = Date.now()
  const response = await fetch(check.url, {
    signal: AbortSignal.timeout(requestTimeoutMs),
    headers: { accept: 'application/json,text/html;q=0.9,*/*;q=0.8' },
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  await response.arrayBuffer()
  return formatDuration(startedAt)
}

function assertWorkerRunning() {
  if (process.env.DEMO_PREFLIGHT_SKIP_WORKER === '1') return '已跳过'
  if (process.platform === 'win32') {
    const output = execFileSync('powershell.exe', [
      '-NoProfile',
      '-Command',
      "(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'scripts[/\\\\]jobs-worker\\.ts' }).Count",
    ], { encoding: 'utf8' }).trim()
    if (Number(output) < 1) throw new Error('后台任务 Worker 未运行，请通过 pnpm dev 启动完整服务')
    return '运行中'
  }

  const output = execFileSync('ps', ['-eo', 'args'], { encoding: 'utf8' })
  if (!output.split('\n').some((line) => /scripts\/jobs-worker\.ts/.test(line))) {
    throw new Error('后台任务 Worker 未运行，请通过 pnpm dev 启动完整服务')
  }
  return '运行中'
}

async function main() {
  console.log(`\nAXIOM 演示就绪检查 · ${webBaseUrl}\n`)
  const failures = []

  for (const check of checks) {
    try {
      const duration = await fetchReady(check, check.warmup ? warmupTimeoutMs : timeoutMs)
      console.log(`✓ ${check.name.padEnd(18)} ${duration}${check.warmup ? '（关键页面已预热）' : ''}`)
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      console.error(`✗ ${check.name.padEnd(18)} ${detail}`)
      failures.push(`${check.name}: ${detail}`)
    }
  }

  if (failures.length === 0) {
    for (const check of checks.filter((item) => item.warmup)) {
      try {
        const duration = await fetchReady(check)
        console.log(`✓ ${`${check.name}复检`.padEnd(18)} ${duration}`)
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        console.error(`✗ ${`${check.name}复检`.padEnd(18)} ${detail}`)
        failures.push(`${check.name}复检: ${detail}`)
      }
    }
  }

  try {
    console.log(`✓ ${'后台任务 Worker'.padEnd(18)} ${assertWorkerRunning()}`)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    console.error(`✗ ${'后台任务 Worker'.padEnd(18)} ${detail}`)
    failures.push(`后台任务 Worker: ${detail}`)
  }

  if (failures.length > 0) {
    console.error('\n演示尚未就绪：')
    for (const failure of failures) console.error(`- ${failure}`)
    process.exitCode = 1
    return
  }

  console.log('\n✓ 基础服务、语义索引、后台图谱与关键页面均已就绪。')
  console.log('  黄金账号数据请以同一命令前置执行的 check:a3-golden 结果为准。\n')
}

await main()
