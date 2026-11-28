import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { App } from './App';
import '@fontsource-variable/figtree';
import '@fontsource-variable/merriweather/opsz.css';
import '@fontsource/instrument-serif/400.css';
import '@fontsource/poppins/600.css';
import '@fontsource/poppins/800.css';
import './styles.css';
// Vite dev serves index.html itself; Go adds data-env from ENV_LABEL everywhere else.
if (import.meta.env.DEV && !document.documentElement.dataset.env) document.documentElement.dataset.env = 'dev';
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
      <BrowserRouter>
        <App />
      </BrowserRouter>
      <Toaster
        position="bottom-right"
        // Clears the floating menu pill and mode switch on phones.
        mobileOffset={{ bottom: 80 }}
        toastOptions={{ style: { borderRadius: 'var(--radius-ui)', fontFamily: 'var(--font-sans)' } }}
      />
    </QueryClientProvider>
  </React.StrictMode>,
);
