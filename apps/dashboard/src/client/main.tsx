// Global styles first, so component styles always come later in the cascade.
import './styles/fonts';
import './styles/tokens.css';
import './styles/base.css';
import { StrictMode, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { resolveBoot } from './boot';

/**
 * The boot entry. It holds the global styles and nothing of either app: the
 * public page and the dashboard are separate lazy chunks, so / never loads
 * dashboard code and /dashboard never loads public page code. npm run
 * check:bundle proves this from the build's module map.
 */

const decision = resolveBoot(window.location.pathname, window.location.search);

if ('redirect' in decision) {
  window.location.replace(decision.redirect);
} else {
  if (decision.replace) window.history.replaceState(null, '', decision.replace);
  const load: Promise<{ default: ComponentType }> =
    decision.app === 'dashboard' ? import('./features/app/DashboardApp') : import('./public/PublicApp');

  const root = document.getElementById('root');
  if (!root) throw new Error('The #root element is missing from index.html.');

  void load.then(({ default: App }) => {
    createRoot(root).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  });
}
