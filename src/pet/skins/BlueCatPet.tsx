/**
 * "Blue Cat" — an image-based pet: a white cat with a blue cap and tail.
 * Each state picks one look from its pool (`LOOKS`) at random, and idle rotates
 * every few minutes. A look is either the base artwork with a drawn face overlay
 * (new eyes/mouth over the artwork's own) or a sticker artwork (`assets/bluecat/`).
 * On top come CSS body motion (`.pet--<state> .body-group`) and the Sprout skin's
 * props (thought bubble, gear, z's, stars…).
 */
import { useLayoutEffect, useState } from "react";
import { pickIndex } from "../workday";
import type { PetState } from "../PetStates";
import type { PetRendererProps } from "./types";
import { PomPoms, Props, Ramen, ToolCaption } from "./SproutPet";
import blueCatUrl from "./assets/bluecat.png";
import helicopterUrl from "./assets/bluecat-helicopter.png";

const INK = "#1d2230";
const FACE = "#fff";

const STICKERS = import.meta.glob("./assets/bluecat/*.png", { eager: true, import: "default" }) as Record<string, string>;

type Art = { href: string; x: number; y: number; size: number };
/** "base" = the base artwork with the drawn face for the state. */
type Look = "base" | Art;

const sticker = (name: string): Art => {
  const href = STICKERS[`./assets/bluecat/${name}.png`];
  if (!href) throw new Error(`missing sticker ${name}`);
  return { href, x: 16, y: 20, size: 128 };
};

const LOOKS: Record<PetState, Look[]> = {
  sleeping: ["base", sticker("facedown"), sticker("suit")],
  idle: [
    "base",
    sticker("plain"),
    sticker("thumbsup"),
    sticker("standing"),
    sticker("small"),
    sticker("chubby"),
    sticker("loaf"),
    sticker("lying"),
    sticker("baby"),
    sticker("icecream"),
    sticker("swim"),
  ],
  coding: ["base", sticker("keyboard")],
  running: [
    "base",
    sticker("wakannai"),
    sticker("glasses"),
    sticker("grooming"),
    sticker("watergun"),
    sticker("camera"),
  ],
  looking_at_user: ["base", sticker("surprised"), sticker("drool"), sticker("teary"), sticker("tear")],
  celebrating: ["base", sticker("flower"), sticker("shark"), sticker("cheer2")],
  // Error: the cat flies off under a propeller cap.
  dizzy: [{ href: helicopterUrl, x: 10, y: 6, size: 140 }],
  // Lunch: the drawn ramen bowl needs the base artwork.
  eating: ["base"],
  cheering: [sticker("pompom")],
};

const IDLE_ROTATE_MS = 3 * 60_000;

/** A random entry of the state's pool, re-picked whenever the state changes (idle also rotates). */
export function useLook<T>(state: PetState, looks: Record<PetState, T[]>): T {
  const pool = looks[state];
  const [pick, setPick] = useState<{ state: PetState; index: number } | null>(null);
  // Layout effect: re-pick before paint so a state change never flashes the old look.
  useLayoutEffect(() => {
    const repick = () =>
      setPick((p) => ({ state, index: pickIndex(pool.length, p?.state === state ? p.index : null) }));
    repick();
    if (state !== "idle") return;
    const t = setInterval(repick, IDLE_ROTATE_MS);
    return () => clearInterval(t);
  }, [state, pool.length]);
  return pool[pick?.state === state ? pick.index % pool.length : 0]!;
}

// Where the base artwork's features sit, in svg units (measured from bluecat.png).
const EYES = [
  { x: 64.9, y: 78.9 },
  { x: 95.1, y: 79.4 },
];
const MOUTH = { x: 80.8, y: 90.5 };

type CatEyes = "closed" | "happy" | "content" | "up" | "down" | "sparkle";
type CatMouth = "open" | "o";

const FACES: Partial<Record<PetState, { eyes?: CatEyes; mouth?: CatMouth }>> = {
  sleeping: { eyes: "closed" },
  coding: { eyes: "down" },
  running: { eyes: "up", mouth: "o" },
  looking_at_user: { eyes: "sparkle", mouth: "o" },
  celebrating: { eyes: "happy", mouth: "open" },
  eating: { eyes: "content" },
  cheering: { eyes: "happy", mouth: "open" },
};

