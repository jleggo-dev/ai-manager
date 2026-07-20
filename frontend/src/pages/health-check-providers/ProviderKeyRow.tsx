import { Table, Group, Text, Badge, Button, ActionIcon, Tooltip } from '@mantine/core';
import { IconKey, IconPlus, IconEdit, IconTrash } from '@tabler/icons-react';
import type { Provider, HcProviderKey } from '../../types/api';

interface ProviderKeyRowProps {
  provider: Provider;
  hcKey: HcProviderKey | undefined;
  onConfigureKey: (providerId: string) => void;
  onEdit: (key: HcProviderKey) => void;
  onDelete: (key: HcProviderKey) => void;
}

export function ProviderKeyRow({ provider, hcKey, onConfigureKey, onEdit, onDelete }: ProviderKeyRowProps) {
  return (
    <Table.Tr>
      <Table.Td>{provider.name}</Table.Td>
      <Table.Td>
        <Badge variant="light" size="sm">
          {provider.type}
        </Badge>
      </Table.Td>
      <Table.Td>
        {hcKey ? (
          <Group gap="xs">
            <IconKey size={14} />
            <Text size="sm">{hcKey.name}</Text>
          </Group>
        ) : (
          <Text size="sm" c="dimmed">
            —
          </Text>
        )}
      </Table.Td>
      <Table.Td>
        {hcKey ? (
          <Badge color={hcKey.is_active ? 'green' : 'gray'} variant="filled" size="sm">
            {hcKey.is_active ? 'Active' : 'Inactive'}
          </Badge>
        ) : (
          <Button
            variant="subtle"
            size="xs"
            leftSection={<IconPlus size={14} />}
            onClick={() => onConfigureKey(provider.id)}
          >
            Configure Key
          </Button>
        )}
      </Table.Td>
      <Table.Td>
        {hcKey && (
          <Group gap="xs">
            <Tooltip label="Edit">
              <ActionIcon variant="subtle" onClick={() => onEdit(hcKey)}>
                <IconEdit size={16} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Delete">
              <ActionIcon variant="subtle" color="red" onClick={() => onDelete(hcKey)}>
                <IconTrash size={16} />
              </ActionIcon>
            </Tooltip>
          </Group>
        )}
      </Table.Td>
    </Table.Tr>
  );
}
