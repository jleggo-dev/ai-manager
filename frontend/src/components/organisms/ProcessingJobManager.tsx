/**
 * Organism – ProcessingJobManager
 * ---------------------------------
 * Orchestrates processing-job management tabs and create/edit/delete modals.
 * Tab/panel implementations live under ./processing-jobs/.
 */

import { useState, useEffect } from 'react';
import { Stack, Loader, Center } from '@mantine/core';
import * as api from '../../services/api';
import { useProcessingJobsData } from './processing-jobs/useProcessingJobsData';
import { useJobCrud } from './processing-jobs/useJobCrud';
import ProcessingJobTabs from './processing-jobs/ProcessingJobTabs';
import JobFormModal from './processing-jobs/JobFormModal';
import DeleteJobModal from './processing-jobs/DeleteJobModal';

export default function ProcessingJobManager() {
  const {
    jobs,
    jobGroups,
    aiProfiles,
    availableRules,
    callingApps,
    setCallingApps,
    loading,
    selectedJob,
    setSelectedJob,
    selectedJobFull,
    setSelectedJobFull,
    loadData,
  } = useProcessingJobsData();

  const crud = useJobCrud(aiProfiles, selectedJob, setSelectedJob, loadData);
  const [activeTab, setActiveTab] = useState('jobs');
  const isChatMode = selectedJobFull?.ai_profile?.mode === 'chat';
  const jobRequired = !selectedJob;

  useEffect(() => {
    if (isChatMode && (activeTab === 'rules' || activeTab === 'test')) setActiveTab('jobs');
    if (!isChatMode && (activeTab === 'rulesets' || activeTab === 'test-ruleset')) setActiveTab('jobs');
  }, [isChatMode, activeTab]);

  function handleTabChange(tab: string | null) {
    if (!tab) return;
    if (tab !== 'jobs' && jobRequired) return;
    if ((tab === 'rules' || tab === 'test') && isChatMode) return;
    if ((tab === 'rulesets' || tab === 'test-ruleset') && !isChatMode) return;
    setActiveTab(tab);
  }

  async function refreshSelectedJob() {
    if (!selectedJob) return;
    setSelectedJobFull(await api.getProcessingJob(selectedJob));
  }

  if (loading)
    return (
      <Center py="xl">
        <Loader />
      </Center>
    );

  return (
    <Stack gap="md">
      <ProcessingJobTabs
        activeTab={activeTab}
        onTabChange={handleTabChange}
        isChatMode={!!isChatMode}
        jobRequired={jobRequired}
        jobs={jobs}
        jobGroups={jobGroups}
        aiProfiles={aiProfiles}
        callingApps={callingApps}
        availableRules={availableRules}
        selectedJob={selectedJob}
        selectedJobFull={selectedJobFull}
        onSelectJob={setSelectedJob}
        onEdit={crud.openEdit}
        onDelete={crud.openDeleteConfirm}
        onCreate={crud.openCreate}
        onRefresh={loadData}
        onRefreshSelected={refreshSelectedJob}
      />
      <JobFormModal
        opened={crud.modalOpened}
        onClose={crud.closeModal}
        editing={!!crud.editing}
        form={crud.form}
        setForm={crud.setForm}
        profileOptions={crud.profileOptions}
        callingApps={callingApps}
        setCallingApps={setCallingApps}
        saving={crud.saving}
        onNameChange={crud.handleNameChange}
        onSubmit={crud.handleSubmit}
      />
      <DeleteJobModal
        opened={crud.deleteModalOpened}
        onClose={crud.closeDelete}
        job={crud.deleteTargetJob}
        confirmText={crud.deleteConfirmText}
        onConfirmTextChange={crud.setDeleteConfirmText}
        deleting={crud.deleting}
        onConfirm={crud.handleDeleteConfirmed}
      />
    </Stack>
  );
}