/** States that blink now and then (the overlay is hidden between blinks). */
const BLINKS = new Set<PetState>(["idle", "coding"]);

function Eye({ x, y, style }: { x: number; y: number; style: CatEyes }) {
  const line = { stroke: INK, strokeWidth: 2.3, fill: "none", strokeLinecap: "round" as const };
  let mark;
  switch (style) {
    case "closed":
      mark = <path d={`M${x - 5} ${y} Q${x} ${y + 4} ${x + 5} ${y}`} {...line} />;
      break;
    case "happy":
      mark = <path d={`M${x - 5} ${y + 2} Q${x} ${y - 5} ${x + 5} ${y + 2}`} {...line} />;
      break;
    case "content":
      mark = <path d={`M${x - 5} ${y + 1} Q${x} ${y - 3} ${x + 5} ${y + 1}`} {...line} />;
      break;
    default: {
      const big = style === "sparkle";
      const dy = style === "up" ? -2.2 : style === "down" ? 2.2 : 0;
      mark = (
        <g>
          <ellipse cx={x} cy={y + dy} rx={big ? 5.4 : 4.6} ry={big ? 6 : 5.2} fill={INK} />
          <circle cx={x + 1.6} cy={y + dy - 2} r={big ? 2 : 1.6} fill={FACE} />
          {big && <circle cx={x - 1.8} cy={y + dy + 2.2} r={1} fill={FACE} />}
        </g>
      );
    }
  }
  return (
    <g>
      <ellipse cx={x} cy={y} rx={6.8} ry={6.8} fill={FACE} />
      {mark}
    </g>
  );
}

function Mouth({ style }: { style: CatMouth }) {
  const { x, y } = MOUTH;
  return (
    <g>
      <ellipse cx={x} cy={y} rx={8.6} ry={4.4} fill={FACE} />
      {style === "open" ? (
        <path
          d={`M${x - 5} ${y - 2} Q${x} ${y + 7} ${x + 5} ${y - 2} Z`}
          fill="#8a3444"
          stroke={INK}
          strokeWidth={1.6}
          strokeLinejoin="round"
        />
      ) : (
        <ellipse cx={x} cy={y} rx={2.2} ry={2.6} fill={INK} />
      )}
    </g>
  );
}

function Face({ state }: { state: PetState }) {
  const face = FACES[state];
  return (
    <>
      {face?.eyes && EYES.map((e) => <Eye key={e.x} x={e.x} y={e.y} style={face.eyes!} />)}
      {face?.mouth && <Mouth style={face.mouth} />}
      {BLINKS.has(state) && (
        <g className="cat-blink">
          {EYES.map((e) => (
            <Eye key={e.x} x={e.x} y={e.y} style="closed" />
          ))}
        </g>
      )}
    </>
  );
}

export function BlueCatPet({ state, animate, size, detail }: PetRendererProps) {
  const look = useLook(state, LOOKS);
  const art = look === "base" ? null : look;
  return (
    <div
      className={`pet pet--${state} ${animate ? "" : "pet--static"}`}
      style={{ width: size, height: size }}
      role="img"
      aria-label={`Pet is ${state.replace(/_/g, " ")}`}
    >
      <svg viewBox="0 0 160 160" width={size} height={size}>
        <ellipse className="ground-shadow" cx={80} cy={146} rx={38} ry={5} fill="#000" opacity={0.16} />
        <g className="body-group">
          {art ? (
            <image href={art.href} x={art.x} y={art.y} width={art.size} height={art.size} preserveAspectRatio="xMidYMax meet" />
          ) : (
            <>
              <image
                href={blueCatUrl}
                x={22}
                y={30}
                width={116}
                height={116}
                preserveAspectRatio="xMidYMax meet"
              />
              <Face state={state} />
            </>
          )}
          {/* pom-poms cover the V-sign hands of the base artwork */}
          {state === "cheering" && !art && <PomPoms left={{ x: 44, y: 106 }} right={{ x: 116, y: 106 }} />}
        </g>
        {state === "eating" && !art && <Ramen mouth={{ x: MOUTH.x, y: MOUTH.y + 1 }} />}
        <Props state={state} />
        {state === "running" && detail && <ToolCaption detail={detail} />}
      </svg>
    </div>
  );
}
