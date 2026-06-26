import { Stack } from '@mantine/core';
import PageHeader from '../components/atoms/PageHeader';
import ProcessingJobManager from '../components/organisms/ProcessingJobManager';

export default function ProcessingJobsPage() {
  return (
    <Stack gap="md">
      <PageHeader
        title="Processing Jobs"
        description="Manage processing jobs, rules, and templates for AI response processing"
      />
      <ProcessingJobManager />
    </Stack>
  );
}
