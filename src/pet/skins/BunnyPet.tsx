/** "Bunny" — a cream bunny with pink ears, drawn from stickers (`assets/bunny/`). */
import { makeStickerPet } from "./StickerPet";

export const BunnyPet = makeStickerPet(
  import.meta.glob("./assets/bunny/*.png", { eager: true, import: "default" }) as Record<string, string>,
  {
    sleeping: ["nap", "orca"],
    idle: ["wave", "small", "tongue", "round", "turn", "sofa", "hat", "bib", "buddy"],
    coding: ["books", "professor"],
    running: ["wobbly", "books", "professor"],
    looking_at_user: ["wave", "heart", "turn"],
    celebrating: ["beer", "sakura", "heart"],
    // Error: rolled over with an x eye.
    dizzy: ["flipped"],
    // Lunch: munching on a bag of chips.
    eating: ["chips"],
    cheering: ["magical"],
  },
);
