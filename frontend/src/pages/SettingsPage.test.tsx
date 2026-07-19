import type { ReactNode } from 'react';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MantineProvider } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import SettingsPage from './SettingsPage';
import * as api from '../services/api';

vi.mock('../services/api', () => ({
  healthCheck: vi.fn(),
  getSettingByKey: vi.fn(),
  upsertSetting: vi.fn(),
  listApiKeys: vi.fn(),
  createApiKey: vi.fn(),
  deleteApiKey: vi.fn(),
  listUserCredentials: vi.fn(),
  listProviders: vi.fn(),
  upsertUserCredential: vi.fn(),
  deleteUserCredential: vi.fn(),
  deleteUserData: vi.fn(),
}));

vi.mock('@mantine/notifications', () => ({
  notifications: { show: vi.fn() },
}));

vi.mock('../components/atoms/PageHeader', () => ({
  default: ({ title, children }: { title: string; children?: ReactNode }) => (
    <div data-testid="page-header">
      <span>{title}</span>
      {children}
    </div>
  ),
}));

const mockKey = {
  id: 'key-1',
  name: 'CI worker',
  key_prefix: 'aim_sk_abc12345',
  created_at: '2024-06-01T12:00:00.000Z',
  last_used_at: null as string | null,
  created_by: 'user-1',
};

function renderSettings(workspaceRole: string | null = 'admin', tab = 'api-keys') {
  return render(
    <MantineProvider>
      <SettingsPage onNavigate={vi.fn()} pageParams={{ tab }} workspaceRole={workspaceRole} />
    </MantineProvider>,
  );
}

describe('SettingsPage — API keys tab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    (api.listApiKeys as ReturnType<typeof vi.fn>).mockResolvedValue({ apiKeys: [mockKey] });
    (api.createApiKey as ReturnType<typeof vi.fn>).mockResolvedValue({
      apiKey: { ...mockKey, id: 'key-2', name: 'Partner' },
      secret: 'aim_sk_secret_once_only_value',
    });
    (api.deleteApiKey as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (api.healthCheck as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'ok', tables: {} });
    (api.getSettingByKey as ReturnType<typeof vi.fn>).mockResolvedValue(null);
  });

  it('lists existing API keys for an admin', async () => {
    renderSettings('admin');
    await waitFor(() => {
      expect(screen.getByText('CI worker')).toBeInTheDocument();
      expect(screen.getByText(/aim_sk_abc12345/)).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /Generate key/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Delete API key CI worker/i })).toBeInTheDocument();
  });

  it('creates a key and shows the one-time secret for copy', async () => {
    renderSettings('owner');
    await waitFor(() => expect(screen.getByLabelText(/New key name/i)).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/New key name/i), { target: { value: 'Partner' } });
    fireEvent.click(screen.getByRole('button', { name: /Generate key/i }));

    await waitFor(() => {
      expect(api.createApiKey).toHaveBeenCalledWith('Partner');
      expect(screen.getByText('aim_sk_secret_once_only_value')).toBeInTheDocument();
      expect(screen.getByText(/Copy this now/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Copy secret/i }));
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('aim_sk_secret_once_only_value');
    });
    expect(notifications.show).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'API key created', color: 'green' }),
    );
  });

  it('revokes (deletes) an API key', async () => {
    renderSettings('admin');
    await waitFor(() => expect(screen.getByText('CI worker')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /Delete API key CI worker/i }));

    await waitFor(() => {
      expect(api.deleteApiKey).toHaveBeenCalledWith('key-1');
      expect(notifications.show).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Key deleted', color: 'green' }),
      );
    });
  });

  it('hides create/delete for members and shows an explanation', async () => {
    renderSettings('member');
    await waitFor(() => {
      expect(screen.getByText('CI worker')).toBeInTheDocument();
      expect(screen.getByText(/Only workspace owners and admins can create or delete/i)).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: /Generate key/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Delete API key/i })).not.toBeInTheDocument();
    expect(api.createApiKey).not.toHaveBeenCalled();
    expect(api.deleteApiKey).not.toHaveBeenCalled();
  });

  it('opens the API keys tab from pageParams', async () => {
    renderSettings('admin', 'api-keys');
    await waitFor(() => {
      expect(screen.getByTestId('page-header')).toHaveTextContent('Settings');
      expect(screen.getByText('Integration API keys')).toBeInTheDocument();
    });
    // Backend URL card is mounted alongside the keys tab
    expect(within(document.body).getByText('Backend API URL')).toBeInTheDocument();
  });
});
