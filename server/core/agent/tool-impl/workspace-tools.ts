/**
 * AXIOM Agent tools - front-end workspace control
 *
 * The server cannot mutate Zustand directly, so this tool returns normalized
 * workspace actions. /api/agent/chat streams them to use-agent.ts, where the
 * client applies them to mode-store and React Query.
 */

import { Type } from '@mariozechner/pi-ai';
import { prisma } from '@/lib/db';
import { getCurrentUserId, getCurrentVaultId } from '@/server/core/agent/agent-context';
import { createTool, toolRegistry } from '../tools';

type WorkspaceAction =
  | { type: 'set_mode'; mode: string }
  | { type: 'open_modal'; modal: string }
  | { type: 'close_modal' }
  | { type: 'set_chat_panel_open'; open: boolean }
  | { type: 'set_panel'; panel: string; open: boolean; zone?: string | null }
  | { type: 'set_right_panel_view'; view: string }
  | { type: 'set_graph_layout'; layout: string }
  | { type: 'set_graph_hover_attention'; enabled: boolean }
  | { type: 'set_immersive'; enabled: boolean }
  | { type: 'set_oracle'; oracle: string }
  | { type: 'select_card'; card: { id: string; title: string; type: string } }
  | { type: 'select_learning_context'; pathId?: string | null; stepId?: string | null }
  | { type: 'clear_selection' }
  | { type: 'select_vault'; vaultId: string }
  | { type: 'refresh_workspace' };

const VALID_MODES = new Set(['dashboard', 'forge', 'galaxy', 'cognition', 'learn']);
const VALID_MODALS = new Set(['search', 'newcard', 'importtext', 'oracle', 'profile', 'shortcuts', 'onboarding']);
const VALID_PANELS = new Set(['fileTree', 'sessionList', 'editor', 'chat']);
const VALID_PANEL_ZONES = new Set(['left', 'right']);
const VALID_RIGHT_PANEL_VIEWS = new Set(['editor', 'read']);
const VALID_GRAPH_LAYOUTS = new Set(['galaxy', 'flat', 'radial', 'concentric', 'layered', 'matrix', 'task-flow', 'timeline', 'mastery', 'evidence']);

function readBoolean(payload: Record<string, unknown>, keys: string[], fallback?: boolean): boolean {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (['true', '1', 'yes', 'open', 'on', 'enabled'].includes(normalized)) return true;
      if (['false', '0', 'no', 'close', 'off', 'disabled'].includes(normalized)) return false;
    }
  }
  if (typeof fallback === 'boolean') return fallback;
  throw new Error(`${keys[0]} must be boolean`);
}

async function resolveCard(payload: Record<string, unknown>, vaultId: string) {
  const id = typeof payload.cardId === 'string' ? payload.cardId.trim() : '';
  const path = typeof payload.path === 'string' ? payload.path.trim().replace(/\\/g, '/') : '';
  const title = typeof payload.title === 'string' ? payload.title.trim() : '';
  if (!id && !path && !title) return null;

  return prisma.card.findFirst({
    where: {
      vaultId,
      OR: [
        ...(id ? [{ id }] : []),
        ...(path ? [{ path }] : []),
        ...(title ? [{ title }, { path: `fleeting/${title}.md` }, { path: `permanent/${title}.md` }, { path: `literature/${title}.md` }] : []),
      ],
    },
    select: { id: true, title: true, type: true },
  });
}

async function resolveLearningContext(payload: Record<string, unknown>, vaultId: string, userId: string) {
  const pathId = typeof payload.pathId === 'string' ? payload.pathId.trim() : '';
  const stepId = typeof payload.stepId === 'string' ? payload.stepId.trim() : '';
  const pathTitle = typeof payload.pathTitle === 'string' ? payload.pathTitle.trim() : '';
  const stepTitle = typeof payload.stepTitle === 'string' ? payload.stepTitle.trim() : '';

  let path = pathId
    ? await prisma.learningPath.findFirst({ where: { id: pathId, vaultId, userId }, select: { id: true } })
    : null;
  if (!path && pathTitle) {
    path = await prisma.learningPath.findFirst({
      where: {
        vaultId,
        userId,
        OR: [{ name: pathTitle }, { topic: pathTitle }],
      },
      select: { id: true },
    });
  }

  let step = stepId
    ? await prisma.learningPathStep.findFirst({
      where: { id: stepId, ...(path ? { pathId: path.id } : {}) },
      select: { id: true, pathId: true },
    })
    : null;
  if (!step && stepTitle) {
    step = await prisma.learningPathStep.findFirst({
      where: {
        title: stepTitle,
        ...(path ? { pathId: path.id } : { path: { vaultId, userId } }),
      },
      select: { id: true, pathId: true },
    });
  }

  return {
    pathId: path?.id ?? step?.pathId ?? null,
    stepId: step?.id ?? null,
  };
}

