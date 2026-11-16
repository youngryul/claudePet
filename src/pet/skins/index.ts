import type { PetSkin } from "./types";
import { SproutPet } from "./SproutPet";
import { BlueCatPet } from "./BlueCatPet";

export const DEFAULT_SKIN_ID = "bluecat";

export const PET_SKINS: Record<string, PetSkin> = {
  bluecat: { id: "bluecat", name: "Blue Cat", Renderer: BlueCatPet },
  sprout: { id: "sprout", name: "Sprout", Renderer: SproutPet },
};

export const getSkin = (id: string): PetSkin => PET_SKINS[id] ?? PET_SKINS[DEFAULT_SKIN_ID]!;
