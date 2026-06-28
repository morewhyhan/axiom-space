import { prisma } from '@/lib/db'
const user = await prisma.user.findFirst({ where: { email: 'demo@axiom.space' }, include: { vaults: true } })
console.log('User:', user?.id, user?.email)
console.log('Vaults:', user?.vaults?.length)
if (user?.vaults?.[0]) console.log('Vault:', user.vaults[0].id, user.vaults[0].name)
await prisma.$disconnect()
