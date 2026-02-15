import Papa from 'papaparse';
import { log } from '../logger';
import { Guest, GuestStatus, generateGuestId } from './types';

type CSVRow = {
  Name: string;
  Status: string;
  'RSVP date': string;
  'Did you enter your full name? (Enter your full name)': string;
  'Is Plus One Of': string;
};

function normalizeStatus(status: string): GuestStatus {
  const normalized = status.trim();
  if (normalized === "Can't Go") return "Can't Go";
  if (normalized === 'Invited') return 'Invited';
  if (normalized === 'Pending') return 'Pending';
  return 'Approved';
}

export function parseCSV(csvContent: string): Guest[] {
  const result = Papa.parse<CSVRow>(csvContent, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim(),
  });

  if (result.errors.length > 0) {
    log.warn('guests.csv', 'CSV parsing errors', { errors: result.errors });
  }

  const rows = result.data;
  const guestsMap = new Map<string, Guest>();
  const plusOneMap = new Map<string, string[]>(); // guest name -> array of +1 names

  rows.forEach((row, index) => {
    const name = row.Name?.trim();
    if (!name) return;

    const isPlusOne = !!row['Is Plus One Of']?.trim();
    const plusOneOf = row['Is Plus One Of']?.trim() || undefined;
    const fullName = row['Did you enter your full name? (Enter your full name)']?.trim() || undefined;
    const status = normalizeStatus(row.Status || 'Pending');
    const rsvpDate = row['RSVP date']?.trim() || undefined;

    const guest: Guest = {
      id: generateGuestId(name, index),
      name,
      fullName: fullName && fullName !== name ? fullName : undefined,
      status,
      rsvpDate,
      isPlusOne,
      plusOneOf,
      checkedIn: false,
      plusOnes: [],
    };

    guestsMap.set(name, guest);

    if (isPlusOne && plusOneOf) {
      if (!plusOneMap.has(plusOneOf)) {
        plusOneMap.set(plusOneOf, []);
      }
      plusOneMap.get(plusOneOf)!.push(name);
    }
  });

  const mainGuests: Guest[] = [];

  guestsMap.forEach((guest, name) => {
    if (!guest.isPlusOne) {
      const plusOneNames = plusOneMap.get(name) || [];
      guest.plusOnes = plusOneNames
        .map((plusOneName) => guestsMap.get(plusOneName))
        .filter((g): g is Guest => g !== undefined);
      mainGuests.push(guest);
    }
  });

  return mainGuests.sort((a, b) => a.name.localeCompare(b.name));
}

export async function parseCSVFile(file: File): Promise<Guest[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const guests = parseCSV(content);
        resolve(guests);
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsText(file);
  });
}
