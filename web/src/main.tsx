import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import './index.css';

const racine = document.getElementById('racine');
if (!racine) throw new Error('Élément #racine absent de index.html.');

createRoot(racine).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
