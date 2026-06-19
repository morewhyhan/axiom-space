export const uiTokens = {
  surfaces: {
    glass: {
      className: 'glass-panel',
      background: 'var(--glass-bg)',
      border: 'var(--glass-border)',
    },
    forgePanel: {
      background: 'var(--forge-panel-bg)',
      border: 'var(--forge-panel-line)',
      softBorder: 'var(--forge-panel-line-soft)',
    },
  },
  layout: {
    panelXs: 'var(--panel-xs)',
    panelSm: 'var(--panel-sm)',
    panelMd: 'var(--panel-md)',
    panelLg: 'var(--panel-lg)',
    panelXl: 'var(--panel-xl)',
    panelPaddingY: 'var(--panel-py)',
    gridGap: 'var(--gap-grid)',
    zoneGap: 'var(--gap-zone)',
  },
  typography: {
    mono: 'mono',
    serif: 'serif',
    label: 'var(--t-label)',
    body: 'var(--t-body)',
    title: 'var(--t-title)',
    micro10: 'var(--f10)',
    micro9: 'var(--f9)',
    micro8: 'var(--f8)',
  },
  accents: {
    purple: 'var(--primary-purple)',
    cyan: 'var(--axiom-cyan)',
    pink: 'var(--axiom-pink)',
  },
  motion: {
    outExpo: 'var(--ease-out-expo)',
    elastic: 'var(--ease-elastic)',
  },
} as const

export type UiTokens = typeof uiTokens
