import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ParsedFormat } from '@prisma/client';
import {
  detectFormat,
  fdxToPlainText,
  fountainToPlainText,
  parseScriptSource,
  readIntExt,
  readTimeOfDay,
  segmentScenes,
} from '../src/lib/script/parse';

const sample = (name: string) => readFileSync(join(process.cwd(), 'samples', name), 'utf8');

describe('scene heading recognition', () => {
  it('reads INT/EXT in plain slug lines', () => {
    assert.equal(readIntExt('INT. WAREHOUSE - NIGHT'), 'INTERIOR');
    assert.equal(readIntExt('EXT. DESERT HIGHWAY - DAWN'), 'EXTERIOR');
  });

  it('reads INT/EXT behind a scene-number prefix', () => {
    // A brief writes "Scene 3 — EXT. ROOFTOP"; an anchored check missed these.
    assert.equal(readIntExt('Scene 3 — EXT. RIYADH SKYLINE ROOFTOP - DUSK'), 'EXTERIOR');
    assert.equal(readIntExt('12. INT. VAN - MOVING - NIGHT'), 'INTERIOR');
  });

  it('schedules a combined INT/EXT scene as an exterior', () => {
    assert.equal(readIntExt('INT./EXT. CAR - DAY'), 'EXTERIOR');
    assert.equal(readIntExt('I/E. BOAT - NIGHT'), 'EXTERIOR');
  });

  it('reads Arabic headings, including Arabic-Indic scene numbers', () => {
    assert.equal(readIntExt('مشهد ١ - داخلي - مقهى شعبي - نهار'), 'INTERIOR');
    assert.equal(readIntExt('مشهد ٤ - خارجي - سطح المنزل - غروب'), 'EXTERIOR');
  });

  it('takes the time of day from the tail of the heading', () => {
    // "DAY CARE" in the middle must not win over the trailing NIGHT.
    assert.equal(readTimeOfDay('INT. DAY CARE CENTRE - NIGHT'), 'NIGHT');
    assert.equal(readTimeOfDay('EXT. RIDGE - GOLDEN HOUR'), 'DAWN_DUSK');
    assert.equal(readTimeOfDay('مشهد ٣ - داخلي - غرفة - ليل'), 'NIGHT');
  });
});

describe('segmentation', () => {
  it('splits a Fountain script into its scenes', async () => {
    const parsed = await parseScriptSource({
      format: ParsedFormat.FOUNTAIN,
      text: sample('night-delivery.fountain'),
    });
    assert.equal(parsed.scenes.length, 6);
    assert.equal(parsed.scenes[0].heading, 'INT. WAREHOUSE - NIGHT');
    assert.equal(parsed.scenes[0].intExt, 'INTERIOR');
    assert.equal(parsed.scenes[3].timeOfDay, 'DAWN_DUSK');
    // Every scene must carry body text, or the analyst has nothing to read.
    assert.ok(parsed.scenes.every((scene) => scene.bodyExcerpt.length > 0));
  });

  it('strips Fountain title pages and boneyard comments', () => {
    const text = fountainToPlainText(sample('night-delivery.fountain'));
    assert.ok(!text.includes('Draft date'));
    assert.ok(!text.includes('Credit:'));
  });

  it('reads Final Draft paragraphs by their declared type', async () => {
    const parsed = await parseScriptSource({
      format: ParsedFormat.FDX,
      text: sample('interview-doc.fdx'),
    });
    assert.equal(parsed.scenes.length, 3);
    assert.equal(parsed.scenes[1].intExt, 'EXTERIOR');
    assert.equal(parsed.scenes[2].timeOfDay, 'NIGHT');
  });

  it('decodes XML entities in Final Draft text', () => {
    const xml = `<FinalDraft><Content>
      <Paragraph Type="Scene Heading"><Text>INT. CAF&#201; - DAY</Text></Paragraph>
      <Paragraph Type="Action"><Text>Tea &amp; bread.</Text></Paragraph>
    </Content></FinalDraft>`;
    const text = fdxToPlainText(xml);
    assert.ok(text.includes('Tea & bread.'));
  });

  it('drops the preamble of a pasted brief but keeps every marked scene', async () => {
    const parsed = await parseScriptSource({
      format: ParsedFormat.PASTED,
      text: sample('luxury-watch-brief.txt'),
    });
    // Five "Scene N" blocks; the BRAND FILM BRIEF header is not a scene.
    assert.equal(parsed.scenes.length, 5);
    assert.ok(!parsed.scenes.some((scene) => scene.heading.includes('BRAND FILM BRIEF')));
    assert.equal(parsed.scenes[2].intExt, 'EXTERIOR');
  });

  it('parses an Arabic screenplay', async () => {
    const parsed = await parseScriptSource({
      format: ParsedFormat.PASTED,
      text: sample('arabic-short.txt'),
    });
    assert.equal(parsed.scenes.length, 4);
    assert.deepEqual(
      parsed.scenes.map((scene) => scene.intExt),
      ['INTERIOR', 'EXTERIOR', 'INTERIOR', 'EXTERIOR'],
    );
  });

  it('refuses an empty script rather than producing zero scenes silently', async () => {
    await assert.rejects(
      () => parseScriptSource({ format: ParsedFormat.PASTED, text: '   \n  ' }),
      /EMPTY_SCRIPT/,
    );
  });

  it('falls back to paragraph blocks when nothing looks like a slug line', () => {
    const scenes = segmentScenes(
      'A long paragraph describing an opening image that runs past the minimum length for a block.\n\n' +
        'A second paragraph that also runs well past the minimum length used by the fallback.',
    );
    assert.equal(scenes.length, 2);
  });
});

describe('format detection', () => {
  it('uses the extension, then the MIME type', () => {
    assert.equal(detectFormat('draft.fountain', ''), ParsedFormat.FOUNTAIN);
    assert.equal(detectFormat('draft.fdx', ''), ParsedFormat.FDX);
    assert.equal(detectFormat('draft.pdf', 'application/pdf'), ParsedFormat.PDF);
    assert.equal(detectFormat('notes.txt', 'text/plain'), ParsedFormat.TXT);
    assert.equal(detectFormat('unknown', 'application/xml'), ParsedFormat.FDX);
  });
});
