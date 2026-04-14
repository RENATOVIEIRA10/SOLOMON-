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
      // Pages that list PDF links for life insurance products
      'https://www.bradescoseguros.com.br/clientes/produtos/seguro-de-vida',
      'https://www.bradescoseguros.com.br/clientes/produtos/seguro-de-vida/para-vida-inteira',
      'https://www.bradescoseguros.com.br/clientes/produtos/seguro-de-vida/vida-viva',
      'https://www.bradescoseguros.com.br/clientes/produtos/seguro-de-vida/meu-seguro-bradesco',
      'https://www.bradescoseguros.com.br/clientes/produtos/seguro-de-vida/tranquilidade-familiar-bradesco',
      'https://www.bradescoseguros.com.br/clientes/produtos/seguro-de-vida/vida-segura-bradesco',
    ],
    pdfPattern: PDF_PATTERN,
    keywords: LIFE_INSURANCE_KEYWORDS,
    needsPlaywright: true, // Heavy JS, WCM content
    source: 'opin',
  },
  {
    name: 'Porto Seguro',
    cnpj: '61.198.164/0001-60',
    urls: [
      'https://www.portoseguro.com.br/consulta-de-clientes/condicoes-gerais-do-seguro-vida',
      'https://www.portoseguro.com.br/seguro-vida',
    ],
    pdfPattern: PDF_PATTERN,
    keywords: LIFE_INSURANCE_KEYWORDS,
    needsPlaywright: true,
    source: 'opin',
    acceptAllPdfs: true, // Page is already life-insurance specific
  },
  {
    name: 'Icatu Seguros',
    cnpj: '42.283.770/0001-39',
    urls: [
      // SUSEP page lists all regulated products with PDFs
      'https://portal.icatuseguros.com.br/susep',
      'https://portal.icatuseguros.com.br/seguro-de-vida',
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
      'https://www.mapfre.com.br/glossario/condicoes-gerais/',
      'https://www.mapfre.com.br/para-voce/seguro-vida/multiflex/conheca-mais-sobre-as-coberturas/',
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
      'https://www.tokiomarine.com.br/condicoes-gerais/seguro-de-vida/',
      'https://www.tokiomarine.com.br/condicoes-gerais/',
    ],
    pdfPattern: PDF_PATTERN,
    keywords: LIFE_INSURANCE_KEYWORDS,
    needsPlaywright: true,
    source: 'opin',
    acceptAllPdfs: true, // Page is seguro-de-vida specific
  },
  {
    name: 'SulAmerica',
    cnpj: '33.041.062/0001-09',
    urls: [
      'https://portal.sulamericaseguros.com.br/para-voce/vida/',
      'https://portal.sulamericaseguros.com.br/para-empresa/vida/sulamerica-capital-global/',
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
      'https://www.zurich.com.br/condicoes-gerais',
      'https://www.zurich.com.br/seguros-para-voce/vida/vida-para-voce',
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
      'https://www.caixavidaeprevidencia.com.br/',
      'https://www.caixaseguradora.com.br/paravoce/vida/',
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
      'https://www.santander.com.br/seguros/para-voce',
      'https://cms.santander.com.br/sites/WPS/documentos/',
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
      // MAG hosts PDFs on Azure Blob — Playwright can find links on their site
      'https://mag.com.br/seguros-vida/',
      'https://mag.com.br/condicoes-gerais/',
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
      'https://www.metlife.com.br/suporte/condicoes-gerais/cliente-individual/seguro-de-vida/',
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
// Known direct PDF URLs (bypass Playwright — just download)
// These were discovered via web search and can be fetched directly.
// ---------------------------------------------------------------------------

export const DIRECT_PDF_URLS: Array<{
  url: string
  insurerName: string
  insurerCnpj: string
  productName: string
}> = [
  // MAPFRE
  { url: 'https://www.mapfre.com.br/media/CG-V.1.1-15414.630594201910_tcm909-586483.pdf', insurerName: 'MAPFRE Seguros', insurerCnpj: '61.074.175/0001-38', productName: 'Vida Individual' },
  { url: 'https://www.mapfre.com.br/media/VG-CG-V41-vigencia-09112019-em-vigor-atualmente.pdf', insurerName: 'MAPFRE Seguros', insurerCnpj: '61.074.175/0001-38', productName: 'Vida em Grupo' },
  { url: 'https://www.mapfre.com.br/media/CG-V.1.1-15414.634203201928_tcm909-586484.pdf', insurerName: 'MAPFRE Seguros', insurerCnpj: '61.074.175/0001-38', productName: 'Vida Individual Bilhete' },
  { url: 'https://www.mapfre.com.br/media/APC-CG-V41-15414-0040112008-30-vigencia-09112019-ate-01082021.pdf', insurerName: 'MAPFRE Seguros', insurerCnpj: '61.074.175/0001-38', productName: 'Vida Voce Multiflex' },
  { url: 'https://www.mapfre.com.br/media/CGVidaEmpresaFaixaEtariaV1.0-10.002879-99-91_tcm909-209399.pdf', insurerName: 'MAPFRE Seguros', insurerCnpj: '61.074.175/0001-38', productName: 'Vida Empresa' },
  // Tokio Marine
  { url: 'https://www.tokiomarine.com.br/wp-content/uploads/2018/08/202408-CG-Vida-Individual-15414900142201731-vfinal-1.pdf', insurerName: 'Tokio Marine', insurerCnpj: '33.164.021/0001-00', productName: 'Vida Individual' },
  // SulAmerica
  { url: 'https://portal.sulamericaseguros.com.br/data/files/9C/93/EA/7E/767346107A620246EB4616A8/Condi%C3%A7%C3%B5es%20Gerais%20SulAm%C3%A9rica%20Vida%20Individual.pdf', insurerName: 'SulAmerica', insurerCnpj: '33.041.062/0001-09', productName: 'Vida Individual' },
  { url: 'https://portal.sulamericaseguros.com.br/data/files/0D/E4/CD/44/FF40291078A72029B808D4A8/CG%20VIDA%20FLEX_08.2024.pdf', insurerName: 'SulAmerica', insurerCnpj: '33.041.062/0001-09', productName: 'Vida Flex' },
  { url: 'https://portal.sulamericaseguros.com.br/data/files/5D/46/BD/9B/C1FA0810D747B8081B4616A8/CondicoesGerais_Vida%20Simples_V2.pdf', insurerName: 'SulAmerica', insurerCnpj: '33.041.062/0001-09', productName: 'Vida Simples' },
  { url: 'https://portal.sulamericaseguros.com.br/data/files/9D/F4/29/1A/02B07510D20DEE65B84616A8/CG%20Prod.%20144%20Vida%20Individual_144%2015414900707201356.pdf', insurerName: 'SulAmerica', insurerCnpj: '33.041.062/0001-09', productName: 'Vida Individual Prod 144' },
  // Zurich
  { url: 'https://www.zurich.com.br/-/media/project/zwp/brazil/docs/vida-para-voce/condicoes-gerais-seguro-de-pessoas-individual-vigencia-a-partir-de-12022021.pdf', insurerName: 'Zurich', insurerCnpj: '28.196.889/0001-43', productName: 'Vida Para Voce' },
  // Porto Seguro
  { url: 'https://www.portoseguro.com.br/content/dam/documentos/condicoes_gerais/seguro_de_vida/vida-on/2022_cg_Seguro_Vida_Individual_Vida_On_11-2022.pdf', insurerName: 'Porto Seguro', insurerCnpj: '61.198.164/0001-60', productName: 'Vida On' },
  { url: 'https://www.portoseguro.com.br/content/dam/documentos/condicoes_gerais/seguro_de_vida/vida-individual/CG_acidentes-pessoais-individual-plus-jul24.pdf', insurerName: 'Porto Seguro', insurerCnpj: '61.198.164/0001-60', productName: 'Acidentes Pessoais Individual Plus' },
  { url: 'https://www.portoseguro.com.br/content/dam/cgs/vida-coletivo/CG-Seguro-Pessoas-Coletivo.pdf', insurerName: 'Porto Seguro', insurerCnpj: '61.198.164/0001-60', productName: 'Pessoas Coletivo' },
  // Bradesco
  { url: 'https://www.bradescoseguros.com.br/wcm/connect/27d3efc8-319b-48d5-ba61-0269f0d6a5a2/Condi%C3%A7%C3%B5es_Gerais_Vida_Viva_Corretor_Maio24.pdf?MOD=AJPERES', insurerName: 'Bradesco Seguros', insurerCnpj: '51.014.223/0001-49', productName: 'Vida Viva' },
  { url: 'https://www.bradescoseguros.com.br/wcm/connect/96e59108-aa04-45f1-96e5-4a9010fd6899/Condi%C3%A7%C3%B5es+Gerais_Viva+Mais.pdf?MOD=AJPERES', insurerName: 'Bradesco Seguros', insurerCnpj: '51.014.223/0001-49', productName: 'Viva Mais' },
  { url: 'https://www.bradescoseguros.com.br/wcm/connect/033f4113-3015-46c5-bee4-35436bb0d35a/SPG_Vida_Rede.pdf?MOD=AJPERES', insurerName: 'Bradesco Seguros', insurerCnpj: '51.014.223/0001-49', productName: 'SPG Vida Rede' },
  { url: 'https://www.bradescoseguros.com.br/wcm/connect/054b2f13-3ced-4141-9120-75fc4235d0ea/OS2113_Condicoes_Gerais_Vida_Mais_Segura_bradesco.pdf?MOD=AJPERES', insurerName: 'Bradesco Seguros', insurerCnpj: '51.014.223/0001-49', productName: 'Vida Mais Segura' },
  // Santander
  { url: 'https://www.santander.com.br/document/gsb/CG_Vida_Santander_23.01.07.pdf', insurerName: 'Santander Auto/RE', insurerCnpj: '61.383.493/0001-80', productName: 'Vida Santander' },
  { url: 'https://www.santander.com.br/document/gsb/seguro_vida_protecao_exclusiva.pdf', insurerName: 'Santander Auto/RE', insurerCnpj: '61.383.493/0001-80', productName: 'Vida Protecao Exclusiva' },
  { url: 'https://cms.santander.com.br/sites/WPS/documentos/arq-condicoes-gerais-seguro-vida-homem-1/19-11-21_224109_vidahomem.pdf', insurerName: 'Santander Auto/RE', insurerCnpj: '61.383.493/0001-80', productName: 'Vida Homem' },
  // MetLife
  { url: 'https://www.metlife.com.br/content/dam/metlifecom/br/homepage/pdfs/suporte/condicoes-gerais/cliente-individual/seguro-de-vida/cg-vida-total.pdf', insurerName: 'MetLife', insurerCnpj: '02.102.498/0001-29', productName: 'Vida Total' },
  { url: 'https://www.metlife.com.br/content/dam/metlifecom/br/homepage/pdfs/suporte/condicoes-gerais/cliente-individual/seguro-de-vida/15414.9009972016-81-CG-Vida-Segura.pdf', insurerName: 'MetLife', insurerCnpj: '02.102.498/0001-29', productName: 'Vida Segura' },
  { url: 'https://www.metlife.com.br/content/dam/metlifecom/br/homepage/pdfs/suporte/condicoes-gerais/cliente-individual/seguro-de-vida/Condicao-Geral-Vida-Protegida-15414.003227-2010-01.pdf', insurerName: 'MetLife', insurerCnpj: '02.102.498/0001-29', productName: 'Vida Protegida' },
  // MAG Seguros (Azure Blob Storage)
  { url: 'https://magportaisinststgprd.blob.core.windows.net/magseguros/2025/03/3082-e-3083-%E2%80%93-Condicoes-Gerais-%E2%80%93-Vida-Inteira.pdf', insurerName: 'MAG Seguros', insurerCnpj: '06.036.540/0001-50', productName: 'Vida Inteira 3082/3083' },
  { url: 'https://magportaisinststgprd.blob.core.windows.net/magseguros/2024/11/2794-a-2797-%E2%80%93-Condicoes-Gerais-%E2%80%93-Vida-Inteira-Resgatavel.pdf', insurerName: 'MAG Seguros', insurerCnpj: '06.036.540/0001-50', productName: 'Vida Inteira Resgatavel' },
  { url: 'https://magportaisinststgprd.blob.core.windows.net/magseguros/2023/09/2694-e-2695-Condicoes-Gerais-Vida-Inteira-Mar23.pdf', insurerName: 'MAG Seguros', insurerCnpj: '06.036.540/0001-50', productName: 'Vida Inteira 2694/2695' },
  // Caixa Seguradora
  { url: 'https://www.caixaseguradora.com.br/paravoce/vida/Biblioteca%20de%20Documentos/Arquivos_Condicoes_Gerais/Condicoes_Gerais_Vida_da_Gente/CG_Vida_da_Gente_Mensal_109300002357_v201211_Arq.7.pdf', insurerName: 'Caixa Vida e Previdencia', insurerCnpj: '03.730.204/0001-76', productName: 'Vida da Gente' },
  // Azos (files.azos.com.br — static CDN)
  { url: 'https://files.azos.com.br/f/15414.604989-2023-35--CONDI%C3%87%C3%95ES-CONTRATUAIS---02.2026.pdf', insurerName: 'Azos', insurerCnpj: '39.781.553/0001-65', productName: 'Condicoes Contratuais 2026' },
  { url: 'https://files.azos.com.br/f/digital-marco-2025.pdf', insurerName: 'Azos', insurerCnpj: '39.781.553/0001-65', productName: 'Digital Marco 2025' },
  { url: 'https://files.azos.com.br/f/digital-fevereiro-2023.pdf', insurerName: 'Azos', insurerCnpj: '39.781.553/0001-65', productName: 'Digital Fevereiro 2023' },
  { url: 'https://files.azos.com.br/f/15414-604991-2023-12---Condi%C3%A7%C3%B5es-Gerais---Broker-(1).pdf', insurerName: 'Azos', insurerCnpj: '39.781.553/0001-65', productName: 'Condicoes Gerais Broker' },
  { url: 'https://files.azos.com.br/f/especialista-outubro-2025.pdf', insurerName: 'Azos', insurerCnpj: '39.781.553/0001-65', productName: 'Especialista Outubro 2025' },
  { url: 'https://files.azos.com.br/f/especialista-junho-2025.pdf', insurerName: 'Azos', insurerCnpj: '39.781.553/0001-65', productName: 'Especialista Junho 2025' },
  { url: 'https://files.azos.com.br/f/especialista-marco-2025.pdf', insurerName: 'Azos', insurerCnpj: '39.781.553/0001-65', productName: 'Especialista Marco 2025' },
  { url: 'https://files.azos.com.br/f/especialista-fevereiro-2024.pdf', insurerName: 'Azos', insurerCnpj: '39.781.553/0001-65', productName: 'Especialista Fevereiro 2024' },
  { url: 'https://files.azos.com.br/f/especialista-fevereiro-2023.pdf', insurerName: 'Azos', insurerCnpj: '39.781.553/0001-65', productName: 'Especialista Fevereiro 2023' },
  { url: 'https://files.azos.com.br/f/15414.601568-2021-91--CONDI%C3%87%C3%95ES-CONTRATUAIS---02.2026.pdf', insurerName: 'Azos', insurerCnpj: '39.781.553/0001-65', productName: 'Condicoes Contratuais 601568' },
  { url: 'https://files.azos.com.br/f/individual-junho-2022.pdf', insurerName: 'Azos', insurerCnpj: '39.781.553/0001-65', productName: 'Individual Junho 2022' },
  { url: 'https://files.azos.com.br/f/individual-julho-2021.pdf', insurerName: 'Azos', insurerCnpj: '39.781.553/0001-65', productName: 'Individual Julho 2021' },
  { url: 'https://files.azos.com.br/f/individual-junho-2021.pdf', insurerName: 'Azos', insurerCnpj: '39.781.553/0001-65', productName: 'Individual Junho 2021' },
  { url: 'https://files.azos.com.br/f/individual-marco-2021.pdf', insurerName: 'Azos', insurerCnpj: '39.781.553/0001-65', productName: 'Individual Marco 2021' },
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
