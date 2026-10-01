import React from 'react';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

type Props = {
  /** Antal varer i kurven (sum af quantities) - styrer hvor fyldt vognen er. */
  count: number;
  /** Vognens stregfarve (temaets primary). */
  color: string;
  size?: number;
};

// Varernes egne farver er ens i lyst og mørkt tema: de skal kunne skelnes fra
// vognens streg og fra hinanden ved 34 px, og det kan de ikke i én farve.
const CARTON = '#4C9BE8';
const BOX = '#F2B63C';
const APPLE = '#E5484D';
const CARROT = '#F08A24';
const GREENS = '#5DBB63';

/**
 * Indkøbsvogn der fyldes op med de første fire ting i kurven: mælkekarton,
 * pakke og æble fylder kurven (1-3), og den fjerde - en gulerod - ligger oven
 * på, fordi vognen er overfyldt. Derefter ændrer tegningen sig ikke mere;
 * antallet bæres af badget ved siden af.
 *
 * Guleroden vender toppen mod venstre, så badget i headerens øverste højre
 * hjørne ikke dækker den. Vognen tegnes sidst, så kurvens kant ligger oven på
 * varerne.
 */
export function CartIcon({ count, color, size = 34 }: Props) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {count >= 1 && (
        <Path
          d="M7.9 16.9V9.2L9.5 7L11.1 9.2V16.9Z"
          fill={CARTON}
          stroke={CARTON}
          strokeWidth={0.6}
          strokeLinejoin="round"
        />
      )}
      {count >= 2 && <Rect x={11.9} y={7.6} width={3.3} height={9.6} rx={0.7} fill={BOX} />}
      {count >= 3 && (
        <>
          <Circle cx={18.2} cy={13.9} r={2.5} fill={APPLE} />
          <Path d="M18.2 11.4L18.8 9.9" stroke={GREENS} strokeWidth={1.1} strokeLinecap="round" />
        </>
      )}
      {count >= 4 && (
        <>
          <Path
            d="M8.4 5.1L6.5 3.5M8.4 5.1L6 5.2M8.4 5.1L6.7 6.8"
            stroke={GREENS}
            strokeWidth={1.3}
            strokeLinecap="round"
          />
          <Path
            d="M8.6 3.6L8.3 6.6L18.4 6.4Z"
            fill={CARROT}
            stroke={CARROT}
            strokeWidth={0.9}
            strokeLinejoin="round"
          />
        </>
      )}
      <Path
        d="M1.5 4.5h3l2.6 12.2a1.8 1.8 0 0 0 1.8 1.4h10.1a1.8 1.8 0 0 0 1.75-1.4L22.8 9H5.5"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Circle cx={10.2} cy={22} r={1.4} fill={color} />
      <Circle cx={19.2} cy={22} r={1.4} fill={color} />
    </Svg>
  );
}
