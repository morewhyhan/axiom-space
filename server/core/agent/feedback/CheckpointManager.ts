/**
 * CheckpointManager — 影子 git 快照系统
 *
 * 在文件修改前自动创建快照，每个目录每轮仅一个快照（去重）。
 * 使用 fs 直接操作文件系统。
 *
 * 存储位置：{vault}/.axiom/checkpoints/{hash(dir)[:16]}/
 */

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

export interface Checkpoint {
  hash: string;
  message: string;
  timestamp: number;
  snapshotId: number;
  workingDir: string;
}

export class CheckpointManager {
  private checkpointedDirs: Set<string> = new Set();
  private enabled: boolean;

  constructor(vaultPath?: string) {
    this.enabled = !!vaultPath;
  }

  enable(): void { this.enabled = true; }
  disable(): void { this.enabled = false; }

  /** 获取影子仓库路径 */
  getShadowRepoPath(workingDir: string): string {
    const hash = this.hashDir(workingDir);
    return path.join(workingDir, '.axiom', 'checkpoints', hash.slice(0, 16));
  }

  /**
   * 确保目录已快照（每目录每轮仅一次）
   */
  async ensureCheckpoint(workingDir: string, reason: string): Promise<void> {
    if (!this.enabled) return;
    if (this.checkpointedDirs.has(workingDir)) return;

    try {
      const shadowRepoPath = this.getShadowRepoPath(workingDir);
      const snapshotId = Date.now();
      const snapshotDir = path.join(shadowRepoPath, 'snapshots', String(snapshotId));

      // 确保快照目录存在
      fs.mkdirSync(snapshotDir, { recursive: true });

      // 列出并复制文件
      const snapshotFiles: string[] = [];
      try {
        const names = fs.readdirSync(workingDir);
        for (const fileName of names) {
          if (fileName.startsWith('.')) continue;
          const fullPath = path.join(workingDir, fileName);
          const stat = fs.statSync(fullPath);
          if (!stat.isFile()) continue;

          const content = fs.readFileSync(fullPath, 'utf-8');
          fs.writeFileSync(path.join(snapshotDir, fileName), content, 'utf-8');
          snapshotFiles.push(fileName);
        }
      } catch { /* 目录可能不存在 */ }

      // 写入元数据
      const meta = {
        reason,
        timestamp: Date.now(),
        files: snapshotFiles,
        workingDir,
      };
      fs.writeFileSync(
        path.join(snapshotDir, '.checkpoint-meta.json'),
        JSON.stringify(meta, null, 2),
        'utf-8',
      );

      this.checkpointedDirs.add(workingDir);
    } catch (err) {
      console.debug('[CheckpointManager] Checkpoint creation failed:', err);
    }
  }

  /**
   * 从快照恢复
   */
  async restore(workingDir: string): Promise<boolean> {
    if (!this.enabled) return false;

    try {
      const shadowRepoPath = this.getShadowRepoPath(workingDir);
      const snapshotsDir = path.join(shadowRepoPath, 'snapshots');

      if (!fs.existsSync(snapshotsDir)) return false;

      // 找到最新的快照
      const dirs = fs.readdirSync(snapshotsDir)
        .map(d => ({ name: d, time: fs.statSync(path.join(snapshotsDir, d)).mtimeMs }))
        .sort((a, b) => b.time - a.time);

      if (dirs.length === 0) return false;

      const latest = dirs[0].name;
      const snapshotDir = path.join(snapshotsDir, latest);

      // 读取元数据
      const metaPath = path.join(snapshotDir, '.checkpoint-meta.json');
      if (!fs.existsSync(metaPath)) return false;
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));

      // 恢复每个文件
      for (const fileName of (meta.files || [])) {
        const sourcePath = path.join(snapshotDir, fileName);
        if (fs.existsSync(sourcePath)) {
          const content = fs.readFileSync(sourcePath, 'utf-8');
          fs.writeFileSync(path.join(workingDir, fileName), content, 'utf-8');
        }
      }

      return true;
    } catch (err) {
      console.debug('[CheckpointManager] Restore failed:', err);
      return false;
    }
  }

  /** 清空本轮已快照记录 */
  clearSession(): void {
    this.checkpointedDirs.clear();
  }

  /** 新对话轮次 — 清空快照集，允许新一轮快照 */
  newTurn(): void {
    this.checkpointedDirs.clear();
  }

  private hashDir(dir: string): string {
    return crypto.createHash('sha256').update(dir).digest('hex');
  }
}
