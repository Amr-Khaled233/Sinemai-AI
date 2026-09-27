/**
 * Pre-launch seed.
 *
 * - Equipment specs are compiled from public manufacturer spec sheets
 *   (ARRI / RED / Sony / Canon / Blackmagic / Aputure / Astera / DJI).
 * - `indicativeDayRate` values are placeholder market estimates in SAR, used
 *   only when no approved vendor stocks an item. Vendors set the real prices,
 *   and an admin can edit these from the catalog screen.
 * - Crew day rates and budget-tier windows are starting points for the admin to
 *   tune; the budget agent reads them from the database, never from code.
 */
import { randomBytes } from 'node:crypto';
import { hash } from 'bcryptjs';
import {
  BudgetTier,
  CameraMovement,
  Complexity,
  PrismaClient,
  Role,
  DayNightSuitability,
} from '@prisma/client';
import { DEFAULT_BUDGET_TIERS, DEFAULT_SETTINGS } from '../src/lib/settings';

const prisma = new PrismaClient();

/**
 * One account is seeded: the admin, at SEED_GMAIL itself. Everyone else signs
 * up as a regular user. Rental companies and cinematographers are records the
 * admin manages, not accounts.
 *
 * The password comes from SEED_PASSWORD. When it is missing a strong one is
 * generated and printed once, so a public deployment never ships with a
 * password that is committed to the repository.
 */
const SEED_GMAIL = (process.env.SEED_GMAIL ?? 'amr.khufra250@gmail.com').trim().toLowerCase();
if (!SEED_GMAIL.includes('@')) throw new Error('SEED_GMAIL must be a full email address');

/** The plus-addressed demo accounts earlier versions of this seed created. */
const LEGACY_DEMO_TAGS = [
  'admin',
  'producer',
  'vendor-riyadh',
  'vendor-jeddah',
  'dop-faisal',
  'dop-noura',
  'dop-omar',
  'dop-layla',
  'dop-tariq',
];

/** Commercial registration numbers of the demo rental companies earlier seeds created. */
const DEMO_COMPANY_CR_NUMBERS = ['1010000001', '4030000002'];

function legacyDemoEmail(tag: string) {
  const [local, domain] = SEED_GMAIL.split('@');
  return `${local.split('+')[0]}+${tag}@${domain}`;
}

function seedPassword() {
  const configured = process.env.SEED_PASSWORD;
  if (configured && configured.length >= 8) return { value: configured, generated: false };
  const generated = `Sin-${randomBytes(9).toString('base64url')}`;
  return { value: generated, generated: true };
}

const { LOW, MEDIUM, HIGH } = BudgetTier;
const ALL_TIERS = [LOW, MEDIUM, HIGH];
const { STATIC, HANDHELD, STEADICAM_GIMBAL, CRANE_DOLLY, DRONE } = CameraMovement;
const ALL_MOVES = [STATIC, HANDHELD, STEADICAM_GIMBAL, CRANE_DOLLY];

const CATEGORIES = [
  { slug: 'camera-body', nameEn: 'Camera bodies', nameAr: 'كاميرات', sortOrder: 1 },
  { slug: 'lens', nameEn: 'Lenses', nameAr: 'عدسات', sortOrder: 2 },
  { slug: 'lighting', nameEn: 'Lighting', nameAr: 'إضاءة', sortOrder: 3 },
  { slug: 'grip', nameEn: 'Grip & rigging', nameAr: 'تثبيت وتجهيزات', sortOrder: 4 },
  { slug: 'support', nameEn: 'Camera support & movement', nameAr: 'حركة الكاميرا', sortOrder: 5 },
  { slug: 'sound', nameEn: 'Sound', nameAr: 'صوت', sortOrder: 6 },
  { slug: 'power', nameEn: 'Power & distribution', nameAr: 'طاقة وتوزيع', sortOrder: 7 },
];

/**
 * Arabic names: an Arabic descriptor with the model kept in Latin script, the
 * way crews say it. Shown on Arabic pages; English pages use brand + model.
 */
