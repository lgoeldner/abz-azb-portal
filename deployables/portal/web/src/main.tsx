import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { App } from './App';
import './styles.css';
const client = new QueryClient({ defaultOptions: { queries: { retry: (count, error) => !('status' in error && [401,403,404].includes(Number(error.status))) && count < 1, staleTime: 15000, refetchOnWindowFocus: true }, mutations: { retry: false } } });
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><QueryClientProvider client={client}><BrowserRouter><App/></BrowserRouter><Toaster position="bottom-right" toastOptions={{ style: { borderRadius: 'var(--radius-ui)', fontFamily: 'var(--font-sans)' } }}/></QueryClientProvider></React.StrictMode>);
