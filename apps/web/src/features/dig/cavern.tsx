import type { ReactNode } from 'react';

/**
 * Decorative rock silhouettes behind the dig's solid panel.
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
    </div>
  );
}
