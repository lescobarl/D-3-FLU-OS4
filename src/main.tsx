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

// Solo en desarrollo: la app importa FLU_CONFIG directamente (no hay lectores de
// este global en src/). Publicarlo en produccion no aporta y expone la config interna.
if (import.meta.env.DEV) {
  window.FLU_CONFIG = FLU_CONFIG;
}

// Registrar el Service Worker de la PWA (notificaciones/offscreen).
// Regla #1: habilitado por FLU_CONFIG.notifications.enabled (sin hardcode).
if (
  'serviceWorker' in navigator &&
  (FLU_CONFIG).notifications?.enabled !== false
) {
  navigator.serviceWorker
    .register('/sw.js')
    .then((registration) => {
      // Fuerza la comprobación de una versión nueva del SW en cada arranque.
      registration.update().catch(() => { /* ignorado: la actualizacion del SW no debe romper el arranque */ });
    })
    .catch((err) => console.error('Error al registrar el Service Worker de la PWA:', err));

  // Auto-actualización: cuando un SW nuevo toma el control, recargar UNA vez
  // para servir el bundle nuevo. Sin esto, un cliente con la shell cacheada
  // vieja seguía ejecutando código antiguo tras "recargar".
  let swRefreshed = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (swRefreshed) return;
    swRefreshed = true;
    window.location.reload();
  });
}

// Arnés de comparación ASR: SOLO en desarrollo y solo en /asr-lab.
// En producción el import dinámico se elimina del bundle (import.meta.env.DEV=false).
const isAsrLab =
  import.meta.env.DEV && window.location.pathname.replace(/\/+$/, '') === '/asr-lab'
const AsrLab = isAsrLab ? React.lazy(() => import('./dev/asrLab/AsrLab')) : null

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('main.tsx: falta #root en index.html')
}

ReactDOM.createRoot(rootElement).render(
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
