import { useState, type FormEvent } from 'react';
import { Stack, TextInput, PasswordInput, Button, Text, Alert } from '@mantine/core';
import { IconMail } from '@tabler/icons-react';
import { signUpWithEmail } from '../../lib/auth-session';

interface SignUpFormProps {
  onSuccess: () => void;
}

export default function SignUpForm({ onSuccess }: SignUpFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmationSent, setConfirmationSent] = useState(false);

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
      const result = await signUpWithEmail(email, password);
      if (result.needsEmailConfirmation) {
        setConfirmationSent(true);
        return;
      }
      onSuccess();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Sign up failed');
    } finally {
      setLoading(false);
    }
  };

  if (confirmationSent) {
    return (
      <Alert icon={<IconMail size={18} />} title="Check your email" color="blue">
        We sent a confirmation link to <strong>{email}</strong>. After confirming, sign in — your account will be
        pending until an administrator approves it.
      </Alert>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <Stack gap="sm">
        <TextInput
          label="Email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.currentTarget.value)}
        />
        <PasswordInput
          label="Password"
          autoComplete="new-password"
          required
          description="At least 8 characters"
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
          Create account
        </Button>
        <Text size="xs" c="dimmed">
          New accounts require administrator approval before you can access the app.
        </Text>
        {error ? (
          <Text size="sm" c="red">
            {error}
          </Text>
        ) : null}
      </Stack>
    </form>
  );
}
