import { Tooltip, Alert, Tabs } from '@mantine/core';
import {
  IconPlayerPlay,
  IconSettings,
  IconFilter,
  IconAdjustments,
  IconActivity,
  IconChartBar,
  IconLock,
  IconLayoutGrid,
} from '@tabler/icons-react';
import type { ProcessingJob, ProcessingJobGroup, AiProfile, CallingApplication } from '../../../types/api';
import type { FormattingRule } from './types';
import DiagnosticsTab from '../DiagnosticsTab';
import JobsTab from './JobsTab';
import RuleSetsTab from './RuleSetsTab';
import TestRuleSetTab from './TestRuleSetTab';
import BuildRulesTab from './BuildRulesTab';
import TestTab from './TestTab';
import AdvancedTab from './AdvancedTab';
import AnalyticsTab from './AnalyticsTab';

interface ProcessingJobTabsProps {
  activeTab: string;
  onTabChange: (tab: string | null) => void;
  isChatMode: boolean;
  jobRequired: boolean;
  jobs: ProcessingJob[];
  jobGroups: ProcessingJobGroup[];
  aiProfiles: AiProfile[];
  callingApps: CallingApplication[];
  availableRules: FormattingRule[];
  selectedJob: string | null;
  selectedJobFull: ProcessingJob | null;
  onSelectJob: (id: string) => void;
  onEdit: (job: ProcessingJob) => void;
  onDelete: (job: ProcessingJob) => void;
  onCreate: () => void;
  onRefresh: () => Promise<void>;
  onRefreshSelected: () => Promise<void>;
}

/** Tab bar + panels for the Processing Jobs manager. */
export default function ProcessingJobTabs({
  activeTab,
  onTabChange,
  isChatMode,
  jobRequired,
  jobs,
  jobGroups,
  aiProfiles,
  callingApps,
  availableRules,
  selectedJob,
  selectedJobFull,
  onSelectJob,
  onEdit,
  onDelete,
  onCreate,
  onRefresh,
  onRefreshSelected,
}: ProcessingJobTabsProps) {
  const disabledTabStyle = jobRequired ? { opacity: 0.45, cursor: 'not-allowed' as const } : undefined;

  return (
      <Tabs value={activeTab} onChange={onTabChange}>
        <Tabs.List>
          <Tabs.Tab value="jobs" leftSection={<IconSettings size={14} />}>
            Jobs
          </Tabs.Tab>
          {!isChatMode && (
            <Tooltip label="Select a job first" disabled={!jobRequired} position="bottom" withArrow>
              <Tabs.Tab value="rules" leftSection={<IconFilter size={14} />} disabled={jobRequired} style={disabledTabStyle}>
                Build Rules
              </Tabs.Tab>
            </Tooltip>
          )}
          {!isChatMode && (
            <Tooltip label="Select a job first" disabled={!jobRequired} position="bottom" withArrow>
              <Tabs.Tab value="test" leftSection={<IconPlayerPlay size={14} />} disabled={jobRequired} style={disabledTabStyle}>
                Test Rules (API call)
              </Tabs.Tab>
            </Tooltip>
          )}
          {isChatMode && (
            <Tooltip label="Select a job first" disabled={!jobRequired} position="bottom" withArrow>
              <Tabs.Tab value="rulesets" leftSection={<IconLayoutGrid size={14} />} disabled={jobRequired} style={disabledTabStyle}>
                Rule Sets
              </Tabs.Tab>
            </Tooltip>
          )}
          {isChatMode && (
            <Tooltip label="Select a job first" disabled={!jobRequired} position="bottom" withArrow>
              <Tabs.Tab
                value="test-ruleset"
                leftSection={<IconPlayerPlay size={14} />}
                disabled={jobRequired}
                style={disabledTabStyle}
              >
                Test Rule Set
              </Tabs.Tab>
            </Tooltip>
          )}
          <Tooltip label="Select a job first" disabled={!jobRequired} position="bottom" withArrow>
            <Tabs.Tab value="analytics" leftSection={<IconChartBar size={14} />} disabled={jobRequired} style={disabledTabStyle}>
              Analytics
            </Tabs.Tab>
          </Tooltip>
          <Tooltip label="Select a job first" disabled={!jobRequired} position="bottom" withArrow>
            <Tabs.Tab value="advanced" leftSection={<IconAdjustments size={14} />} disabled={jobRequired} style={disabledTabStyle}>
              Advanced
            </Tabs.Tab>
          </Tooltip>
          <Tooltip label="Select a job first" disabled={!jobRequired} position="bottom" withArrow>
            <Tabs.Tab value="diagnostics" leftSection={<IconActivity size={14} />} disabled={jobRequired} style={disabledTabStyle}>
              Diagnostics
            </Tabs.Tab>
          </Tooltip>
        </Tabs.List>

        {jobRequired && activeTab === 'jobs' && (
          <Alert variant="light" color="blue" icon={<IconLock size={16} />} mt="sm">
            Select a processing job below to unlock the Build Rules, Test, Analytics, Advanced, and Diagnostics tabs.
          </Alert>
        )}

        <Tabs.Panel value="jobs" pt="md">
          <JobsTab
            jobs={jobs}
            jobGroups={jobGroups}
            aiProfiles={aiProfiles}
            callingApps={callingApps}
            selectedJob={selectedJob}
            onSelect={onSelectJob}
            onEdit={onEdit}
            onDelete={onDelete}
            onCreate={onCreate}
            onRefresh={onRefresh}
          />
        </Tabs.Panel>
        {!isChatMode && (
          <Tabs.Panel value="rules" pt="md">
            <BuildRulesTab
              selectedJob={selectedJob}
              selectedJobFull={selectedJobFull}
              availableRules={availableRules}
              onSelect={onSelectJob}
              onRefresh={onRefreshSelected}
            />
          </Tabs.Panel>
        )}
        {isChatMode && (
          <Tabs.Panel value="rulesets" pt="md">
            <RuleSetsTab
              selectedJob={selectedJob}
              selectedJobFull={selectedJobFull}
              availableRules={availableRules}
              onRefresh={onRefreshSelected}
            />
          </Tabs.Panel>
        )}
        {isChatMode && (
          <Tabs.Panel value="test-ruleset" pt="md">
            <TestRuleSetTab selectedJob={selectedJob} selectedJobFull={selectedJobFull} />
          </Tabs.Panel>
        )}
        {!isChatMode && (
          <Tabs.Panel value="test" pt="md">
            <TestTab selectedJob={selectedJob} selectedJobFull={selectedJobFull} onSelect={onSelectJob} />
          </Tabs.Panel>
        )}
        <Tabs.Panel value="analytics" pt="md">
          <AnalyticsTab selectedJob={selectedJob} selectedJobFull={selectedJobFull} />
        </Tabs.Panel>
        <Tabs.Panel value="advanced" pt="md">
          <AdvancedTab selectedJob={selectedJob} selectedJobFull={selectedJobFull} onRefresh={onRefreshSelected} />
        </Tabs.Panel>
        <Tabs.Panel value="diagnostics" pt="md">
          <DiagnosticsTab selectedJob={selectedJob} selectedJobFull={selectedJobFull} />
        </Tabs.Panel>
      </Tabs>
  );
}
