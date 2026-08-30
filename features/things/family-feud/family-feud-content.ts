import type {
  FamilyFeudAnswerDefinition,
  FamilyFeudCardDefinition,
  FamilyFeudDeckSummary,
  FamilyFeudVibeId,
  FamilyFeudVibeSummary,
} from "./types";

type CardSeed = readonly [prompt: string, answers: readonly string[], protoQaSourceId?: string];

function slug(value: string) {
  return value
    .toLocaleLowerCase("en-GB")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 42);
}

function answer(cardId: string, label: string, position: number): FamilyFeudAnswerDefinition {
  const aliases: Record<string, string[]> = {
    "A mobile phone": ["phone", "smartphone", "cell phone"],
    "The internet": ["internet", "wifi", "wi-fi"],
    "A takeaway": ["takeout", "food delivery"],
    "Public transport": ["bus", "train", "tube"],
    "Tea or coffee": ["tea", "coffee", "hot drink"],
    "Their keys": ["keys", "house keys", "car keys"],
    "A group chat": ["groupchat", "whatsapp group"],
    "The weather": ["weather", "rain"],
    "A board game": ["boardgame", "tabletop game"],
    "Getting a seat on the Tube": ["a seat on the Underground", "getting a train seat"],
    "Check Citymapper": ["check the route app", "look at Citymapper"],
    "Tube delays": ["train delays", "the Underground is delayed"],
    "The London Underground": ["the Tube"],
    "Order an Uber": ["get an Uber", "order a cab"],
    "Take a night bus": ["get the night bus"],
    "Nobody replying": ["no replies", "everyone ignores it"],
    "Send a funny meme": ["send a meme", "post a meme"],
    "The organiser": ["the planner", "the one who organises"],
    "A walk by the canal": ["canal walk", "walking along the canal"],
    "Their local pub": ["the pub", "their usual pub"],
    "A food market": ["food hall", "street-food market"],
    "Only group photographs": ["all group photos", "no solo photos"],
    "They have an early morning": ["early start", "work in the morning"],
    "The journey home": ["how to get home", "transport home"],
    "Someone misses the last train": ["missing the last train", "last train is gone"],
    "They stay all night": ["stay until closing", "end up staying out"],
    "The smell of food": ["food cooking", "the food"],
    "Jollof rice": ["jollof"],
    "Rice and peas": ["rice & peas"],
    "Macaroni cheese": ["mac and cheese", "mac cheese"],
    "Are you seeing anyone?": ["do you have a partner", "are you dating"],
    "Fix someone's phone": ["sort out their phone", "phone help"],
    "The music": ["DJ", "the playlist"],
    "They brought a toothbrush": ["a spare toothbrush", "toothbrush"],
    "You up?": ["are you awake", "u up"],
    "Come over": ["come round", "come to mine"],
    "For one more drink": ["another drink", "a nightcap"],
    "A flatmate walks in": ["roommate interrupts", "their housemate appears"],
  };
  const shortened = label.replace(/^(?:a|an|the|their|they)\s+/i, "");
  const accepted = aliases[label] ?? [];
  return {
    id: `${cardId}:a${position + 1}`,
    label,
    aliases: [...new Set([...accepted, ...(shortened === label ? [] : [shortened])])],
  };
}

function makeDeck(
  id: string,
  name: string,
  seeds: readonly CardSeed[],
  adultOnly = false,
): FamilyFeudCardDefinition[] {
  return seeds.map(([prompt, answers, protoQaSourceId], index) => {
    const cardId = `${id}:${index + 1}-${slug(prompt)}`;
    return {
      id: cardId,
      prompt,
      deckId: id,
      deckName: name,
      adultOnly,
      provenance: protoQaSourceId
        ? { kind: "protoqa-adapted", sourceId: protoQaSourceId }
        : { kind: "original" },
      answers: answers.map((label, position) => answer(cardId, label, position)),
    };
  });
}

