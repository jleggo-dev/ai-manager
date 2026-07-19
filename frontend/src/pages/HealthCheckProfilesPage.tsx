import {
  Stack,
  Group,
  Text,
  Badge,
  Button,
  Table,
  Center,
  Loader,
  Modal,
  TextInput,
  Textarea,
  Select,
  SegmentedControl,
  Switch,
  Alert,
  ActionIcon,
  Tooltip,
  Code,
  Collapse,
} from '@mantine/core';
import {
  IconBrain,
  IconPlus,
  IconEdit,
  IconTrash,
  IconAlertCircle,
  IconChevronDown,
  IconChevronUp,
} from '@tabler/icons-react';
import PageHeader from '../components/atoms/PageHeader';
import { useHealthCheckProfilesData } from '../hooks/useHealthCheckProfilesData';

interface HealthCheckProfilesPageProps {
  onNavigate: (key: string, params?: Record<string, unknown>) => void;
  pageParams: Record<string, unknown>;
  workspaceRole?: string | null;
}

export default function HealthCheckProfilesPage({
  onNavigate: _onNavigate,
  pageParams: _pageParams,
  workspaceRole: _workspaceRole,
}: HealthCheckProfilesPageProps) {
  const {
    profiles,
    loading,
    saving,
    editing,
    form,
    formOpened,
    deleteTarget,
    deleteOpened,
    profileType,
    fetchingAis,
    advancedOpen,
    setAdvancedOpen,
    manualIdEntry,
    eligibleProviders,
    filteredKeys,
    isModelOnlyProvider,
    aiOptions,
    modelOptions,
    providerName,
    handleOpenCreate,
    handleOpenEdit,
    handleProviderChange,
    handleProfileTypeChange,
    handleAiSelect,
    handleModelSelect,
    handleSubmit,
    handleOpenDelete,
    handleConfirmDelete,
    handleCloseForm,
    handleCloseDelete,
    setField,
    toggleManualIdEntry,
  } = useHealthCheckProfilesData();

  if (loading)
    return (
      <Center py="xl">
        <Loader />
      </Center>
    );

  return (
    <Stack gap="md">
      <PageHeader title="Health Check Profiles">
        <Button leftSection={<IconPlus size={16} />} onClick={handleOpenCreate}>
          New Profile
        </Button>
      </PageHeader>

      {profiles.length === 0 ? (
        <Alert icon={<IconAlertCircle size={16} />} color="blue" variant="light">
          No health check profiles yet. Create one to start monitoring your AI providers.
        </Alert>
      ) : (
        <Table striped highlightOnHover withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Name</Table.Th>
              <Table.Th>Provider</Table.Th>
              <Table.Th>Model / Agent ID</Table.Th>
              <Table.Th>Mode</Table.Th>
              <Table.Th>Status</Table.Th>
              <Table.Th style={{ width: 100 }}>Actions</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {profiles.map((p) => (
              <Table.Tr key={p.id}>
                <Table.Td>
                  <Group gap="xs">
                    <IconBrain size={16} />
                    <Text size="sm" fw={500}>
                      {p.name}
                    </Text>
                  </Group>
                </Table.Td>
                <Table.Td>
                  <Text size="sm">{p.provider?.name ?? providerName(p.provider_id)}</Text>
                </Table.Td>
                <Table.Td>
                  <Code>{p.external_ai_id}</Code>
                </Table.Td>
                <Table.Td>
                  <Badge size="xs" variant="light">
                    {p.mode}
                  </Badge>
                </Table.Td>
                <Table.Td>
                  <Badge size="xs" variant="light" color={p.is_active ? 'green' : 'gray'}>
                    {p.is_active ? 'Active' : 'Inactive'}
                  </Badge>
                </Table.Td>
                <Table.Td>
                  <Group gap={4}>
                    <Tooltip label="Edit">
                      <ActionIcon variant="subtle" size="sm" aria-label="Edit" onClick={() => handleOpenEdit(p)}>
                        <IconEdit size={14} />
                      </ActionIcon>
                    </Tooltip>
                    <Tooltip label="Delete">
                      <ActionIcon
                        variant="subtle"
                        color="red"
                        size="sm"
                        aria-label="Delete"
                        onClick={() => handleOpenDelete(p)}
                      >
                        <IconTrash size={14} />
                      </ActionIcon>
                    </Tooltip>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}

      {/* Create / Edit Modal */}
      <Modal
        opened={formOpened}
        onClose={handleCloseForm}
        title={editing ? 'Edit Health Check Profile' : 'New Health Check Profile'}
        size="md"
      >
        <Stack gap="sm">
          <Select
            label="Provider"
            placeholder="Select a provider"
            required
            data={eligibleProviders.map((p) => ({ value: p.id, label: `${p.name} (${p.type})` }))}
            value={form.provider_id || null}
            onChange={handleProviderChange}
            searchable
          />

          {form.provider_id && (
            <SegmentedControl
              value={isModelOnlyProvider ? 'model' : profileType}
              onChange={handleProfileTypeChange}
              data={[
                { label: 'AI Agent', value: 'agent' },
                { label: 'AI Model', value: 'model' },
              ]}
              disabled={!!editing || isModelOnlyProvider}
              fullWidth
            />
          )}

          {form.provider_id && !fetchingAis && (
            <>
              {!manualIdEntry &&
                (isModelOnlyProvider ? 'model' : profileType) === 'agent' &&
                (aiOptions.length > 0 ? (
                  <Select
                    label="Available AI"
                    placeholder="Type to search agents..."
                    data={aiOptions}
                    value={form.external_ai_id || null}
                    onChange={handleAiSelect}
                    searchable
                    required
                  />
                ) : (
                  <TextInput
                    label="External AI ID"
                    placeholder="e.g. agent-abc123"
                    value={form.external_ai_id}
                    onChange={(e) => setField('external_ai_id', e.currentTarget.value)}
                    required
                  />
                ))}

              {!manualIdEntry &&
                (isModelOnlyProvider ? 'model' : profileType) === 'model' &&
                (modelOptions.length > 0 ? (
                  <Select
                    label="LLM Model"
                    placeholder="Type to search models..."
                    data={modelOptions}
                    value={form.external_ai_id || null}
                    onChange={handleModelSelect}
                    searchable
                    required
                  />
                ) : (
                  <TextInput
                    label="Model ID"
                    placeholder="e.g. gpt-4o or claude-sonnet-4-20250514"
                    value={form.external_ai_id}
                    onChange={(e) => setField('external_ai_id', e.currentTarget.value)}
                    required
                  />
                ))}

              {manualIdEntry && (
                <TextInput
                  label="External AI ID"
                  placeholder="Paste the AI ID, e.g. a843e28a-c616-4172-9594-a41ab7a8260b"
                  value={form.external_ai_id}
                  onChange={(e) => setField('external_ai_id', e.currentTarget.value)}
                  required
                />
              )}

              <Text size="xs" c="blue" style={{ cursor: 'pointer' }} onClick={toggleManualIdEntry}>
                {manualIdEntry ? '← Back to list' : "Can't find your AI? Enter ID manually"}
              </Text>
            </>
          )}

          {fetchingAis && form.provider_id && (
            <Center py="xs">
              <Loader size="sm" />
              <Text size="xs" c="dimmed" ml="xs">
                Loading available {profileType === 'agent' ? 'agents' : 'models'}…
              </Text>
            </Center>
          )}

          <TextInput
            label="Name"
            placeholder="e.g. GPT-4 Health Check"
            required
            value={form.name}
            onChange={(e) => setField('name', e.currentTarget.value)}
            description="Auto-filled from selection — edit to customize"
          />

          {/* Show provider key selector only when multiple keys exist */}
          {filteredKeys.length > 1 && (
            <Select
              label="Provider Key"
              placeholder="Select a key"
              required
              data={filteredKeys.map((k) => ({ value: k.id, label: k.name }))}
              value={form.hc_provider_key_id || null}
              onChange={(val) => setField('hc_provider_key_id', val ?? '')}
            />
          )}

          <Switch
            label="Active"
            checked={form.is_active}
            onChange={(e) => setField('is_active', e.currentTarget.checked)}
          />

          <Button
            variant="subtle"
            size="compact-sm"
            onClick={() => setAdvancedOpen((o) => !o)}
            rightSection={advancedOpen ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
          >
            Advanced Settings
          </Button>
          <Collapse in={advancedOpen}>
            <Stack gap="sm">
              <Select
                label="Mode"
                data={[
                  { value: 'completion', label: 'Completion' },
                  { value: 'chat', label: 'Chat' },
                ]}
                value={form.mode}
                onChange={(val) => setField('mode', val ?? 'completion')}
              />

              <Textarea
                label="Description"
                placeholder="Optional description"
                value={form.description}
                onChange={(e) => setField('description', e.currentTarget.value)}
                autosize
                minRows={2}
              />
            </Stack>
          </Collapse>

          <Group justify="flex-end" mt="md">
            <Button variant="default" onClick={handleCloseForm}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} loading={saving}>
              {editing ? 'Save Changes' : 'Create Profile'}
            </Button>
          </Group>
        </Stack>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal opened={deleteOpened} onClose={handleCloseDelete} title="Delete Health Check Profile" size="sm">
        <Stack gap="md">
          <Text size="sm">
            Are you sure you want to delete <strong>{deleteTarget?.name}</strong>?
          </Text>
          <Alert color="orange" variant="light" title="Linked data will be removed">
            The associated health check, all run history, and any incidents will also be permanently deleted.
          </Alert>
          <Group justify="flex-end">
            <Button variant="default" onClick={handleCloseDelete}>
              Cancel
            </Button>
            <Button color="red" onClick={handleConfirmDelete}>
              Delete Profile &amp; Health Check
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
