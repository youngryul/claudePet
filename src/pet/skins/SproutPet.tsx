/**
 * "Sprout" — the MVP pet: a small mint blob with a two-leaf sprout.
 * Pure SVG; all motion is CSS (see styles.css, `.pet--<state>`).
 */
import type { ReactNode } from "react";
import type { PetState } from "../PetStates";
import type { PetRendererProps } from "./types";

const INK = "#1d2230";
const BODY_TOP = "#a4f2d2";
const BODY_BOTTOM = "#5cc79d";
const BLADE = "#f6e7a8";

type EyeStyle = "open" | "closed" | "happy" | "wide" | "up" | "down";
type MouthStyle = "smile" | "open" | "flat" | "o" | "tiny";

const LOOK: Record<PetState, { eyes: EyeStyle; mouth: MouthStyle }> = {
  sleeping: { eyes: "closed", mouth: "tiny" },
  idle: { eyes: "open", mouth: "smile" },
  coding: { eyes: "down", mouth: "smile" },
  running: { eyes: "up", mouth: "flat" },
  looking_at_user: { eyes: "wide", mouth: "o" },
  celebrating: { eyes: "happy", mouth: "open" },
  dizzy: { eyes: "wide", mouth: "o" },
  eating: { eyes: "happy", mouth: "o" },
  cheering: { eyes: "wide", mouth: "open" },
};

function Eyes({ style }: { style: EyeStyle }) {
  const pair = (render: (cx: number) => ReactNode) => (
    <>
      {render(67)}
      {render(93)}
    </>
  );
  switch (style) {
    case "closed":
      return pair((cx) => <path key={cx} d={`M${cx - 6} 98 Q${cx} 103 ${cx + 6} 98`} stroke={INK} strokeWidth={2.4} fill="none" strokeLinecap="round" />);
    case "happy":
      return pair((cx) => <path key={cx} d={`M${cx - 6} 100 Q${cx} 92 ${cx + 6} 100`} stroke={INK} strokeWidth={2.6} fill="none" strokeLinecap="round" />);
    default: {
      const big = style === "wide";
      const dy = style === "up" ? -3 : style === "down" ? 3 : 0;
      const dx = style === "up" ? 1.5 : 0;
      return pair((cx) => (
        <g key={cx} transform={`translate(${dx} ${dy})`}>
          <ellipse cx={cx} cy={98} rx={big ? 7 : 6} ry={big ? 9 : 7.5} fill={INK} />
          <circle cx={cx + 2.2} cy={95} r={big ? 2.6 : 2.2} fill="#fff" />
          {big && <circle cx={cx - 2.2} cy={102} r={1.2} fill="#fff" />}
        </g>
      ));
    }
  }
}

function Mouth({ style }: { style: MouthStyle }) {
  const common = { stroke: INK, strokeWidth: 2.2, fill: "none", strokeLinecap: "round" as const };
  switch (style) {
    case "open":
      return <path d="M74 108 Q80 118 86 108 Z" fill="#8a3444" stroke={INK} strokeWidth={1.8} strokeLinejoin="round" />;
    case "flat":
      return <path d="M76 110 L84 110" {...common} />;
    case "o":
      return <ellipse cx={80} cy={110} rx={2.6} ry={3} fill={INK} />;
    case "tiny":
      return <path d="M78 110 Q80 111.5 82 110" {...common} />;
    default:
      return <path d="M75.5 108 Q80 112.5 84.5 108" {...common} />;
  }
}

const Star = ({ x, y, r = 4, fill = "#ffd166", className }: { x: number; y: number; r?: number; fill?: string; className?: string }) => (
  <path
    className={className}
    d={`M${x} ${y - r} L${x + r * 0.3} ${y - r * 0.3} L${x + r} ${y} L${x + r * 0.3} ${y + r * 0.3} L${x} ${y + r} L${x - r * 0.3} ${y + r * 0.3} L${x - r} ${y} L${x - r * 0.3} ${y - r * 0.3} Z`}
    fill={fill}
  />
);

