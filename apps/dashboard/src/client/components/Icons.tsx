/** Icons copied from the design SVGs. All use currentColor unless the design says otherwise. */

export function SearchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="7.5" cy="7.5" r="5.5" />
      <path d="M12 12l4.5 4.5" />
    </svg>
  );
}

export function CopyIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
      <path d="M10.5 5.5V3.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" />
    </svg>
  );
}

export function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ stroke: 'var(--ok)' }} strokeWidth="2.4" aria-hidden="true">
      <path d="M3 8.5l3 3 7-7" />
    </svg>
  );
}

export function QrIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor" aria-hidden="true">
      <rect x="2" y="2" width="6" height="6" rx="1" />
      <rect x="10" y="2" width="6" height="6" rx="1" />
      <rect x="2" y="10" width="6" height="6" rx="1" />
      <rect x="11" y="11" width="4" height="4" />
    </svg>
  );
}

export function EditIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 15l1-4 8-8 3 3-8 8z" />
    </svg>
  );
}

export function ChartIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor" aria-hidden="true">
      <rect x="2" y="9" width="3" height="7" />
      <rect x="7.5" y="3" width="3" height="13" />
      <rect x="13" y="6" width="3" height="10" />
    </svg>
  );
}

export function KebabIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor" aria-hidden="true">
      <circle cx="3.5" cy="9" r="1.7" />
      <circle cx="9" cy="9" r="1.7" />
      <circle cx="14.5" cy="9" r="1.7" />
    </svg>
  );
}

/** The circle with a slash on the Blocked Domains button. */
export function BlockIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <circle cx="8" cy="8" r="6" />
      <path d="M3.8 12.2l8.4-8.4" />
    </svg>
  );
}

/** Replaces the design's globe emoji on the "Other" country row, which renders inconsistently. */
export function GlobeIcon() {
  return (
    <svg width="16" height="12" viewBox="0 0 24 24" fill="none" style={{ stroke: 'var(--ink2)' }} strokeWidth="2" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z" />
    </svg>
  );
}
