import assert from 'node:assert/strict'
import { prisma } from '@/lib/db'

const baseUrl = process.env.A3_LIVE_URL || 'http://localhost:3000'

async function main() {
  const signIn = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: baseUrl },
    body: JSON.stringify({ email: 'demo@axiom.space', password: 'demo123456' }),
  })
  assert(signIn.ok, `sign-in failed: ${signIn.status} ${await signIn.text()}`)
  const cookieHeaders = signIn.headers as Headers & { getSetCookie?: () => string[] }
  const cookie = (cookieHeaders.getSetCookie?.() ?? [signIn.headers.get('set-cookie') || ''])
    .map((value) => value.split(';')[0]).filter(Boolean).join('; ')
  const user = await prisma.user.findUniqueOrThrow({ where: { email: 'demo@axiom.space' } })
  const vault = await prisma.vault.findFirstOrThrow({ where: { userId: user.id, name: '设计模式黄金案例' } })
  const session = await prisma.learningSession.findFirstOrThrow({
    where: { userId: user.id, vaultId: vault.id, domain: '__agent__' },
    orderBy: { updatedAt: 'desc' },
  })
  const response = await fetch(`${baseUrl}/api/agent/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream', origin: baseUrl, cookie },
    body: JSON.stringify({
      vaultId: vault.id,
      sessionId: session.id,
      message: '请根据当前画像生成一套可直接预览的 Visitor 学习资料，必须包含讲解文档、思维导图、题库、代码练习、Mermaid 图表和视频动画。',
    }),
  })
  const body = await response.text()
  assert(response.ok, `chat failed: ${response.status} ${body.slice(0, 500)}`)
  assert(/push_resource/.test(body), `conversation did not call push_resource: ${body.slice(0, 1200)}`)
  const pack = await prisma.card.findFirstOrThrow({
    where: { vaultId: vault.id, type: 'literature', title: { contains: '个性化资源包' } },
    orderBy: { updatedAt: 'desc' },
  })
  const match = pack.content.match(/<!--\s*axiom-resources:([\s\S]*?)\s*-->/)
  assert(match?.[1], 'generated resource pack has no manifest')
  const manifest = JSON.parse(match[1]) as Array<{ type: string; path: string; sourceObjectId?: string }>
  for (const type of ['document', 'mindmap', 'quiz', 'code', 'diagram', 'video']) {
    assert(manifest.some((item) => item.type === type), `generated manifest is missing ${type}`)
  }
  assert(manifest.every((item) => item.path && item.sourceObjectId), 'generated resource is not traceable')
  console.log(JSON.stringify({ vaultId: vault.id, sessionId: session.id, packId: pack.id, packTitle: pack.title, manifest }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
}).finally(() => prisma.$disconnect())
