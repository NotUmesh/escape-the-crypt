import type { ReactNode } from 'react';

const SPECKS = [8, 19, 31, 44, 58, 69, 81, 92] as const;

/**
 * The cavern behind the dig, drawn in code: rock silhouettes, a low mist and a few falling specks.
 * It is decoration only (`aria-hidden`, no pointer events) and never sits behind text without a
 * solid panel. Colours come from tokens in dig.css; lantern mode and reduced motion switch the
 * mist and the specks off there.
 */
export function Cavern(): ReactNode {
  return (
    <div className="cavern" aria-hidden="true" data-testid="cavern">
      <svg className="cavern__rock" viewBox="0 0 1200 600" preserveAspectRatio="xMidYMin slice" focusable="false">
        <path
          className="cavern__ceiling"
          d="M0 0H1200V70L1150 60L1110 150L1070 70L1010 40L960 190L915 60L850 50L800 130L760 60L690 45L640 170L600 55L540 45L490 120L450 55L380 50L330 200L290 60L230 45L180 140L140 60L70 55L30 130L0 70Z"
        />
        <path className="cavern__wall cavern__wall--left" d="M0 70L60 200L30 340L90 470L40 600H0Z" />
        <path className="cavern__wall cavern__wall--right" d="M1200 70L1140 210L1175 350L1110 480L1160 600H1200Z" />
        <path className="cavern__floor" d="M0 600V520L140 500L300 530L480 505L700 535L900 505L1060 530L1200 510V600Z" />
      </svg>
      <span className="cavern__mist" />
      {SPECKS.map((left) => (
        <span key={left} className="cavern__speck" style={{ left: `${left}%`, animationDelay: `${(left % 7) * -1.3}s` }} />
      ))}
    </div>
  );
}
