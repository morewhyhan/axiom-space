import { prisma } from '@/lib/db'

async function main() {
  const user = await prisma.user.findFirst({
    where: { email: 'demo@axiom.space' },
    include: { vaults: true },
  })

  if (!user) {
    throw new Error('Demo user demo@axiom.space does not exist. Run pnpm db:seed first.')
  }
  if (user.vaults.length === 0) {
    throw new Error('Demo user has no vault. Seed or create a demo vault before browser testing.')
  }

  console.log('User:', user.id, user.email)
  console.log('Vaults:', user.vaults.length)
  for (const vault of user.vaults) {
    console.log('Vault:', vault.id, vault.name)
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
