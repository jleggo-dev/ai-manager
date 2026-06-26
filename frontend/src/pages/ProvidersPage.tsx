import { Stack } from '@mantine/core';
import PageHeader from '../components/atoms/PageHeader';
import ProviderManager from '../components/organisms/ProviderManager';

export default function ProvidersPage() {
  return (
    <Stack gap="md">
      <PageHeader title="Providers" description="Manage LLM provider connections (Devs.ai, OpenAI, Anthropic, etc.)" />
      <ProviderManager />
    </Stack>
  );
}
