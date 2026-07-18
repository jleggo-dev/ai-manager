/**
 * ai-profiles/McpToolsPanel
 * -----------------------------
 * Renders the "MCP Server Tools" list (OAuth connect/disconnect + refresh) for
 * an existing AI profile's Devs.ai agent, shown inside the profile form modal.
 * Extracted from AiProfileManager.tsx (FE-02) as a structural, behavior-preserving
 * move — no logic changes.
 */

import { Badge, Button, Center, Group, Loader, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconRefresh } from '@tabler/icons-react';
import * as api from '../../../services/api';
import type { AiProfile } from '../../../types/api';

export interface McpTool {
  id: string;
  name: string;
  type: string;
}

export interface ToolAuthEntry {
  name: string;
}

interface McpToolsPanelProps {
  editing: AiProfile;
  mcpTools: McpTool[];
  toolAuthStatus: ToolAuthEntry[];
  mcpLoading: boolean;
  onRefresh: (profileId: string) => void;
}

export default function McpToolsPanel({ editing, mcpTools, toolAuthStatus, mcpLoading, onRefresh }: McpToolsPanelProps) {
  return (
    <>
      <Text size="sm" fw={600} mt="sm">
        MCP Server Tools
      </Text>
      <Text size="xs" c="dimmed">
        External integrations (Gmail, Slack, etc.) configured on this AI agent in Devs.ai. OAuth status shows
        whether the user has authorized access.
      </Text>
      {mcpLoading && (
        <Center>
          <Loader size="sm" />
        </Center>
      )}
      {!mcpLoading && mcpTools.length === 0 && (
        <Text size="xs" c="dimmed" fs="italic">
          No MCP server tools configured on this agent. Configure them in the Devs.ai dashboard.
        </Text>
      )}
      {!mcpLoading &&
        mcpTools.map((tool) => {
          const authEntry = toolAuthStatus.find((a) => a.name === tool.name);
          const isConnected = !!authEntry;
          return (
            <Group key={tool.id} gap="xs" justify="space-between">
              <Group gap="xs">
                <Text size="sm">{tool.name}</Text>
                <Badge size="xs" variant="light" color={isConnected ? 'green' : 'orange'}>
                  {isConnected ? 'Connected' : 'Not connected'}
                </Badge>
              </Group>
              {!isConnected && (
                <Button
                  size="compact-xs"
                  variant="light"
                  onClick={async () => {
                    try {
                      const result = await api.initiateToolOAuth(editing.id, tool.id);
                      if (result?.authUrl) {
                        window.open(String(result.authUrl), '_blank', 'noopener');
                        notifications.show({
                          title: 'OAuth',
                          message: 'Authorization window opened. Complete the flow, then refresh.',
                          color: 'blue',
                        });
                      }
                    } catch (err: unknown) {
                      notifications.show({
                        title: 'OAuth Error',
                        message: err instanceof Error ? err.message : String(err),
                        color: 'red',
                      });
                    }
                  }}
                >
                  Connect
                </Button>
              )}
              {isConnected && (
                <Button
                  size="compact-xs"
                  variant="subtle"
                  color="red"
                  onClick={async () => {
                    try {
                      await api.deleteToolOAuthToken(editing.id, tool.id);
                      notifications.show({
                        title: 'Disconnected',
                        message: `${tool.name} OAuth token removed`,
                        color: 'yellow',
                      });
                      onRefresh(editing.id);
                    } catch (err: unknown) {
                      notifications.show({
                        title: 'Error',
                        message: err instanceof Error ? err.message : String(err),
                        color: 'red',
                      });
                    }
                  }}
                >
                  Disconnect
                </Button>
              )}
            </Group>
          );
        })}
      {!mcpLoading && (
        <Button
          size="compact-xs"
          variant="subtle"
          leftSection={<IconRefresh size={14} />}
          onClick={() => onRefresh(editing.id)}
        >
          Refresh tools
        </Button>
      )}
    </>
  );
}