const EQUIPMENT_NAMES_AR: Record<string, string> = {
  'ARRI|ALEXA 35': 'كاميرا ARRI ALEXA 35',
  'ARRI|ALEXA Mini LF': 'كاميرا ARRI ALEXA Mini LF',
  'ARRI|ALEXA Mini': 'كاميرا ARRI ALEXA Mini',
  'RED|V-RAPTOR 8K VV': 'كاميرا RED V-RAPTOR 8K VV',
  'RED|KOMODO 6K': 'كاميرا RED KOMODO 6K',
  'Sony|VENICE 2': 'كاميرا Sony VENICE 2',
  'Sony|FX9': 'كاميرا Sony FX9',
  'Sony|FX6': 'كاميرا Sony FX6',
  'Canon|EOS C70': 'كاميرا Canon EOS C70',
  'Blackmagic Design|Pocket Cinema Camera 6K Pro': 'كاميرا Blackmagic Pocket Cinema 6K Pro',
  'ARRI|Signature Prime set (5 lenses)': 'طقم عدسات ARRI Signature Prime (5 عدسات)',
  'Cooke|S4/i Prime set (6 lenses)': 'طقم عدسات Cooke S4/i Prime (6 عدسات)',
  'ZEISS|Supreme Prime set (5 lenses)': 'طقم عدسات ZEISS Supreme Prime (5 عدسات)',
  'Atlas Lens Co.|Orion Anamorphic 2x set (4 lenses)': 'طقم عدسات أنامورفيك Atlas Orion 2x (4 عدسات)',
  'Sigma|Cine FF High Speed Prime set (5 lenses)': 'طقم عدسات Sigma Cine FF High Speed (5 عدسات)',
  'Fujinon|MK 18-55 T2.9 zoom': 'عدسة زوم Fujinon MK 18-55 T2.9',
  'ARRI|SkyPanel S60-C': 'كشاف ARRI SkyPanel S60-C',
  'ARRI|M18 HMI': 'كشاف ARRI M18 HMI',
  'Aputure|LS 600d Pro': 'كشاف Aputure LS 600d Pro',
  'Aputure|amaran 200x bi-colour': 'كشاف Aputure amaran 200x ثنائي الحرارة',
  'Astera|Titan Tube set (8 tubes)': 'طقم أنابيب إضاءة Astera Titan (8 أنابيب)',
  'Nanlux|Evoke 1200B': 'كشاف Nanlux Evoke 1200B',
  'Kino Flo|Diva-Lite 20 LED kit (2 heads)': 'طقم إضاءة Kino Flo Diva-Lite 20 LED (رأسان)',
  'Matthews|Standard grip package (stands, flags, clamps)': 'طقم تجهيزات Matthews أساسي (حوامل وأعلام ومشابك)',
  'Matthews|12x12 butterfly kit (diffusion + solid)': 'إطار Matthews ‏12×12 (ناشر وحاجب)',
  'DJI|RS 4 Pro gimbal': 'جيمبال DJI RS 4 Pro',
  'Tiffen|Steadicam M-2 with operator vest': 'ستيدي كام Tiffen M-2 مع سترة المشغّل',
  'Dana Dolly|Dana Dolly kit with track': 'دولي Dana Dolly مع السكة',
  'DJI|Inspire 3 aerial platform': 'طائرة تصوير DJI Inspire 3',
  'Easyrig|Vario 5 with Flowcine Serene arm': 'حامل Easyrig Vario 5 مع ذراع Flowcine Serene',
  'Sound Devices|MixPre-10 II recorder': 'مسجّل صوت Sound Devices MixPre-10 II',
  'Sennheiser|MKH 8060 shotgun + boom kit': 'ميكروفون Sennheiser MKH 8060 مع ذراع بوم',
  'Anton/Bauer|Gold Mount battery package (6 batteries + chargers)': 'طقم بطاريات Anton/Bauer Gold Mount (6 بطاريات وشواحن)',
  'Honda|EU70is generator (7 kVA, silenced)': 'مولّد Honda EU70is (7 كيلو فولت أمبير، صامت)'
};

type EquipmentSeed = {
  category: string;
  brand: string;
  model: string;
  nameAr?: string;
  specs: Record<string, string | number>;
  summaryEn: string;
  summaryAr: string;
  lighting: Complexity[];
  movement: CameraMovement[];
  tiers: BudgetTier[];
  dayNight: DayNightSuitability;
  capabilities?: string[];
  dayRate: number;
  isCore?: boolean;
};

