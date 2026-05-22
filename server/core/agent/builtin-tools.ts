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

export function registerBuiltinTools(): void {
  registerFileTools();
  registerCardTools();
  registerMemoryTools();
  registerResourceTools();
  registerSessionTools();
  registerAgentTools();
}
