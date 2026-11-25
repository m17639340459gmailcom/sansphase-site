export type Analytics = {
  since: string;
  views: number;
  visitors: number;
  today: number;
  daily: { day: string; views: number; visitors: number }[];
  paths: { path: string; views: number; visitors: number }[];
  referrers: { host: string; views: number }[];
  countries: { country: string; views: number }[];
  devices: { device: string; views: number }[];
  locales: { locale: string; views: number }[];
};

export const ANALYTICS_RANGES = [7, 30, 90] as const;
