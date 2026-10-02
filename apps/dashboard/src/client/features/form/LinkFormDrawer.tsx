import {
  addTag,
  deriveStatus,
  generateSlug,
  hostPath,
  normalizeUrlInput,
  validateSlug,
  validateUrl,
  type Link,
  type LinkInput,
} from '@daffa/shared';
import { useEffect, useState, type KeyboardEvent } from 'react';
import { Button, IconButton, Switch } from '../../components/controls';
import { Field, FieldError, FieldOk, Help, Label, Preview, TextArea, TextInput } from '../../components/fields';
import { Drawer } from '../../components/overlay';
import { AddChip, GateTile, RemovableTag, StatusBadge } from '../../components/tiles';
import { api, ApiError, isAbort } from '../../lib/api';
import { formatDateTime, fromWibInput, toWibInput } from '../../lib/format';
import { urlPreview } from '../../lib/urlPreview';
import { useResource } from '../../lib/useResource';
import { useApp } from '../app/AppProvider';
import { useQrMatrix } from '../../lib/useQr';
import styles from './form.module.css';

const cx = (...names: Array<string | false | null | undefined>) => names.filter(Boolean).join(' ');

/** Initial values forced by the dev state preview, for the error and success states of the form. */
export interface FormSeed {
  url?: string;
  slug?: string;
  tried?: boolean;
}

type Availability =
  | { status: 'idle' }
  | { status: 'checking'; slug: string }
  | { status: 'available'; slug: string }
  | { status: 'taken'; slug: string; message: string };

/**
 * Asks the API whether a slug is free, 300 ms after typing stops. Only runs
 * once the slug passes the instant local checks, so reserved or malformed
 * slugs never cost a request.
 */
function useSlugAvailability(slug: string, exclude: number | null, enabled: boolean): Availability {
  const [state, setState] = useState<Availability>({ status: 'idle' });
  useEffect(() => {
    if (!enabled) {
      setState({ status: 'idle' });
      return;
    }
    setState({ status: 'checking', slug });
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      api.slugAvailable(slug, exclude, controller.signal).then(
        (result) =>
          setState(
            result.available
              ? { status: 'available', slug }
              : { status: 'taken', slug, message: result.message ?? 'This slug is not available.' },
          ),
        (error: unknown) => {
          // A failed check is not a verdict. The save request validates again.
          if (!isAbort(error)) setState({ status: 'idle' });
        },
      );
    }, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [slug, exclude, enabled]);
  return state;
}

interface LinkFormDrawerProps {
  mode: 'create' | 'edit';
  link: Link | null;
  seed?: FormSeed;
  onClose: () => void;
}

