import type { EntityType } from './authorization.ts';

export type ClientId = 'books' | 'media' | 'places';
export type Signal = {
  id: string;
  entityId: string;
  title: string;
  subtitle: string;
  type: string;
  tags: Record<string, number>;
  active: boolean;
  confirmedAt: string;
};
export type CatalogItem = {
  id: string;
  title: string;
  creator: string;
  description: string;
  url: string;
  price: number;
  format?: 'paperback' | 'hardback' | 'ebook';
  minutes?: number;
  setting?: 'indoors' | 'outdoors';
  art: string;
  identity: string;
  tags: Record<string, number>;
  qlooId: string | null;
};
export type PublicCatalogItem = Omit<CatalogItem, 'tags' | 'qlooId'>;
export const CLIENTS = {
  books: {
    name: 'The Reading Room',
    type: 'book' as EntityType,
    catalogId: 'reading-room-editions',
    port: 3114,
    description: 'A good book, thoughtfully chosen.',
  },
  media: {
    name: 'Tonight',
    type: 'movie' as EntityType,
    catalogId: 'tonight-films',
    port: 3115,
    description: 'Make an evening of it.',
  },
  places: {
    name: 'A Good Afternoon',
    type: 'place' as EntityType,
    catalogId: 'london-afternoons',
    port: 3116,
    description: 'Find a little wonder nearby.',
  },
} as const;
export const REFERENCE_CHOICES = [
  {
    id: 'ref-forest',
    entityId: 'sample:braiding-sweetgrass',
    title: 'Braiding Sweetgrass',
    subtitle: 'Robin Wall Kimmerer · book',
    type: 'book',
    tags: { nature: 6, quiet: 1 },
  },
  {
    id: 'ref-everyday',
    entityId: 'sample:perfect-days',
    title: 'Perfect Days',
    subtitle: 'Wim Wenders · 2023 film',
    type: 'movie',
    tags: { everyday: 3, quiet: 2 },
  },
  {
    id: 'ref-future',
    entityId: 'sample:arrival',
    title: 'Arrival',
    subtitle: 'Denis Villeneuve · 2016 film',
    type: 'movie',
    tags: { speculative: 5, curiosity: 3 },
  },
  {
    id: 'ref-studio',
    entityId: 'sample:agnes-martin',
    title: 'Agnes Martin',
    subtitle: 'Painter · 1912–2004',
    type: 'artist',
    tags: { creative: 5, quiet: 2 },
  },
  {
    id: 'ref-city',
    entityId: 'sample:barbican',
    title: 'The Barbican',
    subtitle: 'Arts centre · London',
    type: 'place',
    tags: { urban: 5, creative: 2 },
  },
  {
    id: 'ref-community',
    entityId: 'sample:a-man-called-ove',
    title: 'A Man Called Ove',
    subtitle: 'Fredrik Backman · book',
    type: 'book',
    tags: { warmth: 4, community: 4 },
  },
] as const;
export const INVENTORIES: Record<ClientId, CatalogItem[]> = {
  books: [
    {
      id: 'book-delights',
      title: 'The Book of Delights',
      creator: 'Ross Gay',
      description:
        'Short essays that attend to small pleasures, ordinary encounters, and the texture of a day.',
      url: 'https://www.hachettebookgroup.com/titles/ross-gay/the-book-of-delights/9781616207922/',
      price: 2200,
      format: 'hardback',
      art: 'sunflower',
      identity: 'ISBN 9781616207922',
      tags: { nature: 4, everyday: 4, warmth: 2 },
      qlooId: null,
    },
    {
      id: 'book-psalm',
      title: 'A Psalm for the Wild-Built',
      creator: 'Becky Chambers',
      description:
        'A tea monk and a robot find an unexpected friendship in a quietly hopeful future.',
      url: 'https://us.macmillan.com/books/9781250236210/apsalmforthewildbuilt/',
      price: 2000,
      format: 'hardback',
      art: 'solstice',
      identity: 'ISBN 9781250236210',
      tags: { nature: 1, speculative: 6, quiet: 2 },
      qlooId: null,
    },
    {
      id: 'book-creative',
      title: 'The Creative Act',
      creator: 'Rick Rubin',
      description: 'Reflections on attention, making things, and leaving room for a creative life.',
      url: 'https://www.penguinrandomhouse.com/books/717356/the-creative-act-by-rick-rubin/',
      price: 2800,
      format: 'hardback',
      art: 'circle',
      identity: 'ISBN 9780593652886',
      tags: { creative: 8, curiosity: 1 },
      qlooId: null,
    },
    {
      id: 'book-trees',
      title: 'The Hidden Life of Trees',
      creator: 'Peter Wohlleben',
      description:
        'An accessible exploration of forests and the relationships between their trees.',
      url: 'https://greystonebooks.com/products/the-hidden-life-of-trees',
      price: 1800,
      format: 'hardback',
      art: 'botanical',
      identity: 'ISBN 9781771642484',
      tags: { nature: 9, curiosity: 1 },
      qlooId: null,
    },
    {
      id: 'book-gathering',
      title: 'The Art of Gathering',
      creator: 'Priya Parker',
      description:
        'A practical invitation to give everyday gatherings more care, intention, and meaning.',
      url: 'https://www.penguinrandomhouse.com/books/319055/the-art-of-gathering-by-priya-parker/',
      price: 2100,
      format: 'paperback',
      art: 'gathering',
      identity: 'ISBN 9781594634932',
      tags: { community: 7, warmth: 3, urban: 1 },
      qlooId: null,
    },
  ],
  media: [
    {
      id: 'film-paterson',
      title: 'Paterson',
      creator: 'Jim Jarmusch · 2016',
      description:
        'A bus driver writes poetry and finds rhythms in the everyday life of a New Jersey town.',
      url: 'https://bleeckerstreetmedia.com/paterson',
      price: 500,
      minutes: 118,
      art: 'river',
      identity: 'Paterson · 2016 · Jim Jarmusch',
      tags: { everyday: 5, quiet: 4, creative: 3 },
      qlooId: null,
    },
    {
      id: 'film-kiki',
      title: 'Kiki’s Delivery Service',
      creator: 'Hayao Miyazaki · 1989',
      description: 'A young witch makes a new home and discovers the work of finding her own way.',
      url: 'https://gkids.com/films/kikis-delivery-service/',
      price: 500,
      minutes: 102,
      art: 'flight',
      identity: 'Kiki’s Delivery Service · 1989',
      tags: { speculative: 4, warmth: 5, community: 2 },
      qlooId: null,
    },
    {
      id: 'film-secret',
      title: 'The Secret Life of Walter Mitty',
      creator: 'Ben Stiller · 2013',
      description:
        'An office worker follows an elusive photograph into landscapes far beyond his daily routine.',
      url: 'https://www.20thcenturystudios.com/movies/the-secret-life-of-walter-mitty',
      price: 500,
      minutes: 112,
      art: 'mountain',
      identity: 'The Secret Life of Walter Mitty · 2013',
      tags: { nature: 8, curiosity: 2 },
      qlooId: null,
    },
    {
      id: 'film-grand',
      title: 'The Grand Budapest Hotel',
      creator: 'Wes Anderson · 2014',
      description: 'An ornate hotel, a devoted concierge, and a tightly composed comic adventure.',
      url: 'https://www.searchlightpictures.com/thegrandbudapesthotel/',
      price: 500,
      minutes: 100,
      art: 'hotel',
      identity: 'The Grand Budapest Hotel · 2014',
      tags: { creative: 5, urban: 4, community: 1 },
      qlooId: null,
    },
    {
      id: 'film-moonrise',
      title: 'Moonrise Kingdom',
      creator: 'Wes Anderson · 2012',
      description: 'Two young pen pals set off together through an island’s woods and coves.',
      url: 'https://www.focusfeatures.com/moonrise_kingdom',
      price: 500,
      minutes: 94,
      art: 'cove',
      identity: 'Moonrise Kingdom · 2012',
      tags: { nature: 4, warmth: 4, creative: 2 },
      qlooId: null,
    },
  ],
  places: [
    {
      id: 'place-kew',
      title: 'Kew Gardens',
      creator: 'Richmond · London',
      description: 'Botanical collections, open landscapes, and glasshouses beside the Thames.',
      url: 'https://www.kew.org/kew-gardens',
      price: 2500,
      setting: 'outdoors',
      art: 'glasshouse',
      identity: 'Royal Botanic Gardens, Kew, Richmond, London TW9 3AE',
      tags: { nature: 9, curiosity: 2 },
      qlooId: null,
    },
    {
      id: 'place-daunt',
      title: 'Daunt Books Marylebone',
      creator: 'Marylebone · London',
      description: 'An independent bookshop known for its galleries and travel-led shelves.',
      url: 'https://dauntbooks.co.uk/shops/marylebone/',
      price: 0,
      setting: 'indoors',
      art: 'shelves',
      identity: '83–84 Marylebone High Street, London W1U 4QW',
      tags: { everyday: 2, quiet: 4, curiosity: 5 },
      qlooId: null,
    },
    {
      id: 'place-tate',
      title: 'Tate Modern',
      creator: 'Bankside · London',
      description: 'Modern and contemporary art in a former power station on the river.',
      url: 'https://www.tate.org.uk/visit/tate-modern',
      price: 0,
      setting: 'indoors',
      art: 'gallery',
      identity: 'Bankside, London SE1 9TG',
      tags: { creative: 8, urban: 3 },
      qlooId: null,
    },
    {
      id: 'place-bfi',
      title: 'BFI Southbank',
      creator: 'South Bank · London',
      description: 'A home for film seasons, screenings, and conversations beside the Thames.',
      url: 'https://www.bfi.org.uk/bfi-southbank',
      price: 1500,
      setting: 'indoors',
      art: 'cinema',
      identity: 'Belvedere Road, London SE1 8XT',
      tags: { speculative: 5, creative: 3, community: 3 },
      qlooId: null,
    },
    {
      id: 'place-dunstan',
      title: 'St Dunstan in the East',
      creator: 'City of London',
      description: 'A small public garden sheltered by the remains of a historic church.',
      url: 'https://www.cityoflondon.gov.uk/things-to-do/city-gardens/find-a-garden/st-dunstan-in-the-east-church-garden',
      price: 0,
      setting: 'outdoors',
      art: 'garden',
      identity: 'St Dunstan’s Hill, London EC3R 5DD',
      tags: { nature: 5, quiet: 5, urban: 2 },
      qlooId: null,
    },
  ],
};
export const availabilityNotice =
  'Authored sample catalog. Budget amounts are illustrative USD values, not live prices. Stock, streaming availability, tickets, and opening times are not verified; check the official source before planning.';
export function publicCatalogItem(item: CatalogItem): PublicCatalogItem {
  const { tags: _tags, qlooId: _qlooId, ...publicItem } = item;
  void _tags;
  void _qlooId;
  return publicItem;
}
export function initialSignals(kind: 'personal' | 'gift'): Signal[] {
  const chosen =
    kind === 'gift'
      ? ['ref-forest', 'ref-everyday', 'ref-community']
      : ['ref-forest', 'ref-everyday', 'ref-future'];
  return REFERENCE_CHOICES.filter((x) => chosen.includes(x.id)).map((x) => ({
    ...x,
    tags: { ...x.tags },
    active: true,
    confirmedAt: new Date().toISOString(),
  }));
}