const EVERYDAY_SEEDS: readonly CardSeed[] = [
  [
    "Name something people check before leaving home.",
    [
      "Their keys",
      "A mobile phone",
      "The weather",
      "Their wallet",
      "The door is locked",
      "Their bag",
      "The time",
      "The lights",
      "Their outfit",
      "Travel directions",
    ],
  ],
  [
    "Name something people do while waiting for a friend.",
    [
      "Check their phone",
      "Send a message",
      "People-watch",
      "Order a drink",
      "Walk around",
      "Listen to music",
      "Check the time",
      "Browse a shop",
      "Take a photo",
      "Make a call",
    ],
  ],
  [
    "Name something that can make a morning feel rushed.",
    [
      "Oversleeping",
      "Missing transport",
      "Looking for keys",
      "Bad traffic",
      "A late alarm",
      "Choosing an outfit",
      "Making breakfast",
      "A low phone battery",
      "Unexpected rain",
      "A last-minute message",
    ],
  ],
  [
    "Name something people keep beside their bed.",
    [
      "A mobile phone",
      "A lamp",
      "Water",
      "An alarm clock",
      "A book",
      "Glasses",
      "Tissues",
      "Medicine",
      "A charger",
      "A notebook",
    ],
  ],
  [
    "Name something people forget when going away for a weekend.",
    [
      "A toothbrush",
      "A phone charger",
      "Socks",
      "Toiletries",
      "Pyjamas",
      "Underwear",
      "Medicine",
      "A jacket",
      "Travel documents",
      "Headphones",
    ],
  ],
  [
    "Name something that makes a house feel cosy.",
    [
      "Blankets",
      "Warm lighting",
      "Candles",
      "Cushions",
      "Music",
      "A fireplace",
      "Plants",
      "A rug",
      "A hot drink",
      "Photographs",
    ],
  ],
  [
    "Name something people do as soon as they get home.",
    [
      "Take off their shoes",
      "Change clothes",
      "Check their phone",
      "Sit down",
      "Make food",
      "Say hello",
      "Wash their hands",
      "Turn on the TV",
      "Put down their bag",
      "Make tea",
    ],
  ],
  [
    "Name something found in nearly every kitchen.",
    [
      "A fridge",
      "A kettle",
      "Plates",
      "Cutlery",
      "A sink",
      "Mugs",
      "A cooker",
      "Pans",
      "A bin",
      "Tea or coffee",
    ],
  ],
  [
    "Name something people complain about on a journey.",
    [
      "Delays",
      "Traffic",
      "The price",
      "Crowds",
      "Uncomfortable seats",
      "The temperature",
      "Noise",
      "Bad directions",
      "Luggage",
      "No signal",
    ],
  ],
  [
    "Name something people do when they cannot sleep.",
    [
      "Check their phone",
      "Read",
      "Watch TV",
      "Listen to music",
      "Get a drink",
      "Count sheep",
      "Change position",
      "Think too much",
      "Open a window",
      "Get up",
    ],
  ],
  [
    "Name something people photograph on holiday.",
    [
      "The view",
      "Friends or family",
      "Food",
      "A landmark",
      "The beach",
      "A sunset",
      "Their hotel",
      "Street art",
      "Animals",
      "A selfie",
    ],
  ],
  [
    "Name something that is annoying to run out of.",
    [
      "Toilet paper",
      "Milk",
      "A mobile phone battery",
      "Money",
      "Petrol",
      "Tea or coffee",
      "Toothpaste",
      "Clean clothes",
      "Food",
      "Hot water",
    ],
  ],
] as const;

const PARTY_SEEDS: readonly CardSeed[] = [
  [
    "Name something people bring to a party.",
    [
      "A drink",
      "Food",
      "A gift",
      "A friend",
      "Music",
      "Ice",
      "A good mood",
      "A jacket",
      "A camera",
      "A game",
    ],
  ],
  [
    "Name something that gets people onto a dance floor.",
    [
      "A favourite song",
      "A friend",
      "A DJ",
      "A drink",
      "A classic throwback",
      "A group dance",
      "A celebration",
      "Good lighting",
      "A dare",
      "The host",
    ],
  ],
  [
    "Name something a good host remembers.",
    [
      "Enough food",
      "Drinks",
      "Music",
      "Introductions",
      "Dietary needs",
      "Seating",
      "Ice",
      "The start time",
      "Lighting",
      "Getting everyone home",
    ],
  ],
  [
    "Name something people talk about when meeting for the first time.",
    [
      "Work",
      "Where they live",
      "Mutual friends",
      "The event",
      "Travel",
      "Hobbies",
      "Music",
      "Food",
      "The weather",
      "Family",
    ],
  ],
  [
    "Name something that can end a party early.",
    [
      "A noise complaint",
      "No drinks",
      "An argument",
      "Bad weather",
      "The venue closing",
      "People getting tired",
      "Transport home",
      "A power cut",
      "The host leaving",
      "A mess",
    ],
  ],
  [
    "Name something people sing together.",
    [
      "Happy Birthday",
      "A karaoke song",
      "A national anthem",
      "A school song",
      "A football chant",
      "A Christmas song",
      "A nursery rhyme",
      "A theme tune",
      "A hymn",
      "A party classic",
    ],
  ],
  [
    "Name something found at a birthday celebration.",
    [
      "A cake",
      "Candles",
      "Presents",
      "Balloons",
      "Cards",
      "Music",
      "Food",
      "Friends",
      "Decorations",
      "Photographs",
    ],
  ],
  [
    "Name something people might compete over at a games night.",
    [
      "The rules",
      "The score",
      "Who goes first",
      "Teams",
      "A close answer",
      "Cheating",
      "The best seat",
      "Snacks",
      "The music",
      "The final turn",
    ],
  ],
  [
    "Name something that makes a group photo difficult.",
    [
      "Someone blinking",
      "People looking away",
      "Bad lighting",
      "Someone missing",
      "A tall person",
      "A small screen",
      "Someone laughing",
      "A stranger walking past",
      "Not enough space",
      "Too many phones",
    ],
  ],
  [
    "Name something people do when their team wins.",
    [
      "Cheer",
      "Hug",
      "Shout",
      "Dance",
      "High-five",
      "Take a photo",
      "Sing",
      "Tease the other team",
      "Post online",
      "Ask for a rematch",
    ],
  ],
  [
    "Name something that makes an awkward silence disappear.",
    [
      "A joke",
      "Music",
      "A new question",
      "Food arriving",
      "Someone laughing",
      "A compliment",
      "A game",
      "A phone ringing",
      "A shared memory",
      "The host speaking",
    ],
  ],
  [
    "Name something guests may secretly judge at an event.",
    [
      "The food",
      "The music",
      "The venue",
      "The drinks",
      "The timing",
      "The decorations",
      "The host",
      "The dress code",
      "The seating",
      "The queue",
    ],
  ],
] as const;

