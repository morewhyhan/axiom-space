import { PrismaClient } from '@prisma/client'
import { hashPassword } from 'better-auth/crypto'

const prisma = new PrismaClient()

const DEMO_EMAIL = 'demo@axiom.space'
const DEMO_PASSWORD = 'demo123456'

async function main() {
  console.log('Seeding database...')

  // Demo user — upsert, then always refresh the credential account password
  // using Better Auth's scrypt hasher. (Earlier versions of this seed used
  // bcryptjs, which Better Auth cannot verify → "Invalid password hash".)
  const user = await prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    update: {},
    create: {
      email: DEMO_EMAIL,
      name: 'Demo User',
    },
  })

  const passwordHash = await hashPassword(DEMO_PASSWORD)
  const existingAccount = await prisma.account.findFirst({
    where: { userId: user.id, providerId: 'credential' },
  })
  if (existingAccount) {
    await prisma.account.update({
      where: { id: existingAccount.id },
      data: { password: passwordHash },
    })
    console.log(`Refreshed credential password for ${DEMO_EMAIL}`)
  } else {
    await prisma.account.create({
      data: {
        userId: user.id,
        accountId: user.email,
        providerId: 'credential',
        password: passwordHash,
      },
    })
    console.log(`Created credential account for ${DEMO_EMAIL}`)
  }

  // Only seed sample vault/cards on a truly fresh DB
  const existingVault = await prisma.vault.findFirst({ where: { userId: user.id } })
  if (existingVault) {
    console.log('Vault already exists, skipping sample data.')
    return
  }

  const vault = await prisma.vault.create({
    data: {
      userId: user.id,
      name: 'My Vault',
    },
  })

  const cluster = await prisma.cluster.create({
    data: {
      vaultId: vault.id,
      name: '示例知识域',
      color: '#a855f7',
      position: 0,
    },
  })

  await prisma.card.createMany({
    data: [
      {
        vaultId: vault.id,
        clusterId: cluster.id,
        path: '示例知识域/欢迎卡片.md',
        title: '欢迎来到 Axiom Space',
        type: 'permanent',
        content: '# 欢迎\n\n这是你的第一个知识卡片。Axiom Space 帮助你构建个人知识星系。',
        tags: JSON.stringify(['入门', '指南']),
      },
      {
        vaultId: vault.id,
        clusterId: cluster.id,
        path: '示例知识域/快速笔记.md',
        title: '快速笔记示例',
        type: 'fleeting',
        content: '这是一个 Fleeting 卡片，用于快速捕获灵感。',
        tags: JSON.stringify(['笔记']),
      },
    ],
  })

  console.log('Seed complete!')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
