
export interface Position {
  x: number;
  y: number;
}

export type NodeType = 'text' | 'image';

export interface NodeData {
  id: string;
  type: NodeType;
  source: 'user' | 'ai'; // Distinguish between manual input and AI generation
  content: string; // Stores text content or Image Base64 string
  position: Position;
  width: number;
  height: number;
  isGenerating?: boolean;
  ports: string[];
  model?: string;
  executionContext?: any[]; // Store the prompt used to generate this node
  isInactive?: boolean; // New property for disabled/ghost state
}

export interface GroupData {
  id: string;
  title: string;
  nodeIds: string[];
  color?: string;
}

export interface EdgeData {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  color?: string;
}

export interface CanvasState {
  nodes: NodeData[];
  edges: EdgeData[];
  groups: GroupData[];
  scale: number;
  offset: Position;
}

export type ProviderType = 'gemini' | 'openai' | 'anthropic';

export interface ModelConfig {
  value: string;
  label: string;
  enabled: boolean;

  // Unified config object for flexible API parameters (thinkingConfig, safetySettings, etc)
  config?: any;

  // Legacy field kept for backward compatibility
  type?: 'text' | 'image';
}

export interface ProviderConfig {
  key: string;
  baseUrl: string;
  models: ModelConfig[];
  isValid?: boolean;
}
