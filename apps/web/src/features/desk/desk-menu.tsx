import type { CSSProperties, FocusEvent, MouseEvent, ReactNode } from 'react';
import { ENTER_CRYPT_LABEL, FRONT_OF_HOUSE_COPY, IMPORT_COPY } from '@escape-the-crypt/core';
import { ParchmentTag } from '../costume/ornaments';
import { DESK_PROPS } from './desk-props';
import type { DeskPlacement, DeskProp } from './desk-props';
import { coverPoint } from './desk-scene-layout';
import type { Point, Size } from './desk-scene-layout';

export type DeskPanel = 'shelf' | 'samples' | 'import';

const LABELS: Record<DeskProp, string> = {
  'notes-book': FRONT_OF_HOUSE_COPY.hub.bringNotes,
  'crypt-stack': FRONT_OF_HOUSE_COPY.hub.shelfTitle,
  'sample-chest': FRONT_OF_HOUSE_COPY.hub.samplesTitle,
  'import-letter': IMPORT_COPY.button,
  'crypt-stairs': ENTER_CRYPT_LABEL,
};

interface Props {
  readonly placement: DeskPlacement | null;
  readonly stage: Size;
  readonly bringHref: string;
  readonly busy: boolean;
  readonly onActivate: (prop: DeskProp, event: MouseEvent<HTMLButtonElement>) => void;
  readonly onHover: (prop: DeskProp | null) => void;
  readonly onFocus: (prop: DeskProp | null) => void;
}

export function DeskMenu({ placement, stage, bringHref, busy, onActivate, onHover, onFocus }: Props): ReactNode {
  const mapped = placement !== null && stage.width >= 840 && stage.height >= 480 && stage.width / stage.height <= 2.4;
  function geometry(id: DeskProp): { style: CSSProperties; outline: ReactNode } | undefined {
    if (!mapped) return undefined;
    const prop = placement.props.get(id);
    if (prop === undefined) return undefined;
    const project = ({ x, y }: Point): Point =>
      coverPoint({ x: x * placement.size.width, y: y * placement.size.height }, placement.size, stage, 0.5);
    const label = project(prop.label);
    // Keep the entire tag on-frame even if the cover crop trims the art.
    const x = Math.max(108, Math.min(stage.width - 108, label.x));
    const y = Math.max(120, Math.min(stage.height - 34, label.y));
    const points = prop.hotspot.map(project).map((p) => `${p.x},${p.y}`).join(' ');
    return {
      style: { left: x, top: y },
      outline: (
        <svg className="desk-menu__outline" width={stage.width} height={stage.height} style={{ left: `calc(50% - ${x}px)`, top: `calc(50% - ${y}px)` }} aria-hidden="true" focusable="false">
          <polygon points={points} />
        </svg>
      ),
    };
  }

  return (
    <nav className="desk-menu" data-mapped={mapped} aria-label={FRONT_OF_HOUSE_COPY.hub.menuLabel}>
      {DESK_PROPS.map((id) => {
        const layout = geometry(id);
        const props = {
          className: `desk-menu__prop${id === 'crypt-stairs' ? ' costume-seal' : ''}`,
          'data-prop': id,
          style: layout?.style,
          onPointerEnter: () => onHover(id),
          onPointerLeave: () => onHover(null),
          onFocus: (event: FocusEvent<HTMLElement>) => onFocus(event.currentTarget.matches(':focus-visible') ? id : null),
          onBlur: () => onFocus(null),
        };
        const contents = <>{layout?.outline}<ParchmentTag className="desk-menu__tag">{LABELS[id]}</ParchmentTag></>;
        return id === 'notes-book' ? (
          <a key={id} {...props} href={bringHref}>{contents}</a>
        ) : (
          <button key={id} {...props} type="button" aria-haspopup={id === 'crypt-stairs' ? undefined : 'dialog'}
            aria-disabled={id === 'crypt-stairs' && busy || undefined} onClick={(event) => onActivate(id, event)}>
            {contents}
          </button>
        );
      })}
    </nav>
  );
}
