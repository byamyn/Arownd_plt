import Svg, { Ellipse, G, Path } from "react-native-svg";

type LogoProps = {
  /** Theme-aware color for the complete Arownd wordmark. */
  color: string;
  /** Rendered width in React Native layout units. */
  width?: number;
};

const VIEW_BOX = "-8 -8 436 76";
const ASPECT_RATIO = 436 / 76;

/**
 * Official adaptive Arownd wordmark.
 * All letterforms follow the active theme: black in light mode, white in dark mode.
 */
export default function Logo({ color, width = 160 }: LogoProps) {
  const height = width / ASPECT_RATIO;

  return (
    <Svg width={width} height={height} viewBox={VIEW_BOX}>
      <G fill={color}>
        <G>
          <Path d="M-0.5,60 L25.5,0 L30.5,0 L56.5,60 L55.5,60 L28,6 L0.5,60 Z" />
          <Path d="M8.50,41.25 L28.00,42.75 L28.00,39.25 L8.50,40.75 Z" />
          <Path d="M28.00,42.75 L47.50,41.25 L47.50,40.75 L28.00,39.25 Z" />
        </G>

        <G transform="translate(66,0)">
          <Path
            d="M0,2.25 L0,57.75 M0,2.25 H30 C52,2.25 52,31 30,31 H0"
            fill="none"
            stroke={color}
            strokeWidth={4.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Path d="M27.31,32.48 L53.55,59.99 L54.45,59.21 L30.69,29.52 Z" />
        </G>

        <G transform="translate(132,0)">
          <Ellipse
            cx={31}
            cy={30}
            rx={28.75}
            ry={27.75}
            fill="none"
            stroke={color}
            strokeWidth={4.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </G>

        <G transform="translate(206,0)">
          <G transform="scale(0.45113) translate(-276,-178)">
            <Path d="M276,179 L324,200 L350,262 L331,312 Z" />
            <Path d="M349,211 L368,220 L387,211 L368,259 Z" />
            <Path d="M460,179 L412,200 L386,262 L405,312 Z" />
          </G>
        </G>

        <G transform="translate(301,0)">
          <Path
            d="M0,2.25 L0,57.75 M50,2.25 L50,57.75"
            fill="none"
            stroke={color}
            strokeWidth={4.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Path d="M-0.55,3.00 L48.34,59.01 L51.66,55.99 L0.55,2.00 Z" />
        </G>

        <G transform="translate(370,0)">
          <Path
            d="M0,2.25 L0,57.75 M0,2.25 H22 C58,2.25 58,57.75 22,57.75 H0"
            fill="none"
            stroke={color}
            strokeWidth={4.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </G>
      </G>
    </Svg>
  );
}
