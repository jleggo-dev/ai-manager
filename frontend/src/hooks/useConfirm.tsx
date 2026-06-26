import { useCallback } from 'react';
import { Text } from '@mantine/core';
import { modals } from '@mantine/modals';

interface ConfirmOptions {
  title?: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmColor?: string;
  destructive?: boolean;
}

export default function useConfirm(): (opts?: ConfirmOptions) => Promise<boolean> {
  return useCallback(
    ({
      title = 'Are you sure?',
      message = '',
      confirmLabel,
      cancelLabel = 'Cancel',
      confirmColor,
      destructive = true,
    }: ConfirmOptions = {}) => {
      const color = confirmColor || (destructive ? 'red' : 'royal');
      const label = confirmLabel || (destructive ? 'Delete' : 'Confirm');

      return new Promise<boolean>((resolve) => {
        modals.openConfirmModal({
          title: (
            <Text fw={600} size="lg">
              {title}
            </Text>
          ),
          centered: true,
          children: (
            <Text size="sm" c="dimmed">
              {message}
            </Text>
          ),
          labels: { confirm: label, cancel: cancelLabel },
          confirmProps: { color, radius: 'lg' },
          cancelProps: { variant: 'subtle', color: 'gray', radius: 'lg' },
          onConfirm: () => resolve(true),
          onCancel: () => resolve(false),
          onClose: () => resolve(false),
          groupProps: { mt: 'md' },
        });
      });
    },
    [],
  );
}
