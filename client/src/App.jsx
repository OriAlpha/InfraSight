import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useParams, useLocation } from 'react-router-dom';
import Layout from './components/Layout/Layout';
import ErrorBoundary from './components/ErrorBoundary';

// Route-level code splitting. Recharts and the larger detail views dominated a
// single ~900 kB bundle that every visitor downloaded before seeing anything.
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Logs = lazy(() => import('./pages/Logs'));
const LogDetail = lazy(() => import('./pages/LogDetail'));
const Analytics = lazy(() => import('./pages/Analytics'));
const Prompts = lazy(() => import('./pages/Prompts'));
const Playground = lazy(() => import('./pages/Playground'));
const Settings = lazy(() => import('./pages/Settings'));
const NotFound = lazy(() => import('./pages/NotFound'));

function NavigateToLogsConversation() {
  const { id } = useParams();
  return <Navigate to={`/logs?view=conversations&conversationId=${id}`} replace />;
}

function RouteFallback() {
  return (
    <div style={{ padding: '2rem', color: 'var(--text-secondary)' }}>
      Loading…
    </div>
  );
}

/**
 * Resets the error boundary when the route changes, so a failure on one page
 * does not persist after the user navigates away.
 */
function RoutedContent({ children }) {
  const location = useLocation();
  return (
    <ErrorBoundary key={location.pathname}>
      <Suspense fallback={<RouteFallback />}>{children}</Suspense>
    </ErrorBoundary>
  );
}

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<RoutedContent><Dashboard /></RoutedContent>} />
        <Route path="/logs" element={<RoutedContent><Logs /></RoutedContent>} />
        <Route path="/logs/:id" element={<RoutedContent><LogDetail /></RoutedContent>} />
        <Route path="/analytics" element={<RoutedContent><Analytics /></RoutedContent>} />
        <Route path="/evals" element={<Navigate to="/logs" replace />} />
        <Route path="/conversations" element={<Navigate to="/logs?view=conversations" replace />} />
        <Route path="/conversations/:id" element={<NavigateToLogsConversation />} />
        <Route path="/prompts" element={<RoutedContent><Prompts /></RoutedContent>} />
        <Route path="/playground" element={<RoutedContent><Playground /></RoutedContent>} />
        <Route path="/traces" element={<Navigate to="/logs?view=traces" replace />} />
        <Route path="/settings" element={<RoutedContent><Settings /></RoutedContent>} />
        <Route path="*" element={<RoutedContent><NotFound /></RoutedContent>} />
      </Route>
    </Routes>
  );
}
