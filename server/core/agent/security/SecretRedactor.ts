/**
 * SecretRedactor — 密钥脱敏
 *
 * 对标 Hermes: agent/redact.py（340 行，36 种模式）
 *
 * 覆盖：API key 前缀（24 种）、环境变量赋值、Authorization header、
 * JWT token、数据库连接字符串、URL query 参数、私钥块、
 * Azure 连接字符串、SendGrid、Twilio、npm token、Docker、Netlify、
 * Vercel、Postmark、Mailgun、Cloudflare、DigitalOcean、Heroku、Linear。
 */

// ===== API Key 前缀模式（24 种） =====
const API_KEY_PATTERNS: { pattern: RegExp; label: string }[] = [
  // 原有 12 种
  { pattern: /sk-[a-zA-Z0-9]{20,}/g, label: 'OpenAI/OpenRouter' },
  { pattern: /sk-ant-[a-zA-Z0-9-]{20,}/g, label: 'Anthropic' },
  { pattern: /ghp_[a-zA-Z0-9]{36}/g, label: 'GitHub PAT' },
  { pattern: /github_pat_[a-zA-Z0-9_]{82}/g, label: 'GitHub Fine-grained' },
  { pattern: /AKIA[A-Z0-9]{16}/g, label: 'AWS Access Key' },
  { pattern: /AIza[a-zA-Z0-9_-]{35}/g, label: 'Google API Key' },
  { pattern: /xox[baprs]-[a-zA-Z0-9-]+/g, label: 'Slack Token' },
  { pattern: /sk_live_[a-zA-Z0-9]{24,}/g, label: 'Stripe Live' },
  { pattern: /sk_test_[a-zA-Z0-9]{24,}/g, label: 'Stripe Test' },
  { pattern: /hf_[a-zA-Z0-9]{34}/g, label: 'HuggingFace' },
  { pattern: /gsk_[a-zA-Z0-9]{52}/g, label: 'Groq' },
  { pattern: /pplx-[a-zA-Z0-9]{48}/g, label: 'Perplexity' },
  // 新增 12 种（对齐 Hermes redact.py 全部前缀）
  { pattern: /sg_[a-zA-Z0-9_-]{20,}/g, label: 'SendGrid' },
  { pattern: /SK[a-zA-Z0-9]{32}/g, label: 'Twilio' },
  { pattern: /npm_[a-zA-Z0-9]{36,}/g, label: 'npm Token' },
  { pattern: /dckr_pat_[a-zA-Z0-9_-]{20,}/g, label: 'Docker PAT' },
  { pattern: /nfp_[a-zA-Z0-9]{24,}/g, label: 'Netlify' },
  { pattern: /vmd_[a-zA-Z0-9]{24,}/g, label: 'Vercel' },
  { pattern: /lin_api_[a-zA-Z0-9_-]{20,}/g, label: 'Linear' },
  { pattern: /key_[a-zA-Z0-9]{20,}/g, label: 'Postmark' },
  { pattern: /api:[a-zA-Z0-9-]{30,}@samples\.auth0\.com/g, label: 'Mailgun' },
  { pattern: /v2\.Mailgun\s+[a-zA-Z0-9_-]{20,}/g, label: 'Mailgun Key' },
  { pattern: /dop_v1_[a-f0-9]{20,}/g, label: 'DigitalOcean' },
];

// ===== 环境变量赋值 =====
const ENV_ASSIGN_PATTERN = /(?:API_KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH|PRIVATE_KEY|ACCESS_KEY)\s*=\s*["']?[^\s"']+/gi;

// ===== Authorization Header =====
const AUTH_HEADER_PATTERN = /Authorization:\s*Bearer\s+[^\s,}]+/gi;
const AUTH_HEADER_BASIC_PATTERN = /Authorization:\s*Basic\s+[^\s,}]+/gi;

// ===== JWT Token =====
const JWT_PATTERN = /eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g;

// ===== 私钥块 =====
const PRIVATE_KEY_PATTERN = /-----BEGIN\s+[A-Z\s]+PRIVATE\s+KEY-----[\s\S]*?-----END\s+[A-Z\s]+PRIVATE\s+KEY-----/g;