const EQUIPMENT: EquipmentSeed[] = [
  // ---------------------------------------------------------------- cameras
  {
    category: 'camera-body',
    brand: 'ARRI',
    model: 'ALEXA 35',
    specs: {
      sensor: 'Super 35 ALEV 4 CMOS, 4608 x 3164',
      dynamicRange: '17 stops (manufacturer stated)',
      mount: 'LPL (PL via adapter)',
      maxFrameRate: '120 fps at 4.6K 16:9',
      recording: 'ARRIRAW, Apple ProRes',
      weight: '2.9 kg body',
    },
    summaryEn: 'Highest dynamic range in the ARRI line; the reference choice for heavy night work and high-contrast interiors.',
    summaryAr: 'أعلى مدى ديناميكي في عائلة أري، الخيار المرجعي للتصوير الليلي والمشاهد عالية التباين.',
    lighting: [Complexity.LOW, Complexity.MEDIUM, Complexity.HIGH],
    movement: ALL_MOVES,
    tiers: [HIGH],
    dayNight: DayNightSuitability.BOTH,
    dayRate: 5200,
    isCore: true,
  },
  {
    category: 'camera-body',
    brand: 'ARRI',
    model: 'ALEXA Mini LF',
    specs: {
      sensor: 'Large format ALEV III, 4448 x 3096',
      dynamicRange: '14+ stops (manufacturer stated)',
      mount: 'LPL',
      maxFrameRate: '90 fps at 4.5K LF 2.39:1',
      recording: 'ARRIRAW, ProRes',
      weight: '2.6 kg body',
    },
    summaryEn: 'Large-format ARRI in a compact body — shallow depth of field for premium commercials and drama.',
    summaryAr: 'مستشعر كبير بجسم مدمج، عمق ميدان ضيق للأعمال الإعلانية والدرامية الراقية.',
    lighting: [Complexity.MEDIUM, Complexity.HIGH],
    movement: ALL_MOVES,
    tiers: [HIGH],
    dayNight: DayNightSuitability.BOTH,
    dayRate: 4600,
    isCore: true,
  },
  {
    category: 'camera-body',
    brand: 'ARRI',
    model: 'ALEXA Mini',
    specs: {
      sensor: 'Super 35 ALEV III, 3424 x 2202',
      dynamicRange: '14+ stops (manufacturer stated)',
      mount: 'PL (EF available)',
      maxFrameRate: '200 fps at 2K',
      recording: 'ARRIRAW, ProRes',
      weight: '2.3 kg body',
    },
    summaryEn: 'The industry workhorse: light enough for gimbal and handheld, with the ARRI colour science drama expects.',
    summaryAr: 'الخيار الأكثر استخداماً: خفيف للاستخدام المحمول والجيمبال مع علم الألوان المعتاد من أري.',
    lighting: [Complexity.LOW, Complexity.MEDIUM, Complexity.HIGH],
    movement: ALL_MOVES,
    tiers: [MEDIUM, HIGH],
    dayNight: DayNightSuitability.BOTH,
    dayRate: 3200,
    isCore: true,
  },
  {
    category: 'camera-body',
    brand: 'RED',
    model: 'V-RAPTOR 8K VV',
    specs: {
      sensor: 'Full-frame VV CMOS, 8192 x 4320',
      dynamicRange: '17+ stops (manufacturer stated)',
      mount: 'RF (PL adapter available)',
      maxFrameRate: '120 fps at 8K full frame',
      recording: 'REDCODE RAW',
      weight: '1.9 kg body',
    },
    summaryEn: 'High-resolution full frame for VFX plates and big-format commercial work.',
    summaryAr: 'دقة عالية بمستشعر كامل، مناسب للمؤثرات البصرية والإعلانات الكبيرة.',
    lighting: [Complexity.MEDIUM, Complexity.HIGH],
    movement: ALL_MOVES,
    tiers: [HIGH],
    dayNight: DayNightSuitability.BOTH,
    capabilities: ['vfx greenscreen', 'vfx plates'],
    dayRate: 3800,
  },
  {
    category: 'camera-body',
    brand: 'RED',
    model: 'KOMODO 6K',
    specs: {
      sensor: 'Super 35 global shutter CMOS, 6144 x 3240',
      dynamicRange: '16+ stops (manufacturer stated)',
      mount: 'Canon RF',
      maxFrameRate: '40 fps at 6K',
      recording: 'REDCODE RAW, ProRes',
      weight: '0.95 kg body',
    },
    summaryEn: 'Compact global-shutter body — crash cam, vehicle mount and gimbal work without rolling-shutter skew.',
    summaryAr: 'جسم مدمج بمصراع عالمي، مناسب للتثبيت على المركبات والجيمبال دون تشويه.',
    lighting: [Complexity.LOW, Complexity.MEDIUM],
    movement: [HANDHELD, STEADICAM_GIMBAL, CRANE_DOLLY, DRONE],
    tiers: [LOW, MEDIUM],
    dayNight: DayNightSuitability.BOTH,
    capabilities: ['vehicle mount', 'crash cam', 'drone'],
    dayRate: 1500,
  },
  {
    category: 'camera-body',
    brand: 'Sony',
    model: 'VENICE 2',
    specs: {
      sensor: 'Full-frame CMOS, 8.6K or 6K sensor block',
      dynamicRange: '16 stops (manufacturer stated)',
      mount: 'E-mount with PL adapter',
      dualBaseISO: 'Dual base ISO 800 / 3200',
      recording: 'X-OCN, ProRes',
      extras: 'Rialto extension system',
    },
    summaryEn: 'Full-frame Sony flagship with an extension system for tight interiors and rigging.',
    summaryAr: 'كاميرا سوني الرائدة بمستشعر كامل مع نظام تمديد مناسب للأماكن الضيقة.',
    lighting: [Complexity.MEDIUM, Complexity.HIGH],
    movement: ALL_MOVES,
    tiers: [HIGH],
    dayNight: DayNightSuitability.BOTH,
    dayRate: 4200,
  },
  {
    category: 'camera-body',
    brand: 'Sony',
    model: 'FX9',
    specs: {
      sensor: 'Full-frame 6K CMOS',
      mount: 'E-mount',
      dualBaseISO: 'Dual base ISO 800 / 4000',
      recording: 'XAVC-I, RAW output',
      extras: 'Built-in variable ND, Fast Hybrid AF',
    },
    summaryEn: 'Documentary and corporate workhorse: internal ND and reliable autofocus for long run-and-gun days.',
    summaryAr: 'خيار موثوق للأفلام الوثائقية: فلتر ND مدمج وتركيز تلقائي لأيام التصوير الطويلة.',
    lighting: [Complexity.LOW, Complexity.MEDIUM],
    movement: [STATIC, HANDHELD, STEADICAM_GIMBAL],
    tiers: [MEDIUM],
    dayNight: DayNightSuitability.BOTH,
    capabilities: ['documentary', 'interview'],
    dayRate: 1100,
  },
  {
    category: 'camera-body',
    brand: 'Sony',
    model: 'FX6',
    specs: {
      sensor: 'Full-frame 10.2MP CMOS',
      mount: 'E-mount',
      dualBaseISO: 'Dual base ISO 800 / 12800',
      recording: 'XAVC-I up to 4K 120p',
      extras: 'Built-in variable ND, 1.0 kg body',
    },
    summaryEn: 'Dual base ISO 12800 makes this the cost-effective low-light body for night exteriors on a small budget.',
    summaryAr: 'حساسية عالية تصل إلى ١٢٨٠٠ تجعلها الخيار الاقتصادي للتصوير الليلي الخارجي.',
    lighting: [Complexity.LOW, Complexity.MEDIUM],
    movement: [STATIC, HANDHELD, STEADICAM_GIMBAL, DRONE],
    tiers: [LOW, MEDIUM],
    dayNight: DayNightSuitability.NIGHT,
    capabilities: ['low light', 'run and gun'],
    dayRate: 650,
    isCore: true,
  },
  {
    category: 'camera-body',
    brand: 'Canon',
    model: 'EOS C70',
    specs: {
      sensor: 'Super 35 DGO CMOS, 4K',
      mount: 'Canon RF',
      dynamicRange: '16+ stops (manufacturer stated)',
      recording: 'XF-AVC, Cinema RAW Light',
      extras: 'Built-in ND, dual mini-XLR',
    },
    summaryEn: 'Compact Super 35 body with dual-gain output — a strong B-cam for interviews and tight locations.',
    summaryAr: 'جسم مدمج بمستشعر سوبر ٣٥، كاميرا ثانية ممتازة للمقابلات والمواقع الضيقة.',
    lighting: [Complexity.LOW, Complexity.MEDIUM],
    movement: [STATIC, HANDHELD, STEADICAM_GIMBAL],
    tiers: [LOW, MEDIUM],
    dayNight: DayNightSuitability.BOTH,
    dayRate: 550,
  },
  {
    category: 'camera-body',
    brand: 'Blackmagic Design',
    model: 'Pocket Cinema Camera 6K Pro',
    specs: {
      sensor: 'Super 35 CMOS, 6144 x 3456',
      mount: 'Canon EF',
      dynamicRange: '13 stops (manufacturer stated)',
      recording: 'Blackmagic RAW, ProRes',
      extras: 'Built-in ND filters, tilting HDR screen',
    },
    summaryEn: 'Lowest-cost RAW body in the catalog; best for short films and student-budget commercials.',
    summaryAr: 'أقل تكلفة للتصوير بصيغة RAW، مناسب للأفلام القصيرة والميزانيات المحدودة.',
    lighting: [Complexity.LOW],
    movement: [STATIC, HANDHELD, STEADICAM_GIMBAL],
    tiers: [LOW],
    dayNight: DayNightSuitability.DAY,
    dayRate: 300,
  },

  // ---------------------------------------------------------------- lenses
  {
    category: 'lens',
    brand: 'ARRI',
    model: 'Signature Prime set (5 lenses)',
    specs: {
      coverage: 'Large format, LPL mount',
      aperture: 'T1.8',
      focalLengths: '25, 35, 47, 75, 125 mm',
      character: 'Gentle falloff, smooth skin rendition',
    },
    summaryEn: 'Large-format primes with soft falloff — matched to ALEXA LF bodies for premium drama and commercials.',
    summaryAr: 'عدسات ثابتة للمستشعر الكبير بتلاشٍ ناعم، متوافقة مع كاميرات أليكسا LF.',
    lighting: [Complexity.MEDIUM, Complexity.HIGH],
    movement: ALL_MOVES,
    tiers: [HIGH],
    dayNight: DayNightSuitability.BOTH,
    dayRate: 3400,
    isCore: true,
  },
  {
    category: 'lens',
    brand: 'Cooke',
    model: 'S4/i Prime set (6 lenses)',
    specs: {
      coverage: 'Super 35, PL mount',
      aperture: 'T2.0',
      focalLengths: '18, 25, 32, 50, 75, 100 mm',
      character: 'Cooke Look — warm, rounded rendition',
    },
    summaryEn: 'The classic warm cinematic prime set; the default answer to "warm tones, classic cinematic".',
    summaryAr: 'مجموعة عدسات كلاسيكية بألوان دافئة، الخيار الأول للمظهر السينمائي التقليدي.',
    lighting: [Complexity.MEDIUM, Complexity.HIGH],
    movement: ALL_MOVES,
    tiers: [MEDIUM, HIGH],
    dayNight: DayNightSuitability.BOTH,
    dayRate: 2600,
  },
  {
    category: 'lens',
    brand: 'ZEISS',
    model: 'Supreme Prime set (5 lenses)',
    specs: {
      coverage: 'Full frame / VV, PL mount',
      aperture: 'T1.5',
      focalLengths: '25, 29, 35, 50, 85 mm',
      character: 'Clean, neutral, high contrast',
    },
    summaryEn: 'Fast full-frame primes — T1.5 buys a stop of headroom on night interiors.',
    summaryAr: 'عدسات سريعة للمستشعر الكامل، فتحة T1.5 تمنح مرونة إضافية في التصوير الليلي.',
    lighting: [Complexity.LOW, Complexity.MEDIUM, Complexity.HIGH],
    movement: ALL_MOVES,
    tiers: [MEDIUM, HIGH],
    dayNight: DayNightSuitability.NIGHT,
    dayRate: 2200,
  },
  {
    category: 'lens',
    brand: 'Atlas Lens Co.',
    model: 'Orion Anamorphic 2x set (4 lenses)',
    specs: {
      coverage: 'Super 35, PL mount',
      squeeze: '2x anamorphic',
      aperture: 'T2.0',
      focalLengths: '40, 50, 65, 80 mm',
      character: 'Blue horizontal flares, oval bokeh',
    },
    summaryEn: 'Anamorphic character at a rental price a mid-budget feature can carry.',
    summaryAr: 'مظهر أنامورفيك بسعر إيجار يناسب الأفلام ذات الميزانية المتوسطة.',
    lighting: [Complexity.MEDIUM, Complexity.HIGH],
    movement: [STATIC, CRANE_DOLLY, STEADICAM_GIMBAL],
    tiers: [MEDIUM, HIGH],
    dayNight: DayNightSuitability.BOTH,
    capabilities: ['anamorphic'],
    dayRate: 1800,
  },
  {
    category: 'lens',
    brand: 'Sigma',
    model: 'Cine FF High Speed Prime set (5 lenses)',
    specs: {
      coverage: 'Full frame, PL / E mount',
      aperture: 'T1.5',
      focalLengths: '24, 35, 50, 85, 105 mm',
      character: 'Neutral, modern, high resolving',
    },
    summaryEn: 'Fast, affordable full-frame primes — the value low-light set.',
    summaryAr: 'عدسات سريعة واقتصادية للمستشعر الكامل، الخيار الأفضل سعراً للإضاءة المنخفضة.',
    lighting: [Complexity.LOW, Complexity.MEDIUM],
    movement: ALL_MOVES,
    tiers: [LOW, MEDIUM],
    dayNight: DayNightSuitability.NIGHT,
    dayRate: 700,
    isCore: true,
  },
  {
    category: 'lens',
    brand: 'Fujinon',
    model: 'MK 18-55 T2.9 zoom',
    specs: {
      coverage: 'Super 35, E-mount',
      aperture: 'T2.9 constant',
      focalRange: '18-55 mm',
      weight: '0.98 kg',
    },
    summaryEn: 'Light parfocal zoom for documentary and fast commercial coverage.',
    summaryAr: 'عدسة زووم خفيفة مناسبة للأفلام الوثائقية والتغطية الإعلانية السريعة.',
    lighting: [Complexity.LOW, Complexity.MEDIUM],
    movement: [STATIC, HANDHELD, STEADICAM_GIMBAL],
    tiers: [LOW, MEDIUM],
    dayNight: DayNightSuitability.DAY,
    capabilities: ['documentary'],
    dayRate: 320,
  },

  // ---------------------------------------------------------------- lighting
  {
    category: 'lighting',
    brand: 'ARRI',
    model: 'SkyPanel S60-C',
    specs: {
      type: 'LED soft panel, RGB+W',
      power: '450 W',
      colour: '2800-10000 K, full colour control',
      output: 'Approx. 1350 lux at 3 m (open face, 5600 K)',
    },
    summaryEn: 'Soft key/fill standard for interiors; colour control removes the need for gel inventory.',
    summaryAr: 'الخيار القياسي للإضاءة الناعمة في الأماكن الداخلية مع تحكم كامل بالألوان.',
    lighting: [Complexity.MEDIUM, Complexity.HIGH],
    movement: ALL_MOVES,
    tiers: [MEDIUM, HIGH],
    dayNight: DayNightSuitability.BOTH,
    dayRate: 900,
    isCore: true,
  },
  {
    category: 'lighting',
    brand: 'ARRI',
    model: 'M18 HMI',
    specs: {
      type: 'HMI with MAX reflector',
      power: '1800 W',
      colour: 'Daylight, 6000 K',
      use: 'Window punch, day exterior fill, day-for-night',
    },
    summaryEn: 'Daylight punch for window sources and large exterior fill; the answer to high-complexity day work.',
    summaryAr: 'إضاءة نهارية قوية للنوافذ والتعبئة الخارجية الكبيرة.',
    lighting: [Complexity.HIGH],
    movement: ALL_MOVES,
    tiers: [MEDIUM, HIGH],
    dayNight: DayNightSuitability.DAY,
    capabilities: ['day-for-night', 'window light'],
    dayRate: 1200,
  },
  {
    category: 'lighting',
    brand: 'Aputure',
    model: 'LS 600d Pro',
    specs: {
      type: 'LED COB point source',
      power: '600 W',
      colour: 'Daylight 5600 K',
      output: 'Approx. 19,000 lux at 3 m with reflector',
    },
    summaryEn: 'Hard daylight source at a fraction of HMI cost, and it runs off battery for remote locations.',
    summaryAr: 'مصدر نهاري قوي بتكلفة أقل من HMI ويعمل بالبطارية في المواقع النائية.',
    lighting: [Complexity.MEDIUM, Complexity.HIGH],
    movement: ALL_MOVES,
    tiers: [LOW, MEDIUM],
    dayNight: DayNightSuitability.BOTH,
    capabilities: ['battery powered', 'remote location'],
    dayRate: 420,
    isCore: true,
  },
  {
    category: 'lighting',
    brand: 'Aputure',
    model: 'amaran 200x bi-colour',
    specs: {
      type: 'LED COB',
      power: '200 W',
      colour: '2700-6500 K bi-colour',
      use: 'Practical augmentation, small interiors',
    },
    summaryEn: 'Budget key/practical augment for low-complexity interiors.',
    summaryAr: 'إضاءة اقتصادية لتعزيز المصادر الموجودة في الأماكن الداخلية البسيطة.',
    lighting: [Complexity.LOW, Complexity.MEDIUM],
    movement: ALL_MOVES,
    tiers: [LOW],
    dayNight: DayNightSuitability.NIGHT,
    dayRate: 120,
    isCore: true,
  },
  {
    category: 'lighting',
    brand: 'Astera',
    model: 'Titan Tube set (8 tubes)',
    specs: {
      type: 'Battery RGB+mint LED tubes',
      runtime: 'Up to 20 h at 25% (manufacturer stated)',
      colour: 'Full RGB + mint, 1750-20000 K',
      use: 'Practicals, car interiors, hidden sources',
    },
    summaryEn: 'Wireless tubes for night interiors, vehicles and any position with no power run.',
    summaryAr: 'أنابيب إضاءة لاسلكية للمشاهد الليلية الداخلية والمركبات دون الحاجة لتمديد كهرباء.',
    lighting: [Complexity.MEDIUM, Complexity.HIGH],
    movement: ALL_MOVES,
    tiers: [MEDIUM, HIGH],
    dayNight: DayNightSuitability.NIGHT,
    capabilities: ['vehicle mount', 'battery powered', 'practical source'],
    dayRate: 750,
  },
  {
    category: 'lighting',
    brand: 'Nanlux',
    model: 'Evoke 1200B',
    specs: {
      type: 'LED spot, bi-colour',
      power: '1200 W',
      colour: '2700-6500 K',
      use: 'Long-throw key, large sets',
    },
    summaryEn: 'High-output LED alternative to HMI for large sets and long throws.',
    summaryAr: 'بديل LED عالي الإخراج للـ HMI في المواقع الكبيرة والمسافات البعيدة.',
    lighting: [Complexity.HIGH],
    movement: ALL_MOVES,
    tiers: [MEDIUM, HIGH],
    dayNight: DayNightSuitability.BOTH,
    dayRate: 800,
  },
  {
    category: 'lighting',
    brand: 'Kino Flo',
    model: 'Diva-Lite 20 LED kit (2 heads)',
    specs: {
      type: 'LED soft panel',
      colour: '2700-6500 K',
      use: 'Interview key/fill, beauty soft light',
    },
    summaryEn: 'Fast, soft interview package — low power draw for location interiors.',
    summaryAr: 'حزمة إضاءة ناعمة وسريعة التجهيز للمقابلات بسحب كهربائي منخفض.',
    lighting: [Complexity.LOW, Complexity.MEDIUM],
    movement: [STATIC, HANDHELD],
    tiers: [LOW, MEDIUM],
    dayNight: DayNightSuitability.BOTH,
    capabilities: ['interview'],
    dayRate: 260,
  },

  // ---------------------------------------------------------------- grip
  {
    category: 'grip',
    brand: 'Matthews',
    model: 'Standard grip package (stands, flags, clamps)',
    specs: {
      contents: '8x C-stands, flags, cutters, apple boxes, clamps, sandbags',
      transport: 'Fits a single 3-ton truck load',
    },
    summaryEn: 'Baseline grip kit — required on any set with controlled light.',
    summaryAr: 'حزمة تثبيت أساسية مطلوبة في أي موقع يعتمد على إضاءة موجهة.',
    lighting: [Complexity.LOW, Complexity.MEDIUM, Complexity.HIGH],
    movement: ALL_MOVES,
    tiers: ALL_TIERS,
    dayNight: DayNightSuitability.BOTH,
    dayRate: 350,
    isCore: true,
  },
  {
    category: 'grip',
    brand: 'Matthews',
    model: '12x12 butterfly kit (diffusion + solid)',
    specs: {
      contents: '12x12 frame, silk, grid cloth, solid, ratchet stands',
      use: 'Exterior diffusion, sun control',
    },
    summaryEn: 'Sun control for desert exteriors — the difference between usable and blown-out midday light.',
    summaryAr: 'التحكم بأشعة الشمس في التصوير الصحراوي الخارجي وضبط إضاءة الظهيرة.',
    lighting: [Complexity.MEDIUM, Complexity.HIGH],
    movement: ALL_MOVES,
    tiers: [MEDIUM, HIGH],
    dayNight: DayNightSuitability.DAY,
    capabilities: ['desert exterior', 'sun control'],
    dayRate: 480,
  },

  // ---------------------------------------------------------------- support
  {
    category: 'support',
    brand: 'DJI',
    model: 'RS 4 Pro gimbal',
    specs: {
      payload: '4.5 kg tested payload',
      features: 'Bluetooth shutter, second release plate, LiDAR focus option',
    },
    summaryEn: 'Single-operator stabiliser for handheld-to-gimbal coverage on compact bodies.',
    summaryAr: 'مثبت لمشغل واحد للانتقال بين التصوير المحمول والجيمبال مع الكاميرات المدمجة.',
    lighting: [Complexity.LOW, Complexity.MEDIUM, Complexity.HIGH],
    movement: [STEADICAM_GIMBAL, HANDHELD],
    tiers: [LOW, MEDIUM],
    dayNight: DayNightSuitability.BOTH,
    dayRate: 280,
    isCore: true,
  },
  {
    category: 'support',
    brand: 'Tiffen',
    model: 'Steadicam M-2 with operator vest',
    specs: {
      payload: 'Up to 18 kg',
      use: 'Long continuous takes, stair and corridor work',
    },
    summaryEn: 'Full-size stabiliser for long unbroken takes with a cinema body and prime.',
    summaryAr: 'مثبت كامل الحجم للمشاهد الطويلة المتصلة مع كاميرا سينمائية.',
    lighting: [Complexity.MEDIUM, Complexity.HIGH],
    movement: [STEADICAM_GIMBAL],
    tiers: [MEDIUM, HIGH],
    dayNight: DayNightSuitability.BOTH,
    dayRate: 1400,
  },
  {
    category: 'support',
    brand: 'Dana Dolly',
    model: 'Dana Dolly kit with track',
    specs: {
      contents: 'Dolly, 2x 4ft speed rail, universal end caps',
      use: 'Short precise dolly moves without a dolly grip crew',
    },
    summaryEn: 'Compact dolly moves for tight interiors and product tables.',
    summaryAr: 'حركات دوللي قصيرة ودقيقة للأماكن الضيقة وتصوير المنتجات.',
    lighting: [Complexity.LOW, Complexity.MEDIUM, Complexity.HIGH],
    movement: [CRANE_DOLLY, STATIC],
    tiers: [LOW, MEDIUM],
    dayNight: DayNightSuitability.BOTH,
    dayRate: 320,
  },
  {
    category: 'support',
    brand: 'DJI',
    model: 'Inspire 3 aerial platform',
    specs: {
      camera: 'X9-8K Air full-frame gimbal camera',
      recording: 'CinemaDNG / ProRes RAW',
      features: 'RTK positioning, dual operator control',
      note: 'Aerial work requires GACA permits in Saudi Arabia',
    },
    summaryEn: 'Cinema drone platform for aerial establishers; budget permit lead time separately.',
    summaryAr: 'منصة تصوير جوي سينمائي للمشاهد التأسيسية، مع مراعاة وقت تصاريح الطيران.',
    lighting: [Complexity.LOW, Complexity.MEDIUM],
    movement: [DRONE],
    tiers: [MEDIUM, HIGH],
    dayNight: DayNightSuitability.DAY,
    capabilities: ['drone', 'aerial'],
    dayRate: 2400,
  },
  {
    category: 'support',
    brand: 'Easyrig',
    model: 'Vario 5 with Flowcine Serene arm',
    specs: {
      payload: '5-17 kg',
      use: 'All-day handheld without operator fatigue',
    },
    summaryEn: 'Body support for handheld-heavy schedules; pays for itself on long documentary days.',
    summaryAr: 'دعامة جسم للتصوير المحمول الطويل، مفيدة في أيام التصوير الوثائقي.',
    lighting: [Complexity.LOW, Complexity.MEDIUM, Complexity.HIGH],
    movement: [HANDHELD],
    tiers: [LOW, MEDIUM, HIGH],
    dayNight: DayNightSuitability.BOTH,
    dayRate: 180,
  },

  // ---------------------------------------------------------------- sound
  {
    category: 'sound',
    brand: 'Sound Devices',
    model: 'MixPre-10 II recorder',
    specs: {
      channels: '10-track recording, 8 inputs',
      features: '32-bit float, timecode',
    },
    summaryEn: 'Location sound recorder with timecode for multi-camera sync.',
    summaryAr: 'مسجل صوت ميداني مع كود زمني للمزامنة بين عدة كاميرات.',
    lighting: [Complexity.LOW, Complexity.MEDIUM, Complexity.HIGH],
    movement: ALL_MOVES,
    tiers: ALL_TIERS,
    dayNight: DayNightSuitability.BOTH,
    dayRate: 300,
    isCore: true,
  },
  {
    category: 'sound',
    brand: 'Sennheiser',
    model: 'MKH 8060 shotgun + boom kit',
    specs: {
      pattern: 'Super-cardioid',
      contents: 'Mic, blimp, softie, boom pole, cable',
    },
    summaryEn: 'Standard dialogue boom package for interior and controlled exterior dialogue.',
    summaryAr: 'حزمة ميكروفون حوار قياسية للتصوير الداخلي والخارجي المضبوط.',
    lighting: [Complexity.LOW, Complexity.MEDIUM, Complexity.HIGH],
    movement: ALL_MOVES,
    tiers: ALL_TIERS,
    dayNight: DayNightSuitability.BOTH,
    dayRate: 220,
    isCore: true,
  },

  // ---------------------------------------------------------------- power
  {
    category: 'power',
    brand: 'Anton/Bauer',
    model: 'Gold Mount battery package (6 batteries + chargers)',
    specs: {
      contents: '6x 150Wh batteries, 2x quad charger, plates',
      use: 'Camera and monitor power for a full shoot day',
    },
    summaryEn: 'Camera power for a full day without mains access.',
    summaryAr: 'طاقة الكاميرا ليوم تصوير كامل دون الحاجة لمصدر كهربائي.',
    lighting: [Complexity.LOW, Complexity.MEDIUM, Complexity.HIGH],
    movement: ALL_MOVES,
    tiers: ALL_TIERS,
    dayNight: DayNightSuitability.BOTH,
    dayRate: 200,
    isCore: true,
  },
  {
    category: 'power',
    brand: 'Honda',
    model: 'EU70is generator (7 kVA, silenced)',
    specs: {
      output: '7 kVA',
      noise: 'Approx. 58 dB at rated load (manufacturer stated)',
      use: 'Night exteriors and remote locations',
    },
    summaryEn: 'Quiet generator for night exteriors where HMI or high-output LED needs mains.',
    summaryAr: 'مولد هادئ للتصوير الليلي الخارجي عند الحاجة لإضاءة قوية.',
    lighting: [Complexity.MEDIUM, Complexity.HIGH],
    movement: ALL_MOVES,
    tiers: [MEDIUM, HIGH],
    dayNight: DayNightSuitability.NIGHT,
    capabilities: ['remote location', 'night exterior'],
    dayRate: 550,
  },
];

