/**
 * Crawler Configurations
 *
 * Defines all insurer sites to crawl for terms & conditions PDFs.
 * Includes both OPIN-sourced insurers (need PDFs from their sites)
 * and non-OPIN insurers (MAG, MetLife, Azos — need everything).
 *
 * Each insurer has:
 *   - urls: pages where PDFs are linked
 *   - pdfPattern: regex to find PDF URLs in raw HTML (fetch fallback)
 *   - keywords: life insurance terms to filter relevant PDFs
 *   - needsPlaywright: true if site requires JS rendering
 */

export interface CrawlerConfig {
  /** Insurer display name */
  name: string
  /** CNPJ (Brazilian tax ID) */
  cnpj: string
  /** Pages to crawl for PDF links */
  urls: string[]
  /** Regex pattern to match PDF URLs in page HTML */
  pdfPattern: RegExp
  /** Keywords to filter life-insurance-relevant PDFs */
  keywords: string[]
  /** Whether this site requires Playwright (JS rendering) */
  needsPlaywright: boolean
  /** Source: 'opin' = has product data, 'crawler' = needs full crawl */
  source: 'opin' | 'crawler'
  /** If true, download ALL PDFs found (page is already life-insurance specific) */
  acceptAllPdfs?: boolean
}

/**
 * Life insurance keywords used to filter relevant PDFs.
 * Matched case-insensitively against the PDF URL or surrounding link text.
 */
export const LIFE_INSURANCE_KEYWORDS = [
  'vida',
  'morte',
  'invalidez',
  'funeral',
  'pessoa',
  'ap ',
  'acidentes pessoais',
  'decessos',
  'sobrevivencia',
  'peculi',
  'pensao',
  'prestamista',
  'resgatavel',
  'condicoes gerais',
  'condicoes-gerais',
  'condições gerais',
  'condições-gerais',
  'cgsa',
  'seguro de vida',
  'seguro vida',
  'cobertura',
]

