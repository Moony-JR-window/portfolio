export interface NetworkInfo {
  ip: string;
  host: string;
  domain: string;
  protocol: string;
  userAgent: string;
}

export interface HistoryEntry {
  type: 'input' | 'output';
  text: string;
  className?: string;
}

export interface FSNode {
  type: 'file' | 'dir';
  content?: string;
  children?: Record<string, FSNode>;
}

export interface Position {
  x: number;
  y: number;
}