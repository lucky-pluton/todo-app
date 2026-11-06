import { useState } from 'react';
import type { FormEvent } from 'react';
import { CheckIcon } from './icons';

type AuthMode = 'login' | 'register';

interface LoginScreenProps {
  onLogin: (email: string, password: string) => Promise<void>;
  onRegister: (name: string, email: string, password: string) => Promise<void>;
  initialError?: string | null;
}

export default function LoginScreen({
  onLogin,
  onRegister,
  initialError = null,
}: LoginScreenProps) {
  const [mode, setMode] = useState<AuthMode>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(initialError);
  const [submitting, setSubmitting] = useState(false);

  function switchMode(next: AuthMode) {
    if (submitting || next === mode) return;
    setMode(next);
    setError(null);
    setPassword('');
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    const trimmedEmail = email.trim();
    const trimmedName = name.trim();

    if (mode === 'register' && !trimmedName) {
      setError('Enter your name.');
      return;
    }

    if (!trimmedEmail) {
      setError('Enter your email address.');
      return;
    }

    if (!password) {
      setError('Enter your password.');
      return;
    }

    if (mode === 'register' && password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      if (mode === 'login') {
        await onLogin(trimmedEmail, password);
      } else {
        await onRegister(trimmedName, trimmedEmail, password);
      }
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : 'Something went wrong. Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="login-heading">
        <span className="login-mark brand-mark" aria-hidden="true">
          <CheckIcon size={20} />
        </span>

        <div className="login-tabs" role="tablist" aria-label="Account mode">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'login'}
            className={mode === 'login' ? 'is-active' : undefined}
            onClick={() => switchMode('login')}
            disabled={submitting}
          >
            Sign in
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'register'}
            className={mode === 'register' ? 'is-active' : undefined}
            onClick={() => switchMode('register')}
            disabled={submitting}
          >
            Create account
          </button>
        </div>

        <h1 id="login-heading">
          {mode === 'login' ? 'Welcome back' : 'Create your account'}
        </h1>
        <p className="login-subtitle">
          {mode === 'login'
            ? 'Sign in to open your personal tasks and team workspaces.'
            : 'Your account keeps personal tasks separate from everyone else’s.'}
        </p>

        <form className="login-form" onSubmit={handleSubmit} noValidate>
          {mode === 'register' && (
            <label className="login-field">
              <span>Name</span>
              <input
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoComplete="name"
                placeholder="Your name"
                maxLength={60}
                disabled={submitting}
                autoFocus
              />
            </label>
          )}

          <label className="login-field">
            <span>Email</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              placeholder="you@example.com"
              maxLength={254}
              disabled={submitting}
              autoFocus={mode === 'login'}
            />
          </label>

          <label className="login-field">
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              placeholder={mode === 'login' ? 'Your password' : 'At least 8 characters'}
              maxLength={200}
              disabled={submitting}
            />
          </label>

          {error && (
            <p className="login-error" role="alert">
              {error}
            </p>
          )}

          <button type="submit" className="login-submit" disabled={submitting}>
            {submitting
              ? mode === 'login'
                ? 'Signing in…'
                : 'Creating account…'
              : mode === 'login'
                ? 'Sign in'
                : 'Create account'}
          </button>
        </form>

        <p className="login-note">
          Accounts and tasks are stored on this server. Choose a password you don’t
          reuse elsewhere.
        </p>
      </section>
    </main>
  );
}
