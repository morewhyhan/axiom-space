import type { ToolMiddleware } from '../tools';

const SUSPECT_PATTERNS: Array<{ pattern: RegExp; warning: string }> = [
  { pattern: /(?:根据|据)\s*(?:研究|调查|统计|报告|论文)\s*(?:显示|表明|发现|证实)/g, warning: '引用研究：请确保引用真实存在的研究' },
  { pattern: /(?:\d{4})\s*年\s*(?:的)?\s*(?:研究|调查|统计|报告)/g, warning: '年份引用：请确保引用的年份和研究真实存在' },
  { pattern: /(?:根据|据)\s*[\u4e00-\u9fa5]{2,8}(?:教授|博士|学者|专家)/g, warning: '人物引用：请确保引用的人物真实存在' },
  { pattern: /(?:发表在|刊登于|出版于)\s*[\u4e00-\u9fa5a-zA-Z\s]{2,20}(?:期刊|杂志|学报|出版社)/g, warning: '期刊引用：请确保引用的期刊真实存在' },
  { pattern: /https?:\/\/[^\s)]+/g, warning: 'URL引用：请确保URL真实可访问' },
  { pattern: /(?:DOI|ISBN|ISSN)[:\s]*[^\s,，。]+/gi, warning: '标识号引用：请确保DOI/ISBN/ISSN号真实存在' },
  { pattern: /(?:百分之|%\s*)\s*\d+/g, warning: '百分比数据：请确保统计数据有可靠来源' },
  { pattern: /(?:增长了?|下降了?|提高了?|降低了?)\s*\d+\s*(?:%|百分之)/g, warning: '变化数据：请确保变化数据有可靠来源' },
];

const ACADEMIC_HALLUCINATION_SIGNALS: Array<{ pattern: RegExp; risk: string }> = [
  { pattern: /(?:证明|证实|验证了?)\s*(?:以下|如下|这)/g, risk: '声称证明：可能过度断言' },
  { pattern: /(?:众所周知|不言而喻|毋庸置疑)/g, risk: '绝对化表述：可能忽略争议' },
  { pattern: /(?:唯一|仅有|只有)\s*(?:的)?\s*(?:方法|途径|方式|解决)/g, risk: '唯一性断言：可能不严谨' },
  { pattern: /(?:所有|任何|每个)\s*(?:人|学生|学习者)/g, risk: '全称断言：可能过于绝对' },
];

export class FactualCheckGuardrail implements ToolMiddleware {
  readonly name = 'FactualCheckGuardrail';

  beforeCall(toolName: string, args: any): { proceed: boolean; args?: any; reason?: string } {
    return { proceed: true, args };
  }

  afterCall(toolName: string, result: any): { result: any } {
    if (!['write', 'edit', 'create_fleeing_card', 'create_permanent_card'].includes(toolName)) {
      return { result };
    }

    const content = result?.content?.[0]?.text || '';
    if (!content || content.length < 50) {
      return { result };
    }

    const warnings: string[] = [];

    for (const { pattern, warning } of SUSPECT_PATTERNS) {
      if (pattern.test(content)) {
        warnings.push(warning);
        pattern.lastIndex = 0;
      }
    }

    for (const { pattern, risk } of ACADEMIC_HALLUCINATION_SIGNALS) {
      if (pattern.test(content)) {
        warnings.push(risk);
        pattern.lastIndex = 0;
      }
    }

    if (warnings.length > 0) {
      const disclaimer = `\n\n---\n[警告] **内容审核提示**：此内容包含 ${warnings.length} 处需要核实的信息：\n${warnings.map((w, i) => `${i + 1}. ${w}`).join('\n')}\n\n请自行验证以上信息的准确性，AI 生成的内容可能存在事实性错误。`;

      if (result?.content?.[0]?.text) {
        result.content[0].text += disclaimer;
      }
    }

    return { result };
  }
}
