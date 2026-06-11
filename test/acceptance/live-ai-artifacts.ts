import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { redactSecrets } from '@/server/core/agent/security/SecretRedactor'

const artifactRoot = resolve(process.cwd(), 'test', 'artifacts', 'live-ai')

export async function writeLiveAiArtifact(relativePath: string, data: unknown): Promise<string> {
  const filePath = resolve(artifactRoot, relativePath)
  await mkdir(dirname(filePath), { recursive: true })
  const safeData = redactArtifact(data)
  const content = typeof safeData === 'string' ? safeData : `${JSON.stringify(safeData, null, 2)}\n`
  await writeFile(filePath, content, 'utf8')
  return filePath
}

function redactArtifact(value: unknown): unknown {
  if (typeof value === 'string') return redactSecrets(value)
  if (Array.isArray(value)) return value.map(redactArtifact)
  if (!value || typeof value !== 'object') return value

  const redacted: Record<string, unknown> = {}
  for (const [key, nested] of Object.entries(value)) {
    redacted[key] = redactArtifact(nested)
  }
  return redacted
}
