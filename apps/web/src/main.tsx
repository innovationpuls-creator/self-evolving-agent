import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { TipProvider } from './components/ui';
import './styles/product-system.css';

createRoot(document.getElementById('root')!).render(
  <TipProvider>
    <App />
  </TipProvider>,
);