const STYLE_TAGS = [
  ['warm-tones', 'Warm tones', 'ألوان دافئة'],
  ['cool-desaturated', 'Cool & desaturated', 'ألوان باردة وباهتة'],
  ['night-cinematography', 'Night cinematography', 'تصوير ليلي'],
  ['natural-light', 'Natural light', 'إضاءة طبيعية'],
  ['high-contrast-noir', 'High-contrast noir', 'تباين عالٍ نوار'],
  ['classic-cinematic', 'Classic cinematic', 'سينمائي كلاسيكي'],
  ['anamorphic-widescreen', 'Anamorphic widescreen', 'أنامورفيك عريض'],
  ['fast-paced-commercial', 'Fast-paced commercial', 'إعلاني سريع الإيقاع'],
  ['documentary-verite', 'Documentary vérité', 'وثائقي واقعي'],
  ['desert-landscape', 'Desert landscape', 'مناظر صحراوية'],
  ['luxury-product', 'Luxury product', 'منتجات فاخرة'],
  ['handheld-intimate', 'Handheld & intimate', 'محمول وحميمي'],
  ['soft-pastel', 'Soft pastel', 'باستيل ناعم'],
  ['high-key-bright', 'High-key & bright', 'إضاءة عالية ومشرقة'],
  ['moody-low-key', 'Moody low-key', 'إضاءة منخفضة وكثيفة'],
];

