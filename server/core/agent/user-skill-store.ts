/**
 * User Skill Store — 纯数据库模式
 *
 * 用户技能存储在 vaultSkill 表中，替代原来的 .axiom/skills/{category}/{name}.md 文件。
 */

import { prisma } from '@/lib/db'
import { getCurrentVaultId, getCurrentUserId } from '@/server/core/agent/agent-context'
import { SKILL_DUPLICATE_PROMPT } from '@/server/core/ai/prompts'

export interface SkillMeta {
  name: string;
  description: string;
  category: string;
  tags: string[];
  demonstrated_at: string;
  confidence: number;
  id?: string;
}

async function resolveVaultId(): Promise<string | null> {
  const ctxVaultId = getCurrentVaultId()
  if (ctxVaultId) return ctxVaultId
  const userId = getCurrentUserId()
  if (!userId) return null
  const vault = await prisma.vault.findFirst({ where: { userId }, orderBy: { createdAt: 'asc' } })
  return vault?.id || null
}

/**
 * 扫描用户所有技能
 */
export async function scanUserSkills(_vaultPath?: string): Promise<SkillMeta[]> {
  const vaultId = await resolveVaultId()
  if (!vaultId) return []

  try {
    const records = await prisma.vaultSkill.findMany({ where: { vaultId } })
    return records.map(r => ({
      name: r.name,
      description: r.description,
      category: r.category,
      tags: JSON.parse(r.tags || '[]'),
      demonstrated_at: r.demonstratedAt.toISOString(),
      confidence: r.confidence,
      id: r.id,
    }))
  } catch {
    return []
  }
}

/**
 * 获取已有 skill 名称列表（供 AI 去重）
 */
export async function getExistingSkillNames(vaultPath?: string): Promise<string[]> {
  const skills = await scanUserSkills(vaultPath)
  return skills.map(s => s.name)
}

/**
 * 保存单个 skill
 */
export async function saveUserSkill(
  _vaultPath: string,
  skill: {
    name: string;
    description: string;
    tags: string[];
    category: string;
    evidence: string;
  },
): Promise<void> {
  const vaultId = await resolveVaultId()
  if (!vaultId) return

  try {
    await prisma.vaultSkill.create({
      data: {
        vaultId,
        name: skill.name,
        description: skill.description,
        category: skill.category,
        tags: JSON.stringify([...(skill.tags || []), 'source:auto']),
        evidence: skill.evidence,
        confidence: 0.5,
        source: 'conversation',
      },
    })
  } catch (err) {
    console.warn('[SkillStore] Save failed:', err)
  }
}

// ========== 提取流程 ==========

/**
 * 从对话中提取 skill 并保存
 */
export async function extractAndSaveSkills(
  vaultPath: string,
  userMessage: string,
  assistantMessage: string,
): Promise<void> {
  if (!userMessage.trim() || !assistantMessage.trim()) return

  try {
    const { aiManager } = await import('../ai')
    const provider = aiManager

    const existingSkills = await scanUserSkills(vaultPath)
    const existingNames = existingSkills.map(s => s.name)

    const extracted = await (provider as any).extractSkillsFromConversation(
      userMessage,
      assistantMessage,
      existingNames,
    )

    if (!extracted || extracted.length === 0) return

    for (const skill of extracted) {
      if (!skill.name) continue

      if (!skill.description || skill.description.trim().length < 50) {
        console.warn(`[SkillStore] Skipping "${skill.name}" — description too short`)
        continue
      }
      if (!skill.evidence || skill.evidence.trim().length < 10) {
        console.warn(`[SkillStore] Skipping "${skill.name}" — evidence too short`)
        continue
      }

      const duplicate = await findDuplicate(existingSkills, skill)
      if (duplicate) {
        await bumpSkillConfidence(vaultPath, duplicate.name, 0.05)
        console.log(`[SkillStore] Merged skill "${skill.name}" -> existing "${duplicate.name}"`)
        continue
      }

      await saveUserSkill(vaultPath, { ...skill, tags: [...(skill.tags || [])] })

      // Sync with SkillRegistry in-memory cache
      try {
        const { getSkillRegistry } = await import('./skills/SkillRegistry')
        const registry = getSkillRegistry()
        await registry.createSkill(skill.name, skill.description, '')
      } catch { /* non-fatal */ }
    }

    console.log(`[SkillStore] Extracted ${extracted.length} skills from conversation`)
  } catch (error) {
    console.error('[SkillStore] extractAndSaveSkills error:', error)
  }
}

