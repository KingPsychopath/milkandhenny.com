export type GuestStatus = 'Approved' | 'Pending' | "Can't Go" | 'Invited';

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
