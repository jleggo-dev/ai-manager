import { Stack } from '@mantine/core';
import PageHeader from '../components/atoms/PageHeader';
import AiProfileManager from '../components/organisms/AiProfileManager';

export default function AiProfilesPage() {
  return (
    <Stack gap="md">
      <PageHeader
        title="AI Profiles"
        description="Register AI models from your providers and assign them to processing jobs."
      />
      <AiProfileManager />
    </Stack>
  );
}
