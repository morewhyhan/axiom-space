import 'dotenv/config'
import { spawn } from 'node:child_process'
import net from 'node:net'

const children = new Set()

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      shell: process.platform === 'win32',
      ...options,
    })

    child.on('exit', (code, signal) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} ${args.join(' ')} exited with ${code ?? signal}`))
    })
  })
}

function capture(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk.toString() })
    child.stderr.on('data', (chunk) => { stderr += chunk.toString() })
    child.on('exit', (code, signal) => {
      if (code === 0) resolve({ stdout, stderr })
      else reject(new Error(`${command} ${args.join(' ')} exited with ${code ?? signal}\n${stderr || stdout}`.trim()))
    })
  })
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

async function ensureDockerAvailable() {
  try {
    await capture('docker', ['version', '--format', '{{.Server.Version}}'])
    await capture('docker', ['compose', 'version'])
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    console.error('\n[dev] Docker is required for pnpm dev.')
    console.error('[dev] Start Docker Desktop with WSL integration enabled, then run pnpm dev again.')
    console.error('[dev] If you only want the Next.js frontend without Postgres/Redis/LightRAG, run pnpm dev:web.\n')
    console.error(detail)
    process.exit(1)
  }
}

async function ensureOllamaModel(model) {
  const list = await new Promise((resolve) => {
    const child = spawn('docker', ['exec', 'axiom-ollama', 'ollama', 'list'], {
      stdio: ['ignore', 'pipe', 'inherit'],
      shell: process.platform === 'win32',
    })
    let output = ''
    child.stdout.on('data', (chunk) => {
      output += chunk.toString()
    })
    child.on('exit', () => resolve(output))
  })

  if (String(list).includes(model.split(':')[0])) return
  await run('docker', ['exec', 'axiom-ollama', 'ollama', 'pull', model])
}

function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => {
      server.close(() => resolve(true))
    })
    server.listen(port, '0.0.0.0')
  })
}

async function findPort(preferredPort) {
  for (let port = preferredPort; port < preferredPort + 20; port += 1) {
    if (await isPortAvailable(port)) return port
  }
  throw new Error(`No available port found from ${preferredPort} to ${preferredPort + 19}`)
}

function shutdown(signal) {
  for (const child of children) child.kill(signal)
  process.exit(signal === 'SIGINT' ? 130 : 143)
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))

await ensureDockerAvailable()
await run('docker', ['compose', 'up', '-d', 'postgres', 'redis', 'ollama'])
await ensureOllamaModel(process.env.OLLAMA_EMBEDDING_MODEL || 'bge-m3:latest')
await run('docker', ['compose', 'up', '-d', 'lightrag'])
await run('pnpm', ['exec', 'prisma', 'db', 'push'])

const port = await findPort(Number(process.env.PORT || 3000))
console.log(`Starting Next.js on http://localhost:${port}`)

start('pnpm', ['run', 'jobs:worker'])
const next = start('pnpm', ['exec', 'next', 'dev', '-p', String(port)])

next.on('exit', (code, signal) => {
  for (const child of children) {
    if (child !== next) child.kill('SIGTERM')
  }
  process.exit(code ?? (signal === 'SIGINT' ? 130 : 1))
})
