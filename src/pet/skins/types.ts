import type { ComponentType } from "react";
import type { PetModifier, PetState } from "../PetStates";

/**
 * A skin renders a pet for a given state. The MVP skin is SVG + CSS; a PNG sprite,
 * Lottie or Rive skin only needs to implement this same props contract.
 */
export interface PetRendererProps {
  state: PetState;
  modifiers: PetModifier[];
  animate: boolean;
  /** Rendered width in CSS pixels. */
  size: number;
  /** Optional short caption (e.g. the running tool). */
  detail?: string | null;
}

export interface PetSkin {
  id: string;
  name: string;
  Renderer: ComponentType<PetRendererProps>;
}
