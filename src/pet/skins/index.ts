import type { PetSkin } from "./types";
import { SproutPet } from "./SproutPet";
import { BlueCatPet } from "./BlueCatPet";
import { BunnyPet } from "./BunnyPet";
import { HamsterPet } from "./HamsterPet";

export const DEFAULT_SKIN_ID = "bluecat";

export const PET_SKINS: Record<string, PetSkin> = {
  bluecat: { id: "bluecat", name: "하치", Renderer: BlueCatPet },
  bunny: { id: "bunny", name: "우사기", Renderer: BunnyPet },
  hamster: { id: "hamster", name: "치이", Renderer: HamsterPet },
  sprout: { id: "sprout", name: "Sprout", Renderer: SproutPet },
};

export const getSkin = (id: string): PetSkin => PET_SKINS[id] ?? PET_SKINS[DEFAULT_SKIN_ID]!;
