/**
 * Learning Skill Types
 * 学习技能类型定义（共享）
 *
 * 这些类型在 Node.js 和浏览器环境中共享
 */

import { TeachingMethod } from '@/types/learning';

/**
 * Skill 类型
 */
export enum SkillType {
  CONCEPT = 'concept',           // 概念讲解
  PROCEDURE = 'procedure',       // 步骤流程
  PROBLEM_SOLVING = 'problem',   // 问题解决
  ASSESSMENT = 'assessment',     // 评估测试
  REMEDIATION = 'remediation',   // 补救教学
  REFERENCE = 'reference',       // 参考资源
}

/**
 * Skill 难度级别
 */
export enum SkillDifficulty {
  BEGINNER = 'beginner',
  INTERMEDIATE = 'intermediate',
  ADVANCED = 'advanced',
  EXPERT = 'expert',
}

/**
 * Skill 元信息
 */
export interface SkillMeta {
  id: string;
  name: string;
  description: string;
  type: SkillType;
  difficulty: SkillDifficulty;
  prerequisites: string[];       // 前置技能ID
  tags: string[];
  version: string;
  author?: string;
  estimatedTime: number;         // 预计学习时间（分钟）
}

/**
 * Skill 内容
 */
export interface SkillContent {
  meta: SkillMeta;
  phases: SkillPhase[];
  resources: SkillResource[];
  assessment?: SkillAssessment;
  variations: SkillVariation[];
}

/**
 * Skill 阶段
 */
export interface SkillPhase {
  id: string;
  name: string;
  description: string;
  order: number;
  teachingMethod: TeachingMethod;
  content: string;
  checkpoints: string[];         // 检查点
}

/**
 * Skill 资源
 */
export interface SkillResource {
  type: 'text' | 'image' | 'video' | 'code' | 'exercise';
  url?: string;
  content?: string;
  description: string;
}

/**
 * Skill 评估
 */
export interface SkillAssessment {
  questions: AssessmentQuestion[];
  passingScore: number;          // 及格分数 (0-1)
}

/**
 * 评估问题
 */
export interface AssessmentQuestion {
  id: string;
  question: string;
  options?: string[];
  correctAnswer?: string | number;
  explanation?: string;
}

/**
 * Skill 变体（针对不同用户画像的适配）
 */
export interface SkillVariation {
  profile: string;               // 用户画像标识
  adaptations: {
    method?: TeachingMethod;
    complexity?: number;
    examples?: string[];
  };
}

/**
 * Skill 匹配结果
 */
export interface SkillMatch {
  skill: SkillContent;
  relevance: number;             // 相关性 0-1
  confidence: number;            // 置信度 0-1
  explanation: string;           // 匹配理由
}

/**
 * Skill Manager 配置
 */
export interface SkillManagerConfig {
  skillsPath?: string;           // 技能文件路径
  enablePersistence?: boolean;   // 是否持久化
  maxCacheSize?: number;         // 最大缓存数量
}
