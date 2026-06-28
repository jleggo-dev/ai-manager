import { useState, type FormEvent } from 'react';
import { Stack, TextInput, Button, Text, Alert, Anchor } from '@mantine/core';
import { IconMailCheck } from '@tabler/icons-react';
import { requestPasswordReset } from '../../lib/auth-session';
import styles from './AuthLanding.module.css';

interface ForgotPasswordFormProps {
  onBack: () => void;
}

export default function ForgotPasswordForm({ onBack }: ForgotPasswordFormProps) {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await requestPasswordReset(email);
      setSent(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not send reset email');
    } finally {
      setLoading(false);
    }
  };

  if (sent) {
    return (
      <Stack gap="md">
        <Alert icon={<IconMailCheck size={18} />} title="Email sent" color="green">
          If an account exists for <strong>{email}</strong>, you will receive a password reset link shortly.
        </Alert>
        <Anchor component="button" type="button" onClick={onBack} className={styles.backLink}>
          Back to sign in
        </Anchor>
      </Stack>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <Stack gap="sm">
        <Text size="sm" c="dimmed">
          Enter your email and we will send a link to reset your password.
        </Text>
        <TextInput
          label="Email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.currentTarget.value)}
        />
        <Button type="submit" loading={loading} fullWidth>
          Send reset link
        </Button>
        <Anchor component="button" type="button" onClick={onBack} className={styles.backLink}>
          Back to sign in
        </Anchor>
        {error ? (
          <Text size="sm" c="red">
            {error}
          </Text>
        ) : null}
      </Stack>
    </form>
  );
}
