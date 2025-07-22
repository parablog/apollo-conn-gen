export interface MapRule {
  pattern: string;
  replacement: string;
  description?: string;
  enabled?: boolean;
  priority?: number;
}

export interface MapRules {
  rules: MapRule[];
  description?: string;
}

export interface Mapper {
  operationName(name: string): string;
} 