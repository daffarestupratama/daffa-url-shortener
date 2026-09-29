/**
 * City names for Cloudflare data center codes, shown under the code in the
 * NETWORK panel as in the design ("CGK Jakarta"). Codes follow IATA airport
 * codes. A code missing here still shows, just without a city line. The list
 * favors the region this dashboard serves plus the large global hubs.
 */
const COLO_CITIES: Readonly<Record<string, string>> = {
  // Indonesia and nearby
  CGK: 'Jakarta',
  SUB: 'Surabaya',
  DPS: 'Denpasar',
  JOG: 'Yogyakarta',
  BTH: 'Batam',
  SIN: 'Singapore',
  KUL: 'Kuala Lumpur',
  JHB: 'Johor Bahru',
  BKK: 'Bangkok',
  MNL: 'Manila',
  CEB: 'Cebu',
  SGN: 'Ho Chi Minh City',
  HAN: 'Hanoi',
  PNH: 'Phnom Penh',
  RGN: 'Yangon',
  // East and South Asia
  HKG: 'Hong Kong',
  TPE: 'Taipei',
  NRT: 'Tokyo',
  KIX: 'Osaka',
  FUK: 'Fukuoka',
  ICN: 'Seoul',
  BOM: 'Mumbai',
  DEL: 'New Delhi',
  MAA: 'Chennai',
  BLR: 'Bangalore',
  HYD: 'Hyderabad',
  CCU: 'Kolkata',
  CMB: 'Colombo',
  DAC: 'Dhaka',
  KHI: 'Karachi',
  // Oceania
  SYD: 'Sydney',
  MEL: 'Melbourne',
  BNE: 'Brisbane',
  PER: 'Perth',
  AKL: 'Auckland',
  // Middle East and Africa
  DXB: 'Dubai',
  DOH: 'Doha',
  RUH: 'Riyadh',
  JED: 'Jeddah',
  TLV: 'Tel Aviv',
  JNB: 'Johannesburg',
  CPT: 'Cape Town',
  NBO: 'Nairobi',
  LOS: 'Lagos',
  CAI: 'Cairo',
  // Europe
  AMS: 'Amsterdam',
  FRA: 'Frankfurt',
  LHR: 'London',
  CDG: 'Paris',
  MAD: 'Madrid',
  MXP: 'Milan',
  ARN: 'Stockholm',
  CPH: 'Copenhagen',
  HEL: 'Helsinki',
  OSL: 'Oslo',
  WAW: 'Warsaw',
  VIE: 'Vienna',
  ZRH: 'Zurich',
  DUB: 'Dublin',
  BRU: 'Brussels',
  MAN: 'Manchester',
  IST: 'Istanbul',
  // Americas
  IAD: 'Ashburn',
  EWR: 'Newark',
  ORD: 'Chicago',
  DFW: 'Dallas',
  ATL: 'Atlanta',
  MIA: 'Miami',
  LAX: 'Los Angeles',
  SJC: 'San Jose',
  SEA: 'Seattle',
  DEN: 'Denver',
  YYZ: 'Toronto',
  YVR: 'Vancouver',
  GRU: 'Sao Paulo',
  EZE: 'Buenos Aires',
  SCL: 'Santiago',
  BOG: 'Bogota',
  LIM: 'Lima',
  QRO: 'Queretaro',
};

export function coloCity(code: string | null): string | null {
  return code ? (COLO_CITIES[code.toUpperCase()] ?? null) : null;
}

/** Tooltip on every colo chip, per the decision to label colos unambiguously. */
export const COLO_TOOLTIP = 'Cloudflare data center that served the request';
