export type Medication = {
  id: string;
  name: string;
  dosage?: string;
  intervalHours: number;
  startTime: string;
  times?: string[];
  durationMinutes?: number;
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
