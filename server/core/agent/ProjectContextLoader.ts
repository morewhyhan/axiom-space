import { getFileStorage } from '@/server/infra/storage/GlobalFileStorage';
import { createAxiomCompat } from '@/server/infra/storage/AxiomCompat';
/**
 * Project Context Loader — 项目上下文文件加载
 *
 * 扫描 vault 目录查找项目约定文件，注入 system prompt：
 * 优先级：.axiom.md > AGENTS.md > CLAUDE.md > .cursorrules
 * 仅加载第一个匹配（不叠加），防止 context 膨胀。
 * 所有内容经过注入扫描，超过 20000 字符截断。
 */

/** 注入检测模式 */

const CONTEXT_THREAT_PATTERNS = [
  { pattern: /ignore\s+(previous|all|above|prior)\s+instructions/i, type: 'prompt_injection' },
  { pattern: /do\s+not\s+tell\s+the\s+user/i, type: 'deception_hide' },
  { pattern: /system\s+prompt\s+override/i, type: 'sys_prompt_override' },
  { pattern: /disregard\s+(your|all|any)\s+(instructions|rules|guidelines)/i, type: 'disregard_rules' },
  { pattern: /act\s+as\s+(if|though)\s+you\s+(have\s+no|don't\s+have)\s+(restrictions|limits|rules)/i, type: 'bypass_restrictions' },
  { pattern: /<!--[^>]*(?:ignore|override|system|secret|hidden)[^>]*-->/i, type: 'html_comment_injection' },
  { pattern: /<\s*div\s+style\s*=\s*["'][\s\S]*?display\s*:\s*none/i, type: 'hidden_div' },
  { pattern: /translate\s+.*\s+into\s+.*\s+and\s+(execute|run|eval)/i, type: 'translate_execute' },
  { pattern: /curl\s+[^\n]*\$\{?\w*(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|API)/i, type: 'exfil_curl' },
  { pattern: /cat\s+[^\n]*(\.env|credentials|\.netrc|\.pgpass)/i, type: 'read_secrets' },
];

/** 不可见 Unicode 字符 */
const CONTEXT_INVISIBLE_CHARS = new Set([
  '\u200b', '\u200c', '\u200d', '\u2060', '\ufeff',
  '\u202a', '\u202b', '\u202c', '\u202d', '\u202e',
]);

/** 文件名优先级（从高到低） */
const CONTEXT_FILE_NAMES = [
  '.axiom.md',
  'AXIOM.md',
  'AGENTS.md',
  'CLAUDE.md',
  '.cursorrules',
];

const MAX_CONTEXT_CHARS = 20000;

/**
 * 扫描内容中的注入威胁
 */
function scanContextContent(content: string, filename: string): string {
  const findings: string[] = [];

  for (const char of content) {
    if (CONTEXT_INVISIBLE_CHARS.has(char)) {
      findings.push(`invisible unicode U+${char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`);
      break;
    }
  }

  for (const { pattern, type } of CONTEXT_THREAT_PATTERNS) {
    if (pattern.test(content)) {
      findings.push(type);
    }
  }

  if (findings.length > 0) {
    console.warn(`[ProjectContext] ${filename} blocked: ${findings.join(', ')}`);
    return `[BLOCKED: ${filename} contained potential prompt injection (${findings.join(', ')}). Content not loaded.]`;
  }

  return content;
}

/**
 * 去除 YAML frontmatter
 */
function stripYamlFrontmatter(content: string): string {
  if (content.startsWith('---')) {
    const end = content.indexOf('\n---', 3);
    if (end !== -1) {
      const body = content.slice(end + 4).replace(/^\n+/, '');
      return body || content;
    }
  }
  return content;
}

/**
 * 截断到最大字符数
 */
function truncateToLimit(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;
  const half = Math.floor(maxChars / 2) - 20;
  return (
    content.slice(0, half) +
    `\n\n... [truncated, ${content.length - maxChars} chars omitted] ...\n\n` +
    content.slice(-half)
  );
}

export interface ProjectContextResult {
  /** 加载的上下文内容（已扫描、已截断） */
  content: string;
  /** 匹配的文件名 */
  filename: string;
  /** 是否被安全拦截 */
  blocked: boolean;
}

/**
 * 从 vault 目录加载项目上下文
 *
 * 搜索优先级：.axiom.md > AGENTS.md > CLAUDE.md > .cursorrules
 * 仅返回第一个匹配，不叠加。
 */
export async function loadProjectContext(vaultPath: string): Promise<ProjectContextResult | null> {
  const fileStorage = getFileStorage()
const axiom = createAxiomCompat(fileStorage);
  if (!axiom?.readFile || !vaultPath) return null;

  for (const filename of CONTEXT_FILE_NAMES) {
    const filePath = `${vaultPath}/${filename}`;
    try {
      const result = await axiom.readFile(filePath);
      if (result?.success && result.content) {
        const raw = result.content;

        // 安全扫描
        const scanned = scanContextContent(raw, filename);
        const blocked = scanned !== raw;

        // 去除 frontmatter
        const stripped = stripYamlFrontmatter(scanned);

        // 截断
        const truncated = truncateToLimit(stripped, MAX_CONTEXT_CHARS);

        return {
          content: truncated.trim(),
          filename,
          blocked,
        };
      }
    } catch {
      // 文件不存在，继续查找下一个
    }
  }

  return null;
}

/**
 * 构建注入到 system prompt 的上下文块
 */
export function buildProjectContextBlock(context: ProjectContextResult): string {
  if (context.blocked) {
    return `\n## Project Context\n${context.content}`;
  }
  return `\n## Project Context (from ${context.filename})\n${context.content}`;
}
