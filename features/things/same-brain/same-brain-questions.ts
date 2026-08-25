/**
 * The question bank, browser-safe so the one-phone mode needs no server.
 *
 * A question earns its place by having a *shape*: one obvious axis, a popular answer that most of
 * the room can find, and two or three others a reasonable person would defend. Both ways of getting
 * this wrong kill the round outright.
 *
 * Too narrow and there is only one answer — "how many legs has a spider" is not a question, it is a
 * fact, and a round where everybody was always going to agree pays one point and teaches nothing
 * about anybody. Too wide and no herd can form: "name a word", "name something you own", "name an
 * object" — the liars word bank learned this the expensive way, where "an object" grew to
 * eighty-three entries holding glaciers next to call centres. A question you cannot picture five
 * people answering is a question that produces five clusters of one.
 *
 * The test to apply before adding one: say it out loud, then guess the top answer. If you cannot,
 * it is too wide. If you are certain, it is too narrow.
 *
 * There is a third failure mode: a question whose answers are all drawn from one small closed set —
 * days of the week, months, colours, numbers, planets — gives the room too little space to think.
 * "Name a day of the week nobody likes" was in this bank and made every round about arguing over a
 * tiny list rather than finding a shared answer. It has been removed. Closed-set questions do not
 * belong here.
 */

export interface SameBrainQuestionGroup {
  /** What this batch is doing — the kind of agreement it goes after. */
  about: string;
  questions: string[];
}

const GROUPS: SameBrainQuestionGroup[] = [
  {
    about:
      "Household objects. The safest questions in the bank: everyone has the same house in their head, so the herd forms on the first or second most obvious thing.",
    questions: [
      "Name something in a kitchen drawer",
      "Name something you keep in a shed",
      "Name something on a fridge door",
      "Name something in a first aid kit",
      "Name something in a toolbox",
      "Name something you find under a sofa",
      "Name something in a bathroom cabinet",
      "Name something people keep but never use",
      "Name something you always lose",
      "Name something on a hotel bed",
      "Name something in a school bag",
      "Name something you would find in a glovebox",
    ],
  },
  {
    about:
      "Small social truths. These split more than the object questions, which is what you want mid-game — the herd is real but not automatic.",
    questions: [
      "Name a reason someone is late",
      "Name an excuse for leaving a party early",
      "Name something people lie about",
      "Name something people pretend to enjoy",
      "Name a thing people argue about in a car",
      "Name something you do when you are nervous",
      "Name a bad first date activity",
      "Name something people say when they have nothing to say",
      "Name a chore everyone puts off",
      "Name something you notice in someone else's house",
      "Name a reason to leave a group chat",
      "Name something people brag about without meaning to",
    ],
  },
  {
    about:
      "Sensory prompts. The answer is a thing rather than an opinion, so these land fast and read well on a phone.",
    questions: [
      "Name something cold",
      "Name something that smells like childhood",
      "Name a sound that wakes you up",
      "Name something sticky",
      "Name something loud",
      "Name a smell nobody likes",
      "Name something that always tastes better outside",
      "Name a texture people hate",
      "Name something too bright",
      "Name a sound that means trouble",
    ],
  },
  {
    about:
      "Places. Tight enough to picture, broad enough that two people can differ honestly on which one comes first.",
    questions: [
      "Name somewhere you go to be alone",
      "Name a place with a bad queue",
      "Name somewhere you would not swim",
      "Name a place children love and adults do not",
      "Name somewhere you would hide",
      "Name a place that is always too warm",
      "Name somewhere you have fallen asleep by accident",
      "Name a place you dress up for",
      "Name somewhere you would not take a first date",
      "Name a room nobody sits in",
    ],
  },
  {
    about:
      "Food. The most reliable herd in the bank and the most likely to be unanimous, so these are worth fewer points more often — spend them early.",
    questions: [
      "Name a topping people argue about",
      "Name something you eat standing up",
      "Name a food that is better cold",
      "Name something nobody finishes",
      "Name a sandwich filling",
      "Name a food you ate constantly as a child",
      "Name something you only eat at Christmas",
      "Name a drink that means the night is over",
      "Name a food that is impossible to eat neatly",
      "Name something people put on toast",
    ],
  },
  {
    about:
      "People and roles. Answers arrive as a job or a type rather than a name, which keeps them short enough to cluster.",
    questions: [
      "Name a job you would be terrible at",
      "Name someone you would not lend money to",
      "Name a job children want and adults do not",
      "Name someone everybody has in their family",
      "Name a job that looks easy and is not",
      "Name someone you should never argue with",
      "Name a job you would do for free",
      "Name someone who always knows everything",
    ],
  },
  {
    about:
      "Time and habit. These split cleanly along how people actually live, so a room of friends and a room of strangers score very differently.",
    questions: [
      "Name the first thing you do in the morning",
      "Name something you do every single day without noticing",
      "Name a thing you keep meaning to start",
      "Name something you have not done in years",
      "Name a time of day that is always wasted",
      "Name something you only do when nobody is watching",
      "Name a habit you picked up from a parent",
    ],
  },
  {
    about:
      "Mild peril. Slightly darker questions, which a warmed-up room reads as funnier and a cold room reads as odd. Late-game material.",
    questions: [
      "Name something people are irrationally afraid of",
      "Name a bad thing to hear a pilot say",
      "Name something you should not do in a library",
      "Name a bad place to lose your phone",
      "Name something you would not touch",
      "Name a bad time for a phone to ring",
      "Name something you should never say at a wedding",
      "Name a bad thing to find in a hotel room",
    ],
  },
];

export const SAME_BRAIN_QUESTIONS = GROUPS.flatMap(({ questions }) => questions);
export const SAME_BRAIN_QUESTION_GROUPS = GROUPS;

/**
 * Picks a question the room has not had recently.
 *
 * The exclusion list is the room's own history rather than a device's, so a group that plays three
 * games back to back keeps getting new questions, and a fresh group is unaffected by what the last
 * group saw. Falls back to the full bank when a very long session exhausts it — a repeat late in a
 * marathon is better than no question at all.
 */
export function sameBrainQuestion(recent: string[], pick: (max: number) => number): string {
  const fresh = SAME_BRAIN_QUESTIONS.filter((question) => !recent.includes(question));
  const pool = fresh.length > 0 ? fresh : SAME_BRAIN_QUESTIONS;
  return pool[pick(pool.length)];
}