async function buildAction(raw: Record<string, unknown>): Promise<WorkspaceAction | null> {
  const action = typeof raw.action === 'string' ? raw.action.trim() : '';
  const payload = (raw.payload && typeof raw.payload === 'object' ? raw.payload : raw) as Record<string, unknown>;
  const vaultId = getCurrentVaultId();
  const userId = getCurrentUserId();

  if (action === 'set_mode') {
    const mode = typeof payload.mode === 'string' ? payload.mode.trim() : '';
    if (!VALID_MODES.has(mode)) throw new Error(`Unsupported mode: ${mode}`);
    return { type: 'set_mode', mode };
  }
  if (action === 'open_modal') {
    const modal = typeof payload.modal === 'string' ? payload.modal.trim() : '';
    if (!VALID_MODALS.has(modal)) throw new Error(`Unsupported modal: ${modal}`);
    return { type: 'open_modal', modal };
  }
  if (action === 'close_modal') return { type: 'close_modal' };
  if (action === 'open_chat_panel') return { type: 'set_chat_panel_open', open: true };
  if (action === 'close_chat_panel') return { type: 'set_chat_panel_open', open: false };
  if (action === 'set_chat_panel') {
    return { type: 'set_chat_panel_open', open: readBoolean(payload, ['open', 'enabled'], true) };
  }
  if (action === 'open_panel' || action === 'close_panel' || action === 'set_panel') {
    const panel = typeof payload.panel === 'string' ? payload.panel.trim() : '';
    const zone = typeof payload.zone === 'string' ? payload.zone.trim() : '';
    if (!VALID_PANELS.has(panel)) throw new Error(`Unsupported panel: ${panel}`);
    if (zone && !VALID_PANEL_ZONES.has(zone)) throw new Error(`Unsupported panel zone: ${zone}`);
    const open = action === 'open_panel'
      ? true
      : action === 'close_panel'
        ? false
        : readBoolean(payload, ['open', 'enabled'], true);
    if (panel === 'chat') return { type: 'set_chat_panel_open', open };
    return { type: 'set_panel', panel, open, zone: zone || null };
  }
  if (action === 'set_right_panel_view') {
    const view = typeof payload.view === 'string' ? payload.view.trim() : '';
    if (!VALID_RIGHT_PANEL_VIEWS.has(view)) throw new Error(`Unsupported right panel view: ${view}`);
    return { type: 'set_right_panel_view', view };
  }
  if (action === 'set_graph_layout') {
    const layout = typeof payload.layout === 'string' ? payload.layout.trim() : '';
    if (!VALID_GRAPH_LAYOUTS.has(layout)) throw new Error(`Unsupported graph layout: ${layout}`);
    return { type: 'set_graph_layout', layout };
  }
  if (action === 'set_graph_hover_attention') {
    return { type: 'set_graph_hover_attention', enabled: readBoolean(payload, ['enabled', 'open'], true) };
  }
  if (action === 'set_immersive') {
    return { type: 'set_immersive', enabled: readBoolean(payload, ['enabled', 'open'], true) };
  }
  if (action === 'set_oracle') {
    const oracle = typeof payload.oracle === 'string' ? payload.oracle.trim() : '';
    if (!oracle) throw new Error('oracle is required');
    return { type: 'set_oracle', oracle };
  }
  if (action === 'clear_selection') return { type: 'clear_selection' };
  if (action === 'refresh_workspace') return { type: 'refresh_workspace' };

  if (action === 'select_card') {
    if (!vaultId) throw new Error('Vault context not configured');
    const card = await resolveCard(payload, vaultId);
    if (!card) throw new Error('Card not found in current vault');
    return {
      type: 'select_card',
      card: {
        id: card.id,
        title: card.title || 'Untitled',
        type: card.type || 'fleeting',
      },
    };
  }

  if (action === 'select_learning_context') {
    if (!vaultId || !userId) throw new Error('User/vault context not configured');
    const context = await resolveLearningContext(payload, vaultId, userId);
    if (!context.pathId && !context.stepId) throw new Error('Learning path or step not found');
    return { type: 'select_learning_context', ...context };
  }

  if (action === 'select_vault') {
    if (!userId) throw new Error('User context not configured');
    const targetVaultId = typeof payload.vaultId === 'string' ? payload.vaultId.trim() : '';
    if (!targetVaultId) throw new Error('vaultId is required');
    const vault = await prisma.vault.findFirst({ where: { id: targetVaultId, userId }, select: { id: true } });
    if (!vault) throw new Error('Vault not found or not owned by current user');
    return { type: 'select_vault', vaultId: vault.id };
  }

  throw new Error(`Unsupported workspace action: ${action}`);
}

const workspaceControlTool = createTool(
  'workspace_control',
  '控制工作台界面',
  '请求前端工作台执行 UI 操作：切换页面模式、打开弹窗、控制 Forge 面板/聊天面板、切换图谱布局、选择 Oracle、选中卡片、选中学习路径/步骤、刷新工作台等。',
  Type.Object({
    actions: Type.Array(Type.Object({
      action: Type.String({ description: '动作：set_mode/open_modal/close_modal/open_chat_panel/close_chat_panel/set_chat_panel/open_panel/close_panel/set_panel/set_right_panel_view/set_graph_layout/set_graph_hover_attention/set_immersive/set_oracle/select_card/select_learning_context/select_vault/clear_selection/refresh_workspace' }),
      payload: Type.Optional(Type.Any({ description: '动作参数对象。' })),
    }), { description: '要执行的一组工作台动作，按顺序执行。' }),
  }),
  async (_id, params) => {
    const built: WorkspaceAction[] = [];
    const errors: string[] = [];

    for (const raw of params.actions ?? []) {
      try {
        const action = await buildAction(raw as Record<string, unknown>);
        if (action) built.push(action);
      } catch (error) {
        errors.push((error as Error).message);
      }
    }

    if (built.length === 0) {
      return {
        content: [{ type: 'text', text: `没有可执行的工作台动作。${errors.length ? `错误：${errors.join('; ')}` : ''}` }],
        details: { error: errors.join('; ') || 'NO_ACTIONS', workspaceActions: [] },
      };
    }

    return {
      content: [{
        type: 'text',
        text: `已请求工作台执行 ${built.length} 个界面动作。${errors.length ? `部分动作失败：${errors.join('; ')}` : ''}`,
      }],
      details: {
        workspaceActions: built,
        errors,
      },
    };
  },
);

export function registerWorkspaceTools(): void {
  toolRegistry.register(workspaceControlTool);
}
