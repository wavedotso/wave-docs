import type { ReactNode } from 'react';

/**
 * The five alert kinds GitHub understands, which is also what
 * `rehype-github-alerts` produces from `> [!NOTE]` and friends.
 */
export const CALLOUT_TYPES = [
  'note',
  'tip',
  'important',
  'warning',
  'caution',
] as const;

/** One of {@link CALLOUT_TYPES}. */
export type CalloutType = (typeof CALLOUT_TYPES)[number];

export interface CalloutProps {
  /**
   * Kind of callout. Typed as a plain string because it arrives as an
   * unvalidated hast attribute; anything unrecognised falls back to `note`
   * rather than rendering an unstyled box.
   */
  type?: string | undefined;
  /** Overrides the default label ("Note", "Warning", …). */
  title?: string | undefined;
  /**
   * Default headings per type, for a site that is not in English.
   *
   * `title` still wins — it is what a single callout in the markdown asked for,
   * and this is what every callout on the site is called otherwise.
   *
   * Here rather than resolved by the caller so that {@link normalizeCalloutType}
   * stays the one place that decides what an unrecognised type falls back to. A
   * caller picking the heading itself would need that rule too, and a second
   * copy of it is a second thing to keep in step.
   */
  labels?: Partial<Record<CalloutType, string>> | undefined;
  className?: string | undefined;
  children?: ReactNode;
}

const CALLOUT_LABELS: Record<CalloutType, string> = {
  note: 'Note',
  tip: 'Tip',
  important: 'Important',
  warning: 'Warning',
  caution: 'Caution',
};

/**
 * Lucide-derived glyph paths, drawn at 24×24 with a 2px stroke.
 *
 * Inlined rather than imported so the package takes no icon dependency and
 * ships no icon bytes for callouts a given page does not use.
 */
const CALLOUT_ICON_PATHS: Record<CalloutType, readonly string[]> = {
  note: ['M12 16v-4', 'M12 8h.01'],
  tip: [
    'M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5a6 6 0 0 0-12 0c0 1.3.5 2.6 1.5 3.5.8.8 1.3 1.5 1.5 2.5',
    'M9 18h6',
    'M10 22h4',
  ],
  important: [
    'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
    'M12 7v4',
    'M12 15h.01',
  ],
  warning: [
    'm21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3',
    'M12 9v4',
    'M12 17h.01',
  ],
  caution: [
    'M15.31 2a2 2 0 0 1 1.42.59l4.68 4.68A2 2 0 0 1 22 8.69v6.62a2 2 0 0 1-.59 1.42l-4.68 4.68a2 2 0 0 1-1.42.59H8.69a2 2 0 0 1-1.42-.59l-4.68-4.68A2 2 0 0 1 2 15.31V8.69a2 2 0 0 1 .59-1.42l4.68-4.68A2 2 0 0 1 8.69 2z',
    'M12 8v4',
    'M12 16h.01',
  ],
};

/**
 * `note` is the only glyph whose enclosing shape is not already one of its
 * paths, so it gets a circle drawn before the strokes.
 */
const CALLOUT_ICON_CIRCLE: Partial<Record<CalloutType, boolean>> = {
  note: true,
};

function normalizeCalloutType(value: string | undefined): CalloutType {
  const candidate = value?.toLowerCase();
  return CALLOUT_TYPES.find((type) => type === candidate) ?? 'note';
}

/**
 * A note/tip/important/warning/caution block.
 *
 * Rendered as an `<aside role="note">`: `aside` is the honest element, and the
 * explicit role keeps a callout in the middle of an article from showing up in
 * every screen reader's landmark list. The type is carried on `aria-label`
 * rather than left to the coloured border, which conveys nothing to a screen
 * reader and nothing to the 8% of men who cannot separate the red one from the
 * green one.
 *
 * All styling lives in `@waveso/docs/styles.css` under `.wave-docs-callout`,
 * so consumers can restyle it without forking the component.
 */
export function Callout({
  type,
  title,
  labels,
  className,
  children,
}: CalloutProps): ReactNode {
  const kind = normalizeCalloutType(type);
  // Blank is absent: `title` arrives as an unvalidated attribute like `type`,
  // and an empty one leaves the callout with no accessible name at all — the
  // one thing this component exists to provide.
  const label = title?.trim() || labels?.[kind] || CALLOUT_LABELS[kind];

  return (
    <aside
      role="note"
      aria-label={label}
      className={['wave-docs-callout', `wave-docs-callout--${kind}`, className]
        .filter(Boolean)
        .join(' ')}
    >
      <p className="wave-docs-callout__label">
        <CalloutIcon type={kind} />
        {label}
      </p>
      <div className="wave-docs-callout__body">{children}</div>
    </aside>
  );
}

function CalloutIcon({ type }: { type: CalloutType }): ReactNode {
  return (
    <svg
      className="wave-docs-callout__icon"
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      // Decorative: the label beside it already names the callout.
      aria-hidden="true"
      focusable="false"
    >
      {CALLOUT_ICON_CIRCLE[type] ? <circle cx="12" cy="12" r="10" /> : null}
      {CALLOUT_ICON_PATHS[type].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
