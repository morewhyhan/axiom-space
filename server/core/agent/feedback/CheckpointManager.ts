import { createAxiomCompat } from "@/server/infra/storage/AxiomCompat";
/**
 * CheckpointManager — 影子 git 快照系统
 *
 * 对标 Hermes: tools/checkpoint_manager.py（654 行）
 *
 * 在文件修改前自动创建快照，每个目录每轮仅一个快照（去重）。
 * 使用 Electron IPC 通过主进程的 git 操作实现。
 *
 * 存储位置：{vault}/.axiom/checkpoints/{hash(dir)[:16]}/
 */

import { getFileStorage } from '@/server/infra/storage/GlobalFileStorage'

export interface Checkpoint {
  hash: string;
  message: string;
  timestamp: number;
  snapshotId: number;  // Date.now() — 用作目录名
  workingDir: string;
}

export class CheckpointManager {
  private checkpointedDirs: Set<string> = new Set();
  private enabled: boolean;
  private vaultPath: string;

  constructor(vaultPath: string, enabled = true) {
    this.vaultPath = vaultPath;
    this.enabled = enabled;
  }

  /**
   * 每轮开始时调用，清除去重缓存
   * 对标 Hermes: new_turn()
   */
  newTurn(): void {
    this.checkpointedDirs.clear();
  }

  /**
   * 确保目录已快照（每目录每轮仅一次）
   * 对标 Hermes: ensure_checkpoint()
   *
   * 使用 axiom IPC 进行文件操作：
   * 1. 列出工作目录中的文件
   * 2. 读取每个文件的内容
   * 3. 写入到快照目录
   * 4. 记录快照元数据
   */
  async ensureCheckpoint(workingDir: string, reason: string): Promise<void> {
    if (!this.enabled) return;
    if (this.checkpointedDirs.has(workingDir)) return;

    const fileStorage = getFileStorage()
const axiom = createAxiomCompat(fileStorage);
    if (!axiom) return;

    try {
      const shadowRepoPath = this.getShadowRepoPath(workingDir);
      const hash = this.hashDir(workingDir);
      const snapshotId = Date.now();
      const snapshotDir = `${shadowRepoPath}/snapshots/${snapshotId}`;

      // 确保快照目录存在
      await axiom.ensureDirectory?.(snapshotDir);

      // 列出工作目录中的文件
      const lsResult = await axiom.ls?.(workingDir);
      const fileEntries: Array<{ name: string; isFile: boolean }> =
        (lsResult?.success && Array.isArray(lsResult.entries)) ? lsResult.entries : [];

      // 复制每个文件到快照目录
      const snapshotFiles: string[] = [];
      for (const entry of fileEntries) {
        const fileName = typeof entry === 'string' ? entry : entry.name;
        const isFile = typeof entry === 'string' ? true : entry.isFile;
        if (!isFile) continue;
        // 跳过隐藏文件和元数据
        if (fileName.startsWith('.')) continue;

        try {
          const readResult = await axiom.readFile(`${workingDir}/${fileName}`);
          if (readResult?.success && readResult.content != null) {
            await axiom.writeFile?.(`${snapshotDir}/${fileName}`, readResult.content);
            snapshotFiles.push(fileName);
          }
        } catch {
          // 跳过无法读取的文件（二进制等）
        }
      }

      // 记录快照元数据（包含文件列表，用于 restore）
      await axiom.writeFile?.(
        `${snapshotDir}/.checkpoint-meta.json`,
        JSON.stringify({
          workingDir,
          reason,
          timestamp: new Date().toISOString(),
          snapshotId,
          hash,
          files: snapshotFiles,
        }),
      );

      this.checkpointedDirs.add(workingDir);
    } catch (err) {
      // 快照失败不应阻止正常操作
      console.warn('[CheckpointManager] snapshot failed:', err);
    }
  }

