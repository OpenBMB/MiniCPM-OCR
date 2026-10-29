import React, { Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ConfirmRenderer, ToastProvider, TooltipProvider } from '@map/ui';
import { QueryProvider } from './providers/QueryProvider';
import { useThemeSync } from './hooks/useThemeSync';
import { ErrorBoundary } from './components/ErrorBoundary';
import { PageLoading } from './components/PageLoading';
import PlaygroundPage from './pages/playground';
import './i18n';
import 'overlayscrollbars/overlayscrollbars.css';
import './theme-vars.css';
import './index.css';

function AppInit({ children }: { children: React.ReactNode }) {
  useThemeSync();
  return children;
}

function App() {
  return (
    <BrowserRouter>
      <ErrorBoundary level="app">
        <QueryProvider>
          <TooltipProvider>
            <ToastProvider>
              <AppInit>
                <ConfirmRenderer />
                <Routes>
                  <Route path="/" element={<Navigate to="/playground/document-parse" replace />} />
                  <Route
                    path="/playground"
                    element={<Navigate to="/playground/document-parse" replace />}
                  />
                  <Route
                    path="/playground/image-parse"
                    element={<Navigate to="/playground/document-parse" replace />}
                  />
                  <Route
                    path="/playground/field-extract"
                    element={<Navigate to="/playground/document-parse" replace />}
                  />
                  <Route
                    path="/playground/tts"
                    element={<Navigate to="/playground/document-parse" replace />}
                  />
                  <Route
                    path="/playground/duplex"
                    element={<Navigate to="/playground/document-parse" replace />}
                  />
                  <Route
                    path="/playground/language"
                    element={<Navigate to="/playground/document-parse" replace />}
                  />
                  <Route
                    path="/playground/:experience"
                    element={
                      <ErrorBoundary level="page">
                        <Suspense fallback={<PageLoading />}>
                          <PlaygroundPage />
                        </Suspense>
                      </ErrorBoundary>
                    }
                  />
                  <Route
                    path="*"
                    element={<Navigate to="/playground/document-parse" replace />}
                  />
                </Routes>
              </AppInit>
            </ToastProvider>
          </TooltipProvider>
        </QueryProvider>
      </ErrorBoundary>
    </BrowserRouter>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