const CONNECTION_SEEDS: readonly CardSeed[] = [
  [
    "Name something friends remember about the first time they met.",
    [
      "Where it happened",
      "What they wore",
      "Who introduced them",
      "The first conversation",
      "A joke",
      "The music",
      "The weather",
      "A first impression",
      "The food",
      "An embarrassing moment",
    ],
  ],
  [
    "Name something that keeps a friendship strong.",
    [
      "Honesty",
      "Making time",
      "Laughter",
      "Trust",
      "Checking in",
      "Shared experiences",
      "Listening",
      "Forgiveness",
      "Support",
      "A group chat",
    ],
  ],
  [
    "Name something friends lovingly tease each other about.",
    [
      "Old photos",
      "Fashion",
      "A bad habit",
      "A nickname",
      "Dating stories",
      "Their laugh",
      "A favourite phrase",
      "Music taste",
      "Cooking",
      "Being late",
    ],
  ],
  [
    "Name something people learn about each other on a trip.",
    [
      "Sleeping habits",
      "How organised they are",
      "Food preferences",
      "Patience",
      "Spending habits",
      "Morning mood",
      "Navigation skills",
      "Packing style",
      "Risk tolerance",
      "Music taste",
    ],
  ],
  [
    "Name something that makes someone easy to talk to.",
    [
      "They listen",
      "They smile",
      "They ask questions",
      "They are funny",
      "They do not judge",
      "They are honest",
      "They share stories",
      "They remember details",
      "They are calm",
      "They make eye contact",
    ],
  ],
  [
    "Name something a group of friends always debates.",
    [
      "Where to eat",
      "What time to meet",
      "Who is driving",
      "What to watch",
      "Holiday plans",
      "The bill",
      "Music",
      "The best route",
      "Sports",
      "The group chat",
    ],
  ],
  [
    "Name something people do to cheer up a friend.",
    [
      "Make them laugh",
      "Listen",
      "Bring food",
      "Give a hug",
      "Call them",
      "Take them out",
      "Send a message",
      "Offer advice",
      "Share a memory",
      "Give them space",
    ],
  ],
  [
    "Name something that can make people feel included.",
    [
      "An introduction",
      "Being asked a question",
      "An invitation",
      "Remembering their name",
      "A seat in the circle",
      "A shared joke",
      "Explaining the rules",
      "A compliment",
      "Being added to the chat",
      "Someone checking in",
    ],
  ],
  [
    "Name something families pass down.",
    [
      "Recipes",
      "Stories",
      "Traditions",
      "Jewellery",
      "Names",
      "Photographs",
      "Clothes",
      "Advice",
      "Furniture",
      "A sense of humour",
    ],
  ],
  [
    "Name something people celebrate together.",
    [
      "A birthday",
      "A wedding",
      "A new job",
      "A graduation",
      "A win",
      "An anniversary",
      "A new baby",
      "A holiday",
      "Moving home",
      "An achievement",
    ],
  ],
  [
    "Name something people wish they did more often with friends.",
    [
      "Meet in person",
      "Travel",
      "Call",
      "Try new things",
      "Eat together",
      "Play games",
      "Exercise",
      "Celebrate small wins",
      "Take photos",
      "Say thank you",
    ],
  ],
  [
    "Name something that makes a shared memory unforgettable.",
    [
      "A surprise",
      "Lots of laughter",
      "A first time",
      "A disaster",
      "A beautiful place",
      "The people",
      "A spontaneous plan",
      "A celebration",
      "A photograph",
      "A story retold often",
    ],
  ],
] as const;

