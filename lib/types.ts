export const PROFILE_COLORS = ["sage", "clay", "amber", "violet", "sky", "sand"] as const;
export type ProfileColor = (typeof PROFILE_COLORS)[number];

export type Profile = {
  id: string;
  name: string;
  color: ProfileColor;
  isDefault?: boolean;
  createdAt: number;
};

export type Medication = {
  id: string;
  name: string;
  dosage?: string;
  intervalHours: number;
  startTime: string;
  times?: string[];
  durationMinutes?: number;
  durationDays?: number;
  startDate?: string;
  profileId: string;
  createdAt: number;
};

export type Config = {
  chatId?: number;
  timezone: string;
  email?: string;
  name?: string;
  createdAt?: number;
};

export type DoseSlot = {
  medId: string;
  med: Medication;
  time: string;
  minutes: number;
  taken: boolean;
  takenAt?: number;
};

export type DayLog = Record<string, { taken: boolean; takenAt: number }>;
