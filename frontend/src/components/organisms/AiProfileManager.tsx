/**
 * Organism – AiProfileManager
 * -----------------------------
 * Lists AI Profiles with CRUD and a test chat feature.
 * Supports creating profiles from available AIs (agent mode)
 * or from registered LLM model IDs (model mode).
 */

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import useConfirm from "../../hooks/useConfirm";
import { getSessionUser } from "../../lib/auth-session";
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
  Code,
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
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
  IconPlus,
  IconAlertCircle,
  IconSend,
  IconSettings,
  IconFlask2,
  IconRefresh,
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
} from "@tabler/icons-react";
import AiProfileCard from "../molecules/AiProfileCard";
import FailoverConfigModal from "../molecules/FailoverConfigModal";
import ManageLlmsModal from "./ManageLlmsModal";
import * as api from "../../services/api";
import type { AiProfile, Provider, LlmModel } from "../../types/api";
import {
  DEVS_AI_BUILTIN_TOOL_OPTIONS,
  DEVS_AI_V2_BUILTIN_TOOL_OPTIONS,
  DEVS_AI_V2_CHAT_MODE_OPTIONS,
  DEVS_AI_V2_THREAD_MODE_OPTIONS,
  DEFAULT_RUNTIME_OPTIONS,
  normaliseRuntimeOptions,
} from "../../lib/runtime-options";
import { isModelOnlyProviderType } from "../../lib/provider-types";

interface ProviderAi {
  id?: string;
  aiId?: string;
  name?: string;
}

interface McpTool {
  id: string;
  name: string;
  type: string;
}

interface ToolAuthEntry {
  name: string;
}

interface TestChatMessage {
  id?: string;
  role: string;
  content?: string;
  streaming?: boolean;
  meta?: {
    duration?: number;
    model?: string;
    usage?: { prompt_tokens: number; completion_tokens: number };
  };
  toolEvent?: string;
  toolName?: string;
  toolCallId?: string;
  arguments?: Record<string, unknown>;
  status?: string;
  output?: string | Record<string, unknown>;
  requiresAuth?: boolean;
  requiresUserAction?: boolean;
  messageId?: string;
}

interface PendingAuth {
  toolCallId: string;
  messageId: string;
  authUrl: string | null;
}

interface ToolJobFormRow {
  jobSlug: string;
  exposeAs: string;
  description: string;
}

interface TestChatApiResult {
  content: string;
  durationMs?: number;
  model?: string;
  usage?: { prompt_tokens: number; completion_tokens: number };
}

interface TestChatPanelProps {
  profileId: string;
  profileName: string;
  profile: AiProfile;
}

