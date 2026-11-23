/** "Hamster" — a round white hamster with pink cheeks, drawn from stickers (`assets/hamster/`). */
import { makeStickerPet } from "./StickerPet";

export const HamsterPet = makeStickerPet(
  import.meta.glob("./assets/hamster/*.png", { eager: true, import: "default" }) as Record<string, string>,
  {
    sleeping: ["blanket", "sideways"],
    idle: ["plain", "smug", "peek", "giggle", "content", "hat", "scarf", "bow", "tongue", "shark", "strawberry"],
    coding: ["glasses", "spectacles"],
    running: ["glasses", "spectacles", "grumpy"],
    looking_at_user: ["surprised", "teary", "thumbsup"],
    celebrating: ["hearts", "parfait", "strawberry"],
    // Error: bursting into tears.
    dizzy: ["sob", "crying"],
    // Lunch: burger, melon bread, taiyaki or ice cream.
    eating: ["burger", "melonpan", "taiyaki", "icecream"],
    cheering: ["magical"],
  },
);
