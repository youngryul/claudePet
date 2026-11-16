/**
 * "Blue Cat" — an image-based pet: a white cat with a blue cap and tail.
 * The artwork is a single transparent PNG; state is conveyed by the shared
 * CSS body motion (`.pet--<state> .body-group`) plus the Sprout skin's props
 * (thought bubble, gear, z's, stars, sweat…).
 */
import type { PetRendererProps } from "./types";
import { Props } from "./SproutPet";
import blueCatUrl from "./assets/bluecat.png";

const DIM_STATES = new Set(["sleeping", "tired", "exhausted"]);

export function BlueCatPet({ state, modifiers, animate, size, detail }: PetRendererProps) {
  return (
    <div
      className={`pet pet--${state} ${animate ? "" : "pet--static"}`}
      style={{ width: size, height: size }}
      role="img"
      aria-label={`Pet is ${state.replace(/_/g, " ")}`}
    >
      <svg viewBox="0 0 160 160" width={size} height={size}>
        <ellipse cx={80} cy={146} rx={state === "exhausted" ? 46 : 38} ry={5} fill="#000" opacity={0.16} />
        <g className="body-group">
          <image
            href={blueCatUrl}
            x={22}
            y={30}
            width={116}
            height={116}
            preserveAspectRatio="xMidYMax meet"
            style={DIM_STATES.has(state) ? { filter: "brightness(0.9) saturate(0.85)" } : undefined}
          />
        </g>
        <Props state={state} sweat={modifiers.includes("sweat")} question={modifiers.includes("question")} />
        {state === "working" && detail && (
          <text x={122} y={68} textAnchor="middle" fontSize={9} fontFamily="ui-monospace, monospace" fill="var(--text-muted, #667085)">
            {detail.length > 12 ? `${detail.slice(0, 11)}…` : detail}
          </text>
        )}
      </svg>
    </div>
  );
}
