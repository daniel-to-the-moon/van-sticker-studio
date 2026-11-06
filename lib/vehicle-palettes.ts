import type { StringKey } from './i18n.ts';

/** Approximate sRGB references from issue 41, not official paint codes. */
export type VehiclePalette = {
  id: string;
  nameKey: StringKey;
  white: string;
  accent: string;
  trim: string;
};

export const VEHICLE_PALETTES: readonly VehiclePalette[] = [
  {
    id: 'powder-blue',
    nameKey: 'palette.powderBlue',
    white: '#F3F2EC',
    accent: '#78A9CC',
    trim: '#D9DDE1',
  },
  {
    id: 'laurel-green',
    nameKey: 'palette.laurelGreen',
    white: '#F2F2EE',
    accent: '#6F9A86',
    trim: '#D9DDE1',
  },
  {
    id: 'mustard-yellow',
    nameKey: 'palette.mustardYellow',
    white: '#F1EEE4',
    accent: '#E0B33A',
    trim: '#5A4632',
  },
  {
    id: 'cherry-red',
    nameKey: 'palette.cherryRed',
    white: '#EFE7D6',
    accent: '#A8262E',
    trim: '#D9D1BD',
  },
  {
    id: 'lagoon-green',
    nameKey: 'palette.lagoonGreen',
    white: '#F4F4F0',
    accent: '#3EB2AC',
    trim: '#E9813A',
  },
  {
    id: 'vibrant-orange',
    nameKey: 'palette.vibrantOrange',
    white: '#F2F2EE',
    accent: '#E2702B',
    trim: '#8E9396',
  },
  {
    id: 'forest-green',
    nameKey: 'palette.forestGreen',
    white: '#F0EDE4',
    accent: '#2F5B45',
    trim: '#C8A24A',
  },
  {
    id: 'coffee-beige',
    nameKey: 'palette.coffeeBeige',
    white: '#F1ECDF',
    accent: '#C4A47C',
    trim: '#7A5A3E',
  },
  {
    id: 'sakura-pink',
    nameKey: 'palette.sakuraPink',
    white: '#F5F3EF',
    accent: '#E8A3B4',
    trim: '#9ED6C3',
  },
  {
    id: 'charcoal-blue',
    nameKey: 'palette.charcoalBlue',
    white: '#F2F2EE',
    accent: '#34445A',
    trim: '#C9CDD1',
  },
];

/** Closed-pose chart height in model metres; one lower band and 3cm trim. */
export const PALETTE_PARTITION = { accentTop: 1.22, trimTop: 1.25 } as const;