const LONDON_BEHAVIOUR_SEEDS: readonly CardSeed[] = [
  [
    "Name a tiny victory that can make a Londoner's whole day.",
    [
      "Getting a seat on the Tube",
      "Catching the train just in time",
      "The bus arriving immediately",
      "Finding a cheap pint",
      "A sunny afternoon in the park",
      "Contactless working first time",
      "Discovering a useful shortcut",
      "Walking straight into a busy venue",
      "Getting the rent fixed",
      "Bumping into a friend",
    ],
  ],
  [
    "Name something a Londoner might say when you tell them the journey takes 45 minutes.",
    [
      "That's not far",
      "Which zone is it in?",
      "Let's meet halfway",
      "Is it on the same line?",
      "I'll check Citymapper",
      "I can probably walk it",
      "What is the night bus like?",
      "Not during rush hour",
      "I'll be there in twenty",
      "Let's do another day",
    ],
  ],
  [
    "Name something people claim proves they are a real Londoner.",
    [
      "They were born there",
      "They walk very quickly",
      "They know the Tube map",
      "They survived rush hour",
      "They complain about rent",
      "They know the best late food",
      "They understand the bus routes",
      "They ignore famous people",
      "They have a north-south opinion",
      "They have lived there for years",
    ],
  ],
  [
    "Name a sign someone has only just moved to London.",
    [
      "They photograph every landmark",
      "They talk about the rent constantly",
      "They stand on the left of the escalator",
      "They use London slang awkwardly",
      "They are excited by the night bus",
      "They call every train the Tube",
      "They underestimate journey times",
      "They ask what zone everything is",
      "They still talk to strangers",
      "They carry a paper Tube map",
    ],
  ],
  [
    "Name something a Londoner does before leaving home for work.",
    [
      "Take a shower",
      "Eat breakfast",
      "Get dressed",
      "Check the route",
      "Grab their keys",
      "Pack their bag",
      "Make coffee",
      "Check the weather",
      "Say goodbye",
      "Lock the door",
    ],
    "r1q5",
  ],
] as const;

const TRANSPORT_SEEDS: readonly CardSeed[] = [
  [
    "Name something a Londoner does when the Tube is delayed.",
    [
      "Check Citymapper",
      "Sigh loudly",
      "Message that they will be late",
      "Try another line",
      "Start walking",
      "Stare at the departure board",
      "Look for a bus",
      "Blame a signal failure",
      "Squeeze onto the next train",
      "Give up on the plan",
    ],
  ],
  [
    "Name an unwritten rule of the London Underground.",
    [
      "Stand on the right",
      "Let passengers off first",
      "Do not block the doors",
      "Move down inside the carriage",
      "Avoid eye contact",
      "Keep your bag off the seat",
      "Have your payment ready",
      "Use headphones",
      "Offer your seat when needed",
      "Keep conversations quiet",
    ],
  ],
  [
    "Name what someone might do after missing the last train home.",
    [
      "Order an Uber",
      "Take a night bus",
      "Sleep on a friend's sofa",
      "Walk home",
      "Wait for the first train",
      "Call someone for a lift",
      "Find a minicab",
      "Go to an after-party",
      "Hire a bike",
      "Book a hotel",
    ],
  ],
  [
    "Name something a London bus can do that causes instant panic.",
    [
      "Drive past the stop",
      "Go on diversion",
      "Change its destination",
      "Close the doors too early",
      "Decline your payment",
      "Make you miss your stop",
      "Suddenly terminate",
      "Arrive completely full",
      "Send the wait time backwards",
      "Take you in the wrong direction",
    ],
  ],
  [
    "Name a comfort London commuters sometimes give up to save money.",
    [
      "Taking a taxi",
      "Having a seat",
      "A direct journey",
      "Air conditioning",
      "Personal space",
      "Travelling at a quiet time",
      "Carrying less luggage",
      "Buying food on the way",
      "A shorter journey",
      "Using their own car",
    ],
    "r1q8",
  ],
] as const;

