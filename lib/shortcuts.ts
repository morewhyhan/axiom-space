/**
 * AXIOM 快捷键配置
 * nvim 风格快捷键映射
 */

export interface Shortcut {
  key: string;
  description: string;
  category: 'navigation' | 'editing' | 'vault' | 'view' | 'system';
  action: () => void;
}

export interface ShortcutCategory {
  title: string;
  shortcuts: {
    key: string;
    description: string;
  }[];
}

// 快捷键配置（不带动作，用于文档显示）
export const SHORTCUTS_DOC: ShortcutCategory[] = [
  {
    title: '导航 (Navigation)',
    shortcuts: [
      { key: 'Ctrl+P', description: '命令面板 / 搜索' },
      { key: 'Ctrl+H', description: '显示帮助' },
      { key: 'Ctrl+,', description: '打开设置' },
      { key: 'Tab', description: '切换下一个视图' },
      { key: 'Shift+Tab', description: '切换上一个视图' },
      { key: 'Ctrl+1/2/3', description: '切换到 Literature/Fleeting/Permanent' },
    ]
  },
  {
    title: '编辑 (Editing)',
    shortcuts: [
      { key: 'Ctrl+Shift+N', description: '新建卡片' },
      { key: 'Ctrl+Shift+F', description: '新建灵感' },
      { key: 'Ctrl+Shift+L', description: '导入文献' },
      { key: 'Ctrl+S', description: '保存当前内容' },
      { key: 'Ctrl+F', description: '查找' },
      { key: 'Esc', description: '关闭弹窗/返回' },
    ]
  },
  {
    title: 'Vault 操作',
    shortcuts: [
      { key: 'Ctrl+N', description: '新建 Vault' },
      { key: 'Ctrl+O', description: '打开 Vault' },
      { key: 'Ctrl+W', description: '关闭当前 Vault' },
      { key: 'Ctrl+R', description: '刷新 Vault' },
    ]
  },
  {
    title: '视图 (View)',
    shortcuts: [
      { key: 'Ctrl+Shift+G', description: '切换知识图谱' },
      { key: 'Ctrl+Shift+S', description: '切换侧边栏' },
      { key: 'Ctrl+Shift+E', description: '切换编辑器' },
      { key: 'Ctrl++', description: '放大字体' },
      { key: 'Ctrl+-', description: '缩小字体' },
    ]
  },
  {
    title: '系统 (System)',
    shortcuts: [
      { key: 'Ctrl+Q', description: '退出应用' },
      { key: 'F11', description: '全屏模式' },
      { key: 'Ctrl+?', description: '显示快捷键帮助' },
    ]
  },
];

// 快捷键到视图的映射
export const VIEW_SHORTCUTS: Record<string, string> = {
  'view-lit': 'Ctrl+1',
  'view-flee': 'Ctrl+2',
  'view-perm': 'Ctrl+3',
  'view-graph': 'Ctrl+Shift+G',
};

// 快捷键到操作的映射
export const ACTION_SHORTCUTS: Record<string, string> = {
  newCard: 'Ctrl+Shift+N',
  newFleeing: 'Ctrl+Shift+F',
  importLiterature: 'Ctrl+Shift+L',
  save: 'Ctrl+S',
  find: 'Ctrl+F',
  help: 'Ctrl+H',
  settings: 'Ctrl+,',
  commandPalette: 'Ctrl+P',
  newVault: 'Ctrl+N',
  openVault: 'Ctrl+O',
  closeVault: 'Ctrl+W',
  refreshVault: 'Ctrl+R',
  toggleSidebar: 'Ctrl+Shift+S',
  toggleEditor: 'Ctrl+Shift+E',
  toggleGraph: 'Ctrl+Shift+G',
  zoomIn: 'Ctrl++',
  zoomOut: 'Ctrl+-',
  fullscreen: 'F11',
  quit: 'Ctrl+Q',
};
