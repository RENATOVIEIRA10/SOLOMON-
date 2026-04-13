/**
 * Crawler Configurations
 *
 * Defines which insurer sites to crawl for terms & conditions PDFs.
 * These insurers are NOT available via the OPIN API.
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
  /** Keywords to filter life-insurance-relevant PDFs (matched against href or link text) */
  keywords: string[]
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
]

export const CRAWLER_CONFIGS: CrawlerConfig[] = [
  {
    name: 'MAG Seguros',
    cnpj: '06.036.540/0001-50',
    urls: [
      'https://www.magseguros.com.br/condicoes-gerais',
    ],
    pdfPattern: /https?:\/\/[^\s"'<>]+\.pdf/gi,
    keywords: LIFE_INSURANCE_KEYWORDS,
  },
  {
    name: 'MetLife',
    cnpj: '02.102.498/0001-29',
    urls: [
      'https://www.metlife.com.br/condicoes-gerais',
    ],
    pdfPattern: /https?:\/\/[^\s"'<>]+\.pdf/gi,
    keywords: LIFE_INSURANCE_KEYWORDS,
  },
  {
    name: 'Azos',
    cnpj: '39.781.553/0001-65',
    urls: [
      'https://www.azos.com.br/condicoes-gerais',
    ],
    pdfPattern: /https?:\/\/[^\s"'<>]+\.pdf/gi,
    keywords: LIFE_INSURANCE_KEYWORDS,
  },
]
