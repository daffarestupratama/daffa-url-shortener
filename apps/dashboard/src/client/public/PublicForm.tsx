import { canonicalUrl, checkPublicUrl, randomPublicSlug, type PublicCreateResult } from '@daffa/shared';
import { useRef, useState, type FormEvent } from 'react';
import { Button } from '../components/controls';
import { FieldError, Help, Label, Preview, TextInput } from '../components/fields';
import { Badge } from '../components/tiles';
import { urlPreview } from '../lib/urlPreview';
import { createPublicLink } from './api';
import { publicErrorState } from './errors';
import type { RateLimit } from './RateLimitDialog';
import { TURNSTILE_ERROR_ID, TurnstileSlot, type TurnstileError } from './TurnstileSlot';
import styles from './public.module.css';

const cx = (...names: Array<string | false | null | undefined>) => names.filter(Boolean).join(' ');

/** A form state forced by the dev preview. */
export interface FormForce {
  url?: string;
  busy?: boolean;
  fieldError?: string;
  turnstileError?: TurnstileError;
  retry?: boolean;
}

interface PublicFormProps {
  /** Dev preview only: the forced state. Such a form never calls the API. */
  force?: FormForce | null;
  preview?: boolean;
  /** False in the previews that force a Turnstile state, which show the empty slot. */
  loadTurnstile?: boolean;
  onCreated: (result: PublicCreateResult) => void;
  onRateLimited: (limit: RateLimit) => void;
}

/**
 * NEW PUBLIC LINK. The destination is checked here first with the same rules
 * as the server, so an invalid URL never spends a Turnstile token. The slug is
 * drawn in the browser and cannot be typed. Every submit that reaches the
 * server resets Turnstile afterwards, because a token works only once.
 */
export function PublicForm({ force, preview = false, loadTurnstile = true, onCreated, onRateLimited }: PublicFormProps) {
  const [url, setUrl] = useState(force?.url ?? '');
  const [slug, setSlug] = useState(() => randomPublicSlug());
  const [busy, setBusy] = useState(force?.busy ?? false);
  const [fieldError, setFieldError] = useState<string | null>(force?.fieldError ?? null);
  const [turnstileError, setTurnstileError] = useState<TurnstileError | null>(force?.turnstileError ?? null);
  const [retry, setRetry] = useState(force?.retry ?? false);
  const [token, setToken] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [offline, setOffline] = useState(false);
  const urlInput = useRef<HTMLInputElement>(null);

  const savedAs = fieldError ? null : urlPreview(url);

  const onToken = (next: string | null) => {
    setToken(next);
    if (next) setTurnstileError(null);
  };

  const onTurnstileError = (error: TurnstileError) => {
    if (error === 'offline') setOffline(true);
    setTurnstileError(error);
  };

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (busy || preview) return;

    const problem = checkPublicUrl(url);
    if (problem) {
      setFieldError(problem.message);
      urlInput.current?.focus();
      return;
    }
    if (!token) {
      setTurnstileError(offline ? 'offline' : 'pending');
      return;
    }

    setBusy(true);
    setFieldError(null);
    setRetry(false);
    try {
      const result = await createPublicLink({ url: canonicalUrl(url), slug, turnstileToken: token });
      onCreated(result);
      setUrl('');
      setSlug(randomPublicSlug());
    } catch (error) {
      const state = publicErrorState(error);
      if (state.kind === 'field') {
        setFieldError(state.message);
        window.setTimeout(() => urlInput.current?.focus());
      } else if (state.kind === 'turnstile') {
        setTurnstileError('failed');
      } else if (state.kind === 'rate') {
        onRateLimited({ scope: state.scope, resetAt: state.resetAt });
      } else {
        setRetry(true);
      }
    } finally {
      setBusy(false);
      // The token was spent, whatever the answer. A fresh one follows from the widget.
      setToken(null);
      setResetKey((key) => key + 1);
    }
  };

  return (
    <form className={styles.form} onSubmit={submit} noValidate aria-busy={busy} aria-labelledby="form-kicker">
      <div className={styles.formHead}>
        <span id="form-kicker" className={styles.formKicker}>
          NEW PUBLIC LINK
        </span>
        <span className={styles.formNote}>Public links are permanent and cannot be edited.</span>
      </div>

      <div className={styles.field}>
        <Label htmlFor="p-url" required>
          Destination URL
        </Label>
        <TextInput
          ref={urlInput}
          id="p-url"
          type="url"
          inputMode="url"
          autoComplete="url"
          mono
          className={styles.urlInput}
          value={url}
          disabled={busy}
          placeholder="https://example.com/a-very-long-address"
          aria-required="true"
          state={fieldError ? 'invalid' : null}
          aria-describedby={fieldError ? 'p-url-msg' : savedAs ? 'p-url-preview' : undefined}
          onChange={(event) => {
            setUrl(event.target.value);
            setFieldError(null);
            setRetry(false);
          }}
        />
        {fieldError && <FieldError id="p-url-msg">{fieldError}</FieldError>}
        {savedAs && <Preview id="p-url-preview" url={savedAs} />}
      </div>

      <div className={styles.field}>
        <Label htmlFor="p-slug">Slug</Label>
        <div className={styles.slugRow}>
          <div className={styles.slugBox}>
            <span className={styles.slugPrefix}>daffa.me/</span>
            <input id="p-slug" className={styles.slugInput} value={slug} disabled readOnly aria-describedby="p-slug-help" />
            <svg className={styles.lock} width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <rect x="3" y="7" width="10" height="7" rx="1.5" />
              <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
            </svg>
          </div>
          <Button variant="secondary" className={styles.generate} disabled={busy} onClick={() => setSlug(randomPublicSlug())}>
            Generate
          </Button>
        </div>
        <Help id="p-slug-help">
          Public slugs are generated automatically as 6 random characters. Generate replaces the slug with a new one.
          Custom slugs are available for private use only.
        </Help>
      </div>

      <div className={styles.submitRow}>
        <TurnstileSlot
          error={turnstileError}
          onToken={onToken}
          onError={onTurnstileError}
          resetKey={resetKey}
          load={loadTurnstile}
        />
        <Button
          type="submit"
          variant="primary"
          className={cx(styles.submit, busy && styles.submitBusy)}
          disabled={busy}
          aria-describedby={turnstileError ? TURNSTILE_ERROR_ID : undefined}
        >
          {busy && <span className={styles.spinner} aria-hidden="true" />}
          {busy ? 'Creating Link' : 'Create Link'}
        </Button>
      </div>

      {retry && (
        <div role="alert" className={styles.retry}>
          <Badge tone="danger">ERROR</Badge>
          <span className={styles.retryText}>
            The link could not be created because the service did not respond. Check the connection, then try again.
          </span>
          <Button variant="secondary" size="md" className={styles.retryButton} onClick={() => submit()}>
            Try Again
          </Button>
        </div>
      )}
    </form>
  );
}
