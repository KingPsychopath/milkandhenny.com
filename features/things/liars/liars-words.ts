/**
 * The imposter word bank, browser-safe.
 *
 * Grouped by category, because the category is what makes the imposter playable. Without one they
 * open on nothing — a random word, caught on the first turn, out before the game starts. Everyone
 * sees the category; only the imposter is missing the word inside it, which is the difference
 * between bluffing and guessing.
 *
 * Categories are kept tight on purpose, because the board is drawn from one of them. Twelve words
 * that barely relate — a lullaby beside a glovebox — make a clue trivial to give and impossible to
 * read, which is the game not working. "an object" had grown into a bin for anything that was not a
 * place or an event, so it is now four groups that each describe something.
 *
 * The list is not a secret. Knowing "beach / desert" is one of them tells you nothing about which
 * was dealt; the room game's secrecy lives in the snapshot, and the one-phone mode needs these
 * words with no server at all.
 */
export interface LiarsWordPair {
  /** What the crew are given. */
  word: string;
  /** What the understudy is given — close enough to survive a round, wrong enough to surface. */
  decoy: string;
  /** Shown to everybody, imposter included. Their only foothold. */
  category: string;
}

interface LiarsWordGroup {
  category: string;
  pairs: Array<[word: string, decoy: string]>;
}

