import { Suspense, lazy, useEffect } from 'react';
import { AppProvider } from './features/app/AppProvider';
import { Shell } from './features/app/Shell';
import { DetailSkeleton } from './features/detail/DetailSkeleton';
import { LinksPage } from './features/list/LinksPage';
import { matchDetail, navigate, useLocation } from './lib/router';

/**
 * The detail page brings the chart, the user agent parser, the flag table and
 * the rankings. None of that is needed for the list, so it loads on demand.
 * A deep link to /links/:id loads it straight away, behind the same skeleton
 * the page shows while its own data loads.
 */
const LinkDetailPage = lazy(() => import('./features/detail/LinkDetailPage'));

function Routes() {
  const { path } = useLocation();
  const detailId = matchDetail(path);
  const known = path === '/' || detailId !== null;

  // Any other path goes back to the list rather than showing a blank page.
  useEffect(() => {
    if (!known) navigate('/', { replace: true });
  }, [known]);

  useEffect(() => {
    document.title = detailId ? 'Link analytics · daffa.me Link Manager' : 'Links · daffa.me Link Manager';
  }, [detailId]);

  if (detailId !== null) {
    return (
      <Suspense fallback={<DetailSkeleton />}>
        <LinkDetailPage key={detailId} rawId={detailId} />
      </Suspense>
    );
  }
  return <LinksPage />;
}

export function App() {
  return (
    <AppProvider>
      <Shell>
        <Routes />
      </Shell>
    </AppProvider>
  );
}
