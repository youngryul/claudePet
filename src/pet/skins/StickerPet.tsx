/**
 * Sticker-only pets: each state picks one sticker from its pool at random and idle
 * rotates every few minutes (same rules as Blue Cat). CSS body motion and the
 * shared props (running badge, z's, stars…) come on top.
 */
import type { ComponentType } from "react";
import type { PetState } from "../PetStates";
import type { PetRendererProps } from "./types";
import { useLook } from "./BlueCatPet";
import { Props, ToolCaption } from "./SproutPet";

/**
 * `stickers` is an eager `import.meta.glob` of the skin's PNGs; `looks` names the
 * stickers (file basenames) each state may show.
 */
export function makeStickerPet(
  stickers: Record<string, string>,
  looks: Record<PetState, string[]>,
): ComponentType<PetRendererProps> {
  const byName = new Map(Object.entries(stickers).map(([path, href]) => [path.replace(/^.*\/|\.png$/g, ""), href]));
  const hrefs = Object.fromEntries(
    Object.entries(looks).map(([state, names]) => [
      state,
      names.map((n) => {
        const href = byName.get(n);
        if (!href) throw new Error(`missing sticker ${n}`);
        return href;
      }),
    ]),
  ) as Record<PetState, string[]>;

  return function StickerPet({ state, animate, size, detail }: PetRendererProps) {
    const href = useLook(state, hrefs);
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
            <image href={href} x={16} y={20} width={128} height={128} preserveAspectRatio="xMidYMax meet" />
          </g>
          <Props state={state} />
          {state === "running" && detail && <ToolCaption detail={detail} />}
        </svg>
      </div>
    );
  };
}