/**
 * 三策略 Skill 去重
 */
export async function findDuplicate(
  existing: SkillMeta[],
  incoming: { name: string; description: string; tags?: string[] }
): Promise<SkillMeta | null> {
  const incomingName = incoming.name.toLowerCase().trim()
  const exactMatch = existing.find(s => s.name.toLowerCase().trim() === incomingName)
  if (exactMatch) return exactMatch

  const incomingTags = (incoming.tags || []).map(t => t.toLowerCase().trim())
  if (incomingTags.length > 0) {
    const tagMatches = existing.filter(s => {
      const existingTags = (s.tags || []).map(t => t.toLowerCase().trim())
      if (existingTags.length === 0) return false
      const overlap = existingTags.filter(t => incomingTags.includes(t)).length
      return overlap / Math.min(existingTags.length, incomingTags.length) > 0.5
    })
    if (tagMatches.length === 1) return tagMatches[0]
    if (tagMatches.length > 1) {
      return tagMatches.reduce((a, b) =>
        (a.confidence || 0) > (b.confidence || 0) ? a : b
      )
    }
  }

  // Strategy 3: LLM-judged description similarity
  try {
    const { aiManager } = await import('../ai/AIManager')
    const result = await aiManager.callAPI(SKILL_DUPLICATE_PROMPT.system, [
      {
        role: 'user',
        content: SKILL_DUPLICATE_PROMPT.buildUserMessage!({
          incomingName: incoming.name,
          incomingDescription: incoming.description,
          existingSkills: existing.map((skill) => ({
            name: skill.name,
            description: skill.description,
          })),
        }),
      },
    ])
    const jsonMatch = result?.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0])
      if (parsed.isDuplicate) {
        return existing.find(s => s.name.toLowerCase().includes(incoming.name.toLowerCase().split(/\s+/)[0])) || null
      }
    }
  } catch {
    console.debug('[SkillStore] LLM dedup strategy skipped (non-fatal)')
  }

  return null
}

export async function bumpSkillConfidence(
  _vaultPath: string,
  skillName: string,
  delta: number = 0.05,
): Promise<void> {
  const vaultId = await resolveVaultId()
  if (!vaultId) return

  try {
    const skill = await prisma.vaultSkill.findUnique({
      where: { vaultId_name: { vaultId, name: skillName } },
    })
    if (!skill) return

    await prisma.vaultSkill.update({
      where: { id: skill.id },
      data: { confidence: Math.min(1, skill.confidence + delta) },
    })
  } catch (err) { console.warn('[SkillStore] Failed to update skill confidence:', err); }
}

export async function deleteUserSkill(
  _vaultPath: string,
  skillName: string,
  _category?: string,
): Promise<boolean> {
  const vaultId = await resolveVaultId()
  if (!vaultId) return false

  try {
    await prisma.vaultSkill.delete({
      where: { vaultId_name: { vaultId, name: skillName } },
    })
    return true
  } catch {
    return false
  }
}

export async function updateUserSkill(
  _vaultPath: string,
  skillName: string,
  _category: string,
  updates: Partial<{ description: string; tags: string[]; confidence: number }>,
): Promise<boolean> {
  const vaultId = await resolveVaultId()
  if (!vaultId) return false

  try {
    const data: any = {}
    if (updates.description !== undefined) data.description = updates.description
    if (updates.tags !== undefined) data.tags = JSON.stringify(updates.tags)
    if (updates.confidence !== undefined) data.confidence = updates.confidence

    await prisma.vaultSkill.update({
      where: { vaultId_name: { vaultId, name: skillName } },
      data,
    })
    return true
  } catch {
    return false
  }
}