/**
 * Error state: the pet flies off under a propeller cap (body motion is `.pet--dizzy`
 * in styles.css). `top` is the y of the head top the cap sits on.
 */
export function Propeller({ top }: { top: number }) {
  const hub = top - 27;
  return (
    <g>
      <path d={`M70 ${top + 3} Q80 ${top - 7} 90 ${top + 3} Z`} fill="#c9ced8" stroke={INK} strokeWidth={1.4} strokeLinejoin="round" />
      <rect x={78.3} y={hub} width={3.4} height={top - hub - 2} rx={1.7} fill="#c9ced8" stroke={INK} strokeWidth={1.2} />
      <g className="rotor">
        <ellipse cx={80} cy={hub} rx={27} ry={5} fill={BLADE} stroke={INK} strokeWidth={1.4} />
      </g>
      <g className="rotor d1">
        <ellipse cx={80} cy={hub} rx={27} ry={5} fill={BLADE} stroke={INK} strokeWidth={1.4} />
      </g>
      <circle cx={80} cy={hub} r={3.2} fill="#c9ced8" stroke={INK} strokeWidth={1.2} />
    </g>
  );
}

/**
 * Lunch break: a bowl of ramen in front, noodles lifted to the mouth with chopsticks,
 * steam rising. `mouth` is where the noodles end on this skin's face.
 */
export function Ramen({ mouth }: { mouth: { x: number; y: number } }) {
  const { x, y } = mouth;
  const strand = (dx: number) =>
    `M${x + dx * 0.4} ${y + 1} C${x - 4 + dx} ${y + 12} ${57 + dx} ${y + 18} ${56 + dx} 121`;
  return (
    <g>
      <g fill="#fff" stroke="var(--text-muted, #8d95a5)" strokeWidth={0.8} opacity={0.85}>
        <circle className="steam" cx={34} cy={112} r={4.5} />
        <circle className="steam d1" cx={30} cy={104} r={3.5} />
        <circle className="steam d2" cx={37} cy={98} r={3} />
      </g>
      <g className="slurp">
        {[-2.6, 0, 2.6].map((dx) => (
          <path key={`o${dx}`} d={strand(dx)} stroke={INK} strokeWidth={3.4} fill="none" strokeLinecap="round" />
        ))}
        {[-2.6, 0, 2.6].map((dx) => (
          <path key={dx} d={strand(dx)} stroke="#f3d27a" strokeWidth={2} fill="none" strokeLinecap="round" />
        ))}
        <path d={`M24 ${y + 9} L${x + 2} ${y + 4}`} stroke={INK} strokeWidth={3.6} strokeLinecap="round" />
        <path d={`M24 ${y + 9} L${x + 2} ${y + 4}`} stroke="#d8ad74" strokeWidth={2} strokeLinecap="round" />
        <path d={`M24 ${y + 14} L${x + 1} ${y + 8}`} stroke={INK} strokeWidth={3.6} strokeLinecap="round" />
        <path d={`M24 ${y + 14} L${x + 1} ${y + 8}`} stroke="#d8ad74" strokeWidth={2} strokeLinecap="round" />
      </g>
      {/* bowl */}
      <path d="M35 121 Q36 142 57 143 Q78 142 79 121 Z" fill="#fff" stroke={INK} strokeWidth={1.5} strokeLinejoin="round" />
      <path
        d="M41 132 L43 138 M47 134 L48 140 M53 135 L53 141 M60 135 L59 141 M66 134 L65 140 M72 132 L70 138"
        stroke="#d9534f"
        strokeWidth={1.6}
        strokeLinecap="round"
      />
      <ellipse cx={57} cy={121} rx={22} ry={5.5} fill="#ecd3a0" stroke={INK} strokeWidth={1.5} />
      <ellipse cx={49} cy={121} rx={4.5} ry={3} fill="#fff" stroke={INK} strokeWidth={0.8} />
      <circle cx={49} cy={121} r={1.6} fill="#f2b84b" />
      <ellipse cx={65} cy={121.5} rx={4.5} ry={3} fill="#fff" stroke={INK} strokeWidth={0.8} />
      <circle cx={65} cy={121.5} r={1.6} fill="#f2b84b" />
      <circle cx={57} cy={123} r={1.2} fill="#5cb85c" />
      <circle cx={60} cy={119.5} r={1} fill="#5cb85c" />
    </g>
  );
}