export default function AiProfileManager() {
  const confirm = useConfirm();
  const [profiles, setProfiles] = useState<AiProfile[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<AiProfile | null>(null);
  const [availableAis, setAvailableAis] = useState<ProviderAi[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [modalOpened, { open: openModal, close: closeModal }] =
    useDisclosure(false);

  /* Test chat state */
  const [chatProfile, setChatProfile] = useState<AiProfile | null>(null);
  const [chatOpened, { open: openChat, close: closeChat }] =
    useDisclosure(false);

  /* Manage LLMs modal state */
  const [llmsOpened, { open: openLlms, close: closeLlms }] =
    useDisclosure(false);

  /* Failover config modal state */
  const [failoverProfile, setFailoverProfile] = useState<AiProfile | null>(
    null,
  );
  const [failoverOpened, { open: openFailover, close: closeFailover }] =
    useDisclosure(false);

  /* Profile type toggle: 'agent' or 'model' */
  const [profileType, setProfileType] = useState("agent");
  const [mode, setMode] = useState("completion");
  const [availableModels, setAvailableModels] = useState<LlmModel[]>([]);

  /* MCP tools state (fetched dynamically from Devs.ai for saved profiles) */
  const [mcpTools, setMcpTools] = useState<McpTool[]>([]);
  const [toolAuthStatus, setToolAuthStatus] = useState<ToolAuthEntry[]>([]);
  const [mcpLoading, setMcpLoading] = useState(false);
  const [processingJobs, setProcessingJobs] = useState<
    Array<{ slug: string; name: string }>
  >([]);
  const [toolJobs, setToolJobs] = useState<ToolJobFormRow[]>([]);

  /* Form state */
  const [form, setForm] = useState({
    provider_id: "",
    external_ai_id: "",
    name: "",
    description: "",
    is_active: true,
    runtime_options: DEFAULT_RUNTIME_OPTIONS,
  });

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [profilesResult, providersResult] = await Promise.all([
        api.listAiProfiles(),
        api.listProviders(),
      ]);
      setProfiles(profilesResult.data);
      setProviders(providersResult.data);
    } catch (err: unknown) {
      notifications.show({
        title: "Error",
        message: err instanceof Error ? err.message : String(err),
        color: "red",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (!modalOpened) return;
    api
      .listProcessingJobs({ limit: 200 })
      .then((result) => {
        setProcessingJobs(
          (result.data || [])
            .map((j) => ({ slug: j.slug, name: j.name }))
            .filter((j) => Boolean(j.slug)),
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

    const providerType =
      providers.find((p) => p.id === selectedProvider)?.type || "";

    const useModelList =
      isModelOnlyProviderType(providerType) || profileType === "model";

    if (useModelList) {
      setAvailableAis([]);
      api
        .listProviderModels(selectedProvider)
        .then((models) => {
          if (!cancelled)
            setAvailableModels(Array.isArray(models) ? models : []);
        })
        .catch(() => {
          if (!cancelled) {
            setAvailableModels([]);
            notifications.show({
              title: "Warning",
              message: "Could not fetch models from provider",
              color: "yellow",
            });
          }
        });
      return () => {
        cancelled = true;
      };
    }

    if (profileType === "agent") {
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
              title: "Warning",
              message: "Could not fetch AIs from provider",
              color: "yellow",
            });
          }
        });
    } else {
      setAvailableAis([]);
      api
        .listProviderModels(selectedProvider)
        .then((models) => {
          if (!cancelled)
            setAvailableModels(Array.isArray(models) ? models : []);
        })
        .catch(() => {
          if (!cancelled) {
            setAvailableModels([]);
            notifications.show({
              title: "Warning",
              message: "Could not fetch models from provider",
              color: "yellow",
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
    const providerType = providers.find((p) => p.id === providerId)?.type || "";
    const modelOnly = isModelOnlyProviderType(providerType);
    if (modelOnly && profileType !== "model") {
      setProfileType("model");
      const providerLabel =
        providers.find((p) => p.id === providerId)?.name || providerType;
      notifications.show({
        title: "Model-only Provider",
        message: `${providerLabel} profiles use model mode only.`,
        color: "blue",
      });
    }
    setSelectedProvider(providerId);
    setForm((prev) => ({
      ...prev,
      provider_id: providerId || "",
      external_ai_id: "",
    }));
  }

  /* When profile type toggles, update state and clear external_ai_id */
  function handleProfileTypeChange(type: string) {
    setProfileType(type);
    setForm((prev) => ({ ...prev, external_ai_id: "" }));
  }

  function openCreate() {
    setEditing(null);
    setProfileType("agent");
    setMode("completion");
    setMcpTools([]);
    setToolAuthStatus([]);
    setForm({
      provider_id: "",
      external_ai_id: "",
      name: "",
      description: "",
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
    if (providerType !== "devs-ai") {
      setMcpTools([]);
      setToolAuthStatus([]);
      return;
    }
    setMcpLoading(true);
    try {
      const [tools, authStatus] = await Promise.all([
        api.listProfileTools(profileId).catch((): McpTool[] => []),
        api
          .listProfileToolAuthStatus(profileId)
          .catch((): ToolAuthEntry[] => []),
      ]);
      const allTools: McpTool[] = Array.isArray(tools) ? tools : [];
      const mcpOnly = allTools.filter((t) => t.type === "MCP_SERVER");
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
    const resolvedProviderId =
      profile.provider_id || profile.provider?.id || "";
    const resolvedProviderType =
      providers.find((p) => p.id === resolvedProviderId)?.type ||
      profile.provider?.type ||
      "";
    setProfileType(
      isModelOnlyProviderType(resolvedProviderType)
        ? "model"
        : profile.profile_type || "agent",
    );
    setMode(profile.mode || "completion");
    setSelectedProvider(resolvedProviderId || null);
    setForm({
      provider_id: resolvedProviderId,
      external_ai_id: profile.external_ai_id || "",
      name: profile.name || "",
      description: profile.description || "",
      is_active: profile.is_active !== false,
      runtime_options: normaliseRuntimeOptions(profile.runtime_options),
    });
    const cfg = (profile.config || {}) as { toolJobs?: ToolJobFormRow[] };
    setToolJobs(
      Array.isArray(cfg.toolJobs)
        ? cfg.toolJobs.map((t) => ({
            jobSlug: t.jobSlug || "",
            exposeAs: t.exposeAs || "",
            description: t.description || "",
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
      const providerType =
        providers.find((p) => p.id === form.provider_id)?.type || "";
      const payload: Record<string, unknown> = {
        ...form,
        profile_type: isModelOnlyProviderType(providerType)
          ? "model"
          : profileType,
        mode,
        runtime_options: normaliseRuntimeOptions(form.runtime_options),
      };
      if (mode === "chat") {
        const priorConfig =
          (editing?.config as Record<string, unknown> | undefined) || {};
        payload.config = {
          ...priorConfig,
          toolJobs: toolJobs.filter(
            (t) => t.jobSlug.trim() && t.exposeAs.trim(),
          ),
        };
      }
      if (editing) {
        await api.updateAiProfile(editing.id, payload);
        notifications.show({
          title: "Updated",
          message: "AI profile updated",
          color: "green",
        });
      } else {
        await api.createAiProfile(payload);
        notifications.show({
          title: "Created",
          message: "AI profile created",
          color: "green",
        });
      }
      closeModal();
      await loadData();
    } catch (err: unknown) {
      notifications.show({
        title: "Error",
        message: err instanceof Error ? err.message : String(err),
        color: "red",
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (
      !(await confirm({
        title: "Delete AI profile",
        message: "This can't be undone.",
      }))
    )
      return;
    try {
      await api.deleteAiProfile(id);
      notifications.show({
        title: "Deleted",
        message: "AI profile removed",
        color: "orange",
      });
      await loadData();
    } catch (err: unknown) {
      notifications.show({
        title: "Error",
        message: err instanceof Error ? err.message : String(err),
        color: "red",
      });
    }
  }

  /** Toggle the is_default flag on a profile (only-one-default pattern) */
  async function handleToggleDefault(id: string, setAsDefault: boolean) {
    try {
      if (setAsDefault) {
        await api.setAiProfileDefault(id);
        notifications.show({
          title: "Default Set",
          message: "This profile is now the default",
          color: "yellow",
        });
      } else {
        await api.clearAiProfileDefault(id);
        notifications.show({
          title: "Default Cleared",
          message: "Default profile removed",
          color: "gray",
        });
      }
      await loadData();
    } catch (err: unknown) {
      notifications.show({
        title: "Error",
        message: err instanceof Error ? err.message : String(err),
        color: "red",
      });
    }
  }

  /* ── Toolbar: search, filter, sort, group-by ──────────────── */
  const [search, setSearch] = useState("");
  const [filterProvider, setFilterProvider] = useState("all");
  const [filterMode, setFilterMode] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [sortBy, setSortBy] = useState("name-asc");
  const [groupBy, setGroupBy] = useState("none");

  const providerFilterOptions = useMemo(() => {
    const seen = new Map();
    for (const p of profiles) {
      const prov = p.provider;
      if (prov?.id && !seen.has(prov.id))
        seen.set(prov.id, prov.name || prov.type);
    }
    return [
      { value: "all", label: "All providers" },
      ...Array.from(seen.entries()).map(([id, name]) => ({
        value: id,
        label: name,
      })),
    ];
  }, [profiles]);

  const filteredAndGroupedProfiles = useMemo(() => {
    const term = search.toLowerCase().trim();
    let list = profiles;

    if (term) {
      list = list.filter((p) => {
        const haystack = [
          p.name,
          p.description,
          p.external_ai_id,
          p.provider?.name,
          p.provider?.type,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(term);
      });
    }
    if (filterProvider !== "all") {
      list = list.filter((p) => p.provider?.id === filterProvider);
    }
    if (filterMode !== "all") {
      list = list.filter((p) => (p.mode || "completion") === filterMode);
    }
    if (filterStatus !== "all") {
      const wantActive = filterStatus === "active";
      list = list.filter((p) => p.is_active === wantActive);
    }

    const sortFn =
      (
        {
          "name-asc": (a: AiProfile, b: AiProfile) =>
            (a.name || "").localeCompare(b.name || ""),
          "name-desc": (a: AiProfile, b: AiProfile) =>
            (b.name || "").localeCompare(a.name || ""),
          newest: (a: AiProfile, b: AiProfile) =>
            new Date(b.created_at || 0).getTime() -
            new Date(a.created_at || 0).getTime(),
          oldest: (a: AiProfile, b: AiProfile) =>
            new Date(a.created_at || 0).getTime() -
            new Date(b.created_at || 0).getTime(),
          provider: (a: AiProfile, b: AiProfile) =>
            (a.provider?.name || "").localeCompare(b.provider?.name || ""),
        } as Record<string, (a: AiProfile, b: AiProfile) => number>
      )[sortBy] || null;
    if (sortFn) list = [...list].sort(sortFn);

    if (groupBy === "none") return { type: "flat" as const, items: list };

    const groups = new Map<string, { label: string; items: AiProfile[] }>();
    for (const p of list) {
      let key: string;
      let label: string;
      if (groupBy === "provider") {
        key = p.provider?.id || "unknown";
        label = p.provider?.name || "Unknown Provider";
      } else {
        key = p.mode || "completion";
        label = key === "chat" ? "Chat" : "Completion";
      }
      if (!groups.has(key)) groups.set(key, { label, items: [] });
      groups.get(key)?.items.push(p);
    }
    return { type: "grouped" as const, groups: Array.from(groups.values()) };
  }, [
    profiles,
    search,
    filterProvider,
    filterMode,
    filterStatus,
    sortBy,
    groupBy,
  ]);

  const isFiltered =
    search ||
    filterProvider !== "all" ||
    filterMode !== "all" ||
    filterStatus !== "all";
  const visibleCount =
    filteredAndGroupedProfiles.type === "flat"
      ? filteredAndGroupedProfiles.items.length
      : filteredAndGroupedProfiles.groups.reduce(
          (sum, g) => sum + g.items.length,
          0,
        );

  const selectedProviderType =
    providers.find((p) => p.id === form.provider_id)?.type || "";
  const isModelOnlyProvider = isModelOnlyProviderType(selectedProviderType);
  const effectiveProfileType = isModelOnlyProvider ? "model" : profileType;

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
      const g = m.category || "Other";
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
      const runtimeOptions = normaliseRuntimeOptions(
        prev.runtime_options,
        selectedProviderType,
      );
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

  const [viewMode, setViewMode] = useState("list");
  const [checkedProfileIds, setCheckedProfileIds] = useState<Set<string>>(
    new Set(),
  );

  function toggleProfileChecked(id: string) {
    setCheckedProfileIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

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
        <Button
          variant="light"
          leftSection={<IconSettings size={16} />}
          onClick={openLlms}
        >
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
          rightSection={
            search ? (
              <CloseButton size="sm" onClick={() => setSearch("")} />
            ) : null
          }
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          size="sm"
          style={{ flex: 1, minWidth: 180 }}
        />
        <Select
          size="sm"
          data={providerFilterOptions}
          value={filterProvider}
          onChange={(v) => setFilterProvider(v || "all")}
          w={160}
          allowDeselect={false}
        />
        <SegmentedControl
          size="xs"
          value={filterMode}
          onChange={setFilterMode}
          data={[
            { label: "All", value: "all" },
            { label: "Completion", value: "completion" },
            { label: "Chat", value: "chat" },
          ]}
        />
        <SegmentedControl
          size="xs"
          value={filterStatus}
          onChange={setFilterStatus}
          data={[
            { label: "All", value: "all" },
            { label: "Active", value: "active" },
            { label: "Inactive", value: "inactive" },
          ]}
        />
        <Select
          size="sm"
          placeholder="Sort"
          data={[
            { value: "name-asc", label: "Name A–Z" },
            { value: "name-desc", label: "Name Z–A" },
            { value: "newest", label: "Newest first" },
            { value: "oldest", label: "Oldest first" },
            { value: "provider", label: "Provider" },
          ]}
          value={sortBy}
          onChange={(v) => setSortBy(v || "name-asc")}
          w={140}
          allowDeselect={false}
        />
        <Select
          size="sm"
          placeholder="Group by"
          data={[
            { value: "none", label: "No grouping" },
            { value: "provider", label: "Group by provider" },
            { value: "mode", label: "Group by mode" },
          ]}
          value={groupBy}
          onChange={(v) => setGroupBy(v || "none")}
          w={160}
          allowDeselect={false}
        />
        <Group gap={4}>
          <Tooltip label="Card view">
            <ActionIcon
              variant={viewMode === "grid" ? "filled" : "subtle"}
              onClick={() => setViewMode("grid")}
              size="sm"
            >
              <IconLayoutGrid size={16} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="List view">
            <ActionIcon
              variant={viewMode === "list" ? "filled" : "subtle"}
              onClick={() => setViewMode("list")}
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
          : `${profiles.length} profile${profiles.length !== 1 ? "s" : ""}`}
      </Text>

      {/* Profile display */}
      {profiles.length === 0 ? (
        <Alert
          icon={<IconAlertCircle size={16} />}
          color="blue"
          variant="light"
        >
          No AI profiles configured. Add one to assign to processing jobs.
        </Alert>
      ) : visibleCount === 0 ? (
        <Alert
          icon={<IconAlertCircle size={16} />}
          color="gray"
          variant="light"
        >
          No profiles match your filters.
        </Alert>
      ) : viewMode === "list" ? (
        /* ── List / Table View ── */
        <Paper withBorder radius="md" style={{ overflow: "hidden" }}>
          <ScrollArea>
            <Table striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th style={{ width: 36 }}>
                    <Checkbox
                      size="xs"
                      checked={
                        checkedProfileIds.size > 0 &&
                        checkedProfileIds.size === visibleCount
                      }
                      indeterminate={
                        checkedProfileIds.size > 0 &&
                        checkedProfileIds.size < visibleCount
                      }
                      onChange={() => {
                        if (checkedProfileIds.size === visibleCount) {
                          setCheckedProfileIds(new Set());
                        } else {
                          const allVisible =
                            filteredAndGroupedProfiles.type === "flat"
                              ? filteredAndGroupedProfiles.items.map(
                                  (p) => p.id,
                                )
                              : filteredAndGroupedProfiles.groups.flatMap((g) =>
                                  g.items.map((p) => p.id),
                                );
                          setCheckedProfileIds(new Set(allVisible));
                        }
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
                {(filteredAndGroupedProfiles.type === "flat"
                  ? filteredAndGroupedProfiles.items
                  : filteredAndGroupedProfiles.groups.flatMap((g) => g.items)
                ).map((p) => (
                  <Table.Tr
                    key={p.id}
                    bg={
                      checkedProfileIds.has(p.id)
                        ? "var(--mantine-color-blue-0)"
                        : p.is_default
                          ? "var(--mantine-color-yellow-0)"
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
                          <Badge
                            size="xs"
                            variant="filled"
                            color="yellow"
                            c="dark"
                          >
                            Default
                          </Badge>
                        )}
                      </Group>
                    </Table.Td>
                    <Table.Td>
                      <CopyButton value={p.id}>
                        {({ copied, copy }) => (
                          <Tooltip
                            label={copied ? "Copied!" : "Copy profile ID"}
                            withArrow
                          >
                            <Text
                              size="xs"
                              c={copied ? "teal" : "dimmed"}
                              style={{
                                cursor: "pointer",
                                fontFamily: "monospace",
                              }}
                              onClick={(e) => {
                                e.stopPropagation();
                                copy();
                              }}
                            >
                              {p.id.slice(0, 8)}…{" "}
                              {copied && (
                                <IconCheck
                                  size={10}
                                  style={{ verticalAlign: "middle" }}
                                />
                              )}
                            </Text>
                          </Tooltip>
                        )}
                      </CopyButton>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs">{p.provider?.name || "—"}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text
                        size="xs"
                        ff="monospace"
                        truncate
                        style={{ maxWidth: 160 }}
                      >
                        {p.external_ai_id}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Badge
                        size="xs"
                        variant="light"
                        color={p.profile_type === "model" ? "violet" : "teal"}
                      >
                        {p.profile_type === "model" ? "Model" : "Agent"}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <Badge
                        size="xs"
                        variant="light"
                        color={p.mode === "chat" ? "orange" : "teal"}
                      >
                        {p.mode === "chat" ? "Chat" : "Completion"}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <Badge
                        size="xs"
                        variant="light"
                        color={p.is_active ? "green" : "gray"}
                      >
                        {p.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      {p.failover_provider ? (
                        <Text size="xs" c="orange.7">
                          {p.failover_provider.name}
                        </Text>
                      ) : (
                        <Text size="xs" c="dimmed">
                          —
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <Menu
                        shadow="md"
                        width={160}
                        position="bottom-end"
                        withinPortal
                      >
                        <Menu.Target>
                          <ActionIcon variant="subtle" size="sm">
                            <IconDotsVertical size={14} />
                          </ActionIcon>
                        </Menu.Target>
                        <Menu.Dropdown>
                          <Menu.Item
                            leftSection={<IconEdit size={14} />}
                            onClick={() => openEdit(p)}
                          >
                            Edit
                          </Menu.Item>
                          <Menu.Item
                            leftSection={<IconMessageCircle size={14} />}
                            onClick={() => openTestChat(p)}
                          >
                            Test chat
                          </Menu.Item>
                          <Menu.Item
                            leftSection={<IconArrowsShuffle size={14} />}
                            onClick={() => openFailoverConfig(p)}
                          >
                            Failover
                          </Menu.Item>
                          <Menu.Item
                            leftSection={
                              p.is_default ? (
                                <IconStarFilled size={14} />
                              ) : (
                                <IconStar size={14} />
                              )
                            }
                            onClick={() =>
                              handleToggleDefault(p.id, !p.is_default)
                            }
                          >
                            {p.is_default ? "Remove default" : "Set default"}
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
      ) : filteredAndGroupedProfiles.type === "flat" ? (
        /* ── Card view (flat) ── */
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
          {filteredAndGroupedProfiles.items.map((p) => (
            <AiProfileCard key={p.id} {...profileCardProps(p)} />
          ))}
        </SimpleGrid>
      ) : (
        /* ── Card view (grouped) ── */
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
      <Modal
        opened={modalOpened}
        onClose={closeModal}
        title={editing ? "Edit AI Profile" : "New AI Profile"}
        size="md"
      >
        <form onSubmit={handleSubmit}>
          <Stack gap="sm">
            {/* Profile type toggle — Agent vs Model */}
            <SegmentedControl
              value={isModelOnlyProvider ? "model" : profileType}
              onChange={handleProfileTypeChange}
              data={[
                { label: "AI Agent", value: "agent" },
                { label: "AI Model", value: "model" },
              ]}
              disabled={!!editing || isModelOnlyProvider}
              fullWidth
            />

            <Text size="xs" c="dimmed">
              {isModelOnlyProvider
                ? "Google Gemini uses model IDs directly (no provider-side agent objects)."
                : profileType === "agent"
                  ? "AI Agents are Devs.ai-configured agents with custom instructions and knowledge."
                  : "AI Models are raw LLM models accessed directly via model ID through the completions API."}
            </Text>

            <SegmentedControl
              value={mode}
              onChange={setMode}
              data={[
                { label: "Completion", value: "completion" },
                { label: "Chat", value: "chat" },
              ]}
              fullWidth
            />
            <Text size="xs" c="dimmed">
              {mode === "chat"
                ? "Chat mode uses streaming responses for real-time interaction."
                : "Completion mode returns the full response in a single request."}
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
            {effectiveProfileType === "agent" &&
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
                      external_ai_id: v || "",
                      name: prev.name || ai?.name || "",
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
            {effectiveProfileType === "model" &&
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
                      external_ai_id: v || "",
                      name: prev.name || model?.display_name || "",
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

            {!form.external_ai_id &&
              selectedProvider &&
              effectiveProfileType === "agent" && (
                <Text size="xs" c="dimmed">
                  If the provider list is empty, enter the AI ID manually above.
                </Text>
              )}

            {!form.external_ai_id &&
              selectedProvider &&
              effectiveProfileType === "model" &&
              availableModels.length === 0 && (
                <Text size="xs" c="dimmed">
                  No models registered for this provider. Use &quot;Manage
                  LLMs&quot; to add models, or enter a model ID manually.
                </Text>
              )}

            <Paper
              withBorder
              p="sm"
              radius="sm"
              style={{ borderLeft: "3px solid var(--mantine-color-orange-5)" }}
            >
              <Stack gap="xs">
                <Text size="sm" fw={600} c="orange.7">
                  Failover (optional)
                </Text>
                <Text size="xs" c="dimmed">
                  Failover activates when the primary model fails or returns
                  empty content.
                </Text>
                {editing?.failover_provider && (
                  <Group gap="xs">
                    <Badge size="xs" color="orange" variant="light">
                      Active
                    </Badge>
                    <Text size="xs">
                      {editing.failover_provider.name} —{" "}
                      <code>{editing.failover_external_ai_id}</code>
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
                    {editing.failover_provider_id
                      ? "Edit Failover"
                      : "Configure Failover"}
                  </Button>
                ) : (
                  <Text size="xs" c="dimmed" fs="italic">
                    Save the profile first, then configure failover.
                  </Text>
                )}
              </Stack>
            </Paper>

            {selectedProviderType === "devs-ai" &&
              effectiveProfileType === "model" && (
                <Paper withBorder p="sm" radius="sm">
                  <Stack gap="xs">
                    <Text size="sm" fw={600}>
                      Devs.ai Runtime Options
                    </Text>
                    <Text size="xs" c="dimmed">
                      Enable built-in tools and chat options for this model
                      profile.
                    </Text>
                    {DEVS_AI_BUILTIN_TOOL_OPTIONS.map((tool) => (
                      <Switch
                        key={tool.key}
                        size="sm"
                        label={tool.label}
                        checked={normaliseRuntimeOptions(
                          form.runtime_options,
                        ).devs_ai.built_in_tools.includes(tool.key)}
                        onChange={(e) =>
                          toggleDevsAiTool(tool.key, e.currentTarget.checked)
                        }
                      />
                    ))}
                    <Switch
                      size="sm"
                      label="Generate Citations"
                      checked={
                        normaliseRuntimeOptions(form.runtime_options).devs_ai
                          .generate_citations
                      }
                      onChange={(e) => {
                        const checked = e.currentTarget.checked;
                        setForm((prev) => {
                          const runtimeOptions = normaliseRuntimeOptions(
                            prev.runtime_options,
                          );
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
                      checked={
                        normaliseRuntimeOptions(form.runtime_options).devs_ai
                          .parallel_tool_calls
                      }
                      onChange={(e) => {
                        const checked = e.currentTarget.checked;
                        setForm((prev) => {
                          const runtimeOptions = normaliseRuntimeOptions(
                            prev.runtime_options,
                          );
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
                      <>
                        <Text size="sm" fw={600} mt="sm">
                          MCP Server Tools
                        </Text>
                        <Text size="xs" c="dimmed">
                          External integrations (Gmail, Slack, etc.) configured
                          on this AI agent in Devs.ai. OAuth status shows
                          whether the user has authorized access.
                        </Text>
                        {mcpLoading && (
                          <Center>
                            <Loader size="sm" />
                          </Center>
                        )}
                        {!mcpLoading && mcpTools.length === 0 && (
                          <Text size="xs" c="dimmed" fs="italic">
                            No MCP server tools configured on this agent.
                            Configure them in the Devs.ai dashboard.
                          </Text>
                        )}
                        {!mcpLoading &&
                          mcpTools.map((tool) => {
                            const authEntry = toolAuthStatus.find(
                              (a) => a.name === tool.name,
                            );
                            const isConnected = !!authEntry;
                            return (
                              <Group
                                key={tool.id}
                                gap="xs"
                                justify="space-between"
                              >
                                <Group gap="xs">
                                  <Text size="sm">{tool.name}</Text>
                                  <Badge
                                    size="xs"
                                    variant="light"
                                    color={isConnected ? "green" : "orange"}
                                  >
                                    {isConnected
                                      ? "Connected"
                                      : "Not connected"}
                                  </Badge>
                                </Group>
                                {!isConnected && (
                                  <Button
                                    size="compact-xs"
                                    variant="light"
                                    onClick={async () => {
                                      try {
                                        const result =
                                          await api.initiateToolOAuth(
                                            editing.id,
                                            tool.id,
                                          );
                                        if (result?.authUrl) {
                                          window.open(
                                            String(result.authUrl),
                                            "_blank",
                                            "noopener",
                                          );
                                          notifications.show({
                                            title: "OAuth",
                                            message:
                                              "Authorization window opened. Complete the flow, then refresh.",
                                            color: "blue",
                                          });
                                        }
                                      } catch (err: unknown) {
                                        notifications.show({
                                          title: "OAuth Error",
                                          message:
                                            err instanceof Error
                                              ? err.message
                                              : String(err),
                                          color: "red",
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
                                        await api.deleteToolOAuthToken(
                                          editing.id,
                                          tool.id,
                                        );
                                        notifications.show({
                                          title: "Disconnected",
                                          message: `${tool.name} OAuth token removed`,
                                          color: "yellow",
                                        });
                                        loadMcpTools(editing.id, "devs-ai");
                                      } catch (err: unknown) {
                                        notifications.show({
                                          title: "Error",
                                          message:
                                            err instanceof Error
                                              ? err.message
                                              : String(err),
                                          color: "red",
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
                        {editing && !mcpLoading && (
                          <Button
                            size="compact-xs"
                            variant="subtle"
                            leftSection={<IconRefresh size={14} />}
                            onClick={() => loadMcpTools(editing.id, "devs-ai")}
                          >
                            Refresh tools
                          </Button>
                        )}
                      </>
                    )}
                  </Stack>
                </Paper>
              )}

            {selectedProviderType === "devs-ai-v2" &&
              effectiveProfileType === "model" && (
                <Paper withBorder p="sm" radius="sm">
                  <Stack gap="xs">
                    <Text size="sm" fw={600}>
                      Devs.ai v2 Runtime Options
                    </Text>
                    <Text size="xs" c="dimmed">
                      Responses API v2 — built-in tools, chat mode, and
                      threading behavior.
                    </Text>
                    {DEVS_AI_V2_BUILTIN_TOOL_OPTIONS.map((tool) => (
                      <Switch
                        key={tool.key}
                        size="sm"
                        label={tool.label}
                        checked={normaliseRuntimeOptions(
                          form.runtime_options,
                          "devs-ai-v2",
                        ).devs_ai_v2.built_in_tools.includes(tool.key)}
                        onChange={(e) =>
                          toggleDevsAiV2Tool(tool.key, e.currentTarget.checked)
                        }
                      />
                    ))}
                    <Select
                      label="Chat mode"
                      size="xs"
                      data={[...DEVS_AI_V2_CHAT_MODE_OPTIONS]}
                      value={
                        normaliseRuntimeOptions(
                          form.runtime_options,
                          "devs-ai-v2",
                        ).devs_ai_v2.chat_mode
                      }
                      onChange={(val) => {
                        if (!val) return;
                        setForm((prev) => {
                          const runtimeOptions = normaliseRuntimeOptions(
                            prev.runtime_options,
                            "devs-ai-v2",
                          );
                          return {
                            ...prev,
                            runtime_options: {
                              ...runtimeOptions,
                              devs_ai_v2: {
                                ...runtimeOptions.devs_ai_v2,
                                chat_mode: val as "execute" | "chat" | "plan",
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
                      value={
                        normaliseRuntimeOptions(
                          form.runtime_options,
                          "devs-ai-v2",
                        ).devs_ai_v2.thread_mode
                      }
                      onChange={(val) => {
                        if (!val) return;
                        setForm((prev) => {
                          const runtimeOptions = normaliseRuntimeOptions(
                            prev.runtime_options,
                            "devs-ai-v2",
                          );
                          return {
                            ...prev,
                            runtime_options: {
                              ...runtimeOptions,
                              devs_ai_v2: {
                                ...runtimeOptions.devs_ai_v2,
                                thread_mode: val as
                                  | "collect"
                                  | "steer"
                                  | "interrupt"
                                  | "force",
                              },
                            },
                          };
                        });
                      }}
                    />
                    <Switch
                      size="sm"
                      label="Parallel Tool Calls"
                      checked={
                        normaliseRuntimeOptions(
                          form.runtime_options,
                          "devs-ai-v2",
                        ).devs_ai_v2.parallel_tool_calls
                      }
                      onChange={(e) => {
                        const checked = e.currentTarget.checked;
                        setForm((prev) => {
                          const runtimeOptions = normaliseRuntimeOptions(
                            prev.runtime_options,
                            "devs-ai-v2",
                          );
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

            {selectedProviderType === "google-gemini" && (
              <Paper withBorder p="sm" radius="sm">
                <Stack gap="xs">
                  <Text size="sm" fw={600}>
                    Google Gemini Runtime Options
                  </Text>
                  <Text size="xs" c="dimmed">
                    Grounding with Google Search allows the model to retrieve
                    web results when needed.
                  </Text>
                  <Switch
                    size="sm"
                    label="Grounding with Google Search"
                    checked={
                      normaliseRuntimeOptions(form.runtime_options)
                        .google_gemini.grounding_with_google_search
                    }
                    onChange={(e) => {
                      const checked = e.currentTarget.checked;
                      setForm((prev) => {
                        const runtimeOptions = normaliseRuntimeOptions(
                          prev.runtime_options,
                        );
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

            {mode === "chat" && (
              <Paper withBorder p="sm" radius="sm">
                <Stack gap="sm">
                  <Text size="sm" fw={600}>
                    Jobs as tools
                  </Text>
                  <Text size="xs" c="dimmed">
                    Expose processing jobs as model-callable tools. AI Admin
                    runs the linked job server-side when the model invokes the
                    tool (devs-ai v1 tool.call or devs-ai-v2 function_call).
                  </Text>
                  {toolJobs.length === 0 && (
                    <Text size="xs" c="dimmed">
                      No tool jobs configured.
                    </Text>
                  )}
                  {toolJobs.map((row, index) => (
                    <Group
                      key={`tool-job-${index}`}
                      align="flex-end"
                      wrap="nowrap"
                    >
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
                          setToolJobs((prev) =>
                            prev.map((r, i) =>
                              i === index ? { ...r, jobSlug: value || "" } : r,
                            ),
                          )
                        }
                      />
                      <TextInput
                        label="Expose as"
                        placeholder="tool_name"
                        style={{ flex: 1 }}
                        value={row.exposeAs}
                        onChange={(e) =>
                          setToolJobs((prev) =>
                            prev.map((r, i) =>
                              i === index
                                ? { ...r, exposeAs: e.currentTarget.value }
                                : r,
                            ),
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
                            prev.map((r, i) =>
                              i === index
                                ? { ...r, description: e.currentTarget.value }
                                : r,
                            ),
                          )
                        }
                      />
                      <ActionIcon
                        color="red"
                        variant="subtle"
                        aria-label="Remove tool job"
                        onClick={() =>
                          setToolJobs((prev) =>
                            prev.filter((_, i) => i !== index),
                          )
                        }
                      >
                        <IconTrash size={16} />
                      </ActionIcon>
                    </Group>
                  ))}
                  <Button
                    variant="light"
                    size="xs"
                    leftSection={<IconPlus size={14} />}
                    onClick={() =>
                      setToolJobs((prev) => [
                        ...prev,
                        { jobSlug: "", exposeAs: "", description: "" },
                      ])
                    }
                  >
                    Add tool job
                  </Button>
                </Stack>
              </Paper>
            )}

            <TextInput
              data-testid="profile-name-input"
              label="Profile Name"
              placeholder={
                effectiveProfileType === "agent"
                  ? "e.g. GPT-5.2 Generic"
                  : "e.g. Claude 4 Sonnet"
              }
              value={form.name}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, name: e.target.value }))
              }
              required
            />
            <Textarea
              label="Description (optional)"
              value={form.description}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, description: e.target.value }))
              }
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
                {editing ? "Update" : "Create"}
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>

      {/* Test Chat Drawer */}
      <Drawer
        opened={chatOpened}
        onClose={closeChat}
        title={`Test Chat — ${chatProfile?.name || ""}`}
        position="right"
        size="lg"
      >
        {chatProfile && (
          <TestChatPanel
            profileId={chatProfile.id}
            profileName={chatProfile.name}
            profile={chatProfile}
          />
        )}
      </Drawer>

      {/* Manage LLMs Modal */}
      <ManageLlmsModal
        opened={llmsOpened}
        onClose={closeLlms}
        providers={providers}
      />

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

/* ══════════════════════════════════════════════════════════════
   TEST CHAT PANEL — simple chat interface to test AI profiles
   ══════════════════════════════════════════════════════════════ */

function TestChatPanel({
  profileId,
  profileName,
  profile,
}: TestChatPanelProps) {
  const [messages, setMessages] = useState<TestChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [sending, setSending] = useState(false);
  const [chatSessionId, setChatSessionId] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [pendingAuth, setPendingAuth] = useState<PendingAuth | null>(null);
  const chatSessionIdRef = useRef<string | null>(null);
  const activeReaderRef =
    useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [messages]);

  useEffect(() => {
    chatSessionIdRef.current = chatSessionId;
  }, [chatSessionId]);

  useEffect(() => {
    return () => {
      if (activeReaderRef.current) {
        activeReaderRef.current.cancel().catch(() => {});
      }
      if (chatSessionIdRef.current) {
        api.closeChatSession(chatSessionIdRef.current).catch(() => {});
      }
    };
  }, []);

  const providerType = String(profile?.provider?.type || "")
    .trim()
    .toLowerCase();
  const rtOpts = profile?.runtime_options ?? {};
  const devsAiRaw = rtOpts.devs_ai;
  const devsAiOptions = (
    devsAiRaw && typeof devsAiRaw === "object" ? devsAiRaw : {}
  ) as Record<string, unknown>;
  const geminiRaw = rtOpts.google_gemini;
  const geminiOptions = (
    geminiRaw && typeof geminiRaw === "object" ? geminiRaw : {}
  ) as Record<string, unknown>;
  const enabledToolIds: string[] = Array.isArray(devsAiOptions.built_in_tools)
    ? (devsAiOptions.built_in_tools as unknown[])
        .map((t) => String(t || "").trim())
        .filter(Boolean)
    : [];

  function buildToolsPresetPrompt() {
    if (providerType === "devs-ai") {
      const toolList =
        enabledToolIds.length > 0 ? enabledToolIds.join(", ") : "none";
      return [
        "Run a runtime-tools smoke test for this profile.",
        `Enabled tools configured on this profile: ${toolList}.`,
        "If web_search is enabled, run one web lookup and include at least one source URL.",
        "If python is enabled, run a tiny calculation (e.g., 37*19) and include the result.",
        "If spreadsheet is enabled, show a tiny 2-row table transformed into CSV.",
        "If memory is enabled, store a short key/value and confirm it was saved.",
        "If sandbox is enabled, run a trivial sandbox action and summarize outcome.",
        "Return compact JSON with: toolsDetected, toolsUsed, checks, and notes.",
      ].join("\n");
    }

    if (providerType === "google-gemini") {
      const grounding = geminiOptions?.grounding_with_google_search === true;
      return grounding
        ? [
            "Run a grounding smoke test.",
            'Use Google Search grounding to answer: "What is the latest official news about Gemini API pricing?"',
            "Include citation URLs and state that grounding was used.",
          ].join("\n")
        : [
            "Run a non-grounded response smoke test.",
            'Answer this from model knowledge only: "Summarize what grounding in Gemini means in 3 bullets."',
            "Do not use web lookups.",
          ].join("\n");
    }

    return [
      "Run a basic tool/runtime smoke test for this profile.",
      "Describe whether any provider runtime options seem active in this response.",
    ].join("\n");
  }

  /** Friendly tool name extracted from MCP tool type like mcp__<id>__listFiles */
  function friendlyToolName(toolType: string | null | undefined) {
    if (!toolType) return "unknown tool";
    const parts = toolType.split("__");
    return parts.length >= 3 ? parts[parts.length - 1] : toolType;
  }

  /** Add a tool-event message to the chat (tool invocation, result, or OAuth prompt) */
  function addToolMessage(toolMsg: TestChatMessage) {
    setMessages((prev) => [...prev, toolMsg]);
  }

  /**
   * Process SSE lines from a stream response. Handles text deltas,
   * tool.call events, tool.message events, and message.complete.
   * Returns the accumulated assistant text content.
   */
  async function processStream(response: Response) {
    if (!response.body) throw new Error("No response body");
    const reader = response.body.getReader();
    activeReaderRef.current = reader;
    const decoder = new TextDecoder();
    let assistantContent = "";
    let buffer = "";
    let lastMessageId = null;

    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const dataStr = line.slice(6).trim();
        if (dataStr === "[DONE]") continue;

        let parsed;
        try {
          parsed = JSON.parse(dataStr);
        } catch {
          continue;
        }

        /* ── tool.call: AI wants to invoke a tool ── */
        if (parsed.type === "tool.call") {
          lastMessageId = parsed.messageId || lastMessageId;
          const calls = parsed.calls || [];
          for (const call of calls) {
            const requiresAuth =
              call.type?.includes("mcp") && call.arguments?.requiresUserAction;
            addToolMessage({
              role: "tool",
              toolEvent: "invocation",
              toolName: friendlyToolName(call.type),
              toolCallId: call.id,
              arguments: call.arguments,
              requiresAuth,
              messageId: parsed.messageId,
            });
          }
          continue;
        }

        /* ── tool.message: result of a tool call ── */
        if (parsed.type === "tool.message") {
          const meta = parsed.metadata || {};
          addToolMessage({
            role: "tool",
            toolEvent: "result",
            toolCallId: parsed.toolCallId,
            status: parsed.status,
            output: parsed.output,
            messageId: parsed.messageId,
            requiresUserAction: meta.requiresUserAction === true,
          });
          if (meta.requiresUserAction === true) {
            setPendingAuth({
              toolCallId: parsed.toolCallId,
              messageId: parsed.messageId,
              authUrl: meta.authUrl || null,
            });
          }
          continue;
        }

        /* ── message.complete: usage info ── */
        if (parsed.type === "message.complete") {
          lastMessageId = parsed.messageId || lastMessageId;
          continue;
        }

        /* ── message.created: new message in the conversation ── */
        if (parsed.type === "message.created") {
          lastMessageId = parsed.messageId || lastMessageId;
          continue;
        }

        /* ── text deltas ── */
        const delta =
          parsed.choices?.[0]?.delta?.content ||
          parsed.candidates?.[0]?.content?.parts?.[0]?.text ||
          (typeof parsed.content === "string"
            ? parsed.content
            : parsed.content?.text) ||
          "";

        if (delta && delta.trim()) {
          assistantContent += delta;
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.role === "assistant" && last.streaming) {
              const updated = [...prev];
              updated[updated.length - 1] = {
                ...last,
                content: assistantContent,
              };
              return updated;
            }
            return [
              ...prev,
              { role: "assistant", content: assistantContent, streaming: true },
            ];
          });
        }
      }
    }

    activeReaderRef.current = null;
    return assistantContent;
  }

  async function handleSend(nextText: string | null = null) {
    const textToSend = String(nextText ?? input).trim();
    if (!textToSend || sending || isStreaming) return;

    const userMsg: TestChatMessage = { role: "user", content: textToSend };
    setMessages((prev) => [...prev, userMsg]);
    if (!nextText) setInput("");

    if (profile?.mode === "chat") {
      setIsStreaming(true);
      try {
        let sessionId = chatSessionId;
        if (!sessionId) {
          const session = await api.createChatSession({
            aiProfileId: profileId,
            userId: getSessionUser()?.id || "admin-test",
            systemPrompt: systemPrompt || undefined,
          });
          sessionId = session.sessionId ?? session.id ?? null;
          setChatSessionId(sessionId);
        }
        if (!sessionId) return;

        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: "", streaming: true },
        ]);

        const response = await api.sendChatMessageStream(sessionId, textToSend);
        if (!response.ok) {
          const errBody = await response
            .json()
            .catch((): Record<string, unknown> => ({}));
          throw new Error(
            String(
              errBody.error || `Stream request failed (${response.status})`,
            ),
          );
        }

        await processStream(response);

        setMessages((prev) => {
          const updated = [...prev];
          let lastIdx = -1;
          for (let i = updated.length - 1; i >= 0; i--) {
            const msg = updated[i];
            if (msg && msg.role === "assistant" && msg.streaming) {
              lastIdx = i;
              break;
            }
          }
          const target = lastIdx >= 0 ? updated[lastIdx] : undefined;
          if (lastIdx >= 0 && target)
            updated[lastIdx] = { ...target, streaming: false };
          return updated;
        });
      } catch (err: unknown) {
        activeReaderRef.current = null;
        setMessages((prev) => {
          const cleaned = prev.filter(
            (m) => !(m.role === "assistant" && m.streaming && !m.content),
          );
          return [
            ...cleaned,
            {
              role: "error",
              content: `Error: ${err instanceof Error ? err.message : String(err)}`,
            },
          ];
        });
      } finally {
        setIsStreaming(false);
      }
    } else {
      setSending(true);
      try {
        const data = (await api.testAiProfileChat(
          profileId,
          textToSend,
          systemPrompt || undefined,
        )) as unknown as TestChatApiResult;
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: data.content,
            meta: {
              duration: data.durationMs,
              model: data.model,
              usage: data.usage,
            },
          },
        ]);
      } catch (err: unknown) {
        setMessages((prev) => [
          ...prev,
          {
            role: "error",
            content: `Error: ${err instanceof Error ? err.message : String(err)}`,
          },
        ]);
      } finally {
        setSending(false);
      }
    }
  }

  async function handleResetChat() {
    if (chatSessionId) {
      try {
        await api.resetChatSession(chatSessionId);
      } catch (_e) {
        /* ignore */
      }
    }
    setChatSessionId(null);
    setMessages([]);
    setPendingAuth(null);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  /**
   * Resume the AI conversation after the user has completed OAuth authorization.
   * Submits a tool output indicating auth was completed, then processes the
   * continuation stream.
   */
  async function handleResumeAfterAuth() {
    if (!pendingAuth || !chatSessionId) return;
    setIsStreaming(true);
    setPendingAuth(null);
    try {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "", streaming: true },
      ]);
      const response = await api.submitChatToolOutputs(
        chatSessionId,
        pendingAuth.messageId,
        [
          {
            toolCallId: pendingAuth.toolCallId,
            output: "OAuth authorization completed by user.",
          },
        ],
      );
      if (!response.ok) {
        const errBody = await response
          .json()
          .catch((): Record<string, unknown> => ({}));
        throw new Error(
          String(
            errBody.error ||
              `Tool output submission failed (${response.status})`,
          ),
        );
      }
      await processStream(response);
      setMessages((prev) => {
        const updated = [...prev];
        let lastIdx = -1;
        for (let i = updated.length - 1; i >= 0; i--) {
          const msg = updated[i];
          if (msg && msg.role === "assistant" && msg.streaming) {
            lastIdx = i;
            break;
          }
        }
        const target = lastIdx >= 0 ? updated[lastIdx] : undefined;
        if (lastIdx >= 0 && target)
          updated[lastIdx] = { ...target, streaming: false };
        return updated;
      });
    } catch (err: unknown) {
      activeReaderRef.current = null;
      const errMsg = err instanceof Error ? err.message : String(err);
      setMessages((prev) => {
        const cleaned = prev.filter(
          (m) => !(m.role === "assistant" && m.streaming && !m.content),
        );
        return [
          ...cleaned,
          { role: "error", content: `Error resuming: ${errMsg}` },
        ];
      });
    } finally {
      setIsStreaming(false);
    }
  }

  /** Render a tool event message (invocation or result) */
  function renderToolMessage(msg: TestChatMessage, i: number) {
    const isInvocation = msg.toolEvent === "invocation";
    const isResult = msg.toolEvent === "result";
    const isError = isResult && msg.status === "error";

    return (
      <Paper
        key={msg.toolCallId || `tool-${i}`}
        p="xs"
        radius="sm"
        withBorder
        bg={isError ? "red.0" : "grape.0"}
        style={{ borderLeft: "3px solid var(--mantine-color-grape-5)" }}
      >
        <Group gap="xs" mb={4}>
          <Badge size="xs" variant="filled" color="grape">
            tool
          </Badge>
          {isInvocation && (
            <>
              <Badge size="xs" variant="light" color="blue">
                {msg.toolName}
              </Badge>
              <Text size="xs" c="dimmed">
                invoked
              </Text>
            </>
          )}
          {isResult && (
            <>
              <Badge
                size="xs"
                variant="light"
                color={isError ? "red" : "green"}
              >
                {msg.status || "success"}
              </Badge>
            </>
          )}
        </Group>
        {isInvocation && msg.arguments && (
          <Code
            block
            style={{
              fontSize: 10,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              maxHeight: 120,
              overflow: "auto",
            }}
          >
            {JSON.stringify(msg.arguments, null, 2)}
          </Code>
        )}
        {isResult && msg.output && (
          <Code
            block
            style={{
              fontSize: 10,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              maxHeight: 200,
              overflow: "auto",
            }}
          >
            {typeof msg.output === "string"
              ? msg.output
              : JSON.stringify(msg.output, null, 2)}
          </Code>
        )}
        {isResult &&
          msg.requiresUserAction &&
          pendingAuth &&
          pendingAuth.toolCallId === msg.toolCallId && (
            <Group gap="xs" mt="xs">
              {pendingAuth.authUrl && (
                <Button
                  size="compact-xs"
                  variant="light"
                  color="blue"
                  onClick={() =>
                    window.open(
                      pendingAuth.authUrl ?? undefined,
                      "_blank",
                      "noopener",
                    )
                  }
                >
                  Authorize
                </Button>
              )}
              <Button
                size="compact-xs"
                variant="light"
                color="green"
                onClick={handleResumeAfterAuth}
                disabled={isStreaming}
              >
                Resume after auth
              </Button>
            </Group>
          )}
      </Paper>
    );
  }

  return (
    <Stack gap="sm" h="100%">
      <Textarea
        label="System Prompt (optional)"
        placeholder="Enter a system prompt to test with..."
        value={systemPrompt}
        onChange={(e) => setSystemPrompt(e.target.value)}
        minRows={2}
        maxRows={4}
        styles={{ input: { fontFamily: "monospace", fontSize: 12 } }}
      />

      <Group justify="space-between" align="center">
        <Text size="xs" c="dimmed">
          Preset uses this profile&apos;s configured runtime/tool options.
        </Text>
        <Group gap="xs">
          {profile?.mode === "chat" && chatSessionId && (
            <Button
              size="xs"
              variant="light"
              color="gray"
              leftSection={<IconRefresh size={14} />}
              disabled={isStreaming}
              onClick={handleResetChat}
            >
              Reset Chat
            </Button>
          )}
          <Button
            size="xs"
            variant="light"
            leftSection={<IconFlask2 size={14} />}
            disabled={sending || isStreaming}
            onClick={() => {
              const preset = buildToolsPresetPrompt();
              setInput(preset);
            }}
          >
            Test Tools Preset
          </Button>
        </Group>
      </Group>

      <Paper withBorder p="sm" style={{ flex: 1 }}>
        <Text fw={600} size="sm" mb={4}>
          Chat with {profileName}
        </Text>
        <ScrollArea h={400} viewportRef={scrollRef}>
          <Stack gap="sm">
            {messages.length === 0 && (
              <Center py="xl">
                <Text size="sm" c="dimmed">
                  Send a message to test the AI profile
                </Text>
              </Center>
            )}
            {messages.map((msg, i) =>
              msg.role === "tool" ? (
                renderToolMessage(msg, i)
              ) : (
                <Paper
                  key={msg.id || `msg-${i}`}
                  p="xs"
                  radius="sm"
                  withBorder={msg.role !== "user"}
                  bg={
                    msg.role === "user"
                      ? "blue.0"
                      : msg.role === "error"
                        ? "red.0"
                        : undefined
                  }
                >
                  <Group gap="xs" mb={4}>
                    <Badge
                      size="xs"
                      variant="light"
                      color={
                        msg.role === "user"
                          ? "blue"
                          : msg.role === "error"
                            ? "red"
                            : "green"
                      }
                    >
                      {msg.role}
                    </Badge>
                    {msg.meta && (
                      <>
                        <Badge size="xs" variant="outline">
                          {msg.meta.duration}ms
                        </Badge>
                        {msg.meta.usage && (
                          <Badge size="xs" variant="outline">
                            {msg.meta.usage.prompt_tokens +
                              msg.meta.usage.completion_tokens}{" "}
                            tokens
                          </Badge>
                        )}
                      </>
                    )}
                  </Group>
                  <Code
                    block
                    style={{
                      fontSize: 11,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                      maxHeight: 300,
                      overflow: "auto",
                    }}
                  >
                    {msg.content}
                  </Code>
                </Paper>
              ),
            )}
            {(sending || isStreaming) && (
              <Center py="sm">
                <Group gap="xs">
                  <Loader size="sm" />
                  {isStreaming && (
                    <Text size="xs" c="dimmed">
                      Streaming...
                    </Text>
                  )}
                </Group>
              </Center>
            )}
          </Stack>
        </ScrollArea>
      </Paper>

      <Group>
        <TextInput
          style={{ flex: 1 }}
          placeholder="Type your message to test the AI response formatting..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={sending || isStreaming}
        />
        <ActionIcon
          size="lg"
          variant="filled"
          onClick={() => handleSend()}
          disabled={!input.trim() || sending || isStreaming}
        >
          <IconSend size={16} />
        </ActionIcon>
      </Group>
    </Stack>
  );
}