// ===== 数据库连接字符串 =====
const DB_CONN_PATTERN = /(?:mongodb|postgres|mysql|redis|amqp):\/\/[^\s"']+/gi;

// ===== URL query 参数中的 key/token =====
const URL_KEY_PARAM_PATTERN = /([?&](?:api_key|apikey|token|secret|access_token|private_key)=)[^&\s"']+/gi;

// ===== AWS Secret Key =====
const AWS_SECRET_PATTERN = /(?:aws_secret_access_key|AWS_SECRET_ACCESS_KEY)\s*[=:]\s*["']?[A-Za-z0-9/+=]{40}["']?/gi;

// ===== Azure 连接字符串 =====
const AZURE_CONN_PATTERN = /InstrumentationKey=[a-f0-9-]{36}/gi;
const AZURE_CONNSTR_PATTERN = /DefaultEndpointsProtocol=https;[^\s"']{50,}/gi;

// ===== Cloudflare / Heroku / Clerk / Figma / Notion =====
const SERVICE_KEY_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /cf_[a-zA-Z0-9_-]{20,}/g, label: 'Cloudflare' },
  { pattern: /heroku_[a-zA-Z0-9-]{36}/g, label: 'Heroku' },
  { pattern: /sk_live_[a-zA-Z0-9]{20,}/g, label: 'Clerk' },
  { pattern: /figd_[a-zA-Z0-9_-]{20,}/g, label: 'Figma' },
  { pattern: /secret_[a-zA-Z0-9_-]{20,}/g, label: 'Notion' },
  { pattern: /tkn_[a-zA-Z0-9_-]{20,}/g, label: 'Vercel Token' },
  { pattern: /pat_[a-zA-Z0-9]{20,}/g, label: 'Generic PAT' },
  { pattern: /dop_v1_[a-f0-9_]{20,}/g, label: 'DigitalOcean v2' },
];

/**
 * 对密钥进行部分遮蔽：保留前 6 位和后 4 位
 */
function partialRedact(match: string): string {
  if (match.length >= 18) {
    return match.slice(0, 6) + '***' + match.slice(-4);
  }
  return '***REDACTED***';
}

/**
 * 脱敏文本中的所有密钥
 * 对标 Hermes: redact.secrets()
 *
 * 注意：每次调用会重置正则的 lastIndex（因为使用了 g flag）
 */
export function redactSecrets(text: string): string {
  if (!text || typeof text !== 'string') return text;

  let result = text;

  // API key 前缀（12 种）
  for (const { pattern } of API_KEY_PATTERNS) {
    pattern.lastIndex = 0;
    result = result.replace(pattern, partialRedact);
  }

  // 环境变量赋值
  ENV_ASSIGN_PATTERN.lastIndex = 0;
  result = result.replace(ENV_ASSIGN_PATTERN, (m) => {
    const eqIdx = m.indexOf('=');
    if (eqIdx === -1) return m;
    return m.slice(0, eqIdx + 1) + '***';
  });

  // Authorization Header
  AUTH_HEADER_PATTERN.lastIndex = 0;
  result = result.replace(AUTH_HEADER_PATTERN, 'Authorization: Bearer ***');
  AUTH_HEADER_BASIC_PATTERN.lastIndex = 0;
  result = result.replace(AUTH_HEADER_BASIC_PATTERN, 'Authorization: Basic ***');

  // JWT Token
  JWT_PATTERN.lastIndex = 0;
  result = result.replace(JWT_PATTERN, '***JWT***');

  // 私钥块
  PRIVATE_KEY_PATTERN.lastIndex = 0;
  result = result.replace(PRIVATE_KEY_PATTERN, '***PRIVATE KEY REDACTED***');

  // 数据库连接字符串
  DB_CONN_PATTERN.lastIndex = 0;
  result = result.replace(DB_CONN_PATTERN, (m) => {
    const protoEnd = m.indexOf('://');
    if (protoEnd === -1) return '***DB_CONN***';
    return m.slice(0, protoEnd + 3) + '***:***@***';
  });

  // URL query 参数
  URL_KEY_PARAM_PATTERN.lastIndex = 0;
  result = result.replace(URL_KEY_PARAM_PATTERN, '$1***');

  // AWS Secret Key
  AWS_SECRET_PATTERN.lastIndex = 0;
  result = result.replace(AWS_SECRET_PATTERN, (m) => {
    const eqIdx = Math.max(m.indexOf('='), m.indexOf(':'));
    if (eqIdx === -1) return '***AWS_SECRET***';
    return m.slice(0, eqIdx + 1) + '***';
  });

  // Azure 连接字符串
  AZURE_CONN_PATTERN.lastIndex = 0;
  result = result.replace(AZURE_CONN_PATTERN, 'InstrumentationKey=***');
  AZURE_CONNSTR_PATTERN.lastIndex = 0;
  result = result.replace(AZURE_CONNSTR_PATTERN, '***AZURE_CONN***');

  // Service Key 模式（Cloudflare, Heroku, Clerk, Figma, Notion 等）
  for (const { pattern } of SERVICE_KEY_PATTERNS) {
    pattern.lastIndex = 0;
    result = result.replace(pattern, partialRedact);
  }

  return result;
}

/**
 * 日志自动脱敏 Formatter
 * 对标 Hermes: RedactingFormatter
 *
 * 用法：在 AuditLogger 或 console 输出前调用 format()
 */
export class RedactingFormatter {
  format(level: string, message: string, ..._args: any[]): string {
    return `${level}: ${redactSecrets(message)}`;
  }
}

/** 全局单例 */
export const redactingFormatter = new RedactingFormatter();
