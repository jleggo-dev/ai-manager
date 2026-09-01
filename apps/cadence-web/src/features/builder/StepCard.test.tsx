/**
 * Press-every-button coverage for one step card: the chip, the rename input, the tool-specific
 * fields, ▲▼ reorder, and the ⋯ menu's duplicate/delete. Every callback prop gets exercised.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { StepCard } from './StepCard.tsx';
import { addCard, defaultBlockFor, type BuilderCard } from './builderSession.ts';

function card(block: ReturnType<typeof defaultBlockFor>): BuilderCard {
  return addCard([], block)[0] as BuilderCard;
}

function noop() {}
const baseProps = {
  onRename: noop,
  onPatchItem: noop,
  onCircuitRounds: noop,
  onCircuitExercise: noop,
  onCircuitAdd: noop,
  onCircuitRemove: noop,
  onDuplicate: noop,
  onDelete: noop,
  onMoveUp: noop,
  onMoveDown: noop,
};

afterEach(() => cleanup());

describe('StepCard — straight (timer) card', () => {
  it('shows the tool chip and the name, editable', () => {
    render(<StepCard {...baseProps} card={card(defaultBlockFor('timer'))} index={0} count={1} />);
    expect(screen.getByText('timer')).toBeTruthy();
    expect(screen.getByLabelText('Step name')).toHaveValue('Timer');
  });

  it('renaming calls onRename with the typed value', () => {
    const onRename = vi.fn();
    render(<StepCard {...baseProps} onRename={onRename} card={card(defaultBlockFor('timer'))} index={0} count={2} />);
    fireEvent.change(screen.getByLabelText('Step name'), { target: { value: 'Plank hold' } });
    expect(onRename).toHaveBeenCalledWith('Plank hold');
  });

  it('editing minutes calls onPatchItem with the new duration', () => {
    const onPatchItem = vi.fn();
    render(
      <StepCard {...baseProps} onPatchItem={onPatchItem} card={card(defaultBlockFor('timer'))} index={0} count={1} />,
    );
    fireEvent.change(screen.getByLabelText('Minutes'), { target: { value: '8' } });
    expect(onPatchItem).toHaveBeenCalledWith({ duration_min: 8 });
  });

  it('▲ is disabled at index 0, ▼ is disabled at the last index, both fire when enabled', () => {
    const onMoveUp = vi.fn();
    const onMoveDown = vi.fn();
    render(
      <StepCard
        {...baseProps}
        onMoveUp={onMoveUp}
        onMoveDown={onMoveDown}
        card={card(defaultBlockFor('timer'))}
        index={1}
        count={3}
      />,
    );
    fireEvent.click(screen.getByLabelText('Move step up'));
    fireEvent.click(screen.getByLabelText('Move step down'));
    expect(onMoveUp).toHaveBeenCalledTimes(1);
    expect(onMoveDown).toHaveBeenCalledTimes(1);
  });

  it('▲ disabled at the top, ▼ disabled at the bottom', () => {
    render(<StepCard {...baseProps} card={card(defaultBlockFor('timer'))} index={0} count={1} />);
    expect(screen.getByLabelText('Move step up')).toBeDisabled();
    expect(screen.getByLabelText('Move step down')).toBeDisabled();
  });

  it('the ⋯ menu opens on press, Duplicate fires onDuplicate and closes the menu', () => {
    const onDuplicate = vi.fn();
    render(
      <StepCard {...baseProps} onDuplicate={onDuplicate} card={card(defaultBlockFor('timer'))} index={0} count={1} />,
    );
    fireEvent.click(screen.getByLabelText('Step options'));
    expect(screen.getByText('Duplicate')).toBeTruthy();
    fireEvent.click(screen.getByText('Duplicate'));
    expect(onDuplicate).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Duplicate')).toBeNull();
  });

  it('the ⋯ menu’s Delete fires onDelete', () => {
    const onDelete = vi.fn();
    render(<StepCard {...baseProps} onDelete={onDelete} card={card(defaultBlockFor('timer'))} index={0} count={1} />);
    fireEvent.click(screen.getByLabelText('Step options'));
    fireEvent.click(screen.getByText('Delete'));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});

describe('StepCard — reps card', () => {
  it('editing sets/reps/load calls onPatchItem for each field', () => {
    const onPatchItem = vi.fn();
    render(
      <StepCard {...baseProps} onPatchItem={onPatchItem} card={card(defaultBlockFor('reps'))} index={0} count={1} />,
    );
    fireEvent.change(screen.getByLabelText('Sets'), { target: { value: '4' } });
    fireEvent.change(screen.getByLabelText('Reps'), { target: { value: '12' } });
    fireEvent.change(screen.getByLabelText('Load'), { target: { value: '135 lb' } });
    expect(onPatchItem).toHaveBeenNthCalledWith(1, { sets: 4 });
    expect(onPatchItem).toHaveBeenNthCalledWith(2, { reps: 12 });
    expect(onPatchItem).toHaveBeenNthCalledWith(3, { load: '135 lb' });
  });
});

describe('StepCard — circuit card', () => {
  it('shows the block label as the name (no single item to name)', () => {
    render(<StepCard {...baseProps} card={card(defaultBlockFor('circuit'))} index={0} count={1} />);
    expect(screen.getByLabelText('Step name')).toHaveValue('Circuit');
    expect(screen.getByText('circuit')).toBeTruthy();
  });

  it('rounds, an exercise name, add and remove all fire their own callbacks', () => {
    const onCircuitRounds = vi.fn();
    const onCircuitExercise = vi.fn();
    const onCircuitAdd = vi.fn();
    const onCircuitRemove = vi.fn();
    render(
      <StepCard
        {...baseProps}
        onCircuitRounds={onCircuitRounds}
        onCircuitExercise={onCircuitExercise}
        onCircuitAdd={onCircuitAdd}
        onCircuitRemove={onCircuitRemove}
        card={card(defaultBlockFor('circuit'))}
        index={0}
        count={1}
      />,
    );
    fireEvent.change(screen.getByLabelText('Rounds'), { target: { value: '5' } });
    expect(onCircuitRounds).toHaveBeenCalledWith(5);
    fireEvent.change(screen.getByLabelText('Exercise 1 name'), { target: { value: 'Lunges' } });
    expect(onCircuitExercise).toHaveBeenCalledWith(0, { name: 'Lunges' });
    fireEvent.click(screen.getByText('＋ Exercise'));
    expect(onCircuitAdd).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByLabelText('Remove exercise 1'));
    expect(onCircuitRemove).toHaveBeenCalledWith(0);
  });
});
