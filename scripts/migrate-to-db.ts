/**
 * migrate-to-db — 将现有 .axiom/ 数据从 card 表迁移到新的独立表
 *
 * 运行方式: npx tsx scripts/migrate-to-db.ts
 *
 * 迁移内容:
 *   .axiom/sessions/*.json      → agentSession 表
 *   .axiom/memories/MEMORY.md    → vaultMemory 表
 *   .axiom/capabilities.json     → vaultCapability 表
 *   .axiom/skills/{category}/{name}.md → vaultSkill 表
 *   .axiom/user-profile.json     -> vault.profileCache (通过 profile-manager)
 */

import { prisma } from '../lib/db'

interface MigrateStats {
  sessions: number
  memories: number
  capabilities: number
  skills: number
  profiles: number
  deleted: number
}

async function migrate(): Promise<MigrateStats> {
  const stats: MigrateStats = { sessions: 0, memories: 0, capabilities: 0, skills: 0, profiles: 0, deleted: 0 }

  console.log('🔍 查询 .axiom/ 开头的卡片...')

  // 查找所有 path 以 .axiom/ 开头的卡片
  const axiomCards = await prisma.card.findMany({
    where: { path: { startsWith: '.axiom/' } },
  })
  console.log(`   找到 ${axiomCards.length} 张 .axiom/ 卡片`)

  // 按 vault 分组
  const byVault = new Map<string, typeof axiomCards>()
  for (const card of axiomCards) {
    const list = byVault.get(card.vaultId) || []
    list.push(card)
    byVault.set(card.vaultId, list)
  }

  for (const [vaultId, cards] of byVault) {
    console.log(`\n📁 Vault ${vaultId}: ${cards.length} 张卡片`)

    for (const card of cards) {
      const path = card.path

      // 1. session 迁移
      if (path.startsWith('.axiom/sessions/') && path.endsWith('.json')) {
        try {
          const data = JSON.parse(card.content)
          const sessionId = path.replace('.axiom/sessions/', '').replace('.json', '')
          await prisma.agentSession.upsert({
            where: { id: sessionId },
            create: {
              id: sessionId,
              vaultId,
              name: data.name || sessionId,
              messages: JSON.stringify({
                config: data.config || {},
                messages: data.messages || [],
                metadata: data.metadata,
              }),
            },
            update: { messages: card.content },
          })
          stats.sessions++
        } catch (err) {
          console.warn(`   ⚠️ Session 迁移失败: ${path}`, err)
        }
        continue
      }

      // 2. memory 迁移
      if (path.startsWith('.axiom/memories/')) {
        try {
          // MEMORY.md 格式: "- **key**: value [category]"
          const lines = card.content.split('\n').filter(l => l.startsWith('- **'))
          for (const line of lines) {
            const match = line.match(/\*\*(.+?)\*\*:\s*(.+?)(?:\s\[(.+)\])?$/)
            if (match) {
              await prisma.vaultMemory.upsert({
                where: { vaultId_key: { vaultId, key: match[1] } },
                create: {
                  vaultId,
                  key: match[1],
                  value: match[2].trim(),
                  category: (match[3] || 'fact').trim(),
                },
                update: { value: match[2].trim() },
              })
              stats.memories++
            }
          }
        } catch (err) {
          console.warn(`   ⚠️ Memory 迁移失败: ${path}`, err)
        }
        continue
      }

      // 3. capabilities 迁移
      if (path === '.axiom/capabilities.json') {
        try {
          const records = JSON.parse(card.content)
          if (Array.isArray(records)) {
            for (const rec of records) {
              await prisma.vaultCapability.upsert({
                where: { vaultId_concept: { vaultId, concept: rec.concept || rec.conceptId } },
                create: {
                  vaultId,
                  concept: rec.concept || rec.conceptId,
                  masteryLevel: rec.masteryLevel || 10,
                  status: rec.status || 'learning',
                  accessCount: rec.accessCount || 1,
                  weakAreas: JSON.stringify(rec.weakAreas || []),
                  strongAreas: JSON.stringify(rec.strongAreas || []),
                },
                update: {
                  masteryLevel: rec.masteryLevel,
                  status: rec.status,
                  accessCount: rec.accessCount,
                },
              })
              stats.capabilities++
            }
          }
        } catch (err) {
          console.warn(`   ⚠️ Capability 迁移失败: ${path}`, err)
        }
        continue
      }

      // 4. skills 迁移
      if (path.startsWith('.axiom/skills/') && path.endsWith('.md')) {
        try {
          // 解析 frontmatter: ---\nkey: value\n...\n---
          const frontmatch = card.content.match(/^---\n([\s\S]*?)\n---/)
          if (frontmatch) {
            const yaml = frontmatch[1]
            const body = card.content.slice(frontmatch[0].length).trim()
            const parseValue = (key: string): string => {
              const m = yaml.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))
              return m ? m[1].trim().replace(/^["']|["']$/g, '') : ''
            }
            const parseArr = (key: string): string[] => {
              const v = parseValue(key)
              if (v.startsWith('[')) {
                return v.slice(1, -1).split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean)
              }
              return v ? [v] : []
            }

            const name = parseValue('name') || path.split('/').pop()?.replace('.md', '') || 'unknown'
            const description = parseValue('description') || body.slice(0, 200)
            const category = parseValue('category') || '未分类'
            const tags = parseArr('tags')
            const confidence = parseFloat(parseValue('confidence')) || 0.5

            await prisma.vaultSkill.upsert({
              where: { vaultId_name: { vaultId, name } },
              create: {
                vaultId,
                name,
                description,
                category,
                tags: JSON.stringify(tags),
                confidence,
                evidence: body,
                source: parseValue('source') || 'migrated',
              },
              update: {
                description,
                category,
                confidence,
                evidence: body,
              },
            })
            stats.skills++
          }
        } catch (err) {
          console.warn(`   ⚠️ Skill 迁移失败: ${path}`, err)
        }
        continue
      }

      // 5. user-profile 迁移到 vault.profileCache
      if (path === '.axiom/user-profile.json') {
        try {
          const profileData = JSON.parse(card.content)
          const existing = await prisma.vault.findUnique({ where: { id: vaultId } })
          if (existing) {
            const merged = { ...(existing.profileCache ? JSON.parse(existing.profileCache) : {}), ...profileData, updatedAt: Date.now() }
            await prisma.vault.update({
              where: { id: vaultId },
              data: { profileCache: JSON.stringify(merged) },
            })
            stats.profiles++
          }
        } catch (err) {
          console.warn(`   ⚠️ Profile 迁移失败: ${path}`, err)
        }
        continue
      }
    }
  }

  // 删除所有已迁移的 .axiom/ 卡片
  console.log(`\n🗑️  删除 ${axiomCards.length} 张 .axiom/ 卡片...`)
  const deleted = await prisma.card.deleteMany({
    where: { path: { startsWith: '.axiom/' } },
  })
  stats.deleted = deleted.count

  return stats
}

migrate()
  .then(stats => {
    console.log('\n✅ 迁移完成:')
    console.log(`   会话: ${stats.sessions}`)
    console.log(`   记忆: ${stats.memories}`)
    console.log(`   能力: ${stats.capabilities}`)
    console.log(`   技能: ${stats.skills}`)
    console.log(`   画像: ${stats.profiles}`)
    console.log(`   已删除 card 表旧数据: ${stats.deleted}`)
    process.exit(0)
  })
  .catch(err => {
    console.error('❌ 迁移失败:', err)
    process.exit(1)
  })
