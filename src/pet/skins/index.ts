import type { PetSkin } from "./types";
import { SproutPet } from "./SproutPet";

export const PET_SKINS: Record<string, PetSkin> = {
  sprout: { id: "sprout", name: "Sprout", Renderer: SproutPet },
};

export const getSkin = (id: string): PetSkin => PET_SKINS[id] ?? PET_SKINS.sprout!;
