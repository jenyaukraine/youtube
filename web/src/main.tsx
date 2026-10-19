import React from 'react';
import { createRoot } from 'react-dom/client';
import { UnlockGate } from '@/app/UnlockGate';
import '@/styles/tokens.css';
import '@/styles/base.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <UnlockGate />
  </React.StrictMode>,
);
