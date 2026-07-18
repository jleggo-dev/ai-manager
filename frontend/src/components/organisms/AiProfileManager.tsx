/**
 * Organism â€“ AiProfileManager
 * -----------------------------
 * Lists AI Profiles with CRUD and a test chat feature.
 * Supports creating profiles from available AIs (agent mode)
 * or from registered LLM model IDs (model mode).
 */

import { useState, useEffect } from 'react';
import {
  Stack,
  Group,
  Button,
  Modal,
  TextInput,
  Select,
  Switch,
  Textarea,
  Loader,
  Center,
  Alert,
  SimpleGrid,
  Text,
  Badge,
  Paper,
  ScrollArea,
  Drawer,
  ActionIcon,
  SegmentedControl,
  Title,
  CloseButton,
  Table,
  Tooltip,
  Checkbox,
  Menu,
  CopyButton,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import {
  IconPlus,
  IconAlertCircle,
  IconSettings,
  IconSearch,
  IconArrowsShuffle,
  IconLayoutGrid,
  IconList,
  IconEdit,
  IconTrash,
  IconDotsVertical,
  IconMessageCircle,
  IconStar,
  IconStarFilled,
  IconCheck,
} from '@tabler/icons-react';
import AiProfileCard from '../molecules/AiProfileCard';
import FailoverConfigModal from '../molecules/FailoverConfigModal';
import ManageLlmsModal from './ManageLlmsModal';
import TestChatPanel from './ai-profiles/TestChatPanel';
import McpToolsPanel, { type McpTool, type ToolAuthEntry } from './ai-profiles/McpToolsPanel';
import { useAiProfilesData } from './ai-profiles/hooks/useAiProfilesData';
import { useProfileListFilters } from './ai-profiles/hooks/useProfileListFilters';
import { useProfileBulkActions } from './ai-profiles/hooks/useProfileBulkActions';
import * as api from '../../services/api';
import type { AiProfile, LlmModel } from '../../types/api';
import {
  DEVS_AI_BUILTIN_TOOL_OPTIONS,
  DEVS_AI_V2_BUILTIN_TOOL_OPTIONS,
  DEVS_AI_V2_CHAT_MODE_OPTIONS,
  DEVS_AI_V2_THREAD_MODE_OPTIONS,
  DEFAULT_RUNTIME_OPTIONS,
  normaliseRuntimeOptions,
} from '../../lib/runtime-options';
import { isModelOnlyProviderType } from '../../lib/provider-types';

interface ProviderAi {
  id?: string;
  aiId?: string;
  name?: string;
}

interface ToolJobFormRow {
  jobSlug: string;
  exposeAs: string;
  description: string;
}

export default function AiProfileManager() {
  const { profiles, providers, loading, loadData, handleDelete, handleToggleDefault } = useAiProfilesData();
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<AiProfile | null>(null);
  const [availableAis, setAvailableAis] = useState<ProviderAi[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [modalOpened, { open: openModal, close: closeModal }] = useDisclosure(false);

  /* Test chat state */
  const [chatProfile, setChatProfile] = useState<AiProfile | null>(null);
  const [chatOpened, { open: openChat, close: closeChat }] = useDisclosure(false);

  /* Manage LLMs modal state */
  const [llmsOpened, { open: openLlms, close: closeLlms }] = useDisclosure(false);

  /* Failover config modal state */
  const [failoverProfile, setFailoverProfile] = useState<AiProfile | null>(null);
  const [failoverOpened, { open: openFailover, close: closeFailover }] = useDisclosure(false);

  /* Profile type toggle: 'agent' or 'model' */
  const [profileType, setProfileType] = useState('agent');
  const [mode, setMode] = useState('completion');
  const [availableModels, setAvailableModels] = useState<LlmModel[]>([]);

  /* MCP tools state (fetched dynamically from Devs.ai for saved profiles) */
  const [mcpTools, setMcpTools] = useState<McpTool[]>([]);
  const [toolAuthStatus, setToolAuthStatus] = useState<ToolAuthEntry[]>([]);
  const [mcpLoading, setMcpLoading] = useState(false);
  const [processingJobs, setProcessingJobs] = useState<Array<{ slug: string; name: string }>>([]);
  const [toolJobs, setToolJobs] = useState<ToolJobFormRow[]>([]);

  /* Form state */
  const [form, setForm] = useState({
    provider_id: '',
    external_ai_id: '',
    name: '',
    description: '',
    is_active: true,
    runtime_options: DEFAULT_RUNTIME_OPTIONS,
  });

  useEffect(() => {
    if (!modalOpened) return;
    api
      .listProcessingJobs({ limit: 200 })
      .then((result) => {
        setProcessingJobs(
          (result.data || []).map((j) => ({ slug: j.slug, name: j.name })).filter((j) => Boolean(j.slug)),
        );
      })
      .catch(() => setProcessingJobs([]));
  }, [modalOpened]);

  /* Fetch AIs or models whenever provider or profile type changes */
  useEffect(() => {
    if (!selectedProvider) {
      setAvailableAis([]);
      setAvailableModels([]);
      return;
    }

    let cancelled = false;

    const providerType = providers.find((p) => p.id === selectedProvider)?.type || '';

    const useModelList = isModelOnlyProviderType(providerType) || profileType === 'model';

    if (useModelList) {
      setAvailableAis([]);
      api
        .listProviderModels(selectedProvider)
        .then((models) => {
          if (!cancelled) setAvailableModels(Array.isArray(models) ? models : []);
        })
        .catch(() => {
          if (!cancelled) {
            setAvailableModels([]);
            notifications.show({
              title: 'Warning',
              message: 'Could not fetch models from provider',
              color: 'yellow',
            });
          }
        });
      return () => {
        cancelled = true;
      };
    }

    if (profileType === 'agent') {
      setAvailableModels([]);
      api
        .listProviderAis(selectedProvider)
        .then((ais) => {
          if (!cancelled) setAvailableAis(Array.isArray(ais) ? ais : []);
        })
        .catch(() => {
          if (!cancelled) {
            setAvailableAis([]);
            notifications.show({
              title: 'Warning',
              message: 'Could not fetch AIs from provider',
              color: 'yellow',
            });
          }
        });
    } else {
      setAvailableAis([]);
      api
        .listProviderModels(selectedProvider)
        .then((models) => {
          if (!cancelled) setAvailableModels(Array.isArray(models) ? models : []);
        })
        .catch(() => {
          if (!cancelled) {
            setAvailableModels([]);
            notifications.show({
              title: 'Warning',
              message: 'Could not fetch models from provider',
              color: 'yellow',
            });
          }
        });
    }

    return () => {
      cancelled = true;
    };
  }, [selectedProvider, profileType, providers]);

  /* When provider changes, update state and clear external_ai_id */
  function handleProviderChange(providerId: string | null) {
    const providerType = providers.find((p) => p.id === providerId)?.type || '';
    const modelOnly = isModelOnlyProviderType(providerType);
    if (modelOnly && profileType !== 'model') {
      setProfileType('model');
      const providerLabel = providers.find((p) => p.id === providerId)?.name || providerType;
      notifications.show({
        title: 'Model-only Provider',
        message: `${providerLabel} profiles use model mode only.`,
        color: 'blue',
      });
    }
    setSelectedProvider(providerId);
    setForm((prev) => ({
      ...prev,
      provider_id: providerId || '',
      external_ai_id: '',
    }));
  }

  /* When profile type toggles, update state and clear external_ai_id */
  function handleProfileTypeChange(type: string) {
    setProfileType(type);
    setForm((prev) => ({ ...prev, external_ai_id: '' }));
  }

  function openCreate() {
    setEditing(null);
    setProfileType('agent');
    setMode('completion');
    setMcpTools([]);
    setToolAuthStatus([]);
    setForm({
      provider_id: '',
      external_ai_id: '',
      name: '',
      description: '',
      is_active: true,
      runtime_options: DEFAULT_RUNTIME_OPTIONS,
    });
    setToolJobs([]);
    setAvailableAis([]);
    setAvailableModels([]);
    setSelectedProvider(null);
    openModal();
  }

  async function loadMcpTools(profileId: string, providerType: string) {
    if (providerType !== 'devs-ai') {
      setMcpTools([]);
      setToolAuthStatus([]);
      return;
    }
    setMcpLoading(true);
    try {
      const [tools, authStatus] = await Promise.all([
        api.listProfileTools(profileId).catch((): McpTool[] => []),
        api.listProfileToolAuthStatus(profileId).catch((): ToolAuthEntry[] => []),
      ]);
      const allTools: McpTool[] = Array.isArray(tools) ? tools : [];
      const mcpOnly = allTools.filter((t) => t.type === 'MCP_SERVER');
      setMcpTools(mcpOnly);
      setToolAuthStatus(Array.isArray(authStatus) ? authStatus : []);
    } catch {
      setMcpTools([]);
      setToolAuthStatus([]);
    } finally {
      setMcpLoading(false);
    }
  }

  function openEdit(profile: AiProfile) {
    setEditing(profile);
    const resolvedProviderId = profile.provider_id || profile.provider?.id || '';
    const resolvedProviderType =
      providers.find((p) => p.id === resolvedProviderId)?.type || profile.provider?.type || '';
    setProfileType(isModelOnlyProviderType(resolvedProviderType) ? 'model' : profile.profile_type || 'agent');
    setMode(profile.mode || 'completion');
    setSelectedProvider(resolvedProviderId || null);
    setForm({
      provider_id: resolvedProviderId,
      external_ai_id: profile.external_ai_id || '',
      name: profile.name || '',
      description: profile.description || '',
      is_active: profile.is_active !== false,
      runtime_options: normaliseRuntimeOptions(profile.runtime_options),
    });
    const cfg = (profile.config || {}) as { toolJobs?: ToolJobFormRow[] };
    setToolJobs(
      Array.isArray(cfg.toolJobs)
        ? cfg.toolJobs.map((t) => ({
            jobSlug: t.jobSlug || '',
            exposeAs: t.exposeAs || '',
            description: t.description || '',
          }))
        : [],
    );
    setMcpTools([]);
    setToolAuthStatus([]);
    loadMcpTools(profile.id, resolvedProviderType);
    openModal();
  }

  function openTestChat(profile: AiProfile) {
    setChatProfile(profile);
    openChat();
  }

  function openFailoverConfig(profile: AiProfile) {
    setFailoverProfile(profile);
    openFailover();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      setSaving(true);
      const providerType = providers.find((p) => p.id === form.provider_id)?.type || '';
      const payload: Record<string, unknown> = {
        ...form,
        profile_type: isModelOnlyProviderType(providerType) ? 'model' : profileType,
        mode,
        runtime_options: normaliseRuntimeOptions(form.runtime_options),
      };
      if (mode === 'chat') {
        const priorConfig = (editing?.config as Record<string, unknown> | undefined) || {};
        payload.config = {
          ...priorConfig,
          toolJobs: toolJobs.filter((t) => t.jobSlug.trim() && t.exposeAs.trim()),
        };
      }
      if (editing) {
        await api.updateAiProfile(editing.id, payload);
        notifications.show({
          title: 'Updated',
          message: 'AI profile updated',
          color: 'green',
        });
      } else {
        await api.createAiProfile(payload);
        notifications.show({
          title: 'Created',
          message: 'AI profile created',
          color: 'green',
        });
      }
      closeModal();
      await loadData();
    } catch (err: unknown) {
      notifications.show({
        title: 'Error',
        message: err instanceof Error ? err.message : String(err),
        color: 'red',
      });
    } finally {
      setSaving(false);
    }
  }

  /* â”€â”€ Toolbar: search, filter, sort, group-by â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
  const {
    search,
    setSearch,
    filterProvider,
    setFilterProvider,
    filterMode,
    setFilterMode,
    filterStatus,
    setFilterStatus,
    sortBy,
    setSortBy,
    groupBy,
    setGroupBy,
    providerFilterOptions,
    filteredAndGroupedProfiles,
    isFiltered,
    visibleCount,
  } = useProfileListFilters(profiles);
  const selectedProviderType = providers.find((p) => p.id === form.provider_id)?.type || '';
  const isModelOnlyProvider = isModelOnlyProviderType(selectedProviderType);
  const effectiveProfileType = isModelOnlyProvider ? 'model' : profileType;

  /* Build select options from available AIs (Devs.ai format) */
  const aiOptions = availableAis.map((ai) => ({
    value: ai.id || ai.aiId || String(ai),
    label: ai.name || ai.id || String(ai),
  }));

  /* Build select options from registered LLM models, grouped by category.
     Mantine v7 expects grouped data as { group, items } objects. */
  const modelOptions = (() => {
    const activeModels = availableModels.filter((m) => m.is_active);
    const groups: Record<string, { value: string; label: string }[]> = {};
    for (const m of activeModels) {
      const g = m.category || 'Other';
      if (!groups[g]) groups[g] = [];
      groups[g].push({
        value: m.model_id,
        label: m.display_name || m.model_id,
      });
    }
    return Object.entries(groups).map(([group, items]) => ({ group, items }));
  })();

  const providerOptions = providers.map((p) => ({
    value: p.id,
    label: `${p.name} (${p.type})`,
  }));

  function toggleDevsAiV2Tool(toolKey: string, enabled: boolean) {
    setForm((prev) => {
      const runtimeOptions = normaliseRuntimeOptions(prev.runtime_options, selectedProviderType);
      const currentTools = runtimeOptions.devs_ai_v2.built_in_tools;
      const nextTools: string[] = enabled
        ? Array.from(new Set<string>([...currentTools, toolKey]))
        : currentTools.filter((t: string) => t !== toolKey);
      return {
        ...prev,
        runtime_options: {
          ...runtimeOptions,
          devs_ai_v2: {
            ...runtimeOptions.devs_ai_v2,
            built_in_tools: nextTools,
          },
        },
      };
    });
  }

  function toggleDevsAiTool(toolKey: string, enabled: boolean) {
    setForm((prev) => {
      const runtimeOptions = normaliseRuntimeOptions(prev.runtime_options);
      const currentTools = runtimeOptions.devs_ai.built_in_tools;
      const nextTools: string[] = enabled
        ? Array.from(new Set<string>([...currentTools, toolKey]))
        : currentTools.filter((t: string) => t !== toolKey);
      return {
        ...prev,
        runtime_options: {
          ...runtimeOptions,
          devs_ai: {
            ...runtimeOptions.devs_ai,
            built_in_tools: nextTools,
          },
        },
      };
    });
  }

  const { viewMode, setViewMode, checkedProfileIds, toggleProfileChecked, toggleSelectAll } = useProfileBulkActions();

  if (loading)
    return (
      <Center py="xl">
        <Loader />
      </Center>
    );

  const profileCardProps = (p: AiProfile) => ({
    profile: p,
    onEdit: openEdit,
    onDelete: handleDelete,
    onTestChat: openTestChat,
    onToggleDefault: handleToggleDefault,
    onConfigureFailover: openFailoverConfig,
  });

  return (
    <Stack gap="md">
      {/* Action bar */}
      <Group justify="flex-end">
        <Button variant="light" leftSection={<IconSettings size={16} />} onClick={openLlms}>
          Manage LLMs
        </Button>
        <Button leftSection={<IconPlus size={16} />} onClick={openCreate}>
          Add AI Profile
        </Button>
      </Group>

      {/* Toolbar: search, filter, sort, group-by */}
      <Group gap="sm" wrap="wrap">
        <TextInput
          placeholder="Search profiles..."
          leftSection={<IconSearch size={14} />}
          rightSection={search ? <CloseButton size="sm" onClick={() => setSearch('')} /> : null}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          size="sm"
          style={{ flex: 1, minWidth: 180 }}
        />
        <Select
          size="sm"
          data={providerFilterOptions}
          value={filterProvider}
          onChange={(v) => setFilterProvider(v || 'all')}
          w={160}
          allowDeselect={false}
        />
        <SegmentedControl
          size="xs"
          value={filterMode}
          onChange={setFilterMode}
          data={[
            { label: 'All', value: 'all' },
            { label: 'Completion', value: 'completion' },
            { label: 'Chat', value: 'chat' },
          ]}
        />
        <SegmentedControl
          size="xs"
          value={filterStatus}
          onChange={setFilterStatus}
          data={[
            { label: 'All', value: 'all' },
            { label: 'Active', value: 'active' },
            { label: 'Inactive', value: 'inactive' },
          ]}
        />
        <Select
          size="sm"
          placeholder="Sort"
          data={[
            { value: 'name-asc', label: 'Name Aâ€“Z' },
            { value: 'name-desc', label: 'Name Zâ€“A' },
            { value: 'newest', label: 'Newest first' },
            { value: 'oldest', label: 'Oldest first' },
            { value: 'provider', label: 'Provider' },
          ]}
          value={sortBy}
          onChange={(v) => setSortBy(v || 'name-asc')}
          w={140}
          allowDeselect={false}
        />
        <Select
          size="sm"
          placeholder="Group by"
          data={[
            { value: 'none', label: 'No grouping' },
            { value: 'provider', label: 'Group by provider' },
            { value: 'mode', label: 'Group by mode' },
          ]}
          value={groupBy}
          onChange={(v) => setGroupBy(v || 'none')}
          w={160}
          allowDeselect={false}
        />
        <Group gap={4}>
          <Tooltip label="Card view">
            <ActionIcon
              variant={viewMode === 'grid' ? 'filled' : 'subtle'}
              onClick={() => setViewMode('grid')}
              size="sm"
            >
              <IconLayoutGrid size={16} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="List view">
            <ActionIcon
              variant={viewMode === 'list' ? 'filled' : 'subtle'}
              onClick={() => setViewMode('list')}
              size="sm"
            >
              <IconList size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>

      {/* Result count */}
      <Text size="sm" c="dimmed">
        {isFiltered
          ? `Showing ${visibleCount} of ${profiles.length} profiles`
          : `${profiles.length} profile${profiles.length !== 1 ? 's' : ''}`}
      </Text>

      {/* Profile display */}
      {profiles.length === 0 ? (
        <Alert icon={<IconAlertCircle size={16} />} color="blue" variant="light">
          No AI profiles configured. Add one to assign to processing jobs.
        </Alert>
      ) : visibleCount === 0 ? (
        <Alert icon={<IconAlertCircle size={16} />} color="gray" variant="light">
          No profiles match your filters.
        </Alert>
      ) : viewMode === 'list' ? (
        /* â”€â”€ List / Table View â”€â”€ */
        <Paper withBorder radius="md" style={{ overflow: 'hidden' }}>
          <ScrollArea>
            <Table striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th style={{ width: 36 }}>
                    <Checkbox
                      size="xs"
                      checked={checkedProfileIds.size > 0 && checkedProfileIds.size === visibleCount}
                      indeterminate={checkedProfileIds.size > 0 && checkedProfileIds.size < visibleCount}
                      onChange={() => {
                        const allVisible =
                          filteredAndGroupedProfiles.type === 'flat'
                            ? filteredAndGroupedProfiles.items.map((p) => p.id)
                            : filteredAndGroupedProfiles.groups.flatMap((g) => g.items.map((p) => p.id));
                        toggleSelectAll(allVisible);
                      }}
                    />
                  </Table.Th>
                  <Table.Th>Name</Table.Th>
                  <Table.Th>Profile ID</Table.Th>
                  <Table.Th>Provider</Table.Th>
                  <Table.Th>Model / Agent</Table.Th>
                  <Table.Th>Type</Table.Th>
                  <Table.Th>Mode</Table.Th>
                  <Table.Th>Status</Table.Th>
                  <Table.Th>Failover</Table.Th>
                  <Table.Th style={{ width: 80 }}>Actions</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {(filteredAndGroupedProfiles.type === 'flat'
                  ? filteredAndGroupedProfiles.items
                  : filteredAndGroupedProfiles.groups.flatMap((g) => g.items)
                ).map((p) => (
                  <Table.Tr
                    key={p.id}
                    bg={
                      checkedProfileIds.has(p.id)
                        ? 'var(--mantine-color-blue-0)'
                        : p.is_default
                          ? 'var(--mantine-color-yellow-0)'
                          : undefined
                    }
                  >
                    <Table.Td>
                      <Checkbox
                        size="xs"
                        checked={checkedProfileIds.has(p.id)}
                        onChange={() => toggleProfileChecked(p.id)}
                      />
                    </Table.Td>
                    <Table.Td>
                      <Group gap={4}>
                        <Text size="xs" fw={600}>
                          {p.name}
                        </Text>
                        {p.is_default && (
                          <Badge size="xs" variant="filled" color="yellow" c="dark">
                            Default
                          </Badge>
                        )}
                      </Group>
                    </Table.Td>
                    <Table.Td>
                      <CopyButton value={p.id}>
                        {({ copied, copy }) => (
                          <Tooltip label={copied ? 'Copied!' : 'Copy profile ID'} withArrow>
                            <Text
                              size="xs"
                              c={copied ? 'teal' : 'dimmed'}
                              style={{
                                cursor: 'pointer',
                                fontFamily: 'monospace',
                              }}
                              onClick={(e) => {
                                e.stopPropagation();
                                copy();
                              }}
                            >
                              {p.id.slice(0, 8)}â€¦{' '}
                              {copied && <IconCheck size={10} style={{ verticalAlign: 'middle' }} />}
                            </Text>
                          </Tooltip>
                        )}
                      </CopyButton>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs">{p.provider?.name || 'â€”'}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" ff="monospace" truncate style={{ maxWidth: 160 }}>
                        {p.external_ai_id}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Badge size="xs" variant="light" color={p.profile_type === 'model' ? 'violet' : 'teal'}>
                        {p.profile_type === 'model' ? 'Model' : 'Agent'}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <Badge size="xs" variant="light" color={p.mode === 'chat' ? 'orange' : 'teal'}>
                        {p.mode === 'chat' ? 'Chat' : 'Completion'}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <Badge size="xs" variant="light" color={p.is_active ? 'green' : 'gray'}>
                        {p.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      {p.failover_provider ? (
                        <Text size="xs" c="orange.7">
                          {p.failover_provider.name}
                        </Text>
                      ) : (
                        <Text size="xs" c="dimmed">
                          â€”
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <Menu shadow="md" width={160} position="bottom-end" withinPortal>
                        <Menu.Target>
                          <ActionIcon variant="subtle" size="sm">
                            <IconDotsVertical size={14} />
                          </ActionIcon>
                        </Menu.Target>
                        <Menu.Dropdown>
                          <Menu.Item leftSection={<IconEdit size={14} />} onClick={() => openEdit(p)}>
                            Edit
                          </Menu.Item>
                          <Menu.Item leftSection={<IconMessageCircle size={14} />} onClick={() => openTestChat(p)}>
                            Test chat
                          </Menu.Item>
                          <Menu.Item
                            leftSection={<IconArrowsShuffle size={14} />}
                            onClick={() => openFailoverConfig(p)}
                          >
                            Failover
                          </Menu.Item>
                          <Menu.Item
                            leftSection={p.is_default ? <IconStarFilled size={14} /> : <IconStar size={14} />}
                            onClick={() => handleToggleDefault(p.id, !p.is_default)}
                          >
                            {p.is_default ? 'Remove default' : 'Set default'}
                          </Menu.Item>
                          <Menu.Divider />
                          <Menu.Item
                            leftSection={<IconTrash size={14} />}
                            color="red"
                            onClick={() => handleDelete(p.id)}
                          >
                            Delete
                          </Menu.Item>
                        </Menu.Dropdown>
                      </Menu>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        </Paper>
      ) : filteredAndGroupedProfiles.type === 'flat' ? (
        /* â”€â”€ Card view (flat) â”€â”€ */
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
          {filteredAndGroupedProfiles.items.map((p) => (
            <AiProfileCard key={p.id} {...profileCardProps(p)} />
          ))}
        </SimpleGrid>
      ) : (
        /* â”€â”€ Card view (grouped) â”€â”€ */
        <Stack gap="lg">
          {filteredAndGroupedProfiles.groups.map((g) => (
            <Stack key={g.label} gap="xs">
              <Title order={5} c="dimmed">
                {g.label}
              </Title>
              <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
                {g.items.map((p) => (
                  <AiProfileCard key={p.id} {...profileCardProps(p)} />
                ))}
              </SimpleGrid>
            </Stack>
          ))}
        </Stack>
      )}

      {/* Create / Edit Modal */}
      <Modal opened={modalOpened} onClose={closeModal} title={editing ? 'Edit AI Profile' : 'New AI Profile'} size="md">
        <form onSubmit={handleSubmit}>
          <Stack gap="sm">
            {/* Profile type toggle â€” Agent vs Model */}
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

            <Text size="xs" c="dimmed">
              {isModelOnlyProvider
                ? 'Google Gemini uses model IDs directly (no provider-side agent objects).'
                : profileType === 'agent'
                  ? 'AI Agents are Devs.ai-configured agents with custom instructions and knowledge.'
                  : 'AI Models are raw LLM models accessed directly via model ID through the completions API.'}
            </Text>

            <SegmentedControl
              value={mode}
              onChange={setMode}
              data={[
                { label: 'Completion', value: 'completion' },
                { label: 'Chat', value: 'chat' },
              ]}
              fullWidth
            />
            <Text size="xs" c="dimmed">
              {mode === 'chat'
                ? 'Chat mode uses streaming responses for real-time interaction.'
                : 'Completion mode returns the full response in a single request.'}
            </Text>

            <Select
              data-testid="profile-provider-select"
              label="Provider"
              placeholder="Select a provider"
              data={providerOptions}
              value={form.provider_id}
              onChange={handleProviderChange}
              required
              disabled={!!editing}
            />

            {/* Agent mode: show AI select or manual input */}
            {effectiveProfileType === 'agent' &&
              (aiOptions.length > 0 ? (
                <Select
                  label="Available AI"
                  placeholder="Select an AI from the provider"
                  data={aiOptions}
                  value={form.external_ai_id}
                  onChange={(v) => {
                    const ai = availableAis.find((a) => (a.id || a.aiId) === v);
                    setForm((prev) => ({
                      ...prev,
                      external_ai_id: v || '',
                      name: prev.name || ai?.name || '',
                    }));
                  }}
                  searchable
                />
              ) : (
                <TextInput
                  label="External AI ID"
                  placeholder="AI UUID or model name"
                  value={form.external_ai_id}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      external_ai_id: e.target.value,
                    }))
                  }
                  required
                />
              ))}

            {/* Model mode: show model select from registered models */}
            {effectiveProfileType === 'model' &&
              (modelOptions.length > 0 ? (
                <Select
                  data-testid="profile-model-select"
                  label="LLM Model"
                  placeholder="Select a model"
                  data={modelOptions}
                  value={form.external_ai_id}
                  onChange={(v) => {
                    const model = availableModels.find((m) => m.model_id === v);
                    setForm((prev) => ({
                      ...prev,
                      external_ai_id: v || '',
                      name: prev.name || model?.display_name || '',
                    }));
                  }}
                  searchable
                />
              ) : (
                <TextInput
                  label="Model ID"
                  placeholder="e.g. gpt-5.2 or anthropic-claude-4-sonnet"
                  value={form.external_ai_id}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      external_ai_id: e.target.value,
                    }))
                  }
                  required
                />
              ))}

            {!form.external_ai_id && selectedProvider && effectiveProfileType === 'agent' && (
              <Text size="xs" c="dimmed">
                If the provider list is empty, enter the AI ID manually above.
              </Text>
            )}

            {!form.external_ai_id &&
              selectedProvider &&
              effectiveProfileType === 'model' &&
              availableModels.length === 0 && (
                <Text size="xs" c="dimmed">
                  No models registered for this provider. Use &quot;Manage LLMs&quot; to add models, or enter a model ID
                  manually.
                </Text>
              )}

            <Paper withBorder p="sm" radius="sm" style={{ borderLeft: '3px solid var(--mantine-color-orange-5)' }}>
              <Stack gap="xs">
                <Text size="sm" fw={600} c="orange.7">
                  Failover (optional)
                </Text>
                <Text size="xs" c="dimmed">
                  Failover activates when the primary model fails or returns empty content.
                </Text>
                {editing?.failover_provider && (
                  <Group gap="xs">
                    <Badge size="xs" color="orange" variant="light">
                      Active
                    </Badge>
                    <Text size="xs">
                      {editing.failover_provider.name} â€” <code>{editing.failover_external_ai_id}</code>
                    </Text>
                  </Group>
                )}
                {editing ? (
                  <Button
                    variant="light"
                    color="orange"
                    size="xs"
                    leftSection={<IconArrowsShuffle size={14} />}
                    onClick={() => {
                      closeModal();
                      openFailoverConfig(editing);
                    }}
                  >
                    {editing.failover_provider_id ? 'Edit Failover' : 'Configure Failover'}
                  </Button>
                ) : (
                  <Text size="xs" c="dimmed" fs="italic">
                    Save the profile first, then configure failover.
                  </Text>
                )}
              </Stack>
            </Paper>

            {selectedProviderType === 'devs-ai' && effectiveProfileType === 'model' && (
              <Paper withBorder p="sm" radius="sm">
                <Stack gap="xs">
                  <Text size="sm" fw={600}>
                    Devs.ai Runtime Options
                  </Text>
                  <Text size="xs" c="dimmed">
                    Enable built-in tools and chat options for this model profile.
                  </Text>
                  {DEVS_AI_BUILTIN_TOOL_OPTIONS.map((tool) => (
                    <Switch
                      key={tool.key}
                      size="sm"
                      label={tool.label}
                      checked={normaliseRuntimeOptions(form.runtime_options).devs_ai.built_in_tools.includes(tool.key)}
                      onChange={(e) => toggleDevsAiTool(tool.key, e.currentTarget.checked)}
                    />
                  ))}
                  <Switch
                    size="sm"
                    label="Generate Citations"
                    checked={normaliseRuntimeOptions(form.runtime_options).devs_ai.generate_citations}
                    onChange={(e) => {
                      const checked = e.currentTarget.checked;
                      setForm((prev) => {
                        const runtimeOptions = normaliseRuntimeOptions(prev.runtime_options);
                        return {
                          ...prev,
                          runtime_options: {
                            ...runtimeOptions,
                            devs_ai: {
                              ...runtimeOptions.devs_ai,
                              generate_citations: checked,
                            },
                          },
                        };
                      });
                    }}
                  />
                  <Switch
                    size="sm"
                    label="Parallel Tool Calls"
                    description="Allow the AI to invoke multiple tools simultaneously"
                    checked={normaliseRuntimeOptions(form.runtime_options).devs_ai.parallel_tool_calls}
                    onChange={(e) => {
                      const checked = e.currentTarget.checked;
                      setForm((prev) => {
                        const runtimeOptions = normaliseRuntimeOptions(prev.runtime_options);
                        return {
                          ...prev,
                          runtime_options: {
                            ...runtimeOptions,
                            devs_ai: {
                              ...runtimeOptions.devs_ai,
                              parallel_tool_calls: checked,
                            },
                          },
                        };
                      });
                    }}
                  />

                  {/* MCP Server Tools (dynamic, fetched from Devs.ai) */}
                  {editing && (
                    <McpToolsPanel
                      editing={editing}
                      mcpTools={mcpTools}
                      toolAuthStatus={toolAuthStatus}
                      mcpLoading={mcpLoading}
                      onRefresh={() => loadMcpTools(editing.id, 'devs-ai')}
                    />
                  )}
                </Stack>
              </Paper>
            )}

            {selectedProviderType === 'devs-ai-v2' && effectiveProfileType === 'model' && (
              <Paper withBorder p="sm" radius="sm">
                <Stack gap="xs">
                  <Text size="sm" fw={600}>
                    Devs.ai v2 Runtime Options
                  </Text>
                  <Text size="xs" c="dimmed">
                    Responses API v2 â€” built-in tools, chat mode, and threading behavior.
                  </Text>
                  {DEVS_AI_V2_BUILTIN_TOOL_OPTIONS.map((tool) => (
                    <Switch
                      key={tool.key}
                      size="sm"
                      label={tool.label}
                      checked={normaliseRuntimeOptions(
                        form.runtime_options,
                        'devs-ai-v2',
                      ).devs_ai_v2.built_in_tools.includes(tool.key)}
                      onChange={(e) => toggleDevsAiV2Tool(tool.key, e.currentTarget.checked)}
                    />
                  ))}
                  <Select
                    label="Chat mode"
                    size="xs"
                    data={[...DEVS_AI_V2_CHAT_MODE_OPTIONS]}
                    value={normaliseRuntimeOptions(form.runtime_options, 'devs-ai-v2').devs_ai_v2.chat_mode}
                    onChange={(val) => {
                      if (!val) return;
                      setForm((prev) => {
                        const runtimeOptions = normaliseRuntimeOptions(prev.runtime_options, 'devs-ai-v2');
                        return {
                          ...prev,
                          runtime_options: {
                            ...runtimeOptions,
                            devs_ai_v2: {
                              ...runtimeOptions.devs_ai_v2,
                              chat_mode: val as 'execute' | 'chat' | 'plan',
                            },
                          },
                        };
                      });
                    }}
                  />
                  <Select
                    label="Thread mode"
                    size="xs"
                    data={[...DEVS_AI_V2_THREAD_MODE_OPTIONS]}
                    value={normaliseRuntimeOptions(form.runtime_options, 'devs-ai-v2').devs_ai_v2.thread_mode}
                    onChange={(val) => {
                      if (!val) return;
                      setForm((prev) => {
                        const runtimeOptions = normaliseRuntimeOptions(prev.runtime_options, 'devs-ai-v2');
                        return {
                          ...prev,
                          runtime_options: {
                            ...runtimeOptions,
                            devs_ai_v2: {
                              ...runtimeOptions.devs_ai_v2,
                              thread_mode: val as 'collect' | 'steer' | 'interrupt' | 'force',
                            },
                          },
                        };
                      });
                    }}
                  />
                  <Switch
                    size="sm"
                    label="Parallel Tool Calls"
                    checked={normaliseRuntimeOptions(form.runtime_options, 'devs-ai-v2').devs_ai_v2.parallel_tool_calls}
                    onChange={(e) => {
                      const checked = e.currentTarget.checked;
                      setForm((prev) => {
                        const runtimeOptions = normaliseRuntimeOptions(prev.runtime_options, 'devs-ai-v2');
                        return {
                          ...prev,
                          runtime_options: {
                            ...runtimeOptions,
                            devs_ai_v2: {
                              ...runtimeOptions.devs_ai_v2,
                              parallel_tool_calls: checked,
                            },
                          },
                        };
                      });
                    }}
                  />
                </Stack>
              </Paper>
            )}

            {selectedProviderType === 'google-gemini' && (
              <Paper withBorder p="sm" radius="sm">
                <Stack gap="xs">
                  <Text size="sm" fw={600}>
                    Google Gemini Runtime Options
                  </Text>
                  <Text size="xs" c="dimmed">
                    Grounding with Google Search allows the model to retrieve web results when needed.
                  </Text>
                  <Switch
                    size="sm"
                    label="Grounding with Google Search"
                    checked={normaliseRuntimeOptions(form.runtime_options).google_gemini.grounding_with_google_search}
                    onChange={(e) => {
                      const checked = e.currentTarget.checked;
                      setForm((prev) => {
                        const runtimeOptions = normaliseRuntimeOptions(prev.runtime_options);
                        return {
                          ...prev,
                          runtime_options: {
                            ...runtimeOptions,
                            google_gemini: {
                              ...runtimeOptions.google_gemini,
                              grounding_with_google_search: checked,
                            },
                          },
                        };
                      });
                    }}
                  />
                </Stack>
              </Paper>
            )}

            {mode === 'chat' && (
              <Paper withBorder p="sm" radius="sm">
                <Stack gap="sm">
                  <Text size="sm" fw={600}>
                    Jobs as tools
                  </Text>
                  <Text size="xs" c="dimmed">
                    Expose processing jobs as model-callable tools. AI Admin runs the linked job server-side when the
                    model invokes the tool (devs-ai v1 tool.call or devs-ai-v2 function_call).
                  </Text>
                  {toolJobs.length === 0 && (
                    <Text size="xs" c="dimmed">
                      No tool jobs configured.
                    </Text>
                  )}
                  {toolJobs.map((row, index) => (
                    <Group key={`tool-job-${index}`} align="flex-end" wrap="nowrap">
                      <Select
                        label="Processing job"
                        placeholder="Select job"
                        searchable
                        style={{ flex: 1 }}
                        data={processingJobs.map((j) => ({
                          value: j.slug,
                          label: `${j.name} (${j.slug})`,
                        }))}
                        value={row.jobSlug || null}
                        onChange={(value) =>
                          setToolJobs((prev) => prev.map((r, i) => (i === index ? { ...r, jobSlug: value || '' } : r)))
                        }
                      />
                      <TextInput
                        label="Expose as"
                        placeholder="tool_name"
                        style={{ flex: 1 }}
                        value={row.exposeAs}
                        onChange={(e) =>
                          setToolJobs((prev) =>
                            prev.map((r, i) => (i === index ? { ...r, exposeAs: e.currentTarget.value } : r)),
                          )
                        }
                      />
                      <TextInput
                        label="Description"
                        placeholder="Optional"
                        style={{ flex: 1 }}
                        value={row.description}
                        onChange={(e) =>
                          setToolJobs((prev) =>
                            prev.map((r, i) => (i === index ? { ...r, description: e.currentTarget.value } : r)),
                          )
                        }
                      />
                      <ActionIcon
                        color="red"
                        variant="subtle"
                        aria-label="Remove tool job"
                        onClick={() => setToolJobs((prev) => prev.filter((_, i) => i !== index))}
                      >
                        <IconTrash size={16} />
                      </ActionIcon>
                    </Group>
                  ))}
                  <Button
                    variant="light"
                    size="xs"
                    leftSection={<IconPlus size={14} />}
                    onClick={() => setToolJobs((prev) => [...prev, { jobSlug: '', exposeAs: '', description: '' }])}
                  >
                    Add tool job
                  </Button>
                </Stack>
              </Paper>
            )}

            <TextInput
              data-testid="profile-name-input"
              label="Profile Name"
              placeholder={effectiveProfileType === 'agent' ? 'e.g. GPT-5.2 Generic' : 'e.g. Claude 4 Sonnet'}
              value={form.name}
              onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
              required
            />
            <Textarea
              label="Description (optional)"
              value={form.description}
              onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
              minRows={2}
            />
            <Switch
              label="Active"
              checked={form.is_active}
              onChange={(e) => {
                const v = e.currentTarget.checked;
                setForm((prev) => ({ ...prev, is_active: v }));
              }}
            />
            <Group justify="flex-end">
              <Button variant="subtle" onClick={closeModal}>
                Cancel
              </Button>
              <Button type="submit" loading={saving}>
                {editing ? 'Update' : 'Create'}
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>

      {/* Test Chat Drawer */}
      <Drawer
        opened={chatOpened}
        onClose={closeChat}
        title={`Test Chat â€” ${chatProfile?.name || ''}`}
        position="right"
        size="lg"
      >
        {chatProfile && (
          <TestChatPanel profileId={chatProfile.id} profileName={chatProfile.name} profile={chatProfile} />
        )}
      </Drawer>

      {/* Manage LLMs Modal */}
      <ManageLlmsModal opened={llmsOpened} onClose={closeLlms} providers={providers} />

      {/* Failover Config Modal */}
      <FailoverConfigModal
        opened={failoverOpened}
        onClose={closeFailover}
        profile={failoverProfile}
        providers={providers}
        onSaved={() => {
          loadData();
          setFailoverProfile(null);
        }}
      />
    </Stack>
  );
}
