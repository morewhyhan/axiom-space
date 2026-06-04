import { access, readFile, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const envPath = path.join(root, '.env')
const envExamplePath = path.join(root, '.env.example')

async function exists(filePath) {
  try {
    await access(filePath, constants.F_OK)
    return true
  } catch {
    return false
  }
}

async function main() {
  if (await exists(envPath)) return
  if (!(await exists(envExamplePath))) {
    console.warn('[bootstrap-dev] .env.example is missing; skipping env bootstrap')
    return
  }

  const content = await readFile(envExamplePath, 'utf-8')
  await writeFile(envPath, content, 'utf-8')
  console.log('[bootstrap-dev] created .env from .env.example')
}

main().catch((err) => {
  console.warn('[bootstrap-dev] failed:', err instanceof Error ? err.message : String(err))
})
