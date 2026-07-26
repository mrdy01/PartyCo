import type { ReactElement, ReactNode } from 'react';
import s from './rich.module.css';

/**
 * A piece of a user-facing string that needs its own typographic treatment.
 *
 * Exists because fixtures and protocol payloads are plain `.ts` — they cannot carry JSX — yet the
 * design insists a branch name is semibold and a repo path is mono. A caller holding JSX can still
 * pass a `ReactNode` and skip segments entirely.
 */
export type TextSegment = string | { text: string; emphasis?: 'strong' | 'code' };

export type RichText = ReactNode | readonly TextSegment[];

export interface RichProps {
  value: RichText;
}

function isSegments(value: RichText): value is readonly TextSegment[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item === 'string' ||
        (typeof item === 'object' && item !== null && 'text' in (item as object)),
    )
  );
}

/** Renders either a plain `ReactNode` or a segment list. Never introduces block-level markup. */
export function Rich({ value }: RichProps): ReactElement {
  if (!isSegments(value)) return <>{value as ReactNode}</>;
  return (
    <>
      {value.map((segment, index) => {
        const key = `${index}`;
        if (typeof segment === 'string') return <span key={key}>{segment}</span>;
        if (segment.emphasis === 'code') {
          return (
            <code key={key} className={s.code}>
              {segment.text}
            </code>
          );
        }
        if (segment.emphasis === 'strong') {
          return (
            <b key={key} className={s.strong}>
              {segment.text}
            </b>
          );
        }
        return <span key={key}>{segment.text}</span>;
      })}
    </>
  );
}
