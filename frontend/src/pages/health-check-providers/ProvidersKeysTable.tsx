import { Table } from '@mantine/core';
import type { Provider, HcProviderKey } from '../../types/api';
import { ProviderKeyRow } from './ProviderKeyRow';

interface ProvidersKeysTableProps {
  providers: Provider[];
  getKeyForProvider: (providerId: string) => HcProviderKey | undefined;
  onConfigureKey: (providerId: string) => void;
  onEdit: (key: HcProviderKey) => void;
  onDelete: (key: HcProviderKey) => void;
}

export function ProvidersKeysTable({
  providers,
  getKeyForProvider,
  onConfigureKey,
  onEdit,
  onDelete,
}: ProvidersKeysTableProps) {
  return (
    <Table striped highlightOnHover>
      <Table.Thead>
        <Table.Tr>
          <Table.Th>Provider Name</Table.Th>
          <Table.Th>Provider Type</Table.Th>
          <Table.Th>HC Key Name</Table.Th>
          <Table.Th>Status</Table.Th>
          <Table.Th>Actions</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {providers.map((provider) => (
          <ProviderKeyRow
            key={provider.id}
            provider={provider}
            hcKey={getKeyForProvider(provider.id)}
            onConfigureKey={onConfigureKey}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        ))}
      </Table.Tbody>
    </Table>
  );
}