const GROUP_CHAT_SEEDS: readonly CardSeed[] = [
  [
    "Name something that always causes chaos in a group chat making plans.",
    [
      "Nobody replying",
      "Too many venue suggestions",
      "A last-minute time change",
      "Someone ignoring the poll",
      "A separate side chat",
      "Different budgets",
      "An unexpected plus-one",
      "Nobody making the booking",
      "Everyone arriving at different times",
      "Someone cancelling",
    ],
  ],
  [
    "Name a way someone gets an ignored group chat talking again.",
    [
      "Send a funny meme",
      "Say they have gossip",
      "Tag everybody",
      "Send a voice note",
      "Ask a controversial question",
      "Share an old photograph",
      "Mention food",
      "Start a poll",
      "Say it is urgent",
      "Threaten to leave the chat",
    ],
  ],
  [
    "Name a role every friendship group chat seems to have.",
    [
      "The organiser",
      "The silent reader",
      "The meme dealer",
      "The voice-note sender",
      "The late replier",
      "The gossip source",
      "The peacemaker",
      "The chaotic one",
      "The screenshot keeper",
      "The person who leaves",
    ],
  ],
  [
    "Name a message people read twice before sending to the group chat.",
    [
      "A complaint about a friend",
      "A screenshot",
      "An emotional paragraph",
      "A risky joke",
      "A change of plans",
      "A request for money",
      "An invitation with limited spaces",
      "A dating update",
      "A message meant for someone else",
      "A very long voice note",
    ],
  ],
  [
    "Name a sign two people in the group chat are proper friends.",
    [
      "They have private jokes",
      "They tease each other",
      "They reply immediately",
      "They share old photographs",
      "They defend each other",
      "They make plans separately",
      "They send voice notes",
      "They know each other's family",
      "They borrow each other's things",
      "They finish each other's stories",
    ],
    "r2q5",
  ],
] as const;

const DATING_SEEDS: readonly CardSeed[] = [
  [
    "Name somewhere a Londoner might take you and insist it counts as a date.",
    [
      "A walk by the canal",
      "Their local pub",
      "A food market",
      "A park",
      "A coffee shop",
      "A free museum",
      "A chicken shop",
      "A rooftop bar",
      "An arcade",
      "A long bus ride",
    ],
  ],
  [
    "Name a reason someone might arrive late to a London date.",
    [
      "Tube delays",
      "Work finished late",
      "They got on the wrong train",
      "They could not find the venue",
      "They changed their outfit",
      "Their Uber cancelled",
      "They underestimated the journey",
      "It started raining",
      "Their phone battery died",
      "They stopped for food",
    ],
  ],
  [
    "Name a dating-profile detail that might make a Londoner swipe left.",
    [
      "Only group photographs",
      "No written bio",
      "Fluent in sarcasm",
      "A gym-mirror selfie",
      "Every photograph is abroad",
      "They boast about their postcode",
      "A photograph holding a fish",
      "Heavily filtered pictures",
      "No drama please",
      "A long list of demands",
    ],
  ],
  [
    "Name an excuse someone gives to end a bad date early.",
    [
      "They have an early morning",
      "Their friend needs help",
      "They need the last train",
      "Work has called",
      "They feel unwell",
      "They forgot another plan",
      "They need to feed a pet",
      "Their phone is dying",
      "A family emergency",
      "They say they are tired",
    ],
  ],
  [
    "Name something that is hard to work out about someone on a first London date.",
    [
      "Their real intentions",
      "Their age",
      "Whether they are single",
      "Their personality",
      "What they do for work",
      "Whether they are honest",
      "Their dating history",
      "How much money they earn",
      "Where they actually live",
      "Whether they want children",
    ],
    "r1q1",
  ],
] as const;

const NIGHTLIFE_SEEDS: readonly CardSeed[] = [
  [
    "Name something Londoners check before committing to a night out.",
    [
      "The journey home",
      "The entry price",
      "Who else is going",
      "The last-entry time",
      "The dress code",
      "Whether they need ID",
      "The drinks prices",
      "The guest list",
      "The weather",
      "Whether there is a cloakroom",
    ],
  ],
  [
    "Name a sign a quiet London night out has gone completely off the rails.",
    [
      "Someone misses the last train",
      "The group loses a friend",
      "Shots arrive",
      "An ex appears",
      "A phone dies",
      "The card gets declined",
      "A stranger joins the group",
      "Someone starts an argument",
      "Everybody goes to an after-party",
      "Breakfast becomes the next stop",
    ],
  ],
  [
    "Name what happens after a friend says they are only coming for one drink.",
    [
      "They stay all night",
      "Someone orders a round",
      "They agree to shots",
      "They start dancing",
      "They miss the last train",
      "They order late-night food",
      "They make new friends",
      "They suggest another venue",
      "They go to an after-party",
      "They regret it the next morning",
    ],
  ],
  [
    "Name something people do while stuck in a long nightclub queue.",
    [
      "Complain about the wait",
      "Check the guest list",
      "Take photographs",
      "Message friends already inside",
      "Debate going elsewhere",
      "Make friends with strangers",
      "Check they have ID",
      "Hold everybody's place",
      "Listen to the music outside",
      "Look for a toilet",
    ],
  ],
  [
    "Name something people do on a night out with close friends but not with strangers.",
    [
      "Share personal gossip",
      "Dance without embarrassment",
      "Borrow money",
      "Share food or drinks",
      "Hold each other's belongings",
      "Cry in the toilets",
      "Take ridiculous photographs",
      "Argue and make up",
      "Sleep on their sofa",
      "Tell them a secret",
    ],
    "r2q11",
  ],
] as const;

