import React from 'react';
import { createRoot } from 'react-dom/client';
import { UnlockGate } from './components/UnlockGate';

createRoot(document.getElementById('root')!).render(<React.StrictMode><UnlockGate /></React.StrictMode>);