function PomPom({ cx, cy, className }: { cx: number; cy: number; className: string }) {
  const tufts = Array.from({ length: 10 }, (_, i) => (i / 10) * Math.PI * 2);
  return (
    <g className={className} style={{ transformOrigin: `${cx}px ${cy + 6}px` }}>
      {tufts.map((a) => (
        <circle key={a} cx={cx + Math.cos(a) * 8} cy={cy + Math.sin(a) * 8} r={5.5} fill="#bfe3f5" stroke={INK} strokeWidth={1.1} />
      ))}
      <circle cx={cx} cy={cy} r={8.5} fill="#bfe3f5" />
      <path d={`M${cx - 3} ${cy - 2} q2 3 0 5 M${cx + 2} ${cy - 3} q2 3 0 5`} stroke="#7bb6d6" strokeWidth={1} fill="none" strokeLinecap="round" />
    </g>
  );
}

/** Cheer-up moments: pom-poms shaken at both hands (body hops via `.pet--cheering`). */
export function PomPoms({ left, right }: { left: { x: number; y: number }; right: { x: number; y: number } }) {
  return (
    <>
      <PomPom cx={left.x} cy={left.y} className="pom-l" />
      <PomPom cx={right.x} cy={right.y} className="pom-r" />
    </>
  );
}

/**
 * "Claude is running" badge: a pulsing orange disc with a spinning spark, shown in
 * every state where the agent is busy so it stands apart from idle at a glance.
 */
export function RunningBadge() {
  const rays = Array.from({ length: 8 }, (_, i) => i * 45);
  return (
    <g transform="translate(136 30)">
      <circle className="run-ping" r={13} fill="none" stroke="#f08a3c" strokeWidth={2.4} />
      <circle r={13} fill="#f08a3c" stroke={INK} strokeWidth={1.4} />
      <g className="run-spark">
        {rays.map((a) => (
          <path key={a} d="M0 -3 L0 -9" stroke="#fff" strokeWidth={a % 90 === 0 ? 2.8 : 2} strokeLinecap="round" transform={`rotate(${a})`} />
        ))}
        <circle r={2.4} fill="#fff" />
      </g>
    </g>
  );
}

/** The running tool's name under the badge. */
export function ToolCaption({ detail }: { detail: string }) {
  return (
    <text
      x={136}
      y={56}
      textAnchor="middle"
      fontSize={9}
      fontWeight={700}
      fontFamily="ui-monospace, monospace"
      fill="#c45f1c"
    >
      {detail.length > 12 ? `${detail.slice(0, 11)}…` : detail}
    </text>
  );
}

export function Props({ state }: { state: PetState }) {
  return (
    <>
      {(state === "running" || state === "coding") && <RunningBadge />}
      {state === "looking_at_user" && (
        <g className="bob-sm">
          <rect x={112} y={26} width={18} height={24} rx={7} fill="#ffd166" stroke={INK} strokeWidth={1.4} />
          <path d="M121 31 L121 41" stroke={INK} strokeWidth={3} strokeLinecap="round" />
          <circle cx={121} cy={45.5} r={1.8} fill={INK} />
        </g>
      )}
      {state === "celebrating" && (
        <g>
          <Star x={30} y={50} className="twinkle" />
          <Star x={132} y={44} r={5} fill="#ff9fb2" className="twinkle d1" />
          <Star x={120} y={78} r={3} fill="#9ad8ff" className="twinkle d2" />
          <Star x={42} y={82} r={3} fill="#c3a6ff" className="twinkle d1" />
        </g>
      )}
      {state === "sleeping" && (
        <g fill="var(--text-muted, #8d95a5)" fontFamily="ui-monospace, monospace" fontWeight={700}>
          <text className="float-up" x={108} y={60} fontSize={12}>z</text>
          <text className="float-up d1" x={114} y={52} fontSize={15}>z</text>
          <text className="float-up d2" x={120} y={44} fontSize={18}>Z</text>
        </g>
      )}
    </>
  );
}

