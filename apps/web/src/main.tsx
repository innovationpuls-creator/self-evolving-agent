import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { TipProvider } from './components/ui';
import './styles/product-system.css';

const root = document.getElementById('root');
if (!root) throw new Error('缺少 #root 容器');
createRoot(root).render(
  <TipProvider>
    <App />
  </TipProvider>,
);
