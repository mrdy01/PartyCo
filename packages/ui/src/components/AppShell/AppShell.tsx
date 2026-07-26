import type { ReactNode } from 'react';
import s from './AppShell.module.css';

export interface AppShellProps {
  /** The 36px window strip. Draggable — the frame does not style what is inside it. */
  titleBar?: ReactNode;
  /** The 52px context rail. */
  rail?: ReactNode;
  /**
   * The 236px files panel. Absent by default and absent again the moment it is closed: the shell
   * does not remind anyone that it exists.
   */
  filesPanel?: ReactNode;
  /** The one column that is always there. */
  children: ReactNode;
  /** The slide-out detail panel — diff, checks, a file, a teammate. Nothing by default. */
  detailPanel?: ReactNode;
  /** Fixed width of the detail panel in px. The export draws it at 520. */
  detailWidth?: number;
  /** The single status line. */
  statusLine?: ReactNode;
  className?: string;
}

/**
 * The window: title bar, rail, one main column, an optional panel on either side, one status line.
 *
 * Pure layout, and deliberately so — every previous attempt at a "shell" component grew opinions
 * about what belongs in each slot, and that is exactly the decision the brief moved out of the
 * frame and into the moment the person asks for something.
 *
 * The defaults are the whole argument: no files panel, no detail panel, nothing on the right. What
 * a person sees on open is one column of conversation and three fields of state.
 */
export function AppShell({
  titleBar,
  rail,
  filesPanel,
  children,
  detailPanel,
  detailWidth = 520,
  statusLine,
  className,
}: AppShellProps): React.ReactElement {
  return (
    <div className={className ? `${s.root} ${className}` : s.root}>
      {titleBar}
      <div className={s.body}>
        {rail}
        {filesPanel ? <div className={s.files}>{filesPanel}</div> : null}
        <main className={s.main}>{children}</main>
        {detailPanel ? (
          <aside className={s.detail} style={{ width: `${detailWidth}px` }}>
            {detailPanel}
          </aside>
        ) : null}
      </div>
      {statusLine}
    </div>
  );
}
