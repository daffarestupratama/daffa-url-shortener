import type { Link } from '@daffa/shared';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { ToastView } from '../../components/overlay';
import { useToast, type ToastFn } from '../../lib/toast';
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

/** Dialogs a dev preview opens never change data: their confirm button only closes them. */
export interface OpenOptions {
  preview?: boolean;
}

interface DeleteState {
  link: LinkRef;
  preview: boolean;
}

interface AppApi {
  /** Bumped after every change, so pages refetch what they show. */
  version: number;
  refresh: () => void;
  toast: ToastFn;
  openCreate: (seed?: FormSeed) => void;
  openEdit: (link: Link, seed?: FormSeed) => void;
  openQr: (link: LinkRef) => void;
  openDelete: (link: LinkRef, options?: OpenOptions) => void;
  closeForm: () => void;
}

const AppContext = createContext<AppApi | null>(null);

export function useApp(): AppApi {
  const value = useContext(AppContext);
  if (!value) throw new Error('useApp must be used inside AppProvider.');
  return value;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [version, setVersion] = useState(0);
  const [form, setForm] = useState<FormState | null>(null);
  const [qr, setQr] = useState<LinkRef | null>(null);
  const [toDelete, setToDelete] = useState<DeleteState | null>(null);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  const { message: toastMessage, toast } = useToast();

  const api = useMemo<AppApi>(
    () => ({
      version,
      refresh,
      toast,
      openCreate: (seed) => setForm({ mode: 'create', link: null, seed }),
      openEdit: (link, seed) => setForm({ mode: 'edit', link, seed }),
      openQr: (link) => setQr(link),
      openDelete: (link, options) => setToDelete({ link, preview: options?.preview ?? false }),
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
          link={toDelete.link}
          preview={toDelete.preview}
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
