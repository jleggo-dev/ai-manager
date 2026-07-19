/**
 * FE-06: thin barrel for the AI Admin frontend API client.
 * Domain modules live under `./api/`; import paths `services/api` stay unchanged.
 */

export type {
  Provider,
  AiProfile,
  ProcessingJob,
  ChatSession,
  ChatMessage,
  AppSetting,
  CallingApplication,
  Workflow,
  WorkflowStep,
  DiagnosticLog,
  ProcessingJobGroup,
  LlmModel,
  SyncModelsResult,
  HealthCheckResult,
  WorkspaceMembership,
  ApiKey,
  CreateApiKeyResponse,
  WorkspaceMember,
  UserCredential,
  PaginatedResponse,
  AiMatcherSlotResult,
  AvailableFormattingRule,
  HcProviderKey,
  HcProfile,
  HcCheck,
  HcRun,
  HcIncident,
  HcDashboardItem,
  CheckUptimeHistory,
} from '../types/api';

export { getApiAuthHeaders, getValidationDetails } from './api/client';
export * from './api/providers';
export * from './api/ai-profiles';
export * from './api/processing-jobs';
export * from './api/calling-applications';
export * from './api/settings';
export * from './api/chat-sessions';
export * from './api/workflows';
export * from './api/workspaces';
export * from './api/health-checks';
export * from './api/admin';