const FAMILY_FUNCTION_SEEDS: readonly CardSeed[] = [
  [
    "Name something you notice the moment you enter a big family function.",
    [
      "The smell of food",
      "Loud greetings",
      "Music playing",
      "Aunties giving hugs",
      "Children running around",
      "Rows of chairs",
      "A table full of drinks",
      "People taking photographs",
      "Someone asking why you are late",
      "Relatives you cannot name",
    ],
  ],
  [
    "Name something likely to end up piled onto a plate at a Black British family function.",
    [
      "Jollof rice",
      "Chicken",
      "Rice and peas",
      "Macaroni cheese",
      "Plantain",
      "Curry goat",
      "Coleslaw",
      "Salad",
      "Roast potatoes",
      "A meat pie",
    ],
  ],
  [
    "Name something a relative might ask you within five minutes of arriving.",
    [
      "Are you seeing anyone?",
      "How is work?",
      "Do you remember me?",
      "Why are you late?",
      "Have you eaten?",
      "How are your parents?",
      "When are you getting married?",
      "Are you still studying?",
      "Do you go to church?",
      "How did you get so grown?",
    ],
  ],
  [
    "Name a sign that leaving the family function will take another hour.",
    [
      "The long goodbye starts",
      "Someone offers more food",
      "Leftovers are being packed",
      "A new story begins",
      "Everybody wants photographs",
      "The music gets turned up",
      "People argue about lifts",
      "Someone puts the kettle on",
      "A child has gone missing",
      "Nobody can find their coat",
    ],
  ],
  [
    "Name something from a family function people might remember for years.",
    [
      "A funny speech",
      "A big argument",
      "The food",
      "Someone's dancing",
      "A surprise guest",
      "A family photograph",
      "A special announcement",
      "The music",
      "A disastrous journey",
      "A story an elder told",
    ],
    "r2q15",
  ],
] as const;

const AUNTIES_UNCLES_SEEDS: readonly CardSeed[] = [
  [
    "Name something an aunty seems able to produce from her handbag.",
    [
      "Tissues",
      "Mints",
      "Painkillers",
      "Hand cream",
      "A plastic bag",
      "Loose change",
      "A phone charger",
      "Plasters",
      "A snack",
      "An old photograph",
    ],
  ],
  [
    "Name something an uncle might appoint himself in charge of at the function.",
    [
      "The music",
      "The barbecue",
      "Parking",
      "Pouring drinks",
      "Taking photographs",
      "Moving chairs",
      "Giving directions",
      "Making announcements",
      "The television",
      "Telling old stories",
    ],
  ],
  [
    "Name a phrase that often comes just before some unsolicited family advice.",
    [
      "I'm only saying",
      "When I was your age",
      "You know I love you",
      "Don't take this the wrong way",
      "Listen to your elders",
      "I'm telling you for your own good",
      "Your mother told me",
      "Let me be honest",
      "One day you will understand",
      "Nobody else will tell you",
    ],
  ],
  [
    "Name a job a younger relative gets recruited to do at a family gathering.",
    [
      "Fix someone's phone",
      "Carry chairs",
      "Take photographs",
      "Serve food",
      "Watch the children",
      "Connect the music",
      "Run to the shop",
      "Wash dishes",
      "Move a car",
      "Explain the Wi-Fi",
    ],
  ],
  [
    "Name something an aunty might insist needs replacing in your home.",
    [
      "The sofa",
      "The curtains",
      "The kettle",
      "The carpet",
      "The television",
      "The mattress",
      "The towels",
      "The pots and pans",
      "The front door",
      "The family photographs",
    ],
    "r2q6",
  ],
] as const;

