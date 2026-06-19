import { Routes, Route, Navigate, useParams } from 'react-router-dom';
import Layout from './components/Layout/Layout';
import Dashboard from './pages/Dashboard';
import Logs from './pages/Logs';
import LogDetail from './pages/LogDetail';
import Analytics from './pages/Analytics';
import Prompts from './pages/Prompts';
import Playground from './pages/Playground';
import Settings from './pages/Settings';
import NotFound from './pages/NotFound';

function NavigateToLogsConversation() {
  const { id } = useParams();
  return <Navigate to={`/logs?view=conversations&conversationId=${id}`} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/logs" element={<Logs />} />
        <Route path="/logs/:id" element={<LogDetail />} />
        <Route path="/analytics" element={<Analytics />} />
        <Route path="/evals" element={<Navigate to="/logs" replace />} />
        <Route path="/conversations" element={<Navigate to="/logs?view=conversations" replace />} />
        <Route path="/conversations/:id" element={<NavigateToLogsConversation />} />
        <Route path="/prompts" element={<Prompts />} />
        <Route path="/playground" element={<Playground />} />
        <Route path="/traces" element={<Navigate to="/logs?view=traces" replace />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
