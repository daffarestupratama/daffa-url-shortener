import { Suspense, lazy, useEffect } from 'react';
import { DASHBOARD_BASE, matchDetail, navigate, useLocation } from '../../lib/router';
import { DetailSkeleton } from '../detail/DetailSkeleton';
import { LinksPage } from '../list/LinksPage';
import { AppProvider } from './AppProvider';
import { Shell } from './Shell';

/**
 * The detail page brings the chart, the user agent parser, the flag table and
 * the rankings. None of that is needed for the list, so it loads on demand.
 * A deep link to /dashboard/links/:id loads it straight away, behind the same
 * skeleton the page shows while its own data loads.
 */
const LinkDetailPage = lazy(() => import('../detail/LinkDetailPage'));

function Routes() {
  const { path } = useLocation();
  const detailId = matchDetail(path);
  const known = path === DASHBOARD_BASE || detailId !== null;

  // /dashboard/ and any other path under it go back to the list rather than
  // showing a blank page. The query is kept, so /dashboard/?tab=public works.
  useEffect(() => {
    if (!known) navigate(`${DASHBOARD_BASE}${window.location.search}`, { replace: true });
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
  return known ? <LinksPage /> : null;
}

/** The owner dashboard under /dashboard. Default export for the lazy import in main.tsx. */
export default function DashboardApp() {
  return (
    <AppProvider>
      <Shell>
        <Routes />
      </Shell>
    </AppProvider>
  );
}
