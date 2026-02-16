import { getRedis } from '../platform/redis';
import { Guest, GuestStatus, generateGuestId } from './types';

const GUEST_LIST_KEY = 'guest:list';

/** In-memory fallback for local development without Redis. */
const memoryStore = new Map<string, Guest[]>();

/**
 * Fetch the guest list. Falls back to in-memory store when Redis
 * is unavailable or errors. Never throws — always returns an array.
 */
export async function getGuests(): Promise<Guest[]> {
  const redis = getRedis();

  if (!redis) {
    return memoryStore.get(GUEST_LIST_KEY) ?? [];
  }

  try {
    const guests = await redis.get<Guest[]>(GUEST_LIST_KEY);
    return guests ? (Array.isArray(guests) ? guests : []) : [];
  } catch (error) {
    console.error('[kv-client] getGuests failed, using memory fallback:', error);
    return memoryStore.get(GUEST_LIST_KEY) ?? [];
  }
}

/**
 * Persist the guest list. Writes to both Redis (primary) and
 * the in-memory store (cache + fallback). Never throws.
 */
export async function setGuests(guests: Guest[]): Promise<void> {
  memoryStore.set(GUEST_LIST_KEY, guests);

  const redis = getRedis();
  if (!redis) return;

  try {
    await redis.set(GUEST_LIST_KEY, guests);
  } catch (error) {
    console.error('[kv-client] setGuests failed, data is in memory only:', error);
  }
}

/**
 * Toggle a guest's check-in status (works for main guests and plus-ones).
 * Throws on failure — callers should handle the error.
 */
export async function updateGuestCheckIn(
  guestId: string,
  checkedIn: boolean
): Promise<void> {
  const guests = await getGuests();

  const updatedGuests = guests.map((guest: Guest) => {
    if (guest.id === guestId) {
      return {
        ...guest,
        checkedIn,
        checkedInAt: checkedIn ? new Date().toISOString() : undefined,
      };
    }

    if (guest.plusOnes) {
      const updatedPlusOnes = guest.plusOnes.map((plusOne: Guest) => {
        if (plusOne.id === guestId) {
          return {
            ...plusOne,
            checkedIn,
            checkedInAt: checkedIn ? new Date().toISOString() : undefined,
          };
        }
        return plusOne;
      });
      return { ...guest, plusOnes: updatedPlusOnes };
    }

    return guest;
  });

  await setGuests(updatedGuests);
}

export type GuestOpResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; error: string };

type AddGuestInput = {
  name: string;
  fullName?: string;
  status?: GuestStatus;
  plusOneOf?: string;
};

/**
 * Add a guest (or plus-one) to the guest list.
 * Pure list manipulation lives here so route handlers stay thin.
 */
export async function addGuest(input: AddGuestInput): Promise<GuestOpResult<Guest>> {
  if (!input.name || typeof input.name !== 'string') {
    return { ok: false, status: 400, error: 'Name is required' };
  }

  const name = input.name.trim();
  if (!name) return { ok: false, status: 400, error: 'Name is required' };

  const plusOneOf = input.plusOneOf?.trim() || undefined;
  const isPlusOne = !!plusOneOf;

  const guests = await getGuests();

  const newGuest: Guest = {
    id: generateGuestId(name),
    name,
    fullName: input.fullName?.trim() || undefined,
    status: input.status || 'Pending',
    isPlusOne,
    plusOneOf,
    checkedIn: false,
    plusOnes: [],
  };

  if (isPlusOne && plusOneOf) {
    const mainGuestIndex = guests.findIndex((g) => g.name === plusOneOf);
    if (mainGuestIndex === -1) {
      return { ok: false, status: 404, error: 'Main guest not found' };
    }

    const main = guests[mainGuestIndex];
    const nextMain: Guest = {
      ...main,
      plusOnes: [...(main.plusOnes ?? []), newGuest],
    };

    const updatedGuests = guests.slice();
    updatedGuests[mainGuestIndex] = nextMain;
    await setGuests(updatedGuests);
    return { ok: true, value: newGuest };
  }

  await setGuests([...guests, newGuest]);
  return { ok: true, value: newGuest };
}

/**
 * Remove a guest by id (works for main guests and plus-ones).
 */
export async function removeGuest(guestId: string): Promise<GuestOpResult<void>> {
  const id = guestId?.trim();
  if (!id) return { ok: false, status: 400, error: 'Guest ID is required' };

  const guests = await getGuests();
  const updatedGuests = guests
    .filter((g) => g.id !== id)
    .map((g) => ({
      ...g,
      plusOnes: (g.plusOnes ?? []).filter((p) => p.id !== id),
    }));

  await setGuests(updatedGuests);
  return { ok: true, value: undefined };
}

type BootstrapResult = {
  reset?: boolean;
  bootstrapped: boolean;
  message: string;
  count: number;
};

/**
 * Bootstrap guest list from a parsed CSV payload.
 * The caller is responsible for fetching/parsing the CSV.
 */
export async function bootstrapGuestsFromCsv(
  csvGuests: Guest[] | null,
  opts?: { force?: boolean }
): Promise<GuestOpResult<BootstrapResult>> {
  const force = !!opts?.force;

  if (!force) {
    const existing = await getGuests();
    if (existing.length > 0) {
      return {
        ok: true,
        value: {
          bootstrapped: false,
          message: 'Guests already exist',
          count: existing.length,
        },
      };
    }
  } else {
    await setGuests([]);
  }

  if (!csvGuests) {
    return {
      ok: true,
      value: {
        reset: force || undefined,
        bootstrapped: false,
        message: force ? 'Cleared data but no guests.csv found' : 'No guests.csv found in public folder',
        count: 0,
      },
    };
  }

  await setGuests(csvGuests);
  return {
    ok: true,
    value: {
      reset: force || undefined,
      bootstrapped: true,
      message: force ? 'Cleared and reloaded from CSV' : 'Loaded guests from CSV',
      count: csvGuests.length,
    },
  };
}