const CREW_RATES: Array<[string, string, string, number, number, number, number]> = [
  // slug, labelEn, labelAr, headcount, LOW, MEDIUM, HIGH
  ['dop', 'Director of Photography', 'مدير التصوير', 1, 2500, 5000, 9000],
  ['camera-operator', 'Camera Operator', 'مشغل كاميرا', 1, 1200, 2200, 3500],
  ['focus-puller', '1st AC / Focus Puller', 'مساعد كاميرا أول', 1, 900, 1600, 2600],
  ['second-ac', '2nd AC', 'مساعد كاميرا ثانٍ', 1, 600, 1000, 1600],
  ['dit', 'DIT', 'فني بيانات', 1, 800, 1500, 2400],
  ['gaffer', 'Gaffer', 'مسؤول إضاءة', 1, 1000, 1900, 3200],
  ['best-boy-electric', 'Best Boy Electric', 'مساعد إضاءة أول', 1, 700, 1200, 1900],
  ['electrician', 'Electrician', 'كهربائي', 2, 500, 800, 1200],
  ['key-grip', 'Key Grip', 'رئيس التثبيت', 1, 900, 1600, 2600],
  ['grip', 'Grip', 'فني تثبيت', 2, 500, 800, 1200],
  ['sound-mixer', 'Sound Mixer', 'مهندس صوت', 1, 1000, 1800, 2800],
  ['boom-operator', 'Boom Operator', 'مشغل بوم', 1, 600, 1000, 1500],
  ['gimbal-operator', 'Gimbal / Steadicam Operator', 'مشغل مثبت', 1, 1200, 2200, 3600],
  ['drone-pilot', 'Drone Pilot (licensed)', 'مشغل طائرة مسيرة', 1, 1500, 2500, 4000],
  ['production-assistant', 'Production Assistant', 'مساعد إنتاج', 2, 350, 550, 800],
];

