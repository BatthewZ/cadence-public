export type RecurrenceRule = {
  frequency: "daily" | "weekly" | "monthly" | "yearly";
  interval: number;           // every N days/weeks/months/years
  daysOfWeek?: number[];      // 0=Sun..6=Sat (weekly)
  dayOfMonth?: number;        // 1-31 (monthly by date)
  nthWeekday?: { n: number; day: number }; // e.g. 2nd Tuesday (monthly by weekday)
  endDate?: string;           // ISO date, optional end condition
};

export const RECURRENCE_FREQUENCIES = ["daily", "weekly", "monthly", "yearly"] as const;
