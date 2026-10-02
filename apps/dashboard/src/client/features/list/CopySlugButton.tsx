import { useEffect, useRef, useState } from 'react';
import { IconButton } from '../../components/controls';
import { CheckIcon, CopyIcon } from '../../components/Icons';
import { copyShortLink } from '../../lib/clipboard';
import { useApp } from '../app/AppProvider';

/** The 36 px copy button next to the gate tile of a row. Shows a check for 1.6 s after copying. */
export function CopySlugButton({ slug }: { slug: string }) {
  const { toast } = useApp();
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = async () => {
    await copyShortLink(slug, toast);
    setCopied(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <IconButton size={36} label={copied ? `Copied daffa.me/${slug}` : `Copy daffa.me/${slug}`} onClick={copy}>
      {copied ? <CheckIcon /> : <CopyIcon />}
    </IconButton>
  );
}