const SLIGHTLY_SPICY_SEEDS: readonly CardSeed[] = [
  [
    "Name a sign someone expected to stay the night, even though they said they did not.",
    [
      "They brought a toothbrush",
      "They have a phone charger",
      "They packed clean clothes",
      "They brought an overnight bag",
      "They checked the morning journey",
      "They told nobody to wait up",
      "They brought skincare",
      "They have their laptop",
      "They parked for the whole night",
      "They brought contact-lens supplies",
    ],
  ],
  [
    "Name a flirty text people send while pretending to be casual.",
    [
      "You up?",
      "What are you doing later?",
      "Come over",
      "Did you make it home?",
      "I miss you",
      "I was thinking about you",
      "When am I seeing you?",
      "They reply to a story",
      "My place or yours?",
      "They send a suggestive emoji",
    ],
  ],
  [
    "Name a reason a date might suggest going back to someone's place.",
    [
      "For one more drink",
      "To listen to music",
      "The venue is closing",
      "They missed the last train",
      "To watch a film",
      "It is quieter",
      "To order food",
      "They live nearby",
      "To meet a pet",
      "To charge a phone",
    ],
  ],
  [
    "Name something that can instantly ruin a romantic mood at home.",
    [
      "A flatmate walks in",
      "A parent phones",
      "Bad music starts playing",
      "The doorbell rings",
      "Someone says the wrong name",
      "The takeaway arrives",
      "A pet interrupts",
      "An alarm goes off",
      "The room is freezing",
      "Someone starts laughing",
    ],
  ],
  [
    "Name an item of clothing someone would not want their date borrowing the next morning.",
    [
      "Underwear",
      "Their favourite outfit",
      "An expensive coat",
      "A work uniform",
      "A sentimental jumper",
      "Shoes",
      "A designer item",
      "A fitted suit",
      "Something brand new",
      "A football shirt",
    ],
    "r1q18",
  ],
] as const;

const DECKS = [
  {
    id: "everyday-life",
    name: "Everyday life",
    description: "Easy, familiar prompts that work with almost any room.",
    cards: makeDeck("everyday-life", "Everyday life", EVERYDAY_SEEDS),
  },
  {
    id: "party-night",
    name: "Party night",
    description: "Celebrations, games nights and the funny parts of getting together.",
    cards: makeDeck("party-night", "Party night", PARTY_SEEDS),
  },
  {
    id: "better-together",
    name: "Better together",
    description: "Warm prompts about friendship, family and shared memories.",
    cards: makeDeck("better-together", "Better together", CONNECTION_SEEDS),
  },
  {
    id: "london-behaviour",
    name: "London behaviour",
    description: "The tiny habits, victories and arguments that make the city feel familiar.",
    cards: makeDeck("london-behaviour", "London behaviour", LONDON_BEHAVIOUR_SEEDS),
  },
  {
    id: "transport",
    name: "Transport",
    description: "Tube etiquette, night buses and journeys that become a whole story.",
    cards: makeDeck("transport", "Transport", TRANSPORT_SEEDS),
  },
  {
    id: "group-chat",
    name: "Group chat",
    description: "Planning chaos, voice notes, screenshots and the people who never reply.",
    cards: makeDeck("group-chat", "Group chat", GROUP_CHAT_SEEDS),
  },
  {
    id: "dating-in-london",
    name: "Dating in London",
    description: "Questionable dates, long journeys and excuses for missing the last train.",
    cards: makeDeck("dating-in-london", "Dating in London", DATING_SEEDS),
  },
  {
    id: "nightlife",
    name: "Nightlife",
    description: "One drink, long queues, late food and plans that escalate beautifully.",
    cards: makeDeck("nightlife", "Nightlife", NIGHTLIFE_SEEDS),
  },
  {
    id: "family-function",
    name: "Family function",
    description: "Food, long goodbyes and the questions relatives ask before you sit down.",
    cards: makeDeck("family-function", "Family function", FAMILY_FUNCTION_SEEDS),
  },
  {
    id: "aunties-uncles",
    name: "Aunties & uncles",
    description: "Handbags with everything, appointed DJs and advice you did not request.",
    cards: makeDeck("aunties-uncles", "Aunties & uncles", AUNTIES_UNCLES_SEEDS),
  },
  {
    id: "slightly-spicy",
    name: "Slightly Spicy",
    description: "Flirty but playable: a late-game lift for adults only.",
    adultOnly: true,
    cards: makeDeck("slightly-spicy", "Slightly Spicy", SLIGHTLY_SPICY_SEEDS, true),
  },
] as const;

export const FAMILY_FEUD_DECKS: readonly FamilyFeudDeckSummary[] = DECKS.map((deck) => ({
  id: deck.id,
  name: deck.name,
  description: deck.description,
  cardCount: deck.cards.length,
  adultOnly: "adultOnly" in deck ? deck.adultOnly : undefined,
}));

