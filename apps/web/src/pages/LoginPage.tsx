import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Bot, Loader2 } from 'lucide-react';
import { Backdrop } from '../components/Backdrop.tsx';
import { Button } from '../components/ui/Button.tsx';
import { Input } from '../components/ui/Input.tsx';
import { LoadingState } from '../components/ui/LoadingState.tsx';
import { StatusBanner } from '../components/ui/StatusBanner.tsx';
import { useAuth } from '../contexts/AuthContext.tsx';
import { useT } from '../i18n/index.ts';
import { getErrorMessage } from '../lib/format.ts';

export default function LoginPage() {
  const { login, token, loading } = useAuth();
  const { t } = useT();
  const navigate = useNavigate();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (loading) {
    return <LoadingState label={t.loading} className="h-full flex-none" />;
  }

  if (token) {
    return <Navigate to="/" replace />;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');

    if (!username.trim() || !password) {
      setError(t.login.errorRequired);
      return;
    }

    setSubmitting(true);
    try {
      await login(username.trim(), password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(getErrorMessage(err, t.login.errorFailed));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="relative h-full overflow-auto bg-bg-app px-4 text-text-primary">
      <Backdrop />
      <div className="relative z-10 flex min-h-full items-center justify-center py-8">
        <div className="w-full max-w-md">
          <div className="mb-8 text-center">
            <div className="mb-4 inline-flex h-11 w-11 items-center justify-center border border-accent/35 bg-accent-soft text-accent shadow-[0_0_28px_rgb(var(--accent)/0.13)]">
              <Bot className="h-5 w-5" />
            </div>
            <h1 className="text-xl font-bold uppercase tracking-[0.08em] text-text-primary blend-lighter">
              {t.login.title}
            </h1>
            <p className="mt-1 text-sm text-text-tertiary">{t.nav.subtitle}</p>
          </div>

          <div className="border border-border-default bg-bg-surface-2 p-6 shadow-md backdrop-blur-md">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label
                  htmlFor="username"
                  className="block text-sm font-medium text-text-secondary mb-1.5"
                >
                  {t.login.username}
                </label>
                <Input
                  id="username"
                  type="text"
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={submitting}
                />
              </div>

              <div>
                <label
                  htmlFor="password"
                  className="block text-sm font-medium text-text-secondary mb-1.5"
                >
                  {t.login.password}
                </label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={submitting}
                />
              </div>

              <StatusBanner tone="error" message={error} />

              <Button type="submit" disabled={submitting} variant="primary" className="mt-2 w-full">
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t.login.submitting}
                  </>
                ) : (
                  t.login.submit
                )}
              </Button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
