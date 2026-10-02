import type { Link, PublicLinkItem } from '@daffa/shared';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { applyDetailOverlay, applyListOverlay, listFlags } from './devPreview';

// The module announces the first preview it sees on the console.
beforeAll(() => {
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
});

const link = { id: 1, slug: 'cv', title: 'CV and LinkedIn profile' } as Link;
const pub = { id: 11, slug: 'x7kq2m', host: 'docs.google.com' } as PublicLinkItem;

/** Fake app and page actions that record every call with its arguments. */
function recorder() {
  const calls: Array<[string, unknown[]]> = [];
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push([name, args]);
    };
  return {
    calls,
    actions: {
      openCreate: record('openCreate'),
      openEdit: record('openEdit'),
      openQr: record('openQr'),
      openDelete: record('openDelete'),
      toast: record('toast'),
      openPublicDelete: record('openPublicDelete'),
      openBlock: record('openBlock'),
      openBlocked: record('openBlocked'),
    },
  };
}

/** True when some argument of the call is an object with preview: true. */
const marksPreview = (args: unknown[]) =>
  args.some((arg) => typeof arg === 'object' && arg !== null && (arg as { preview?: boolean }).preview === true);

// The list page owns these two, and always opens them in preview mode.
const PAGE_PREVIEW_ONLY = ['openPublicDelete', 'openBlock'];
// These open nothing that can change data.
const READ_ONLY = ['openQr', 'toast'];

describe('list overlays never open a live dialog', () => {
  const overlays = [
    'create',
    'create-errors',
    'create-ok',
    'create-url',
    'edit',
    'delete',
    'qr',
    'toast',
    'blocked',
    'blocked-empty',
    'blocked-nomatch',
    'public-qr',
    'public-delete',
    'block',
    'block-none',
    'block-covered',
  ];

  for (const overlay of overlays) {
    it(`?overlay=${overlay}`, () => {
      const { calls, actions } = recorder();
      expect(applyListOverlay(`?overlay=${overlay}`, actions, { privateLink: link, publicLink: pub })).toBe(true);
      expect(calls).toHaveLength(1);
      const [name, args] = calls[0]!;
      if (READ_ONLY.includes(name) || PAGE_PREVIEW_ONLY.includes(name)) return;
      expect(marksPreview(args), `${name} ${JSON.stringify(args)}`).toBe(true);
    });
  }

  it('waits for the first row before opening a dialog that needs one', () => {
    const { calls, actions } = recorder();
    expect(applyListOverlay('?overlay=delete', actions, { privateLink: null, publicLink: null })).toBe(false);
    expect(applyListOverlay('?overlay=block', actions, { privateLink: link, publicLink: null })).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('opens menus through flags, which RowMenu treats as preview', () => {
    expect(listFlags('?overlay=menu').menuOpen).toBe(true);
    expect(listFlags('?overlay=menu-blocked')).toMatchObject({ menuOpen: true, menuBlocked: true });
  });
});

describe('detail overlays never open a live dialog', () => {
  for (const overlay of ['edit', 'delete']) {
    it(`?overlay=${overlay}`, () => {
      const { calls, actions } = recorder();
      applyDetailOverlay(`?overlay=${overlay}`, actions, link);
      expect(calls).toHaveLength(1);
      expect(marksPreview(calls[0]![1])).toBe(true);
    });
  }
});

describe('no preview', () => {
  it('opens nothing without an overlay', () => {
    const { calls, actions } = recorder();
    expect(applyListOverlay('', actions, { privateLink: link, publicLink: pub })).toBe(true);
    applyDetailOverlay('', actions, link);
    expect(calls).toHaveLength(0);
  });
});
