/**
 * AXIOM 内置工具集 - 编排器
 * 工具实现已拆分到 tools/ 目录下的领域文件中
 */

import { registerFileTools } from "./tool-impl/file-tools";
import { registerCardTools } from "./tool-impl/card-tools";
import { registerMemoryTools } from "./tool-impl/memory-tools";
import { registerResourceTools } from "./tool-impl/resource-tools";
import { registerSessionTools } from "./tool-impl/session-tools";
import { registerAgentTools } from "./tool-impl/agent-tools";
import { registerContentAnalysisTools } from "./tool-impl/content-analysis-tools";
import { registerGraphAnalysisTools } from "./tool-impl/graph-analysis-tools";
import { registerLearningPathTools } from "./tool-impl/learning-path-tools";
import { registerAssessmentTools } from "./tool-impl/assessment-tools";
import { registerRecommendationTools } from "./tool-impl/recommendation-tools";
import { registerLearningManagementTools } from "./tool-impl/learning-management-tools";
import { registerContentQualityTools } from "./tool-impl/content-quality-tools";
import { registerVaultMaintenanceTools } from "./tool-impl/vault-maintenance-tools";
import { registerImportDocumentTool } from "./tool-impl/import-document-tool";
import { registerPromptTools } from "./tool-impl/prompt-tools";
import { registerWorkspaceTools } from "./tool-impl/workspace-tools";
import { registerPushSuggestionTools } from "./tool-impl/push-suggestion-tools";

export function registerBuiltinTools(): void {
  registerFileTools();
  registerCardTools();
  registerMemoryTools();
  registerResourceTools();
  registerSessionTools();
  registerAgentTools();
  // 新增工具模块
  registerContentAnalysisTools();
  registerGraphAnalysisTools();
  registerLearningPathTools();
  registerAssessmentTools();
  // 第二波新增模块
  registerRecommendationTools();
  registerLearningManagementTools();
  registerContentQualityTools();
  registerVaultMaintenanceTools();
  registerImportDocumentTool();
  registerPromptTools();
  registerWorkspaceTools();
  registerPushSuggestionTools();
}
