import { createRoot } from 'react-dom/client';
import { Provider, useDemo } from './state/store';
import { TipProvider } from './components/ui';
import { Shell } from './components/shell';
import { Conversation } from './pages/Conversation';
import { Trace } from './pages/Trace';
import { Memory } from './pages/Memory';
import { Reflection } from './pages/Reflection';
import { Skills } from './pages/Skills';
import { Evolution } from './pages/Evolution';
import { Settings } from './pages/Settings';
import { WorkspaceMemory } from './workspace/Memory';
import { WorkspaceSkills } from './workspace/Skills';
import { WorkspaceReflection } from './workspace/Reflection';
import { WorkspaceEvolution } from './workspace/Evolution';
import { WorkspaceDataProvider } from './workspace/host-data';
import './styles.css';
import './workspace/workspace.css';
function App() {
  const { page, mode, epoch } = useDemo();
  return (
    <Shell>
      <div key={`${mode}:${epoch}`}>
        <WorkspaceDataProvider>
          {Object.entries({
            chat: <Conversation />,
            trace: <Trace />,
            memory: mode === 'quiet' ? <WorkspaceMemory /> : <Memory />,
            reflection: mode === 'quiet' ? <WorkspaceReflection /> : <Reflection />,
            skills: mode === 'quiet' ? <WorkspaceSkills /> : <Skills />,
            evolution: mode === 'quiet' ? <WorkspaceEvolution /> : <Evolution />,
            settings: <Settings />,
          }).map(([id, view]) => (
            <div key={id} hidden={page !== id}>
              {view}
            </div>
          ))}
        </WorkspaceDataProvider>
      </div>
    </Shell>
  );
}
const root = document.getElementById('root');
if (
  root &&
  (import.meta.env.MODE === 'host' || new URLSearchParams(location.search).get('data') === 'host') &&
  new URLSearchParams(location.search).get('route') !== 'studio'
) {
  void import('./real/App').then(({ renderHostApp }) => renderHostApp(root));
} else if (root)
  createRoot(root).render(
    <Provider>
      <TipProvider>
        <App />
      </TipProvider>
    </Provider>,
  );
