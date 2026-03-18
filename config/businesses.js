/**
 * Ziarem – all businesses and services (single source of truth).
 * Used by: GET /businesses, lead tagging (ziarem_tags), inbox badges, docs.
 */

const BUSINESSES = [
  {
    name: 'Wolf Surety & Reno LLC',
    badge: 'Wolf Reno',
    description: 'Surety bonds and contractor/trade leads (builders, electricians, plumbers, welders, architects).',
    ziarem_tags: ['WOLF_RENO_TARGET'],
    services: ['Surety bonds', 'Contractor / trade targeting'],
  },
  {
    name: 'Dispute LLC',
    badge: 'Dispute',
    description: 'Credit repair and distressed property (notice of default, foreclosure, notice of sale; low credit).',
    ziarem_tags: ['DISPUTE_DISTRESSED'],
    services: ['Credit repair', 'Distressed property'],
  },
  {
    name: 'Lyco Inc',
    badge: 'Lyco',
    description: 'Tax and high-net-worth leads (self-employed, business owners, doctors, attorneys; home value > $1M).',
    ziarem_tags: ['LYCO_TAX_LEAD'],
    services: ['Tax leads', 'High-net-worth', 'Business owner targeting'],
  },
  {
    name: 'Dos Mortgage & Laenan',
    badge: 'Dos',
    description: 'Mortgage refi (adjustable-rate) and first-time buyer leads (credit A + renter).',
    ziarem_tags: ['DOS_REFI_TARGET', 'DOS_FIRST_TIME_BUYER'],
    services: ['Refi targeting (ADJ)', 'First-time buyer'],
  },
  {
    name: 'Re4lty & Closed By Whom',
    badge: 'Re4lty',
    description: 'Fix-and-flip opportunities (older homes, lower value) and title / bargain-and-sale deed.',
    ziarem_tags: ['RE4LTY_FLIP_OPPORTUNITY', 'CLOSED_BY_WHOM_TITLE'],
    services: ['Flip opportunity leads', 'Title / Closed By Whom'],
  },
  {
    name: 'Wolf Insurance',
    badge: 'Wolf Ins',
    description: 'Insurance liability and high-risk (pools, wood-shake roof).',
    ziarem_tags: ['WOLF_INSURANCE_LIABILITY', 'WOLF_INSURANCE_HIGH_RISK'],
    services: ['Pool liability', 'High-risk (e.g. wood shake roof)'],
  },
];

/** All ziarem_tags that can be applied to leads (for filtering/display). */
const ALL_TAGS = [...new Set(BUSINESSES.flatMap((b) => b.ziarem_tags))];

/** Badge names for inbox (e.g. [Lyco], [Wolf Reno]). */
const BADGES = BUSINESSES.map((b) => ({ name: b.name, badge: b.badge }));

module.exports = {
  BUSINESSES,
  ALL_TAGS,
  BADGES,
};