const VIBES = [
  {
    id: "london-link-up",
    name: "London link-up",
    description: "London behaviour, group-chat chaos, dating, transport and nightlife.",
    deckIds: ["london-behaviour", "group-chat", "dating-in-london", "transport", "nightlife"],
    roundDeckIds: [
      "london-behaviour",
      "transport",
      "group-chat",
      "dating-in-london",
      "nightlife",
      "london-behaviour",
    ],
  },
  {
    id: "family-function",
    name: "Family function",
    description: "Black British functions, aunties and uncles, group chats and London family life.",
    deckIds: ["london-behaviour", "family-function", "group-chat", "aunties-uncles"],
    roundDeckIds: [
      "london-behaviour",
      "family-function",
      "group-chat",
      "aunties-uncles",
      "family-function",
      "group-chat",
    ],
  },
  {
    id: "night-out",
    name: "Night out",
    description: "London behaviour, dating, transport and nightlife with a rising-energy finish.",
    deckIds: ["london-behaviour", "transport", "dating-in-london", "nightlife"],
    roundDeckIds: [
      "london-behaviour",
      "transport",
      "dating-in-london",
      "nightlife",
      "london-behaviour",
      "nightlife",
    ],
  },
  {
    id: "after-dark",
    name: "After dark",
    description: "Dating and nightlife, with one late Slightly Spicy card when 18+ is enabled.",
    deckIds: ["dating-in-london", "nightlife", "slightly-spicy"],
    roundDeckIds: [
      "dating-in-london",
      "nightlife",
      "dating-in-london",
      "nightlife",
      "dating-in-london",
      "nightlife",
    ],
    adultRoundDeckIds: [
      "dating-in-london",
      "nightlife",
      "dating-in-london",
      "nightlife",
      "slightly-spicy",
      "nightlife",
    ],
  },
  {
    id: "full-london-mix",
    name: "Full London mix",
    description: "The broadest comic arc across every suitable London deck.",
    deckIds: [
      "london-behaviour",
      "transport",
      "group-chat",
      "family-function",
      "aunties-uncles",
      "dating-in-london",
      "nightlife",
      "slightly-spicy",
    ],
    roundDeckIds: [
      "london-behaviour",
      "transport",
      "group-chat",
      "dating-in-london",
      "nightlife",
      "family-function",
    ],
    adultRoundDeckIds: [
      "london-behaviour",
      "transport",
      "group-chat",
      "dating-in-london",
      "slightly-spicy",
      "nightlife",
    ],
  },
  {
    id: "choose-own",
    name: "Choose my own",
    description: "Manually toggle the decks included in the game.",
    deckIds: [],
    roundDeckIds: [],
  },
] as const satisfies ReadonlyArray<
  FamilyFeudVibeSummary & {
    roundDeckIds: readonly string[];
    adultRoundDeckIds?: readonly string[];
  }
>;

export const FAMILY_FEUD_VIBES: readonly FamilyFeudVibeSummary[] = VIBES.map(
  ({ id, name, description, deckIds }) => ({ id, name, description, deckIds }),
);

export function familyFeudVibe(vibeId: FamilyFeudVibeId | string) {
  return VIBES.find(({ id }) => id === vibeId) ?? VIBES[0];
}

export function familyFeudRoundDeckSequence(input: {
  vibeId: FamilyFeudVibeId;
  selectedDeckIds?: readonly string[];
  includeAdult: boolean;
  rounds: number;
}) {
  const vibe = familyFeudVibe(input.vibeId);
  const requested =
    input.vibeId === "choose-own" ? [...new Set(input.selectedDeckIds ?? [])] : [...vibe.deckIds];
  const allowed = requested.filter((deckId) => {
    const deck = DECKS.find(({ id }) => id === deckId);
    return !deck || input.includeAdult || !("adultOnly" in deck && deck.adultOnly);
  });
  const fallback = VIBES[0].roundDeckIds;
  const preferred =
    input.vibeId === "choose-own"
      ? allowed
      : input.includeAdult && "adultRoundDeckIds" in vibe
        ? vibe.adultRoundDeckIds
        : vibe.roundDeckIds;
  const source = preferred.filter((deckId) => allowed.includes(deckId));
  const cycle = source.length ? source : allowed.length ? allowed : fallback;
  const result: string[] = [];
  for (let index = 0; index < input.rounds; index += 1) {
    let candidate = cycle[index % cycle.length]!;
    if (candidate === result.at(-1) && cycle.length > 1)
      candidate = cycle[(index + 1) % cycle.length]!;
    result.push(candidate);
  }
  return result;
}

export function familyFeudDecks(deckIds: readonly string[], includeAdult: boolean) {
  const requested = new Set(deckIds);
  return DECKS.filter(
    (deck) =>
      requested.has(deck.id) && (includeAdult || !("adultOnly" in deck && Boolean(deck.adultOnly))),
  );
}

export function familyFeudDeck(deckId: string) {
  return DECKS.find(({ id }) => id === deckId) ?? DECKS[0];
}

export const FAMILY_FEUD_PRACTICE_CARD: FamilyFeudCardDefinition = {
  id: "practice:things-at-a-party",
  prompt: "Name something you might find at a party.",
  answers: ["Music", "Food", "Friends"].map((label, position) =>
    answer("practice:things-at-a-party", label, position),
  ),
};
