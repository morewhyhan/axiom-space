/** Electron IPC bridge */
interface AxiomAPI {
  readFile(path: string): Promise<{ success: boolean; content?: string }>;
  writeFile(path: string, content: string): Promise<{ success: boolean }>;
  // ... other methods
  [key: string]: any;
}

interface Window {
  axiom?: AxiomAPI;
  __AXIOM_DOCKER__?: boolean;
}