const GROUPS: LiarsWordGroup[] = [
  {
    category: "a place you go",
    pairs: [
      ["petrol station", "car wash"],
      ["cathedral", "mosque"],
      ["windmill", "water wheel"],
      ["war memorial", "bandstand"],
      ["beach", "desert"],
      ["library", "museum"],
      ["hospital", "school"],
      ["airport", "train station"],
      ["cinema", "theatre"],
      ["volcano", "mountain"],
      ["prison", "boarding school"],
      ["circus", "carnival"],
      ["casino", "arcade"],
      ["farm", "zoo"],
      ["bakery", "butcher"],
      ["lighthouse", "windmill"],
      ["aquarium", "greenhouse"],
      ["supermarket", "market stall"],
      ["swimming pool", "lake"],
      ["castle", "cathedral"],
      ["desert island", "shipwreck"],
      ["greenhouse", "allotment"],
      ["post office", "bank"],
      ["graveyard", "battlefield"],
      ["museum", "art gallery"],
      ["nightclub", "pub"],
      ["ski resort", "spa hotel"],
      ["courtroom", "parliament"],
      ["kitchen", "workshop"],
      ["attic", "basement"],
      ["waterfall", "fountain"],
      ["bookshop", "record shop"],
      ["hotel lobby", "waiting room"],
      ["island", "peninsula"],
      ["labyrinth", "obstacle course"],
      ["monastery", "boarding house"],
      ["quicksand", "swamp"],
      ["orchard", "vineyard"],
      ["stadium", "amphitheatre"],
      ["cellar", "pantry"],
      ["shipyard", "scrapyard"],
      ["canyon", "fjord"],
      ["sauna", "greenhouse"],
      ["pharmacy", "corner shop"],
      ["hedge maze", "hall of mirrors"],
      ["harbour", "marina"],
      ["swamp", "marsh"],
      ["glacier", "iceberg"],
      ["quarry", "mine"],
      ["tea room", "canteen"],
      ["allotment", "back garden"],
      ["igloo", "log cabin"],
      ["nursery", "playground"],
      ["observatory", "control tower"],
      ["treehouse", "shed"],
      ["vineyard", "brewery"],
      ["barbershop", "nail salon"],
      ["launderette", "internet cafe"],
      ["ice rink", "roller disco"],
      ["planetarium", "cinema"],
      ["morgue", "operating theatre"],
      ["call centre", "newsroom"],
      ["allotment shed", "beach hut"],
      ["rooftop", "balcony"],
      ["bus stop", "taxi rank"],
      ["waiting room", "departure lounge"],
      ["lost property", "pawn shop"],
      ["rock pool", "puddle"],
      ["shingle beach", "gravel drive"],
      ["pier", "jetty"],
      ["green room", "dressing room"],
      ["corner shop", "petrol station"],
      ["stable", "kennel"],
      ["laboratory", "pharmacy"],
      ["space station", "oil rig"],
      ["control room", "cockpit"],
      ["polling station", "job centre"],
      ["town hall", "village green"],
      ["bell tower", "clock tower"],
      ["crypt", "wine cellar"],
    ],
  },
  {
    category: "an event",
    pairs: [
      ["haircut", "tattoo"],
      ["laundry", "dishwashing"],
      ["wedding", "funeral"],
      ["marathon", "triathlon"],
      ["birthday", "anniversary"],
      ["earthquake", "thunderstorm"],
      ["honeymoon", "road trip"],
      ["opera", "ballet"],
      ["safari", "hiking"],
      ["hurricane", "blizzard"],
      ["harvest", "planting"],
      ["auction", "raffle"],
      ["avalanche", "landslide"],
      ["eclipse", "aurora"],
      ["rehearsal", "audition"],
      ["roadworks", "building site"],
      ["monsoon", "drought"],
      ["pilgrimage", "expedition"],
      ["yoga class", "dance class"],
      ["boot sale", "jumble sale"],
      ["waiting list", "queue"],
      ["wedding speech", "eulogy"],
      ["first date", "job interview"],
      ["school play", "talent show"],
      ["sports day", "field trip"],
      ["detention", "assembly"],
      ["night shift", "red eye flight"],
      ["power cut", "water outage"],
      ["house move", "spring clean"],
      ["recycling", "composting"],
      ["roadside picnic", "tailgate"],
      ["encore", "curtain call"],
      ["stage fright", "writer's block"],
      ["brass band", "marching band"],
      ["karaoke", "open mic"],
      ["silent disco", "speed dating"],
      ["last orders", "closing time"],
      ["market day", "car boot sale"],
      ["sunday roast", "christmas dinner"],
      ["hibernation", "migration"],
      ["layover", "detour"],
      ["jury duty", "census"],
      ["confession", "interrogation"],
      ["verdict", "diagnosis"],
      ["parole", "graduation"],
      ["curfew", "bedtime"],
    ],
  },
  {
    category: "something in the house",
    pairs: [
      ["mirror", "window"],
      ["chandelier", "lampshade"],
      ["attic ladder", "fire escape"],
      ["junk drawer", "toolbox"],
      ["duvet", "mattress"],
      ["grandfather clock", "cuckoo clock"],
      ["quilt", "tapestry"],
      ["radiator", "kettle"],
      ["umbrella stand", "coat rack"],
      ["smoke alarm", "car alarm"],
      ["chimney", "drainpipe"],
      ["jigsaw", "dominoes"],
      ["record player", "music box"],
      ["typewriter", "sewing machine"],
      ["kaleidoscope", "prism"],
      ["lantern", "torch"],
    ],
  },
  {
    category: "something you take with you",
    pairs: [
      ["umbrella", "raincoat"],
      ["compass", "map"],
      ["postcard", "letter"],
      ["fishing rod", "butterfly net"],
      ["sleeping bag", "roll mat"],
      ["head torch", "candle"],
      ["thermos", "hip flask"],
      ["picnic blanket", "beach towel"],
      ["camping stove", "kettle"],
      ["passport", "membership card"],
      ["parachute", "kite"],
      ["megaphone", "whistle"],
      ["mixtape", "playlist"],
      ["photograph", "painting"],
      ["carnival mask", "gas mask"],
      ["tent", "caravan"],
    ],
  },
  {
    category: "something outside",
    pairs: [
      ["campfire", "fireplace"],
      ["bonfire", "barbecue"],
      ["haystack", "compost heap"],
      ["scarecrow", "statue"],
      ["sandcastle", "snowman"],
      ["beehive", "anthill"],
      ["spiderweb", "fishing net"],
      ["molehill", "sand dune"],
      ["hammock", "deckchair"],
      ["trampoline", "diving board"],
      ["seesaw", "swing"],
      ["wheelbarrow", "trolley"],
      ["conveyor belt", "assembly line"],
      ["toll booth", "ticket barrier"],
      ["speed camera", "cctv"],
      ["stained glass", "mosaic"],
    ],
  },
  {
    category: "something you eat or drink",
    pairs: [
      ["porridge", "soup"],
      ["mulled wine", "punch"],
      ["ice lolly", "sorbet"],
      ["gravy", "custard sauce"],
      ["toastie", "panini"],
      ["wedding cake", "birthday cake"],
      ["coffee", "tea"],
      ["honey", "syrup"],
      ["custard", "gravy"],
      ["sourdough", "pizza dough"],
      ["leftovers", "packed lunch"],
    ],
  },
  {
    category: "an object",
    pairs: [
      ["guitar", "piano"],
      ["chess", "poker"],
      ["chessboard", "crossword"],
      ["telescope", "microscope"],
      ["violin", "cello"],
      ["puppet", "doll"],
      ["revolving door", "turnstile"],
      ["vending machine", "cash machine"],
      ["yacht", "rowing boat"],
      ["zeppelin", "glider"],
      ["escalator", "travelator"],
      ["lifeboat", "raft"],
      ["elevator", "escalator"],
      ["flat pack", "jigsaw puzzle"],
      ["dentist chair", "barber chair"],
      ["car boot", "glovebox"],
      ["arcade machine", "jukebox"],
      ["photo booth", "confessional"],
      ["revolving stage", "carousel"],
      ["metronome", "pendulum"],
      ["microscope slide", "photo negative"],
      ["petri dish", "ashtray"],
      ["black box", "time capsule"],
      ["parking ticket", "library fine"],
      ["moustache", "beard"],
      ["lullaby", "anthem"],
      ["alibi", "excuse"],
      ["fingerprint", "signature"],
      ["witness box", "pulpit"],
    ],
  },
  {
    category: "a person or a job",
    pairs: [
      ["vampire", "ghost"],
      ["orchestra", "choir"],
      ["pirate", "viking"],
      ["dentist", "barber"],
      ["detective", "journalist"],
      ["magician", "clown"],
      ["astronaut", "deep sea diver"],
      ["chef", "waiter"],
      ["penguin", "seal"],
      ["puppy", "kitten"],
      ["tailor", "cobbler"],
      ["seagull", "pigeon"],
      ["acrobat", "gymnast"],
      ["greengrocer", "fishmonger"],
      ["moth", "butterfly"],
      ["referee", "lifeguard"],
      ["blacksmith", "carpenter"],
      ["zoo keeper", "vet"],
      ["understudy", "stand-in"],
      ["conductor", "choreographer"],
      ["busker", "street artist"],
      ["fishmonger", "deli counter"],
      ["sheepdog", "guide dog"],
      ["veterinary", "paediatric"],
      ["lighthouse keeper", "night watchman"],
      ["pilgrim", "backpacker"],
    ],
  },
  {
    category: "nature or weather",
    pairs: [
      ["winter", "autumn"],
      ["snow", "sand"],
      ["sunrise", "sunset"],
      ["cactus", "pine tree"],
      ["thunder", "fireworks"],
      ["fog", "smoke"],
      ["midnight", "dawn"],
      ["whirlpool", "riptide"],
      ["x-ray", "photocopy"],
      ["low tide", "drought"],
      ["pickling", "smoking"],
      ["birdwatching", "fishing"],
    ],
  },
  {
    category: "getting somewhere",
    pairs: [
      ["submarine", "spaceship"],
      ["helicopter", "hot air balloon"],
      ["bicycle", "motorbike"],
      ["ambulance", "fire engine"],
      ["ferry", "cruise ship"],
      ["map reading", "stargazing"],
      ["customs", "security check"],
      ["sleeper train", "night bus"],
      ["cable car", "chairlift"],
      ["roundabout", "crossroads"],
      ["level crossing", "drawbridge"],
      ["hard shoulder", "lay-by"],
    ],
  },
];

