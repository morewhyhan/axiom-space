/**
 * 防幻觉系统 - 事实核查守卫
 *
 * 检测和修正 LLM 生成内容中的幻觉问题
 */

export interface AssertionToCheck {
  text: string;
  type: 'formula' | 'number' | 'date' | 'person' | 'code' | 'url' | 'claim';
  riskLevel: 'high' | 'medium' | 'low';
  context: string;
}

export interface VerificationResult {
  assertion: string;
  status: 'verified' | 'unverified' | 'suspicious';
  evidence?: string;
  suggestion?: string;
}

/**
 * 事实核查守卫
 */
export class FactualCheckGuardrail {
  /**
   * 提取关键断言
   */
  private extractAssertions(content: string): AssertionToCheck[] {
    const assertions: AssertionToCheck[] = [];

    // 提取公式（例如：E=mc²）
    const formulaPattern = /([A-Za-z]+\s*=\s*[A-Za-z0-9+\-*/()²³⁴]+)/g;
    let fmatch: RegExpExecArray | null;
    while ((fmatch = formulaPattern.exec(content)) !== null) {
      assertions.push({
        text: fmatch[1],
        type: 'formula',
        riskLevel: 'high',
        context: content.slice(Math.max(0, fmatch.index - 50), fmatch.index + fmatch[0].length + 50)
      });
    }

    // 提取具体数字（年份、统计数据）
    const numberPattern = /(?:在\s*)?(\d{4})年|约?\s*(\d+(?:\.\d+)?)\s*(万|千|百|%|元|美元|米|秒|分钟)/g;
    let nmatch: RegExpExecArray | null;
    while ((nmatch = numberPattern.exec(content)) !== null) {
      assertions.push({
        text: nmatch[0],
        type: nmatch[1] ? 'date' : 'number',
        riskLevel: 'high',
        context: content.slice(Math.max(0, nmatch.index - 50), nmatch.index + nmatch[0].length + 50)
      });
    }

    // 提取人名（例如：牛顿、爱因斯坦）
    const personPattern = /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*|[\u4e00-\u9fa5]+(?:·[\u4e00-\u9fa5]+)?)/g;
    const commonNames = ['Isaac', 'Albert', 'Marie', 'Stephen', 'Charles', 'Isaac Newton', 'Albert Einstein'];
    let pmatch: RegExpExecArray | null;
    while ((pmatch = personPattern.exec(content)) !== null) {
      const p = pmatch;
      if (commonNames.some(name => name.includes(p[0]))) {
        assertions.push({
          text: p[0],
          type: 'person',
          riskLevel: 'medium',
          context: content.slice(Math.max(0, p.index - 50), p.index + p[0].length + 50)
        });
      }
    }

    // 提取代码片段（```...```）
    const codePattern = /```[\s\S]*?```/g;
    let cmatch: RegExpExecArray | null;
    while ((cmatch = codePattern.exec(content)) !== null) {
      assertions.push({
        text: cmatch[0].slice(0, 100),
        type: 'code',
        riskLevel: 'high',
        context: cmatch[0]
      });
    }

    // 提取 URL
    const urlPattern = /https?:\/\/[^\s)]+/g;
    let umatch: RegExpExecArray | null;
    while ((umatch = urlPattern.exec(content)) !== null) {
      assertions.push({
        text: umatch[0],
        type: 'url',
        riskLevel: 'medium',
        context: content.slice(Math.max(0, umatch.index - 50), umatch.index + umatch[0].length + 50)
      });
    }

    return assertions;
  }

  /**
   * 核查单个断言
   * 注：实际部署时应调用 web_search API，这里提供基础框架
   */
  private async verifyAssertion(assertion: AssertionToCheck): Promise<VerificationResult> {
    // 在这里可以集成 web_search 工具进行真实验证
    // 当前提供基础的启发式判断

    switch (assertion.type) {
      case 'formula':
        // 基础公式验证（可扩展）
        const knownFormulas = ['E=mc²', 'F=ma', 'PV=nRT', 'v=u+at'];
        const isKnown = knownFormulas.some(f => assertion.text.includes(f));
        return {
          assertion: assertion.text,
          status: isKnown ? 'verified' : 'unverified',
          evidence: isKnown ? '该公式在科学文献中已验证' : '无法验证，建议添加来源',
          suggestion: isKnown ? undefined : '请在参考资料中标注该公式的来源'
        };

      case 'code':
        // 代码片段：检查语法有效性
        return {
          assertion: assertion.text,
          status: 'unverified', // 代码需人工审查
          evidence: '代码片段需手工验证',
          suggestion: '代码应包含注释说明其用途和测试状态'
        };

      case 'url':
        // URL 验证可以尝试 HEAD 请求检查是否可达
        return {
          assertion: assertion.text,
          status: 'unverified',
          evidence: 'URL 可达性需运行时检查',
          suggestion: '请确保 URL 指向的资源确实存在'
        };

      default:
        return {
          assertion: assertion.text,
          status: 'unverified',
          suggestion: `请验证 ${assertion.type} 类型的信息来源`
        };
    }
  }

  /**
   * 对生成的内容执行事实核查
   */
  async verify(content: string, resourceType: string = 'document'): Promise<{
    status: 'passed' | 'warning' | 'blocked';
    issues: VerificationResult[];
    message: string;
  }> {
    // 提取关键断言
    const assertions = this.extractAssertions(content);

    if (assertions.length === 0) {
      return {
        status: 'passed',
        issues: [],
        message: '内容中无需特别核查的断言'
      };
    }

    // 对高风险断言进行验证
    const highRiskAssertions = assertions.filter(a => a.riskLevel === 'high');
    const verificationResults = await Promise.all(
      highRiskAssertions.map(a => this.verifyAssertion(a))
    );

    // 统计结果
    const unverified = verificationResults.filter(r => r.status === 'unverified');

    if (unverified.length > 0) {
      return {
        status: 'warning',
        issues: verificationResults,
        message: `发现 ${unverified.length} 个未验证的断言。建议在内容中添加来源说明或标注为"待核实"。`
      };
    }

    return {
      status: 'passed',
      issues: verificationResults,
      message: '核查完成，内容基本可信'
    };
  }
}

export const factualCheckGuardrail = new FactualCheckGuardrail();
