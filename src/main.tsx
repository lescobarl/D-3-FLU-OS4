import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { FLU_CONFIG } from './voice/lib/fluConfig';
import './index.css';

// Declaración global del tipo de window.FLU_CONFIG (asignado abajo).
declare global {
    interface Window {
        FLU_CONFIG?: typeof FLU_CONFIG;
    }
}

// Exponer la configuración real en window para lecturas del panel de ajustes.
window.FLU_CONFIG = FLU_CONFIG;

// Registrar el Service Worker de la PWA (notificaciones/offscreen).
// Regla #1: habilitado por FLU_CONFIG.notifications.enabled (sin hardcode).
if (
  'serviceWorker' in navigator &&
  (FLU_CONFIG as any).notifications?.enabled !== false
) {
  navigator.serviceWorker
    .register('/sw.js')
    .catch((err) => console.error('Error al registrar el Service Worker de la PWA:', err));
}

// Arnés de comparación ASR: SOLO en desarrollo y solo en /asr-lab.
// En producción el import dinámico se elimina del bundle (import.meta.env.DEV=false).
const isAsrLab =
  import.meta.env.DEV && window.location.pathname.replace(/\/+$/, '') === '/asr-lab'
const AsrLab = isAsrLab ? React.lazy(() => import('./dev/asrLab/AsrLab')) : null

ReactDOM.createRoot(document.getElementById('root')!).render(
  isAsrLab && AsrLab ? (
    <React.Suspense fallback={null}>
      <AsrLab />
    </React.Suspense>
  ) : (
    <React.StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </React.StrictMode>
  ),
);
