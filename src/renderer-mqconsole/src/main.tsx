// src/renderer-mqconsole/src/main.tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ConsoleApp } from './ConsoleApp';

const container = document.getElementById('root');
if (!container) throw new Error('mqconsole renderer root not found');
createRoot(container).render(
  <StrictMode>
    <ConsoleApp />
  </StrictMode>
);
