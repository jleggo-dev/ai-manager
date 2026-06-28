import { useState, type FormEvent } from 'react';
import { Stack, PasswordInput, Button, Text, Title } from '@mantine/core';
import { updatePassword } from '../../lib/auth-session';
import styles from './AuthLanding.module.css';

interface ResetPasswordFormProps {
  onSuccess: () => void;
}

export default function ResetPasswordForm({ onSuccess }: ResetPasswordFormProps) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await updatePassword(password);
      onSuccess();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not update password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <Title order={3} className={styles.cardTitle}>
            Set a new password
          </Title>
        </div>
        <div className={styles.cardBody}>
          <form onSubmit={handleSubmit}>
            <Stack gap="sm">
              <PasswordInput
                label="New password"
                autoComplete="new-password"
                required
                value={password}
                onChange={(e) => setPassword(e.currentTarget.value)}
              />
              <PasswordInput
                label="Confirm password"
                autoComplete="new-password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.currentTarget.value)}
              />
              <Button type="submit" loading={loading} fullWidth>
                Update password
              </Button>
              {error ? (
                <Text size="sm" c="red">
                  {error}
                </Text>
              ) : null}
            </Stack>
          </form>
        </div>
      </div>
    </div>
  );
}
