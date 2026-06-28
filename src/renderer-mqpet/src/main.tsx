// src/renderer-mqpet/src/main.tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MqpetStage } from './MqpetStage';

const container = document.getElementById('root');
if (!container) throw new Error('mqpet renderer root not found');
createRoot(container).render(
  <StrictMode>
    <MqpetStage />
  </StrictMode>
);