export const LIARS_WORD_PAIRS: LiarsWordPair[] = GROUPS.flatMap(({ category, pairs }) =>
  pairs.map(([word, decoy]) => ({ word, decoy, category })),
);

export const LIARS_WORD_CATEGORIES = GROUPS.map(({ category }) => category);


/**
 * The board: a dozen words from one category, one of which was dealt.
 *
 * This is the shape the genre settled on. Spyfall gives the spy a list of every possible location;
 * The Chameleon puts sixteen words on a card and the chameleon sees all of them but not which one
 * is circled. A category alone leaves the imposter guessing into open space; a visible shortlist
 * gives them a real line of attack — and, more importantly, gives the crew the tension the game is
 * actually about: be specific enough to prove you know the word, vague enough not to hand it over.
 */
export const LIARS_BOARD_SIZE = 12;

export function liarsBoard(
  pair: LiarsWordPair,
  pick: (bound: number) => number,
  decoy?: string | null,
) {
  const siblings = LIARS_WORD_PAIRS.filter(
    ({ word, category }) => category === pair.category && word !== pair.word && word !== decoy,
  ).map(({ word }) => word);

  for (let index = siblings.length - 1; index > 0; index -= 1) {
    const swap = pick(index + 1);
    [siblings[index], siblings[swap]] = [siblings[swap], siblings[index]];
  }

  const board = [pair.word, ...(decoy ? [decoy] : []), ...siblings].slice(0, LIARS_BOARD_SIZE);
  for (let index = board.length - 1; index > 0; index -= 1) {
    const swap = pick(index + 1);
    [board[index], board[swap]] = [board[swap], board[index]];
  }
  return board.toSorted((left, right) => left.localeCompare(right));
}
