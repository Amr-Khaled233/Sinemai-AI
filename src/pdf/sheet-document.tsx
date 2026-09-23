import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';
import { fontsFor, registerPdfFonts } from './fonts';
import type { BudgetBreakdown, DopMatch, PackageItem, SceneSummary, VendorMatch } from '@/agents/types';

/**
 * PDF export built with @react-pdf/renderer — no headless browser, so it fits
 * inside a Vercel function without blowing up bundle size or cold starts.
 *
 * The sheet is produced in the language it was generated in. Arabic is laid out
 * right to left with an embedded Arabic font (see ./fonts.ts); Latin brand and
 * model names stay in Latin script inside Arabic sentences, which is how crews
 * write them anyway.
 */

export type PdfLabels = {
  title: string;
  summary: string;
  sceneBreakdown: string;
  scenes: string;
  shootDays: string;
  nightScenes: string;
  exteriors: string;
  highComplexity: string;
  heading: string;
  environment: string;
  time: string;
  lighting: string;
  movement: string;
  equipmentTitle: string;
  category: string;
  item: string;
  quantity: string;
  days: string;
  reason: string;
  dopsTitle: string;
  dopsEmpty: string;
  matchScore: string;
  vendorsTitle: string;
  vendorsEmpty: string;
  coverage: string;
  budgetTitle: string;
  budgetLow: string;
  budgetMid: string;
  budgetHigh: string;
  role: string;
  headcount: string;
  rate: string;
  total: string;
  equipmentRental: string;
  crew: string;
  contingency: string;
  reviewer: string;
  provenance: string;
  dayRate: string;
};

export type SheetPdfData = {
  locale: string;
  labels: PdfLabels;
  projectName: string;
  projectType: string;
  budgetTier: string;
  city: string;
  generatedAt: string;
  currency: string;
  styleTags: string[];
  summaryText: string;
  sceneSummary: SceneSummary | null;
  scenes: Array<{
    order: number;
    heading: string;
    intExt: string | null;
    timeOfDay: string | null;
    lightingComplexity: string | null;
    cameraMovement: string | null;
    estimatedHours: number | null;
  }>;
  equipment: PackageItem[];
  equipmentRationale: string;
  dops: DopMatch[];
  vendors: VendorMatch[];
  budget: BudgetBreakdown | null;
  low: number;
  mid: number;
  high: number;
  criticNotes: string[];
};

const money = (value: number, currency: string) =>
  `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Math.round(value))} ${currency}`;

function makeStyles(locale: string) {
  const f = fontsFor(locale);
  return {
    f,
    styles: StyleSheet.create({
      page: {
        padding: 36,
        fontSize: 9,
        color: '#1a1d24',
        fontFamily: f.body,
        direction: f.direction,
        textAlign: f.align,
      },
      kicker: { fontSize: 7, letterSpacing: f.isArabic ? 0 : 1.6, color: '#9a7a2e' },
      h1: { fontSize: 18, marginTop: 6, fontFamily: f.bold, fontWeight: f.boldWeight },
      meta: { fontSize: 8, color: '#6b7280', marginTop: 4 },
      section: { marginTop: 18 },
      h2: {
        fontSize: 10,
        fontFamily: f.bold,
        fontWeight: f.boldWeight,
        borderBottomWidth: 1,
        borderBottomColor: '#d8c79a',
        paddingBottom: 3,
        marginBottom: 6,
      },
      bold: { fontFamily: f.bold, fontWeight: f.boldWeight },
      body: { lineHeight: 1.6, color: '#374151' },
      row: {
        flexDirection: f.isArabic ? 'row-reverse' : 'row',
        borderBottomWidth: 0.5,
        borderBottomColor: '#e5e7eb',
        paddingVertical: 3,
      },
      th: {
        flexDirection: f.isArabic ? 'row-reverse' : 'row',
        backgroundColor: '#f3f4f6',
        paddingVertical: 4,
        fontFamily: f.bold,
        fontWeight: f.boldWeight,
      },
      cell: { paddingHorizontal: 3, textAlign: f.align },
      statRow: { flexDirection: f.isArabic ? 'row-reverse' : 'row', gap: 8, marginTop: 4 },
      stat: { flexGrow: 1, borderWidth: 0.5, borderColor: '#e5e7eb', padding: 6 },
      statLabel: { fontSize: 6.5, color: '#6b7280', textAlign: f.align },
      statValue: { fontSize: 12, fontFamily: f.bold, fontWeight: f.boldWeight, marginTop: 2, textAlign: f.align },
      note: { fontSize: 7.5, color: '#6b7280', marginTop: 10, lineHeight: 1.5 },
      badge: { fontSize: 7, color: '#92400e' },
      footer: { position: 'absolute', bottom: 22, left: 36, right: 36, fontSize: 7, color: '#9ca3af' },
    }),
  };
}

