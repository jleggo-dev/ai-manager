import type { SupabaseClient } from '@supabase/supabase-js';

export type AuthMode = 'jwt' | 'api_key';

export type WorkspaceRole = 'owner' | 'admin' | 'member';

interface JwtAuthContext {
  mode: 'jwt';
  workspaceId: string | null;
  userId: string;
  userClient: SupabaseClient;
}

interface ApiKeyAuthContext {
  mode: 'api_key';
  workspaceId: string;
  apiKeyId: string;
  userId?: string;
  forwardedUserId?: string | null;
  apiKeyRole?: WorkspaceRole;
  callingApplicationId?: string | null;
}

export type RequestAuthContext = JwtAuthContext | ApiKeyAuthContext;

export type AccountStatus = 'pending' | 'approved' | 'suspended';

export interface ProfileRow {
  id: string;
  email: string | null;
  display_name: string | null;
  status: AccountStatus;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}
