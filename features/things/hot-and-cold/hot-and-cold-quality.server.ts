import { createHash } from "node:crypto";
import type { HotAndColdTarget } from "./hot-and-cold-words.server";

export interface HotAndColdComparison {
  closer: string;
  farther: string;
}

export interface HotAndColdHumanTrail {
  approvalHash: string;
  approvedHints: readonly [string, string, string];
  closeWords: readonly string[];
  comparisons: readonly HotAndColdComparison[];
  forbiddenHints?: readonly string[];
}

export const HOT_AND_COLD_HUMAN_TRAILS: Partial<Record<HotAndColdTarget, HotAndColdHumanTrail>> = {
  onion: {
    approvalHash: "dcd3ee428a8dc43c3439988cd4f1f076298a7fd66ebf574016f18217f5bef5f3",
    closeWords: ["garlic", "vegetable", "bulb", "food"],
    comparisons: [
      { closer: "garlic", farther: "apple" },
      { closer: "vegetable", farther: "fruit" },
    ],
    approvedHints: ["fried", "pasta", "eating"],
  },
  necklace: {
    approvalHash: "14c832018fe7e96c0c2f83504815ca5251adc22230fcde8ff316fef2da7503a4",
    closeWords: ["jewel", "chain", "pendant", "jewelry"],
    comparisons: [
      { closer: "jewel", farther: "rope" },
      { closer: "chain", farther: "belt" },
    ],
    approvedHints: ["souvenir", "engraved", "bracelet"],
  },
  book: {
    approvalHash: "32bb0d206184d30cc631897617d2fb28a81b52b6b981f9f16034123290f7c011",
    closeWords: ["page", "reading", "novel", "library"],
    comparisons: [
      { closer: "novel", farther: "newspaper" },
      { closer: "page", farther: "pencil" },
    ],
    approvedHints: ["brochure", "encyclopedia", "novelist"],
  },
  hospital: {
    approvalHash: "a9f7ba76fb545e8cd8f5e169c3822b244de08b413903fc5823e47a8048876fdc",
    closeWords: ["doctor", "nurse", "patient", "medicine"],
    comparisons: [
      { closer: "doctor", farther: "building" },
      { closer: "patient", farther: "hotel" },
    ],
    approvedHints: ["disease", "illness", "medication"],
  },
  archer: {
    approvalHash: "974bcfbe5d0baead141da56812e177e12be65b4a339b5906ae001c2be38ce3da",
    closeWords: ["arrow", "bow", "shooting", "target"],
    comparisons: [
      { closer: "arrow", farther: "gun" },
      { closer: "bow", farther: "sword" },
    ],
    approvedHints: ["prey", "projectile", "hunt"],
  },
  captain: {
    approvalHash: "af7dacad3b705c8c7af1cb2afacc8a5c593c0402143bcee38156454f87924aee",
    closeWords: ["ship", "sailor", "crew", "leader"],
    comparisons: [
      { closer: "sailor", farther: "soldier" },
      { closer: "ship", farther: "car" },
    ],
    approvedHints: ["merchant", "manned", "commandant"],
  },
  brush: {
    approvalHash: "50f8b97d5e44e17351cf34e84a55482ffacf9a4e65ef4eaf90cb38f71f5a5701",
    closeWords: ["comb", "hair", "paint", "bristle"],
    comparisons: [
      { closer: "comb", farther: "fork" },
      { closer: "paint", farther: "pencil" },
    ],
    approvedHints: ["waxed", "hairline", "combed"],
  },
  gold: {
    approvalHash: "e431777129b5f6b10ecd574e0ce6ce128c601ffc2ba767b638b23254a1f04a6f",
    closeWords: ["metal", "silver", "jewelry", "treasure"],
    comparisons: [
      { closer: "silver", farther: "iron" },
      { closer: "jewelry", farther: "money" },
    ],
    approvedHints: ["radium", "bracelet", "aluminum"],
  },
  ghost: {
    approvalHash: "a1e6d8979cc4c01f371cbb0ef2f101eb0906885329a14245c94ab0cfcde27827",
    closeWords: ["spirit", "haunted", "phantom", "spooky"],
    comparisons: [
      { closer: "spirit", farther: "angel" },
      { closer: "haunted", farther: "house" },
    ],
    approvedHints: ["hearse", "purgatory", "corpse"],
  },
  piano: {
    approvalHash: "e4c83fe798cf0554eb0b59b2f0bbc9b1914aee831220dda297b8d66817ccd358",
    closeWords: ["music", "keyboard", "instrument", "melody"],
    comparisons: [
      { closer: "keyboard", farther: "computer" },
      { closer: "music", farther: "radio" },
    ],
    approvedHints: ["tempo", "clarinet", "musician"],
  },
  sandwich: {
    approvalHash: "00a7672085763ee094359c5656abc395964d618ed1759a30903cb316095f2374",
    closeWords: ["bread", "lunch", "food", "filling"],
    comparisons: [
      { closer: "bread", farther: "cake" },
      { closer: "lunch", farther: "dinner" },
    ],
    approvedHints: ["shredded", "platter", "burger"],
  },
  queen: {
    approvalHash: "c876412845de01e258e936d43e242fc31217a27684200c86208a32f48ce88084",
    closeWords: ["king", "royal", "crown", "monarch"],
    comparisons: [
      { closer: "king", farther: "woman" },
      { closer: "crown", farther: "jewel" },
    ],
    approvedHints: ["conqueror", "duchess", "prince"],
  },
  armour: {
    approvalHash: "c493a8d60c0ee69a5eb6b04daac9910a49c115f28506314005a5a8b4c9333f1e",
    closeWords: ["shield", "helmet", "protection", "battle"],
    comparisons: [
      { closer: "shield", farther: "sword" },
      { closer: "helmet", farther: "hat" },
    ],
    approvedHints: ["leather", "security", "protected"],
  },
  chocolate: {
    approvalHash: "ec103f1d73a7fa26dae81ca8cd9f7c2f63a045db2c00fda3b908840eb6084fe9",
    closeWords: ["cocoa", "sweet", "candy", "dessert"],
    comparisons: [
      { closer: "cocoa", farther: "coffee" },
      { closer: "candy", farther: "sugar" },
    ],
    approvedHints: ["caramel", "recipe", "snack"],
  },
  toothbrush: {
    approvalHash: "a2c2b1e0172749bc80fb63b271e59a875598ae4ab97fbd5ecf672c0497ece63b",
    closeWords: ["teeth", "toothpaste", "bathroom", "dental"],
    comparisons: [
      { closer: "toothpaste", farther: "soap" },
      { closer: "teeth", farther: "mouth" },
    ],
    approvedHints: ["washing", "chewing", "bathroom"],
  },
  artist: {
    approvalHash: "632d41d2e9b76bb212270b5dd2a98d2cbdf9842e7794173b69ac86c156f7bdce",
    closeWords: ["painting", "art", "creative", "painter"],
    comparisons: [
      { closer: "painter", farther: "writer" },
      { closer: "painting", farther: "museum" },
    ],
    approvedHints: ["writer", "imaginative", "arts"],
  },
  cave: {
    approvalHash: "3c3aad92805165216f36633c98c9c97724d5a1e952ce7bda477c034d70c745a7",
    closeWords: ["cavern", "rock", "underground", "dark"],
    comparisons: [
      { closer: "cavern", farther: "tunnel" },
      { closer: "underground", farther: "mountain" },
    ],
    approvedHints: ["mountain", "lair", "ravine"],
  },
  butterfly: {
    approvalHash: "ae68eb6f6afb4c105faf4ef620d75af72ad8c2ab1873cffcfffd98f96f0459cf",
    closeWords: ["insect", "wings", "caterpillar", "garden"],
    comparisons: [
      { closer: "caterpillar", farther: "worm" },
      { closer: "wings", farther: "bird" },
    ],
    approvedHints: ["condor", "flea", "dragonfly"],
  },
  sunrise: {
    approvalHash: "d60c7f97e356e7170ef8f719b73207e82565dddea018bfbdf0ec444cbe61193c",
    closeWords: ["dawn", "morning", "sun", "horizon"],
    comparisons: [
      { closer: "dawn", farther: "dusk" },
      { closer: "sun", farther: "star" },
    ],
    approvedHints: ["bedtime", "noon", "dusk"],
  },
  pirate: {
    approvalHash: "555be181a53a870f4bcd46ca95f477e86714d05a60381923b25c60f317ab3af0",
    closeWords: ["ship", "treasure", "sailor", "captain"],
    comparisons: [
      { closer: "treasure", farther: "gold" },
      { closer: "sailor", farther: "soldier" },
    ],
    approvedHints: ["cargo", "commandant", "seaman"],
  },
  summer: {
    approvalHash: "c4faf97d608613d1bf34efbd4db8f5bfcbd43c145a351e8b2a620268c39d6142",
    closeWords: ["hot", "holiday", "sun", "beach"],
    comparisons: [
      { closer: "hot", farther: "cold" },
      { closer: "holiday", farther: "school" },
    ],
    approvedHints: ["heating", "afternoon", "sunlight"],
  },
  feather: {
    approvalHash: "35b96a983b68a904d44f5f1eb83c2ccdd6e42c4c50dd8d498b5563ff6467f72e",
    closeWords: ["bird", "wing", "soft", "light"],
    comparisons: [
      { closer: "bird", farther: "animal" },
      { closer: "wing", farther: "airplane" },
    ],
    approvedHints: ["animal", "falcon", "finch"],
  },
  coin: {
    approvalHash: "aa1bfd2ddbf5e7bff4de18ab9c0e174db89be136b2c76c72d47ba7bdeb381232",
    closeWords: ["money", "currency", "pocket", "metal"],
    comparisons: [
      { closer: "money", farther: "gold" },
      { closer: "currency", farther: "paper" },
    ],
    approvedHints: ["stakes", "vending", "funds"],
  },
  box: {
    approvalHash: "1c353893a9f0297f48e7987bdca86f8784690b51f29a2d9616dda63f8fb65689",
    closeWords: ["container", "cardboard", "package", "storage"],
    comparisons: [
      { closer: "container", farther: "bottle" },
      { closer: "cardboard", farther: "paper" },
    ],
    approvedHints: ["enclosed", "shelf", "vial"],
  },
  telephone: {
    approvalHash: "c8da7973c978409145a6819ff83e04039680fb677ac6809b4b2d30502a3c6249",
    closeWords: ["phone", "call", "receiver", "conversation"],
    comparisons: [
      { closer: "phone", farther: "radio" },
      { closer: "call", farther: "talk" },
    ],
    approvedHints: ["listening", "broadcasting", "talking"],
  },
  cathedral: {
    approvalHash: "6dd6addd209e93d2956995787d46c460a71742467914484a68acae9e26cec33e",
    closeWords: ["church", "religion", "building", "worship"],
    comparisons: [
      { closer: "church", farther: "castle" },
      { closer: "religion", farther: "school" },
    ],
    approvedHints: ["pilgrimage", "christian", "worshipped"],
  },
  jacket: {
    approvalHash: "3e3722bbc544209728a76f3612b96e009ebf2cd1a53da2b03c83e19eb5a3c0b3",
    closeWords: ["coat", "clothing", "sleeve", "warm"],
    comparisons: [
      { closer: "coat", farther: "shirt" },
      { closer: "sleeve", farther: "arm" },
    ],
    approvedHints: ["plaid", "heated", "raincoat"],
  },
  cinema: {
    approvalHash: "fc36f31a56ad8536e43e106bd87fb8408293921ec2129555c249bdc902276e53",
    closeWords: ["movie", "film", "theatre", "screen"],
    comparisons: [
      { closer: "movie", farther: "television" },
      { closer: "film", farther: "camera" },
    ],
    approvedHints: ["circus", "acting", "filmed"],
  },
  rocket: {
    approvalHash: "444e8a7162e168a3d21df6719433b52cea25a8a87aca28a1136c36a239c23538",
    closeWords: ["space", "launch", "missile", "astronaut"],
    comparisons: [
      { closer: "space", farther: "sky" },
      { closer: "missile", farther: "car" },
    ],
    approvedHints: ["powered", "ballistics", "spaceship"],
  },
  ant: {
    approvalHash: "04f5dd9aa14657538ddeeabd34c55dd7a5e707fdb124af1d13103e8d69bfb73d",
    closeWords: ["insect", "colony", "bug", "tiny"],
    comparisons: [
      { closer: "insect", farther: "spider" },
      { closer: "colony", farther: "army" },
    ],
    approvedHints: ["animal", "species", "mosquito"],
  },
  scarf: {
    approvalHash: "dde594fe43fa63fd893426ff04585be685b84328631ecc76ec30b7e14cb4fb52",
    closeWords: ["clothing", "hat", "shawl", "blanket", "sheath"],
    comparisons: [
      { closer: "clothing", farther: "sheath" },
      { closer: "hat", farther: "sheath" },
      { closer: "sheath", farther: "sword" },
      { closer: "sword", farther: "sharp" },
    ],
    approvedHints: ["helmet", "blanket", "shawl"],
    forbiddenHints: ["sheath"],
  },
};

export function hotAndColdApprovalHash(
  target: string,
  trail: readonly string[],
  hints: readonly string[],
) {
  return createHash("sha256").update(JSON.stringify({ target, trail, hints })).digest("hex");
}
