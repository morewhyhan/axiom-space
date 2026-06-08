import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const artifactRoot = resolve(process.cwd(), 'test', 'artifacts', 'live-ai')

export async function writeLiveAiArtifact(relativePath: string, data: unknown): Promise<string> {
  const filePath = resolve(artifactRoot, relativePath)
  await mkdir(dirname(filePath), { recursive: true })
  const content = typeof data === 'string' ? data : `${JSON.stringify(data, null, 2)}\n`
  await writeFile(filePath, content, 'utf8')
  return filePath
}
