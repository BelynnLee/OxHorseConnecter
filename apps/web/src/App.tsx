import { lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext.tsx';
import { ThemeProvider } from './contexts/ThemeContext.tsx';
import { I18nProvider, useT } from './i18n/index.ts';
import LoginPage from './pages/LoginPage.tsx';
import DevicesPage from './pages/DevicesPage.tsx';
import TaskDetailPage from './pages/TaskDetailPage.tsx';
import HistoryPage from './pages/HistoryPage.tsx';
import TemplatesPage from './pages/TemplatesPage.tsx';
import SettingsPage from './pages/SettingsPage.tsx';
import ConfigPage from './pages/ConfigPage.tsx';
import ControlPlanePage from './pages/ControlPlanePage.tsx';
import EvalComparisonPage from './pages/EvalComparisonPage.tsx';
import Layout from './components/Layout.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { LoadingState } from './components/ui/LoadingState.tsx';

const AgentWorkbenchPage = lazy(() => import('./pages/AgentWorkbenchPage.tsx'));

function CenteredSpinner() {
  const { t } = useT();
  return <LoadingState label={t.loading} className="h-full flex-none" />;
}

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { token, loading } = useAuth();
  if (loading) {
    return <CenteredSpinner />;
  }
  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function LocalizedErrorBoundary({ children }: { children: ReactNode }) {
  const { t } = useT();
  return (
    <ErrorBoundary
      fallback={(error, reset) => (
        <div className="flex h-full items-center justify-center bg-bg-app px-4">
          <div className="w-full max-w-md border border-danger/30 bg-bg-surface-2 p-6 text-sm">
            <div className="mb-3 flex items-center gap-2 text-danger">
              <span className="font-medium uppercase tracking-wide">{t.errorBoundary.title}</span>
            </div>
            <p className="mb-4 break-words text-text-secondary">{error.message}</p>
            <button
              type="button"
              onClick={reset}
              className="border border-border-default bg-bg-surface px-3 py-1.5 text-xs uppercase tracking-wide text-text-secondary hover:bg-bg-hover"
            >
              {t.errorBoundary.retry}
            </button>
          </div>
        </div>
      )}
    >
      {children}
    </ErrorBoundary>
  );
}

function WorkbenchAliasRedirect() {
  const location = useLocation();
  return (
    <Navigate
      to={{
        pathname: '/workbench',
        search: location.search,
      }}
      replace
      state={location.state}
    />
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <I18nProvider>
          <LocalizedErrorBoundary>
            <BrowserRouter>
              <Routes>
                <Route path="/login" element={<LoginPage />} />
                <Route
                  path="/"
                  element={
                    <ProtectedRoute>
                      <Layout />
                    </ProtectedRoute>
                  }
                >
                  <Route index element={<DevicesPage />} />
                  <Route path="devices" element={<DevicesPage />} />
                  <Route
                    path="workbench"
                    element={
                      <Suspense fallback={<CenteredSpinner />}>
                        <AgentWorkbenchPage />
                      </Suspense>
                    }
                  />
                  <Route path="tasks/new" element={<WorkbenchAliasRedirect />} />
                  <Route path="task/new" element={<WorkbenchAliasRedirect />} />
                  <Route path="runs/:id" element={<TaskDetailPage />} />
                  <Route path="tasks/:id" element={<TaskDetailPage />} />
                  <Route path="history" element={<HistoryPage />} />
                  <Route path="templates" element={<TemplatesPage />} />
                  <Route path="control-plane" element={<ControlPlanePage />} />
                  <Route path="evals" element={<EvalComparisonPage />} />
                  <Route path="config" element={<ConfigPage />} />
                  <Route path="settings" element={<SettingsPage />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Route>
              </Routes>
            </BrowserRouter>
          </LocalizedErrorBoundary>
        </I18nProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
