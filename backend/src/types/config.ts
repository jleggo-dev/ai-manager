import type { Request, Response, NextFunction } from 'express';

export interface AppConfig {
  port: number;
  aiManagerSupabase: {
    url: string;
    anonKey: string;
    serviceRoleKey: string;
  };
  devsAi: {
    baseUrl: string;
    apiKey: string | undefined;
    defaultModel: string;
  };
}

export interface RateLimits {
  global: number;
  llm: number;
  auth: number;
  llmUser: number;
}

export type AsyncRequestHandler = (req: Request, res: Response, next: NextFunction) => Promise<void | Response>;
