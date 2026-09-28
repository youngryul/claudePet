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

type EyeStyle = "open" | "closed" | "happy" | "spiral" | "half" | "wide" | "x" | "up" | "down";
type MouthStyle = "smile" | "open" | "flat" | "wavy" | "o" | "tiny";

const LOOK: Record<PetState, { eyes: EyeStyle; mouth: MouthStyle }> = {
  sleeping: { eyes: "closed", mouth: "tiny" },
  idle: { eyes: "open", mouth: "smile" },
  coding: { eyes: "down", mouth: "smile" },
  thinking: { eyes: "up", mouth: "o" },
  working: { eyes: "open", mouth: "flat" },
  looking_at_user: { eyes: "wide", mouth: "o" },
  celebrating: { eyes: "happy", mouth: "open" },
  dizzy: { eyes: "spiral", mouth: "wavy" },
  slightly_tired: { eyes: "half", mouth: "smile" },
  tired: { eyes: "half", mouth: "flat" },
  exhausted: { eyes: "x", mouth: "wavy" },
  confused: { eyes: "open", mouth: "o" },
  overwhelmed: { eyes: "wide", mouth: "wavy" },
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
    case "x":
      return pair((cx) => (
        <path key={cx} d={`M${cx - 5} 94 L${cx + 5} 102 M${cx + 5} 94 L${cx - 5} 102`} stroke={INK} strokeWidth={2.4} strokeLinecap="round" />
      ));
    case "spiral":
      return pair((cx) => (
        <g key={cx} className="spin">
          <path
            d={`M${cx} 98 m-1 0 a1.5 1.5 0 1 1 3 0 a3 3 0 1 1 -6 0 a4.5 4.5 0 1 1 9 0 a6 6 0 1 1 -12 0`}
            stroke={INK}
            strokeWidth={1.8}
            fill="none"
            strokeLinecap="round"
          />
        </g>
      ));
    case "half":
      return pair((cx) => (
        <g key={cx}>
          <ellipse cx={cx} cy={100} rx={6} ry={4.5} fill={INK} />
          <path d={`M${cx - 7.5} 98.5 L${cx + 7.5} 98.5`} stroke="#6fd3aa" strokeWidth={4} strokeLinecap="round" />
          <path d={`M${cx - 7} 97 L${cx + 7} 97`} stroke={INK} strokeWidth={1.6} strokeLinecap="round" />
        </g>
      ));
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
    case "wavy":
      return <path d="M73 111 Q76.5 107 80 111 Q83.5 115 87 111" {...common} />;
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

function Props({ state, sweat, question }: { state: PetState; sweat: boolean; question: boolean }) {
  return (
    <>
      {state === "thinking" && (
        <g>
          <circle cx={112} cy={50} r={3} fill="var(--pet-bubble, #fff)" stroke={INK} strokeWidth={1.2} />
          <rect x={116} y={20} width={34} height={20} rx={10} fill="var(--pet-bubble, #fff)" stroke={INK} strokeWidth={1.4} />
          <circle className="dot" cx={125} cy={30} r={2.4} fill={INK} />
          <circle className="dot d1" cx={133} cy={30} r={2.4} fill={INK} />
          <circle className="dot d2" cx={141} cy={30} r={2.4} fill={INK} />
        </g>
      )}
      {state === "working" && (
        <g transform="translate(122 44)">
          <g className="spin">
            <path
              d="M0 -11 L3 -8 L7 -9 L8 -5 L11 -3 L9 0 L11 3 L8 5 L7 9 L3 8 L0 11 L-3 8 L-7 9 L-8 5 L-11 3 L-9 0 L-11 -3 L-8 -5 L-7 -9 L-3 -8 Z"
              fill="#8d95a5"
              stroke={INK}
              strokeWidth={1.2}
              strokeLinejoin="round"
            />
            <circle r={3.5} fill={INK} />
          </g>
        </g>
      )}
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
      {state === "dizzy" && (
        <g className="orbit">
          <Star x={80} y={30} r={4.5} />
          <Star x={62} y={48} r={3.5} fill="#ff9fb2" />
          <Star x={98} y={48} r={3.5} fill="#9ad8ff" />
        </g>
      )}
      {state === "sleeping" && (
        <g fill="var(--text-muted, #8d95a5)" fontFamily="ui-monospace, monospace" fontWeight={700}>
          <text className="float-up" x={108} y={60} fontSize={12}>z</text>
          <text className="float-up d1" x={114} y={52} fontSize={15}>z</text>
          <text className="float-up d2" x={120} y={44} fontSize={18}>Z</text>
        </g>
      )}
      {state === "overwhelmed" && (
        <g className="bob-sm" fontFamily="ui-sans-serif, system-ui" fontWeight={900} fontSize={22} fill="#e5484d" stroke={INK} strokeWidth={0.8}>
          <text x={110} y={48}>!!</text>
        </g>
      )}
      {(state === "confused" || question) && state !== "overwhelmed" && (
        <g className="bob-sm" fontFamily="ui-sans-serif, system-ui" fontWeight={900} fontSize={24} fill="#9ad8ff" stroke={INK} strokeWidth={0.9}>
          <text x={state === "confused" ? 104 : 26} y={52}>?</text>
        </g>
      )}
      {(sweat || state === "tired" || state === "exhausted") && (
        <path className="sweat" d="M113 70 Q109 77 113 80 Q117 77 113 70 Z" fill="#9ad8ff" stroke={INK} strokeWidth={1} />
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

export function SproutPet({ state, modifiers, animate, size, detail }: PetRendererProps) {
  const look = LOOK[state];
  const eyes: EyeStyle = modifiers.includes("heavy_eyes") && look.eyes === "open" ? "half" : look.eyes;
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
        <ellipse cx={80} cy={146} rx={state === "exhausted" ? 46 : 36} ry={5} fill="#000" opacity={0.16} />
        <g className="body-group">
          {/* sprout */}
          <path d="M80 57 L80 47" stroke={BODY_BOTTOM} strokeWidth={3} strokeLinecap="round" />
          <path d="M80 48 C78 40 72 35 63 34 C66 42 72 46 80 48 Z" fill="#7fdcae" stroke={INK} strokeWidth={1.2} />
          <path d="M80 48 C83 39 90 34 99 33 C95 42 88 47 80 48 Z" fill={BODY_TOP} stroke={INK} strokeWidth={1.2} />
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
            <Eyes style={eyes} />
          </g>
          <Mouth style={look.mouth} />
          {state === "coding" && <Laptop />}
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
