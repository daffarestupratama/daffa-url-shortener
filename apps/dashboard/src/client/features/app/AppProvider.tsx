import type { Link } from '@daffa/shared';
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { ToastView } from '../../components/overlay';
import { DeleteDialog } from '../overlays/DeleteDialog';
import { LinkFormDrawer, type FormSeed } from '../form/LinkFormDrawer';
import { QrModal } from '../overlays/QrModal';

export interface LinkRef {
  id: number;
  slug: string;
  title: string;
}

interface FormState {
  mode: 'create' | 'edit';
  link: Link | null;
  seed?: FormSeed;
}

interface AppApi {
  /** Bumped after every change, so pages refetch what they show. */
  version: number;
  refresh: () => void;
  toast: (message: string, options?: { sticky?: boolean }) => void;
  openCreate: (seed?: FormSeed) => void;
  openEdit: (link: Link, seed?: FormSeed) => void;
  openQr: (link: LinkRef) => void;
  openDelete: (link: LinkRef) => void;
  closeForm: () => void;
}

const AppContext = createContext<AppApi | null>(null);

export function useApp(): AppApi {
  const value = useContext(AppContext);
  if (!value) throw new Error('useApp must be used inside AppProvider.');
  return value;
}

const TOAST_MS = 2400;

export function AppProvider({ children }: { children: ReactNode }) {
  const [version, setVersion] = useState(0);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [qr, setQr] = useState<LinkRef | null>(null);
  const [toDelete, setToDelete] = useState<LinkRef | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  const toast = useCallback((message: string, options?: { sticky?: boolean }) => {
    window.clearTimeout(toastTimer.current);
    setToastMessage(message);
    if (!options?.sticky) toastTimer.current = window.setTimeout(() => setToastMessage(null), TOAST_MS);
  }, []);

  const api = useMemo<AppApi>(
    () => ({
      version,
      refresh,
      toast,
      openCreate: (seed) => setForm({ mode: 'create', link: null, seed }),
      openEdit: (link, seed) => setForm({ mode: 'edit', link, seed }),
      openQr: (link) => setQr(link),
      openDelete: (link) => setToDelete(link),
      closeForm: () => setForm(null),
    }),
    [version, refresh, toast],
  );

  return (
    <AppContext.Provider value={api}>
      {children}
      {form && (
        <LinkFormDrawer
          key={form.link?.id ?? 'new'}
          mode={form.mode}
          link={form.link}
          seed={form.seed}
          onClose={() => setForm(null)}
        />
      )}
      {qr && <QrModal link={qr} onClose={() => setQr(null)} />}
      {toDelete && (
        <DeleteDialog
          link={toDelete}
          onClose={() => setToDelete(null)}
          onDeleted={() => {
            setToDelete(null);
            setForm(null);
          }}
        />
      )}
      <ToastView message={toastMessage} />
    </AppContext.Provider>
  );
}
