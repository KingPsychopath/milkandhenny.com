export type GuestStatus = 'Approved' | 'Pending' | "Can't Go" | 'Invited';

/**
 * Generate a deterministic guest ID from a name.
 * Pass a suffix (index or timestamp) for uniqueness.
 * Defaults to Date.now() when no suffix is provided.
 */
export function generateGuestId(
  name: string,
  suffix: string | number = Date.now()
): string {
  return `${name.toLowerCase().replace(/\s+/g, '-')}-${suffix}`;
}

export type Guest = {
  id: string;
  name: string;
  fullName?: string;
  status: GuestStatus;
  rsvpDate?: string;
  isPlusOne: boolean;
  plusOneOf?: string;
  checkedIn: boolean;
  checkedInAt?: string;
  plusOnes: Guest[];
};

export type GuestStats = {
  totalInvites: number;
  totalPlusOnes: number;
  checkedInInvites: number;
  checkedInPlusOnes: number;
  totalCheckedIn: number;
};

export type SearchFilter = 'all' | 'invites' | 'plusOnes' | 'checkedIn' | 'notCheckedIn';
