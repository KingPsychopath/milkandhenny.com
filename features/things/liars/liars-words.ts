/**
 * The imposter word bank, browser-safe.
 *
 * Grouped tightly, because the board is drawn from a single category. Twelve words that barely
 * relate make a clue trivial to give and impossible to read, which is the game not working — and
 * broad buckets are where that creeps in. "an object" grew to eighty-three entries and "a place you
 * go" to eighty, holding glaciers next to call centres. Both are gone; nothing here is a bin.
 *
 * A group smaller than twelve simply yields a smaller board, which is a harder crew problem rather
 * than a broken one.
 *
 * The list is not a secret. Knowing "beach / desert" is one of these tells you nothing about which
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
    category: "somewhere outdoors",
    pairs: [
      ["beach", "desert"],
      ["volcano", "mountain"],
      ["desert island", "shipwreck"],
      ["waterfall", "fountain"],
      ["island", "peninsula"],
      ["quicksand", "swamp"],
      ["canyon", "fjord"],
      ["glacier", "iceberg"],
      ["swamp", "marsh"],
      ["rock pool", "puddle"],
      ["shingle beach", "gravel drive"],
      ["orchard", "hop field"],
      ["allotment", "back garden"],
      ["pier", "jetty"],
      ["harbour", "marina"],
      ["quarry", "mine"],
    ],
  },
  {
    category: "a room in a building",
    pairs: [
      ["kitchen", "workshop"],
      ["attic", "basement"],
      ["cellar", "pantry"],
      ["hotel lobby", "waiting room"],
      ["waiting room", "departure lounge"],
      ["green room", "dressing room"],
      ["crypt", "wine cellar"],
      ["tea room", "canteen"],
      ["rooftop", "balcony"],
      ["control room", "cockpit"],
      ["morgue", "operating theatre"],
      ["laboratory", "operating theatre"],
      ["nursery", "playground"],
      ["stable", "kennel"],
      ["treehouse", "shed"],
      ["igloo", "log cabin"],
      ["allotment shed", "beach hut"],
    ],
  },
  {
    category: "somewhere in town",
    pairs: [
      ["petrol station", "car wash"],
      ["bakery", "butcher"],
      ["supermarket", "market stall"],
      ["post office", "bank"],
      ["bookshop", "record shop"],
      ["pharmacy", "corner shop"],
      ["corner shop", "petrol station"],
      ["barbershop", "nail salon"],
      ["launderette", "internet cafe"],
      ["bus stop", "taxi rank"],
      ["lost property", "pawn shop"],
      ["call centre", "newsroom"],
      ["polling station", "job centre"],
      ["town hall", "village green"],
      ["market day", "car boot sale"],
    ],
  },
  {
    category: "somewhere you'd visit",
    pairs: [
      ["library", "museum"],
      ["hospital", "school"],
      ["cinema", "theatre"],
      ["prison", "boarding school"],
      ["circus", "carnival"],
      ["casino", "arcade"],
      ["farm", "zoo"],
      ["aquarium", "greenhouse"],
      ["castle", "cathedral"],
      ["museum", "art gallery"],
      ["nightclub", "pub"],
      ["ski resort", "spa hotel"],
      ["courtroom", "parliament"],
      ["stadium", "amphitheatre"],
      ["monastery", "boarding house"],
      ["cathedral", "mosque"],
      ["planetarium", "cinema"],
      ["ice rink", "roller disco"],
      ["observatory", "control tower"],
      ["space station", "oil rig"],
      ["vineyard", "brewery"],
      ["graveyard", "battlefield"],
      ["war memorial", "bandstand"],
      ["bell tower", "clock tower"],
      ["swimming pool", "lake"],
      ["lighthouse", "windmill"],
      ["windmill", "water wheel"],
      ["labyrinth", "obstacle course"],
      ["hedge maze", "hall of mirrors"],
      ["shipyard", "scrapyard"],
      ["greenhouse", "conservatory"],
      ["sauna", "greenhouse"],
      ["airport", "train station"],
    ],
  },
  {
    category: "an occasion",
    pairs: [
      ["wedding", "funeral"],
      ["birthday", "anniversary"],
      ["honeymoon", "road trip"],
      ["opera", "ballet"],
      ["wedding speech", "eulogy"],
      ["first date", "job interview"],
      ["school play", "talent show"],
      ["sports day", "field trip"],
      ["encore", "curtain call"],
      ["karaoke", "open mic"],
      ["silent disco", "speed dating"],
      ["sunday roast", "christmas dinner"],
      ["parole", "graduation"],
      ["rehearsal", "audition"],
      ["auction", "raffle"],
      ["boot sale", "jumble sale"],
      ["brass band", "marching band"],
      ["pilgrimage", "expedition"],
      ["safari", "hiking"],
      ["marathon", "triathlon"],
    ],
  },
  {
    category: "something going wrong",
    pairs: [
      ["earthquake", "thunderstorm"],
      ["hurricane", "blizzard"],
      ["avalanche", "landslide"],
      ["power cut", "water outage"],
      ["roadworks", "building site"],
      ["waiting list", "queue"],
      ["detention", "assembly"],
      ["stage fright", "writer's block"],
      ["curfew", "bedtime"],
      ["jury duty", "census"],
      ["confession", "interrogation"],
      ["layover", "detour"],
      ["night shift", "red eye flight"],
      ["last orders", "closing time"],
      ["verdict", "diagnosis"],
    ],
  },
  {
    category: "a chore",
    pairs: [
      ["laundry", "dishwashing"],
      ["haircut", "tattoo"],
      ["house move", "spring clean"],
      ["recycling", "composting"],
      ["harvest", "planting"],
      ["yoga class", "dance class"],
      ["roadside picnic", "tailgate"],
      ["hibernation", "migration"],
      ["eclipse", "aurora"],
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
    category: "a machine or a vehicle",
    pairs: [
      ["revolving door", "turnstile"],
      ["vending machine", "cash machine"],
      ["yacht", "rowing boat"],
      ["zeppelin", "glider"],
      ["escalator", "travelator"],
      ["lifeboat", "raft"],
      ["elevator", "escalator"],
      ["arcade machine", "jukebox"],
      ["photo booth", "confessional"],
      ["revolving stage", "carousel"],
      ["dentist chair", "barber chair"],
      ["car boot", "glovebox"],
      ["flat pack", "jigsaw puzzle"],
      ["submarine", "spaceship"],
      ["helicopter", "hot air balloon"],
      ["bicycle", "motorbike"],
      ["ambulance", "fire engine"],
      ["ferry", "cruise ship"],
      ["cable car", "chairlift"],
      ["sleeper train", "night bus"],
      ["roundabout", "crossroads"],
      ["level crossing", "drawbridge"],
      ["hard shoulder", "lay-by"],
    ],
  },
  {
    category: "something you play or listen to",
    pairs: [
      ["guitar", "piano"],
      ["chess", "poker"],
      ["chessboard", "crossword"],
      ["violin", "cello"],
      ["puppet", "doll"],
      ["metronome", "pendulum"],
      ["lullaby", "anthem"],
      ["orchestra", "choir"],
      ["telescope", "microscope"],
      ["microscope slide", "photo negative"],
      ["petri dish", "ashtray"],
      ["black box", "time capsule"],
    ],
  },
  {
    category: "a person or an animal",
    pairs: [
      ["pirate", "viking"],
      ["dentist", "barber"],
      ["detective", "journalist"],
      ["magician", "clown"],
      ["astronaut", "deep sea diver"],
      ["chef", "waiter"],
      ["tailor", "cobbler"],
      ["acrobat", "gymnast"],
      ["greengrocer", "fishmonger"],
      ["referee", "lifeguard"],
      ["blacksmith", "carpenter"],
      ["zoo keeper", "vet"],
      ["understudy", "stand-in"],
      ["conductor", "choreographer"],
      ["busker", "street artist"],
      ["fishmonger", "deli counter"],
      ["veterinary", "paediatric"],
      ["lighthouse keeper", "night watchman"],
      ["pilgrim", "backpacker"],
      ["moustache", "beard"],
      ["penguin", "seal"],
      ["puppy", "kitten"],
      ["seagull", "pigeon"],
      ["moth", "butterfly"],
      ["sheepdog", "guide dog"],
      ["vampire", "ghost"],
    ],
  },
  {
    category: "something you can't hold",
    pairs: [
      ["alibi", "excuse"],
      ["fingerprint", "signature"],
      ["parking ticket", "library fine"],
      ["witness box", "pulpit"],
      ["x-ray", "photocopy"],
      ["pickling", "smoking"],
      ["birdwatching", "fishing"],
      ["map reading", "stargazing"],
      ["customs", "security check"],
    ],
  },
  {
    category: "weather",
    pairs: [
      ["winter", "autumn"],
      ["snow", "sand"],
      ["sunrise", "sunset"],
      ["cactus", "pine tree"],
      ["thunder", "fireworks"],
      ["fog", "smoke"],
      ["midnight", "dawn"],
      ["whirlpool", "riptide"],
      ["low tide", "drought"],
      ["monsoon", "drought"],
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
