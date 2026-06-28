import { Stack, Text, Title, Button, Alert } from '@mantine/core';
import { IconClock, IconBan } from '@tabler/icons-react';
import type { AccountStatus } from '../../lib/auth-session';
import styles from './AuthLanding.module.css';

interface PendingApprovalProps {
  status: AccountStatus;
  email: string | null;
  onSignOut: () => void;
  onRefresh?: () => void;
}

export default function PendingApproval({ status, email, onSignOut, onRefresh }: PendingApprovalProps) {
  const isSuspended = status === 'suspended';

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <Title order={3} className={styles.cardTitle}>
            {isSuspended ? 'Account suspended' : 'Approval pending'}
          </Title>
        </div>
        <div className={styles.cardBody}>
          <Stack gap="md">
            <Alert
              icon={isSuspended ? <IconBan size={18} /> : <IconClock size={18} />}
              color={isSuspended ? 'red' : 'yellow'}
              title={isSuspended ? 'Access suspended' : 'Waiting for administrator approval'}
            >
              {isSuspended ? (
                <Text size="sm">
                  Your account{email ? ` (${email})` : ''} has been suspended. Contact a workspace administrator if
                  you believe this is a mistake.
                </Text>
              ) : (
                <Text size="sm">
                  Your account{email ? ` (${email})` : ''} is registered but not yet approved. A workspace administrator
                  must approve your access before you can use AI Admin.
                </Text>
              )}
            </Alert>
            {!isSuspended && onRefresh ? (
              <Button variant="light" onClick={onRefresh}>
                Check approval status
              </Button>
            ) : null}
            <Button variant="default" onClick={onSignOut}>
              Sign out
            </Button>
          </Stack>
        </div>
      </div>
    </div>
  );
}