async function main() {
  console.log('→ categories');
  for (const category of CATEGORIES) {
    await prisma.equipmentCategory.upsert({
      where: { slug: category.slug },
      create: category,
      update: category,
    });
  }
  const categoryIds = new Map(
    (await prisma.equipmentCategory.findMany({ select: { id: true, slug: true } })).map((c) => [c.slug, c.id]),
  );

  console.log('→ equipment catalog');
  for (const item of EQUIPMENT) {
    const categoryId = categoryIds.get(item.category);
    if (!categoryId) throw new Error(`Unknown category ${item.category}`);
    const data = {
      categoryId,
      brand: item.brand,
      model: item.model,
      nameAr: EQUIPMENT_NAMES_AR[`${item.brand}|${item.model}`] ?? item.nameAr ?? null,
      specs: item.specs,
      summaryEn: item.summaryEn,
      summaryAr: item.summaryAr,
      suitableLightingComplexity: item.lighting,
      suitableMovementTypes: item.movement,
      budgetTier: item.tiers,
      dayNightSuitability: item.dayNight,
      specialCapabilities: item.capabilities ?? [],
      indicativeDayRate: item.dayRate,
      isCore: item.isCore ?? false,
      active: true,
    };
    await prisma.equipment.upsert({
      where: { brand_model: { brand: item.brand, model: item.model } },
      create: data,
      update: data,
    });
  }

  console.log('→ style tags');
  for (const [index, [slug, labelEn, labelAr]] of STYLE_TAGS.entries()) {
    await prisma.styleTag.upsert({
      where: { slug },
      create: { slug, labelEn, labelAr, sortOrder: index },
      update: { labelEn, labelAr, sortOrder: index },
    });
  }

  console.log('→ crew rates + budget tiers + settings');
  for (const [roleSlug, labelEn, labelAr, headcount, low, medium, high] of CREW_RATES) {
    for (const [tier, dayRate] of [
      [BudgetTier.LOW, low],
      [BudgetTier.MEDIUM, medium],
      [BudgetTier.HIGH, high],
    ] as Array<[BudgetTier, number]>) {
      await prisma.crewRate.upsert({
        where: { roleSlug_budgetTier: { roleSlug, budgetTier: tier } },
        create: { roleSlug, labelEn, labelAr, budgetTier: tier, dayRate, headcount },
        update: { labelEn, labelAr, dayRate, headcount },
      });
    }
  }

  for (const tier of [BudgetTier.LOW, BudgetTier.MEDIUM, BudgetTier.HIGH]) {
    const config = DEFAULT_BUDGET_TIERS[tier];
    await prisma.budgetTierConfig.upsert({
      where: { tier },
      create: { tier, ...config },
      update: config,
    });
  }

  await prisma.setting.upsert({
    where: { key: 'platform' },
    create: { key: 'platform', value: DEFAULT_SETTINGS },
    update: {},
  });

  // ---------------------------------------------------------------- accounts
  console.log('→ admin account');
  const credentials = seedPassword();
  const password = await hash(credentials.value, 12);

  // Re-running with SEED_PASSWORD set resets the admin password on purpose;
  // without it an existing admin keeps theirs.
  const admin = await prisma.user.upsert({
    where: { email: SEED_GMAIL },
    create: { email: SEED_GMAIL, name: 'Admin', passwordHash: password, role: Role.ADMIN, locale: 'en' },
    update: {
      role: Role.ADMIN,
      ...(credentials.generated ? {} : { passwordHash: password, passwordChangedAt: new Date() }),
    },
  });

  // One admin only: any other admin becomes a regular user.
  const demoted = await prisma.user.updateMany({
    where: { role: Role.ADMIN, id: { not: admin.id } },
    data: { role: Role.PRODUCER },
  });
  if (demoted.count) console.log(`  ${demoted.count} other admin account(s) are now regular users`);

  // ---------------------------------------------------------------- old data
  // Earlier versions of this seed created demo logins and demo rental
  // companies. They are removed outright, with everything hanging off them
  // (their scripts; the companies' stock and bookings). The migrations remove
  // the cinematographer tables and roles themselves.
  console.log('→ removing old demo data');
  const legacyEmails = LEGACY_DEMO_TAGS.map(legacyDemoEmail).filter((email) => email !== SEED_GMAIL);
  const removedAccounts = await prisma.user.deleteMany({ where: { email: { in: legacyEmails } } });
  if (removedAccounts.count) console.log(`  removed ${removedAccounts.count} old demo account(s)`);

  const removedCompanies = await prisma.company.deleteMany({ where: { crNumber: { in: DEMO_COMPANY_CR_NUMBERS } } });
  if (removedCompanies.count) console.log(`  removed ${removedCompanies.count} demo rental company(ies) and their stock`);

  console.log(`
Seed complete.
  Admin: ${SEED_GMAIL}
  Password: ${
    credentials.generated
      ? `${credentials.value}  <- generated for this run. Save it now, or set SEED_PASSWORD to choose your own.`
      : '(from SEED_PASSWORD)'
  }
  Sign in at /en/login. Everyone else creates their own account.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