const PDF_PATTERN = /https?:\/\/[^\s"'<>]+\.pdf/gi

// ---------------------------------------------------------------------------
// OPIN insurers — have product data, need PDFs from their websites
// ---------------------------------------------------------------------------

const OPIN_INSURERS: CrawlerConfig[] = [
  {
    name: 'Prudential do Brasil',
    cnpj: '36.542.486/0001-87',
    urls: [
      'https://www.prudential.com.br/condicoes-gerais',
      'https://www.prudential.com.br/produtos',
    ],
    pdfPattern: PDF_PATTERN,
    keywords: LIFE_INSURANCE_KEYWORDS,
    needsPlaywright: true, // SPA React
    source: 'opin',
  },
  {
    name: 'Bradesco Seguros',
    cnpj: '51.014.223/0001-49',
    urls: [
      'https://www.bradescoseguros.com.br/clientes/produtos/seguro-de-vida',
      'https://www.bradescoseguros.com.br/condicoes-gerais',
    ],
    pdfPattern: PDF_PATTERN,
    keywords: LIFE_INSURANCE_KEYWORDS,
    needsPlaywright: true, // Heavy JS
    source: 'opin',
  },
  {
    name: 'Porto Seguro',
    cnpj: '61.198.164/0001-60',
    urls: [
      'https://www.portoseguro.com.br/seguro-vida/condicoes-gerais',
      'https://www.portoseguro.com.br/seguro-vida',
    ],
    pdfPattern: PDF_PATTERN,
    keywords: LIFE_INSURANCE_KEYWORDS,
    needsPlaywright: true,
    source: 'opin',
  },
  {
    name: 'Icatu Seguros',
    cnpj: '42.283.770/0001-39',
    urls: [
      'https://www.icatuseguros.com.br/condicoes-gerais',
      'https://www.icatuseguros.com.br/seguros/seguro-de-vida',
    ],
    pdfPattern: PDF_PATTERN,
    keywords: LIFE_INSURANCE_KEYWORDS,
    needsPlaywright: true, // Dynamic content
    source: 'opin',
  },
  {
    name: 'MAPFRE Seguros',
    cnpj: '61.074.175/0001-38',
    urls: [
      'https://www.mapfre.com.br/seguro-vida/condicoes-gerais/',
      'https://www.mapfre.com.br/seguro-vida/',
    ],
    pdfPattern: PDF_PATTERN,
    keywords: LIFE_INSURANCE_KEYWORDS,
    needsPlaywright: true,
    source: 'opin',
  },
  {
    name: 'Tokio Marine',
    cnpj: '33.164.021/0001-00',
    urls: [
      'https://www.tokiomarine.com.br/seguro-vida',
      'https://www.tokiomarine.com.br/condicoes-gerais',
    ],
    pdfPattern: PDF_PATTERN,
    keywords: LIFE_INSURANCE_KEYWORDS,
    needsPlaywright: true,
    source: 'opin',
  },
  {
    name: 'SulAmerica',
    cnpj: '33.041.062/0001-09',
    urls: [
      'https://portal.sulamericaseguros.com.br/seguro-de-vida',
      'https://portal.sulamericaseguros.com.br/condicoes-gerais',
    ],
    pdfPattern: PDF_PATTERN,
    keywords: LIFE_INSURANCE_KEYWORDS,
    needsPlaywright: true,
    source: 'opin',
  },
  {
    name: 'Zurich',
    cnpj: '28.196.889/0001-43',
    urls: [
      'https://www.zurich.com.br/pt-br/seguros/seguro-de-vida',
      'https://www.zurich.com.br/pt-br/condicoes-gerais',
    ],
    pdfPattern: PDF_PATTERN,
    keywords: LIFE_INSURANCE_KEYWORDS,
    needsPlaywright: true,
    source: 'opin',
  },
  {
    name: 'Caixa Vida e Previdencia',
    cnpj: '03.730.204/0001-76',
    urls: [
      'https://www.caixavidaeprevidencia.com.br/seguros/seguro-de-vida',
    ],
    pdfPattern: PDF_PATTERN,
    keywords: LIFE_INSURANCE_KEYWORDS,
    needsPlaywright: true,
    source: 'opin',
  },
  {
    name: 'Santander Auto/RE',
    cnpj: '61.383.493/0001-80',
    urls: [
      'https://www.santander.com.br/seguros/seguro-de-vida',
    ],
    pdfPattern: PDF_PATTERN,
    keywords: LIFE_INSURANCE_KEYWORDS,
    needsPlaywright: true,
    source: 'opin',
  },
]

// ---------------------------------------------------------------------------
// Non-OPIN insurers — need full crawl (products + PDFs)
// ---------------------------------------------------------------------------

const CRAWLER_ONLY_INSURERS: CrawlerConfig[] = [
  {
    name: 'MAG Seguros',
    cnpj: '06.036.540/0001-50',
    urls: [
      'https://www.magseguros.com.br/condicoes-gerais',
      'https://www.magseguros.com.br/produtos/seguro-de-vida',
    ],
    pdfPattern: PDF_PATTERN,
    keywords: LIFE_INSURANCE_KEYWORDS,
    needsPlaywright: true,
    source: 'crawler',
    acceptAllPdfs: true,
  },
  {
    name: 'MetLife',
    cnpj: '02.102.498/0001-29',
    urls: [
      'https://www.metlife.com.br/condicoes-gerais',
      'https://www.metlife.com.br/seguro-de-vida/',
    ],
    pdfPattern: PDF_PATTERN,
    keywords: LIFE_INSURANCE_KEYWORDS,
    needsPlaywright: true,
    source: 'crawler',
    acceptAllPdfs: true,
  },
  {
    name: 'Azos',
    cnpj: '39.781.553/0001-65',
    urls: [
      'https://www.azos.com.br/condicoes-gerais',
    ],
    pdfPattern: PDF_PATTERN,
    keywords: LIFE_INSURANCE_KEYWORDS,
    needsPlaywright: false, // Azos is simpler, static site
    source: 'crawler',
    acceptAllPdfs: true, // Site is 100% life insurance
  },
]

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

/** All insurers that need Playwright crawling */
export const PLAYWRIGHT_CONFIGS: CrawlerConfig[] = [
  ...OPIN_INSURERS.filter((c) => c.needsPlaywright),
  ...CRAWLER_ONLY_INSURERS.filter((c) => c.needsPlaywright),
]

/** Insurers that can be crawled with simple fetch */
export const FETCH_CONFIGS: CrawlerConfig[] = [
  ...OPIN_INSURERS.filter((c) => !c.needsPlaywright),
  ...CRAWLER_ONLY_INSURERS.filter((c) => !c.needsPlaywright),
]

/** All crawler configs */
export const CRAWLER_CONFIGS: CrawlerConfig[] = [
  ...OPIN_INSURERS,
  ...CRAWLER_ONLY_INSURERS,
]

/** Only non-OPIN insurers (legacy export for site-crawler.ts) */
export const CRAWLER_ONLY_CONFIGS: CrawlerConfig[] = CRAWLER_ONLY_INSURERS
