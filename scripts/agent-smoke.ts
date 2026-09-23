/**
 * Pipeline smoke test.
 *
 *   npm run agents:smoke              # parser only, no API calls, no database writes
 *   npm run agents:smoke -- --full    # creates a throwaway project and runs all six agents
 *
 * The parse-only mode is the one to run in CI: it proves segmentation still works
 * on Fountain, Final Draft and pasted-brief inputs without spending tokens.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ParsedFormat } from '@prisma/client';
import { detectFormat, parseScriptSource } from '../src/lib/script/parse';

const SAMPLES_DIR = join(process.cwd(), 'samples');
const full = process.argv.includes('--full');

async function parseSamples() {
  const files = readdirSync(SAMPLES_DIR).filter((name) => /\.(fountain|fdx|txt|md)$/i.test(name));
  if (files.length === 0) throw new Error('No sample scripts found in ./samples');

  for (const file of files) {
    const raw = readFileSync(join(SAMPLES_DIR, file), 'utf8');
    const format = detectFormat(file);
    const parsed = await parseScriptSource({ format, text: raw });

    console.log(`\n=== ${file}  [${format}]`);
    console.log(`    scenes: ${parsed.scenes.length}   pages≈${parsed.pageCount}`);
    for (const scene of parsed.scenes) {
      console.log(
        `    ${String(scene.order).padStart(2)}. ${scene.heading.slice(0, 58).padEnd(58)} ` +
          `${(scene.intExt ?? '—').padEnd(9)} ${(scene.timeOfDay ?? '—').padEnd(10)} ${scene.pageEighths}/8`,
      );
    }

    // Segmentation failures are silent killers downstream, so assert the basics.
    if (parsed.scenes.length === 0) throw new Error(`${file}: no scenes parsed`);
    const missingEnv = parsed.scenes.filter((scene) => scene.intExt === null).length;
    if (missingEnv > parsed.scenes.length / 2) {
      console.warn(`    ! ${missingEnv}/${parsed.scenes.length} scenes have no INT/EXT — check the heading patterns`);
    }
  }
}

async function runFullPipeline() {
  if (!process.env.OPENAI_API_KEY) throw new Error('--full needs OPENAI_API_KEY');
  if (!process.env.DATABASE_URL) throw new Error('--full needs DATABASE_URL');

  const { prisma } = await import('../src/lib/prisma');
  const { runProductionAnalysis } = await import('../src/agents/orchestrator');

  const owner = await prisma.user.findFirst({ where: { role: 'PRODUCER' }, select: { id: true } });
  if (!owner) throw new Error('No producer account found — run `npm run db:seed` first.');

  const raw = readFileSync(join(SAMPLES_DIR, 'night-delivery.fountain'), 'utf8');
  const parsed = await parseScriptSource({ format: ParsedFormat.FOUNTAIN, text: raw });

  const project = await prisma.project.create({
    data: {
      ownerId: owner.id,
      name: `[smoke] Night Delivery ${new Date().toISOString().slice(11, 19)}`,
      type: 'SHORT_FILM',
      budgetTier: 'MEDIUM',
      city: 'Riyadh',
      visualStyleTags: ['night-cinematography', 'high-contrast-noir', 'handheld-intimate'],
      status: 'SCRIPT_UPLOADED',
      script: {
        create: {
          parsedFormat: ParsedFormat.FOUNTAIN,
          rawText: parsed.rawText,
          pageCount: parsed.pageCount,
          sceneCount: parsed.scenes.length,
          parsedAt: new Date(),
          scenes: {
            create: parsed.scenes.map((scene) => ({
              order: scene.order,
              heading: scene.heading,
              slug: scene.slug,
              bodyExcerpt: scene.bodyExcerpt,
              intExt: scene.intExt,
              timeOfDay: scene.timeOfDay,
              pageEighths: scene.pageEighths,
            })),
          },
        },
      },
    },
    select: { id: true, name: true },
  });

  console.log(`\nRunning the agent graph on ${project.name} (${project.id})\n`);
  const started = Date.now();

  const sheet = await runProductionAnalysis(project.id, (event) => {
    if (event.type === 'stage') console.log(`  [${String(event.pct).padStart(3)}%] ${event.stage}${event.detail ? ` · ${event.detail}` : ''}`);
    else if (event.type === 'log') console.log(`         ${event.message}`);
    else if (event.type === 'error') console.error(`  !! ${event.message}`);
  });

  console.log(`\nFinished in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  console.log(`  scenes analysed : ${sheet.sceneSummary.sceneCount} (${sheet.sceneSummary.shootDays} shoot days)`);
  console.log(`  night ratio     : ${sheet.sceneSummary.nightScenePct}%`);
  console.log(`  package         : ${sheet.equipment.package.map((i) => `${i.brand} ${i.model}`).join(', ')}`);
  console.log(`  dropped ids     : ${sheet.equipment.droppedHallucinatedIds.length}`);
  console.log(`  DOP matches     : ${sheet.dops.matches.map((d) => `${d.name} ${d.score}`).join(', ') || 'none'}`);
  console.log(`  vendors         : ${sheet.vendorBudget.vendors.map((v) => v.companyName).join(', ') || 'none'}`);
  console.log(
    `  budget          : ${sheet.vendorBudget.low} / ${sheet.vendorBudget.mid} / ${sheet.vendorBudget.high} ${sheet.vendorBudget.budget.currency}`,
  );
  console.log(`  critic passed   : ${sheet.critic.passed}`);
  for (const issue of sheet.critic.issues) {
    console.log(`    - [${issue.severity}] ${issue.agent}: ${issue.problem}`);
  }

  const toolCalls = await prisma.agentToolCall.count({ where: { run: { projectId: project.id } } });
  const runs = await prisma.agentRun.count({ where: { projectId: project.id } });
  console.log(`\n  logged ${runs} agent run(s) and ${toolCalls} tool call(s) for this project.`);
  await prisma.$disconnect();
}

async function main() {
  await parseSamples();
  if (full) await runFullPipeline();
  else console.log('\nParse-only run. Add --full to execute the agent graph against the database.');
}

main().catch((error) => {
  console.error('\nSmoke test failed:', error);
  process.exit(1);
});
