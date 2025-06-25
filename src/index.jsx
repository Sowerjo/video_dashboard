import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

// Garante que existe o elemento #root
const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<App />);
} else {
  console.error("Elemento #root não encontrado!");
}
