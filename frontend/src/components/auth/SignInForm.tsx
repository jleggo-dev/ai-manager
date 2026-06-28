import { useState, type FormEvent } from 'react';
import { Stack, TextInput, PasswordInput, Button, Text, Anchor } from '@mantine/core';
import { signInWithEmail } from '../../lib/auth-session';
import styles from './AuthLanding.module.css';

interface SignInFormProps {
  onForgotPassword: () => void;
  onSuccess: () => void;
}

export default function SignInForm({ onForgotPassword, onSuccess }: SignInFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await signInWithEmail(email, password);
      onSuccess();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Sign in failed');
    } finally {
      setLoading(false);
    }
  };

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
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.currentTarget.value)}
        />
        <Anchor component="button" type="button" size="sm" onClick={onForgotPassword} className={styles.forgotLink}>
          Forgot password?
        </Anchor>
        <Button type="submit" loading={loading} fullWidth>
          Sign in
        </Button>
        {error ? (
          <Text size="sm" c="red" className={styles.errorBox}>
            {error}
          </Text>
        ) : null}
      </Stack>
    </form>
  );
}