export function SheetDocument({ data }: { data: SheetPdfData }) {
  registerPdfFonts();
  const { styles, f } = makeStyles(data.locale);
  const L = data.labels;
  const cur = data.currency;

  const Stat = ({ label, value }: { label: string; value: string }) => (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );

  return (
    <Document title={`${data.projectName} — ${L.title}`} author="Sinemai AI">
      <Page size="A4" style={styles.page}>
        <Text style={styles.kicker}>Sinemai AI · {L.title}</Text>
        <Text style={styles.h1}>{data.projectName}</Text>
        <Text style={styles.meta}>
          {[data.projectType, data.budgetTier, data.city, data.generatedAt].filter(Boolean).join('  ·  ')}
        </Text>
        {data.styleTags.length > 0 && <Text style={styles.meta}>{data.styleTags.join('  ·  ')}</Text>}

        {data.summaryText ? (
          <View style={styles.section}>
            <Text style={styles.h2}>{L.summary}</Text>
            <Text style={styles.body}>{data.summaryText}</Text>
          </View>
        ) : null}

        {data.sceneSummary && (
          <View style={styles.section}>
            <Text style={styles.h2}>{L.sceneBreakdown}</Text>
            <View style={styles.statRow}>
              <Stat label={L.scenes} value={String(data.sceneSummary.sceneCount)} />
              <Stat label={L.shootDays} value={String(data.sceneSummary.shootDays)} />
              <Stat label={L.nightScenes} value={`${data.sceneSummary.nightScenePct}%`} />
              <Stat label={L.exteriors} value={`${data.sceneSummary.exteriorScenePct}%`} />
              <Stat label={L.highComplexity} value={`${data.sceneSummary.highComplexityPct}%`} />
            </View>

            <View style={[styles.th, { marginTop: 10 }]}>
              <Text style={[styles.cell, { width: '6%' }]}>#</Text>
              <Text style={[styles.cell, { width: '42%' }]}>{L.heading}</Text>
              <Text style={[styles.cell, { width: '13%' }]}>{L.environment}</Text>
              <Text style={[styles.cell, { width: '13%' }]}>{L.time}</Text>
              <Text style={[styles.cell, { width: '13%' }]}>{L.lighting}</Text>
              <Text style={[styles.cell, { width: '13%' }]}>{L.movement}</Text>
            </View>
            {data.scenes.map((scene) => (
              <View key={scene.order} style={styles.row} wrap={false}>
                <Text style={[styles.cell, { width: '6%' }]}>{scene.order}</Text>
                <Text style={[styles.cell, { width: '42%' }]}>{scene.heading.slice(0, 74)}</Text>
                <Text style={[styles.cell, { width: '13%' }]}>{scene.intExt ?? '—'}</Text>
                <Text style={[styles.cell, { width: '13%' }]}>{scene.timeOfDay ?? '—'}</Text>
                <Text style={[styles.cell, { width: '13%' }]}>{scene.lightingComplexity ?? '—'}</Text>
                <Text style={[styles.cell, { width: '13%' }]}>{scene.cameraMovement ?? '—'}</Text>
              </View>
            ))}
          </View>
        )}

        <View style={styles.section} break>
          <Text style={styles.h2}>{L.equipmentTitle}</Text>
          <View style={styles.th}>
            <Text style={[styles.cell, { width: '14%' }]}>{L.category}</Text>
            <Text style={[styles.cell, { width: '36%' }]}>{L.item}</Text>
            <Text style={[styles.cell, { width: '7%' }]}>{L.quantity}</Text>
            <Text style={[styles.cell, { width: '8%' }]}>{L.days}</Text>
            <Text style={[styles.cell, { width: '35%' }]}>{L.reason}</Text>
          </View>
          {data.equipment.map((item) => (
            <View key={item.equipmentId} style={styles.row} wrap={false}>
              <Text style={[styles.cell, { width: '14%' }]}>{item.categorySlug}</Text>
              <Text style={[styles.cell, { width: '36%' }]}>
                {item.brand} {item.model}
              </Text>
              <Text style={[styles.cell, { width: '7%' }]}>{item.quantity}</Text>
              <Text style={[styles.cell, { width: '8%' }]}>{item.rentalDays}</Text>
              <Text style={[styles.cell, { width: '35%' }]}>{item.reason}</Text>
            </View>
          ))}
          {data.equipmentRationale ? (
            <Text style={[styles.body, { marginTop: 8 }]}>{data.equipmentRationale}</Text>
          ) : null}
        </View>

        <View style={styles.section}>
          <Text style={styles.h2}>{L.dopsTitle}</Text>
          {data.dops.length === 0 ? (
            <Text style={styles.body}>{L.dopsEmpty}</Text>
          ) : (
            data.dops.map((dop) => (
              <View key={dop.dopId} style={{ marginBottom: 7 }} wrap={false}>
                <Text style={styles.bold}>
                  {dop.name} — {L.matchScore} {Math.round(dop.score * 100)}%
                  {dop.city ? ` · ${dop.city}` : ''}
                  {dop.dayRate ? ` · ${L.dayRate} ${money(dop.dayRate, cur)}` : ''}
                </Text>
                <Text style={styles.body}>{dop.reason}</Text>
                {dop.portfolioLinks.length > 0 && (
                  <Text style={[styles.body, { color: '#0f766e' }]}>{dop.portfolioLinks.join('  ·  ')}</Text>
                )}
              </View>
            ))
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.h2}>{L.vendorsTitle}</Text>
          {data.vendors.length === 0 ? (
            <Text style={styles.body}>{L.vendorsEmpty}</Text>
          ) : (
            data.vendors.map((vendor) => (
              <View key={vendor.vendorId} style={{ marginBottom: 8 }} wrap={false}>
                <Text style={styles.bold}>
                  {vendor.companyName} — {vendor.city} · {L.coverage} {vendor.coveragePct}% ·{' '}
                  {money(vendor.subtotal, cur)}
                </Text>
                {vendor.items.map((line) => (
                  <View key={line.equipmentId} style={styles.row} wrap={false}>
                    <Text style={[styles.cell, { width: '50%' }]}>
                      {line.brand} {line.model}
                    </Text>
                    <Text style={[styles.cell, { width: '12%' }]}>×{line.quantity}</Text>
                    <Text style={[styles.cell, { width: '13%' }]}>
                      {line.rentalDays} {L.days}
                    </Text>
                    <Text style={[styles.cell, { width: '25%' }]}>{money(line.lineTotal, cur)}</Text>
                  </View>
                ))}
              </View>
            ))
          )}
        </View>

        {data.budget && (
          <View style={styles.section} wrap={false}>
            <Text style={styles.h2}>{L.budgetTitle}</Text>
            <View style={styles.statRow}>
              <Stat label={L.budgetLow} value={money(data.low, cur)} />
              <Stat label={L.budgetMid} value={money(data.mid, cur)} />
              <Stat label={L.budgetHigh} value={money(data.high, cur)} />
            </View>

            <View style={[styles.th, { marginTop: 10 }]}>
              <Text style={[styles.cell, { width: '46%' }]}>{L.role}</Text>
              <Text style={[styles.cell, { width: '12%' }]}>{L.headcount}</Text>
              <Text style={[styles.cell, { width: '18%' }]}>{L.rate}</Text>
              <Text style={[styles.cell, { width: '10%' }]}>{L.days}</Text>
              <Text style={[styles.cell, { width: '14%' }]}>{L.total}</Text>
            </View>
            {data.budget.crewBreakdown.map((line) => (
              <View key={line.roleSlug} style={styles.row} wrap={false}>
                <Text style={[styles.cell, { width: '46%' }]}>
                  {f.isArabic ? line.labelAr : line.labelEn}
                </Text>
                <Text style={[styles.cell, { width: '12%' }]}>{line.headcount}</Text>
                <Text style={[styles.cell, { width: '18%' }]}>{money(line.dayRate, cur)}</Text>
                <Text style={[styles.cell, { width: '10%' }]}>{line.days}</Text>
                <Text style={[styles.cell, { width: '14%' }]}>{money(line.total, cur)}</Text>
              </View>
            ))}

            <Text style={[styles.body, { marginTop: 8 }]}>
              {L.equipmentRental} {money(data.budget.equipmentRental, cur)} · {L.crew}{' '}
              {money(data.budget.crewTotal, cur)} · {L.contingency} {data.budget.contingencyPct}% ·{' '}
              {data.budget.shootDays} {L.shootDays}
            </Text>
          </View>
        )}

        {data.criticNotes.length > 0 && (
          <View style={styles.section} wrap={false}>
            <Text style={styles.h2}>{L.reviewer}</Text>
            {data.criticNotes.map((note, index) => (
              <Text key={index} style={styles.badge}>
                • {note}
              </Text>
            ))}
          </View>
        )}

        <Text style={styles.note}>{L.provenance}</Text>

        <Text
          style={styles.footer}
          render={({ pageNumber, totalPages }) => `Sinemai AI · ${pageNumber}/${totalPages}`}
          fixed
        />
      </Page>
    </Document>
  );
}
