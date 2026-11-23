import React, { lazy, Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { App } from './App';
import '@fontsource-variable/bricolage-grotesque/opsz.css';
import './styles.css';

const previewMode = import.meta.env.VITE_PREVIEW_MOCK === 'true';
const Router = previewMode ? HashRouter : BrowserRouter;
const PreviewBar = previewMode ? lazy(() => import('./PreviewBar').then((m) => ({ default: m.PreviewBar }))) : null;

const client = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, error) => !('status' in error && [401, 403, 404].includes(Number(error.status))) && count < 1,
      staleTime: 15000,
      refetchOnWindowFocus: true,
    },
    mutations: { retry: false },
  },
});
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={client}>
      <Router>
        <App />
      </Router>
      {PreviewBar && (
        <Suspense fallback={null}>
          <PreviewBar />
        </Suspense>
      )}
      <Toaster
        position="bottom-right"
        toastOptions={{ style: { borderRadius: 'var(--radius-ui)', fontFamily: 'var(--font-sans)' } }}
      />
    </QueryClientProvider>
  </React.StrictMode>,
);