  /**
   * 列出可用快照
   * 对标 Hermes: list_checkpoints()
   */
  async listCheckpoints(workingDir: string): Promise<Checkpoint[]> {
    const fileStorage = getFileStorage()
const axiom = createAxiomCompat(fileStorage);
    if (!axiom) return [];

    const shadowRepoPath = this.getShadowRepoPath(workingDir);
    const snapshotsDir = `${shadowRepoPath}/snapshots`;

    try {
      const result = await axiom.ls?.(snapshotsDir);
      if (!result?.success || !Array.isArray(result.entries)) return [];

      const checkpoints: Checkpoint[] = [];
      for (const file of result.entries) {
        const fileName = typeof file === 'string' ? file : file.name;
        try {
          const metaResult = await axiom.readFile?.(`${snapshotsDir}/${fileName}/.checkpoint-meta.json`);
          if (metaResult?.success && metaResult.content) {
            const meta = JSON.parse(metaResult.content);
            checkpoints.push({
              hash: meta.hash,
              message: meta.reason,
              timestamp: new Date(meta.timestamp).getTime(),
              snapshotId: meta.snapshotId || parseInt(fileName) || 0,
              workingDir: meta.workingDir,
            });
          }
        } catch {
          // 跳过无法解析的快照
        }
      }

      return checkpoints.sort((a, b) => b.timestamp - a.timestamp);
    } catch {
      return [];
    }
  }

  /**
   * 恢复到最近的快照
   * 对标 Hermes: restore()
   *
   * 恢复前先做预回滚快照，然后从快照目录复制文件回工作目录。
   */
  async restore(workingDir: string): Promise<boolean> {
    const fileStorage = getFileStorage()
const axiom = createAxiomCompat(fileStorage);
    if (!axiom) return false;

    // 预回滚快照（保存当前状态以便回退）
    await this.forceCheckpoint(workingDir, 'pre-restore-snapshot');

    const checkpoints = await this.listCheckpoints(workingDir);
    if (checkpoints.length === 0) return false;

    // 取第二个（最新的 pre-restore 之前的），因为第一个是刚创建的预回滚
    const target = checkpoints.length > 1 ? checkpoints[1] : checkpoints[0];
    const snapshotDir = `${this.getShadowRepoPath(workingDir)}/snapshots/${target.snapshotId}`;

    try {
      // 读取快照元数据获取文件列表
      const metaResult = await axiom.readFile(`${snapshotDir}/.checkpoint-meta.json`);
      if (!metaResult?.success || !metaResult.content) return false;
      const meta = JSON.parse(metaResult.content);
      const files: string[] = meta.files || [];

      // 从快照目录复制每个文件回工作目录
      for (const fileName of files) {
        try {
          const readResult = await axiom.readFile(`${snapshotDir}/${fileName}`);
          if (readResult?.success && readResult.content != null) {
            await axiom.writeFile(`${workingDir}/${fileName}`, readResult.content);
          }
        } catch {
          // 跳过无法恢复的文件
        }
      }

      // 删除快照中不存在的文件（快照后新建的文件）
      try {
        const lsResult = await (axiom as any).listFiles?.(workingDir);
        if (lsResult?.success && Array.isArray(lsResult.files)) {
          const snapshotFileSet = new Set(files);
          for (const currentFile of lsResult.files) {
            if (!snapshotFileSet.has(currentFile)) {
              try {
                await axiom.deleteFile?.(`${workingDir}/${currentFile}`);
              } catch {
                // 跳过无法删除的文件
              }
            }
          }
        }
      } catch {
        // 列出当前文件失败，非致命
      }

      return true;
    } catch {
      return false;
    }
  }

  /**
   * 强制创建快照（忽略去重检查）
   */
  private async forceCheckpoint(workingDir: string, reason: string): Promise<void> {
    const wasCheckpointed = this.checkpointedDirs.has(workingDir);
    this.checkpointedDirs.delete(workingDir);
    await this.ensureCheckpoint(workingDir, reason);
    if (wasCheckpointed) {
      this.checkpointedDirs.add(workingDir);
    }
  }

  /**
   * 获取影子仓库路径
   */
  private getShadowRepoPath(workingDir: string): string {
    const hash = this.hashDir(workingDir);
    return `${this.vaultPath}/.axiom/checkpoints/${hash}`;
  }

  /**
   * 目录路径哈希（取前 16 字符）
   */
  private hashDir(dir: string): string {
    let hash = 0;
    for (let i = 0; i < dir.length; i++) {
      const chr = dir.charCodeAt(i);
      hash = ((hash << 5) - hash) + chr;
      hash |= 0;
    }
    return Math.abs(hash).toString(16).padStart(16, '0').slice(0, 16);
  }

  /**
   * 启用/禁用快照
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * 回滚到最近的快照（便捷方法，使用构造时的 vaultPath）
   */
  async rollbackLast(): Promise<boolean> {
    return this.restore(this.vaultPath);
  }
}
