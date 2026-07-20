import {
  Group,
  Text,
  Button,
  Table,
  ScrollArea,
  Switch,
  ActionIcon,
  Loader,
  Center,
  Alert,
  Badge,
  Tooltip,
} from '@mantine/core';
import { IconTrash, IconRefresh } from '@tabler/icons-react';
import type { LlmModel } from '../../../types/api';
import { formatTimestamp } from '../../../lib/format';
import { CATEGORY_COLORS } from './categoryUtils';

interface ManageLlmsModelListProps {
  models: LlmModel[];
  filtered: LlmModel[];
  loading: boolean;
  search: string;
  lastRefreshAt: string;
  syncableProvider: boolean;
  syncing: boolean;
  grouped: Record<string, LlmModel[]>;
  sortedCategories: string[];
  onSyncFromProvider: () => void;
  onToggleActive: (model: LlmModel) => void;
  onDelete: (model: LlmModel) => void;
}

export function ManageLlmsModelList({
  models,
  filtered,
  loading,
  search,
  lastRefreshAt,
  syncableProvider,
  syncing,
  grouped,
  sortedCategories,
  onSyncFromProvider,
  onToggleActive,
  onDelete,
}: ManageLlmsModelListProps) {
  return (
    <>
      <Group gap="xs">
        <Text size="xs" c="dimmed">
          {models.length} total models
        </Text>
        {search && (
          <Text size="xs" c="dimmed">
            ({filtered.length} matching)
          </Text>
        )}
        {lastRefreshAt && (
          <Text size="xs" c="dimmed">
            Last refresh: {formatTimestamp(lastRefreshAt)}
          </Text>
        )}
        {syncableProvider && (
          <Button
            variant="light"
            size="xs"
            leftSection={<IconRefresh size={12} />}
            onClick={onSyncFromProvider}
            loading={syncing}
          >
            Refresh from Provider
          </Button>
        )}
      </Group>

      {loading ? (
        <Center py="lg">
          <Loader size="sm" />
        </Center>
      ) : filtered.length === 0 ? (
        <Alert color="blue" variant="light">
          {models.length === 0 ? 'No models registered for this provider.' : 'No models match the search.'}
        </Alert>
      ) : (
        <ScrollArea h={350}>
          <Table striped highlightOnHover withTableBorder withColumnBorders>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Model ID</Table.Th>
                <Table.Th>Display Name</Table.Th>
                <Table.Th>Category</Table.Th>
                <Table.Th w={70}>Active</Table.Th>
                <Table.Th w={50} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {sortedCategories.map((cat) =>
                (grouped[cat] ?? []).map((m) => (
                  <Table.Tr key={m.id}>
                    <Table.Td>
                      <Text size="xs" ff="monospace">
                        {m.model_id}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs">{m.display_name}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Badge size="xs" variant="light" color={CATEGORY_COLORS[cat] || 'gray'}>
                        {cat}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <Switch size="xs" checked={m.is_active} onChange={() => onToggleActive(m)} />
                    </Table.Td>
                    <Table.Td>
                      <Tooltip label="Remove model">
                        <ActionIcon size="xs" variant="subtle" color="red" onClick={() => onDelete(m)}>
                          <IconTrash size={12} />
                        </ActionIcon>
                      </Tooltip>
                    </Table.Td>
                  </Table.Tr>
                )),
              )}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      )}
    </>
  );
}