export function LinkFormDrawer({ mode, link, seed, onClose }: LinkFormDrawerProps) {
  const { refresh, toast, openDelete, version } = useApp();
  const editing = mode === 'edit' && link !== null;

  const [url, setUrl] = useState(seed?.url ?? link?.url ?? '');
  const [slug, setSlug] = useState(seed?.slug ?? link?.slug ?? '');
  const [title, setTitle] = useState(link?.title ?? '');
  const [description, setDescription] = useState(link?.description ?? '');
  const [tags, setTags] = useState<string[]>(link?.tags ?? []);
  const [tagDraft, setTagDraft] = useState('');
  const [expires, setExpires] = useState(toWibInput(link?.expiresAt ?? null));
  const [active, setActive] = useState(link ? link.isActive : true);
  const [tried, setTried] = useState(seed?.tried ?? false);
  const [urlTouched, setUrlTouched] = useState(editing || Boolean(seed?.tried));
  const [serverError, setServerError] = useState<{ field: 'url' | 'slug' | null; message: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const knownTags = useResource(`tags:${version}`, (signal) => api.tags(signal));

  const slugUnchanged = editing && slug === link.slug;
  const slugLocalError = validateSlug(slug, { required: tried });
  const availability = useSlugAvailability(slug, link?.id ?? null, slug !== '' && slugLocalError === null && !slugUnchanged);

  const urlError =
    validateUrl(url, { required: tried || urlTouched }) ?? (serverError?.field === 'url' ? serverError.message : null);
  const savedAs = urlError ? null : urlPreview(url);
  const slugTakenError = availability.status === 'taken' && availability.slug === slug ? availability.message : null;
  const slugError = slugLocalError ?? slugTakenError ?? (serverError?.field === 'slug' ? serverError.message : null);
  const slugOk =
    slug !== '' && !slugError && (slugUnchanged || (availability.status === 'available' && availability.slug === slug));

  const expiresAt = fromWibInput(expires);
  const previewStatus = deriveStatus(active, expiresAt, Date.now());
  const previewSlug = slug || 'slug';
  const matrix = useQrMatrix(slug && !slugLocalError ? slug : 'slug');

  const commitTag = (raw: string) => {
    setTags((current) => addTag(current, raw));
    setTagDraft('');
  };

  const onTagKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitTag(tagDraft);
    } else if (event.key === 'Backspace' && tagDraft === '' && tags.length > 0) {
      setTags((current) => current.slice(0, -1));
    }
  };

  const save = async () => {
    setTried(true);
    setUrlTouched(true);
    setServerError(null);
    if (validateUrl(url, { required: true }) || validateSlug(slug, { required: true }) || slugTakenError) return;

    const input: LinkInput = {
      url: normalizeUrlInput(url),
      slug,
      title: title.trim(),
      description: description.trim(),
      tags,
      expiresAt,
      isActive: active,
    };
    setSaving(true);
    try {
      if (editing) await api.updateLink(link.id, input);
      else await api.createLink(input);
      toast(`Link daffa.me/${slug} saved`);
      refresh();
      onClose();
    } catch (error) {
      setSaving(false);
      if (error instanceof ApiError && error.code === 'invalid_url') setServerError({ field: 'url', message: error.message });
      else if (error instanceof ApiError && (error.code === 'invalid_slug' || error.code === 'slug_taken'))
        setServerError({ field: 'slug', message: error.message });
      else setServerError({ field: null, message: error instanceof ApiError ? error.message : 'The link could not be saved.' });
    }
  };

  const suggestions = (knownTags.data?.tags ?? []).filter((tag) => !tags.includes(tag));
  const hasFieldErrors = tried && Boolean(urlError || slugError);

  return (
    <Drawer labelledBy="form-title" onClose={onClose}>
      <div className={styles.head}>
        <div className={styles.headText}>
          <span className={styles.kicker}>{editing ? 'EDIT LINK' : 'NEW LINK'}</span>
          <h2 id="form-title" className={styles.heading}>
            {editing ? `Edit daffa.me/${link.slug}` : 'Create Link'}
          </h2>
        </div>
        <IconButton size={44} label="Close form" onClick={onClose}>
          {'×'}
        </IconButton>
      </div>

      <div className={styles.body}>
        <div className={styles.grid}>
          <div className={styles.fields}>
            <Field>
              <Label htmlFor="f-url" required>
                Destination URL
              </Label>
              <TextInput
                id="f-url"
                type="url"
                mono
                data-autofocus
                value={url}
                placeholder="https://"
                state={urlError ? 'invalid' : null}
                aria-describedby={urlError ? 'f-url-error' : savedAs ? 'f-url-preview' : undefined}
                onChange={(event) => {
                  setUrl(event.target.value);
                  if (serverError?.field === 'url') setServerError(null);
                }}
                onBlur={() => setUrlTouched(true)}
              />
              {urlError && <FieldError id="f-url-error">{urlError}</FieldError>}
              {savedAs && <Preview id="f-url-preview" url={savedAs} />}
            </Field>

            <Field>
              <Label htmlFor="f-slug">Slug</Label>
              <div className={styles.row}>
                <div className={cx(styles.slugBox, slugError ? styles.slugInvalid : slugOk && styles.slugValid)}>
                  <span className={styles.slugPrefix}>daffa.me/</span>
                  <input
                    id="f-slug"
                    className={styles.slugInput}
                    value={slug}
                    placeholder="e.g. porto-2026"
                    aria-invalid={slugError ? true : undefined}
                    aria-describedby="slug-help"
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(event) => {
                      setSlug(event.target.value);
                      if (serverError?.field === 'slug') setServerError(null);
                    }}
                  />
                </div>
                <Button variant="secondary" className={styles.sideButton} onClick={() => setSlug(generateSlug())}>
                  Generate
                </Button>
              </div>
              {slugError && <FieldError>{slugError}</FieldError>}
              {slugOk && <FieldOk>Slug is available.</FieldOk>}
              <Help id="slug-help">
                Lowercase letters, numbers, and hyphens. 2 to 80 characters, cannot start with a hyphen.
                {slug ? ` Currently ${slug.length} characters.` : ''}
              </Help>
            </Field>

            <Field>
              <Label htmlFor="f-title">Title</Label>
              <TextInput
                id="f-title"
                value={title}
                placeholder="A short name to identify the link"
                onChange={(event) => setTitle(event.target.value)}
              />
            </Field>

            <Field>
              <Label htmlFor="f-desc">Description</Label>
              <TextArea
                id="f-desc"
                rows={3}
                value={description}
                placeholder="Private notes about this link"
                onChange={(event) => setDescription(event.target.value)}
              />
            </Field>

            <Field>
              <Label htmlFor="f-tag">Tags</Label>
              <div className={styles.tagBox}>
                {tags.map((tag) => (
                  <RemovableTag key={tag} name={tag} onRemove={() => setTags((current) => current.filter((t) => t !== tag))} />
                ))}
                <input
                  id="f-tag"
                  className={styles.tagInput}
                  value={tagDraft}
                  placeholder="Type a tag and press Enter"
                  onChange={(event) => {
                    const value = event.target.value;
                    if (value.endsWith(',')) commitTag(value.slice(0, -1));
                    else setTagDraft(value);
                  }}
                  onKeyDown={onTagKey}
                />
              </div>
              {suggestions.length > 0 && (
                <div className={styles.suggest}>
                  <span className={styles.suggestLabel}>Existing tags</span>
                  {suggestions.map((tag) => (
                    <AddChip key={tag} label={tag} onClick={() => commitTag(tag)} />
                  ))}
                </div>
              )}
            </Field>

            <Field>
              <Label htmlFor="f-exp" optional>
                Expiration
              </Label>
              <div className={styles.row}>
                <TextInput
                  id="f-exp"
                  type="datetime-local"
                  className={styles.expiry}
                  value={expires}
                  onChange={(event) => setExpires(event.target.value)}
                />
                {expires && (
                  <Button variant="secondary" className={styles.sideButton} onClick={() => setExpires('')}>
                    Clear date
                  </Button>
                )}
              </div>
              <Help>Time zone WIB. Leave empty for a link that never expires.</Help>
            </Field>

            <div className={styles.status}>
              <div className={styles.statusText}>
                <span id="sw-label" className={styles.statusLabel}>
                  Link status
                </span>
                <span className={styles.statusHelp}>
                  {active ? 'Visitors are redirected to the destination URL.' : 'Visitors see the link unavailable page.'}
                </span>
              </div>
              <div className={styles.switchRow}>
                <span className={styles.switchText} style={{ color: active ? 'var(--ok)' : 'var(--off)' }}>
                  {active ? 'ACTIVE' : 'INACTIVE'}
                </span>
                <Switch checked={active} onChange={setActive} labelledBy="sw-label" />
              </div>
            </div>
          </div>

          <div className={styles.preview}>
            <span className={styles.previewTitle}>PREVIEW</span>
            <div className={styles.previewCard}>
              <GateTile slug={previewSlug} variant="preview" prefix="domain" />
              <span className={styles.previewDest}>{url.trim() ? hostPath(normalizeUrlInput(url)) : 'Destination URL not set'}</span>
              <div className={styles.previewStatus}>
                <StatusBadge status={previewStatus} />
                <span className={styles.previewExp}>
                  {expiresAt === null
                    ? 'No expiration'
                    : previewStatus === 'expired'
                      ? 'Date has passed'
                      : `Valid until ${formatDateTime(expiresAt)}`}
                </span>
              </div>
              <div className={styles.qrBox}>
                {matrix ? (
                  <svg
                    viewBox={`0 0 ${matrix.size} ${matrix.size}`}
                    width="160"
                    height="160"
                    shapeRendering="crispEdges"
                    role="img"
                    aria-label="QR code preview"
                  >
                    <path d={matrix.path} style={{ fill: 'var(--ink)' }} />
                  </svg>
                ) : (
                  <div className={styles.qrLoading}>Loading QR</div>
                )}
                <span className={styles.qrText}>daffa.me/{previewSlug}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className={styles.footer}>
        {editing && (
          <Button variant="dangerOutline" onClick={() => openDelete({ id: link.id, slug: link.slug, title: link.title })}>
            Delete Link
          </Button>
        )}
        <span className={styles.spacer} />
        {hasFieldErrors && (
          <span role="status" className={styles.footerError}>
            Please review the highlighted fields.
          </span>
        )}
        {!hasFieldErrors && serverError?.field === null && (
          <span role="status" className={styles.footerError}>
            {serverError.message}
          </span>
        )}
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" className={styles.save} onClick={save} disabled={saving} aria-busy={saving}>
          {saving ? 'Saving' : editing ? 'Save Changes' : 'Save Link'}
        </Button>
      </div>
    </Drawer>
  );
}
