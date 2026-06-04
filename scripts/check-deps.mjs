import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const packages = ['next/package.json', '@prisma/client', 'playwright', 'tsx', 'prisma/package.json']

for (const name of packages) {
  try {
    console.log(`${name}: ${require.resolve(name)}`)
  } catch {
    console.log(`${name}: MISSING`)
  }
}
