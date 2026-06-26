import { render, screen, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import WorkflowInputEditor, { type InputVariableFormItem } from './WorkflowInputEditor';

const baseForm = {
  name: 'Test Workflow',
  slug: 'test-workflow',
  description: 'A test workflow',
  ai_profile_id: null,
  is_active: true,
  inputVariables: [] as InputVariableFormItem[],
};

const profileOptions = [
  { value: 'prof-1', label: 'Claude Agent' },
  { value: 'prof-2', label: 'Gemini Agent' },
];

function renderEditor(formOverrides: Partial<typeof baseForm> = {}, onChange = vi.fn()) {
  const form = { ...baseForm, ...formOverrides };
  return {
    onChange,
    ...render(
      <MantineProvider>
        <WorkflowInputEditor form={form} onChange={onChange} profileOptions={profileOptions} />
      </MantineProvider>,
    ),
  };
}

describe('WorkflowInputEditor', () => {
  it('renders Application Call heading', () => {
    renderEditor();
    expect(screen.getByText('Application Call')).toBeInTheDocument();
  });

  it('renders workflow name and slug fields with values', () => {
    renderEditor();
    expect(screen.getByDisplayValue('Test Workflow')).toBeInTheDocument();
    expect(screen.getByDisplayValue('test-workflow')).toBeInTheDocument();
  });

  it('calls onChange when workflow name is edited', () => {
    const { onChange } = renderEditor();
    const nameInput = screen.getByDisplayValue('Test Workflow');
    fireEvent.change(nameInput, { target: { value: 'New Name' } });
    expect(onChange).toHaveBeenCalledWith({ name: 'New Name' });
  });

  it('calls onChange when description is edited', () => {
    const { onChange } = renderEditor();
    const descInput = screen.getByDisplayValue('A test workflow');
    fireEvent.change(descInput, { target: { value: 'Updated desc' } });
    expect(onChange).toHaveBeenCalledWith({ description: 'Updated desc' });
  });

  it('renders active switch label', () => {
    renderEditor({ is_active: true });
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('shows empty state when no variables defined', () => {
    renderEditor();
    expect(screen.getByText(/No input variables defined/i)).toBeInTheDocument();
  });

  it('does not show empty state when variables exist', () => {
    renderEditor({
      inputVariables: [{ _uid: 'u1', name: 'topic', required: false }],
    });
    expect(screen.queryByText(/No input variables defined/i)).not.toBeInTheDocument();
  });

  it('renders existing variable fields', () => {
    renderEditor({
      inputVariables: [{ _uid: 'u1', name: 'topic', label: 'Topic', required: true }],
    });
    expect(screen.getByDisplayValue('topic')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Topic')).toBeInTheDocument();
  });

  it('calls onChange when Add Input Variable button is clicked', () => {
    const { onChange } = renderEditor();
    fireEvent.click(screen.getByRole('button', { name: /Add Input Variable/i }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const call = onChange.mock.calls[0]?.[0] as { inputVariables: InputVariableFormItem[] } | undefined;
    expect(call?.inputVariables).toHaveLength(1);
    expect(call?.inputVariables?.[0]?.name).toBe('');
    expect(call?.inputVariables?.[0]?.required).toBe(false);
  });

  it('calls onChange with updated variable when name changes', () => {
    const { onChange } = renderEditor({
      inputVariables: [{ _uid: 'u1', name: 'old-name', required: false }],
    });
    const input = screen.getByDisplayValue('old-name');
    fireEvent.change(input, { target: { value: 'new-name' } });
    expect(onChange).toHaveBeenCalledTimes(1);
    const call = onChange.mock.calls[0]?.[0] as { inputVariables: InputVariableFormItem[] } | undefined;
    expect(call?.inputVariables?.[0]?.name).toBe('new-name');
  });

  it('shows help text about variable syntax', () => {
    renderEditor();
    expect(screen.getByText(/variableName/)).toBeInTheDocument();
  });
});
