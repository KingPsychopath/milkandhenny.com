import { getRedis } from '../redis';
import { Guest } from './types';

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