function Laptop() {
  return (
    <g>
      <path d="M52 124 L108 124 L114 138 L46 138 Z" fill="#3a4152" stroke={INK} strokeWidth={1.4} strokeLinejoin="round" />
      <path d="M56 127 L104 127" stroke="#5fd3a5" strokeWidth={1.4} strokeDasharray="3 2" opacity={0.9} />
      <ellipse className="tap-l" cx={66} cy={123} rx={6} ry={4.5} fill={BODY_BOTTOM} stroke={INK} strokeWidth={1.2} />
      <ellipse className="tap-r" cx={94} cy={123} rx={6} ry={4.5} fill={BODY_BOTTOM} stroke={INK} strokeWidth={1.2} />
    </g>
  );
}

export function SproutPet({ state, animate, size, detail }: PetRendererProps) {
  const look = LOOK[state];
  const flying = state === "dizzy";
  const gradId = "sprout-body";
  return (
    <div
      className={`pet pet--${state} ${animate ? "" : "pet--static"}`}
      style={{ width: size, height: size }}
      role="img"
      aria-label={`Pet is ${state.replace(/_/g, " ")}`}
    >
      <svg viewBox="0 0 160 160" width={size} height={size}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={BODY_TOP} />
            <stop offset="1" stopColor={BODY_BOTTOM} />
          </linearGradient>
        </defs>
        <ellipse className="ground-shadow" cx={80} cy={146} rx={36} ry={5} fill="#000" opacity={0.16} />
        <g className="body-group">
          {/* sprout (the propeller cap takes its place while flying) */}
          {!flying && (
            <>
              <path d="M80 57 L80 47" stroke={BODY_BOTTOM} strokeWidth={3} strokeLinecap="round" />
              <path d="M80 48 C78 40 72 35 63 34 C66 42 72 46 80 48 Z" fill="#7fdcae" stroke={INK} strokeWidth={1.2} />
              <path d="M80 48 C83 39 90 34 99 33 C95 42 88 47 80 48 Z" fill={BODY_TOP} stroke={INK} strokeWidth={1.2} />
            </>
          )}
          {/* feet */}
          <ellipse cx={63} cy={139} rx={10} ry={4.5} fill="#48b088" stroke={INK} strokeWidth={1.2} />
          <ellipse cx={97} cy={139} rx={10} ry={4.5} fill="#48b088" stroke={INK} strokeWidth={1.2} />
          {/* body */}
          <path
            d="M34 112 C34 78 52 56 80 56 C108 56 126 78 126 112 C126 132 108 139 80 139 C52 139 34 132 34 112 Z"
            fill={`url(#${gradId})`}
            stroke={INK}
            strokeWidth={1.6}
          />
          <ellipse cx={62} cy={74} rx={9} ry={5} fill="#fff" opacity={0.35} transform="rotate(-25 62 74)" />
          {/* face */}
          <ellipse cx={55} cy={110} rx={6.5} ry={3.6} fill="#ff9fb2" opacity={0.75} />
          <ellipse cx={105} cy={110} rx={6.5} ry={3.6} fill="#ff9fb2" opacity={0.75} />
          <g className="eyes">
            <Eyes style={look.eyes} />
          </g>
          <Mouth style={look.mouth} />
          {state === "coding" && <Laptop />}
          {flying && <Propeller top={57} />}
          {state === "cheering" && <PomPoms left={{ x: 34, y: 108 }} right={{ x: 126, y: 108 }} />}
        </g>
        {state === "eating" && <Ramen mouth={{ x: 80, y: 110 }} />}
        <Props state={state} />
        {state === "running" && detail && <ToolCaption detail={detail} />}
      </svg>
    </div>
  );
}
