import { useState, type FormEvent } from 'react';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import * as api from '../../../services/api';
import type { ProcessingJob, AiProfile } from '../../../types/api';
import type { ProcessingJobFormData } from './types';

/**
 * Owns create/edit/delete modal state and handlers for ProcessingJobManager.
 */
export function useJobCrud(
  aiProfiles: AiProfile[],
  selectedJob: string | null,
  setSelectedJob: (id: string | null) => void,
  loadData: () => Promise<void>,
) {
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<ProcessingJob | null>(null);
  const [modalOpened, { open: openModal, close: closeModal }] = useDisclosure(false);
  const [deleteModalOpened, { open: openDeleteModal, close: closeDeleteModal }] = useDisclosure(false);
  const [deleteTargetJob, setDeleteTargetJob] = useState<ProcessingJob | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);

  const [form, setForm] = useState<ProcessingJobFormData>({
    name: '',
    slug: '',
    description: '',
    ai_profile_id: null,
    is_active: true,
    calling_application_id: null,
  });

  function openCreate() {
    setEditing(null);
    const defaultProfile = aiProfiles.find((p) => p.is_default && p.is_active);
    setForm({
      name: '',
      slug: '',
      description: '',
      ai_profile_id: defaultProfile?.id || null,
      is_active: true,
      calling_application_id: null,
    });
    openModal();
  }

  function openEdit(job: ProcessingJob) {
    setEditing(job);
    setForm({
      name: job.name || '',
      slug: job.slug || '',
      description: job.description || '',
      ai_profile_id: job.ai_profile_id || null,
      is_active: job.is_active !== false,
      calling_application_id: job.calling_application_id || null,
    });
    openModal();
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    try {
      setSaving(true);
      if (form.calling_application_id) {
        try {
          await api.createCallingApplication({
            id: form.calling_application_id,
            display_name: form.calling_application_id,
          });
        } catch {
          /* upsert — ok if exists */
        }
      }
      if (editing) {
        await api.updateProcessingJob(editing.id, form as unknown as Record<string, unknown>);
        notifications.show({ title: 'Updated', message: 'Processing job updated', color: 'green' });
      } else {
        await api.createProcessingJob(form as unknown as Record<string, unknown>);
        notifications.show({ title: 'Created', message: 'Processing job created', color: 'green' });
      }
      closeModal();
      await loadData();
    } catch (err: unknown) {
      notifications.show({ title: 'Error', message: err instanceof Error ? err.message : String(err), color: 'red' });
    } finally {
      setSaving(false);
    }
  }

  function openDeleteConfirm(job: ProcessingJob) {
    setDeleteTargetJob(job);
    setDeleteConfirmText('');
    openDeleteModal();
  }

  function closeDelete() {
    closeDeleteModal();
    setDeleteTargetJob(null);
    setDeleteConfirmText('');
  }

  async function handleDeleteConfirmed() {
    const id = deleteTargetJob?.id;
    if (!id) return;
    if (deleteConfirmText.trim().toLowerCase() !== 'delete') return;
    try {
      setDeleting(true);
      await api.deleteProcessingJob(id);
      if (selectedJob === id) setSelectedJob(null);
      notifications.show({ title: 'Deleted', message: 'Processing job removed', color: 'orange' });
      closeDelete();
      await loadData();
    } catch (err: unknown) {
      notifications.show({ title: 'Error', message: err instanceof Error ? err.message : String(err), color: 'red' });
    } finally {
      setDeleting(false);
    }
  }

  function handleNameChange(name: string) {
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
    setForm((prev) => ({ ...prev, name, slug: editing ? prev.slug : slug }));
  }

  const profileOptions = aiProfiles.map((p) => ({
    value: p.id,
    label: `${p.name} (${p.provider?.name || 'unknown'})`,
  }));

  return {
    form,
    setForm,
    saving,
    editing,
    modalOpened,
    closeModal,
    openCreate,
    openEdit,
    handleSubmit,
    handleNameChange,
    profileOptions,
    deleteModalOpened,
    deleteTargetJob,
    deleteConfirmText,
    setDeleteConfirmText,
    deleting,
    openDeleteConfirm,
    closeDelete,
    handleDeleteConfirmed,
  };
}
