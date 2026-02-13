import { getRedis } from './redis';
import { Guest } from './types';

const GUEST_LIST_KEY = 'guest:list';

/** In-memory fallback storage for local development without Redis */
const memoryStore = new Map<string, Guest[]>();

export async function getGuests(): Promise<Guest[]> {
  try {
    const redis = getRedis();
    if (redis) {
      const guests = await redis.get<Guest[]>(GUEST_LIST_KEY);
      return guests ? (Array.isArray(guests) ? guests : []) : [];
    }
    // Fallback to in-memory storage
    return memoryStore.get(GUEST_LIST_KEY) || [];
  } catch (error) {
    console.error('Error fetching guests:', error);
    return memoryStore.get(GUEST_LIST_KEY) || [];
  }
}

export async function setGuests(guests: Guest[]): Promise<void> {
  try {
    const redis = getRedis();
    if (redis) {
      await redis.set(GUEST_LIST_KEY, guests);
    }
    // Always update memory store (serves as cache and fallback)
    memoryStore.set(GUEST_LIST_KEY, guests);
  } catch (error) {
    console.error('Error saving guests:', error);
    memoryStore.set(GUEST_LIST_KEY, guests);
  }
}

export async function updateGuestCheckIn(guestId: string, checkedIn: boolean): Promise<void> {
  try {
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
  } catch (error) {
    console.error('Error updating guest check-in:', error);
    throw error;
  }
}
