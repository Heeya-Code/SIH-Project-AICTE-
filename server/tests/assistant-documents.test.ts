import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeCtx, newApp, upload, type Ctx } from './helpers';
import { config } from '../src/config';
import { generateAssistantAnswer } from '../src/assistant-model';

let ctx: Ctx;
const originalAi = { key: config.aiApiKey, baseUrl: config.aiBaseUrl, model: config.aiModel };
beforeEach(() => { ctx = makeCtx(); });
afterEach(() => {
  config.aiApiKey = originalAi.key;
  config.aiBaseUrl = originalAi.baseUrl;
  config.aiModel = originalAi.model;
  vi.unstubAllGlobals();
});

async function pdfResponse(call: any) {
  return call.buffer(true).parse((res: any, callback: (error: Error | null, body?: Buffer) => void) => {
    const chunks: Buffer[] = [];
    res.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    res.on('end', () => callback(null, Buffer.concat(chunks)));
  });
}

describe('sample documents', () => {
  it('lists existing document categories and serves a readable PDF for each sample', async () => {
    const institution = await ctx.as('inst1@demo.local');
    const catalog = await institution.get('/api/documents/samples');
    expect(catalog.status).toBe(200);
    expect(catalog.body.rows.map((row: any) => row.doc_type)).toEqual(expect.arrayContaining([
      'Land / Title Documents', 'Lease Deed', 'Fire Safety Certificate', 'Faculty List', 'Building Plan',
    ]));
    for (const sample of catalog.body.rows) {
      const response = await pdfResponse(institution.get(`/api/documents/samples/download?doc_type=${encodeURIComponent(sample.doc_type)}`));
      expect(response.status, sample.doc_type).toBe(200);
      expect(response.headers['content-type']).toContain('application/pdf');
      expect(response.body.subarray(0, 5).toString('ascii')).toBe('%PDF-');
      expect(response.body.length, sample.doc_type).toBeGreaterThan(1500);
    }
  });

  it('returns a meaningful fictional PDF for synthetic records while preserving real uploads', async () => {
    const uploaded = await upload(ctx, 'inst1@demo.local', { doc_type: 'Fire Safety Certificate' });
    expect(uploaded.status).toBe(201);
    ctx.db.prepare('UPDATE documents SET synthetic=1 WHERE id=?').run(uploaded.body.id);
    const institution = await ctx.as('inst1@demo.local');
    const response = await pdfResponse(institution.get(`/api/documents/${uploaded.body.id}/download`));
    expect(response.status).toBe(200);
    expect(response.headers['content-disposition']).toContain('attachment');
    expect(response.body.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(response.body.length).toBeGreaterThan(1500);
  });

  it('requires authentication for the sample library and does not expose guessed record files', async () => {
    const unauthenticated = await import('supertest').then(({ default: request }) => request(ctx.app).get('/api/documents/samples'));
    expect(unauthenticated.status).toBe(401);
    const other = await upload(ctx, 'inst2@demo.local', { doc_type: 'Lease Deed' });
    const institution = await ctx.as('inst1@demo.local');
    expect((await institution.get(`/api/documents/${other.body.id}/download`)).status).toBe(404);
  });
});

describe('configured assistant model', () => {
  it('uses permission-scoped case facts and does not reveal another institution’s case', async () => {
    const appId = await newApp(ctx, 'inst2@demo.local');
    const ref = (ctx.db.prepare('SELECT ref FROM applications WHERE id=?').get(appId) as any).ref;
    const other = await ctx.as('inst1@demo.local');
    const hidden = await other.post('/api/assistant/ask', { question: `What is the status of ${ref}?` });
    expect(hidden.status).toBe(200);
    expect(hidden.body.facts.join(' ')).toContain(`No application ${ref} is visible to you.`);
    expect(JSON.stringify(hidden.body)).not.toContain('Test application');

    const owner = await ctx.as('inst2@demo.local');
    const visible = await owner.post('/api/assistant/ask', { question: `Which documents are attached to ${ref}?` });
    expect(visible.status).toBe(200);
    expect(visible.body.facts.join(' ')).toContain('current document record(s)');
  });

  it('does not call an external model when credentials are not configured', async () => {
    config.aiApiKey = '';
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    expect(await generateAssistantAnswer('How does a report work?', {})).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('sends follow-up context and retrieved source evidence to the configured compatible endpoint', async () => {
    config.aiApiKey = 'test-key';
    config.aiBaseUrl = 'https://model.example/v1/';
    config.aiModel = 'test-model';
    const fetch = vi.fn(async (_url: string, init: RequestInit) => {
      const request = JSON.parse(String(init.body));
      expect(_url).toBe('https://model.example/v1/chat/completions');
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-key');
      expect(request.model).toBe('test-model');
      expect(JSON.stringify(request.messages)).toContain('verified_excerpt');
      expect(JSON.stringify(request.messages)).toContain('Earlier answer');
      return new Response(JSON.stringify({ choices: [{ message: { content: 'Use only the supplied excerpt.' } }] }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetch);
    const result = await generateAssistantAnswer('Can you explain that?', {
      retrievedEvidence: [{ title: 'Sample rule', statement: 'A source statement.', status: 'verified_excerpt', source: 'Handbook excerpt' }],
    }, [{ question: 'What did the excerpt say?', answer: 'Earlier answer' }]);
    expect(result).toBe('Use only the supplied excerpt.');
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('surfaces provider failures instead of silently returning a success-shaped answer', async () => {
    config.aiApiKey = 'test-key';
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })));
    await expect(generateAssistantAnswer('Explain the current status.', {})).rejects.toMatchObject({
      status: 502,
      code: 'AI_PROVIDER_ERROR',
    });
  });

  it('retrieves fictional sample-document content and links it in an answer', async () => {
    config.aiApiKey = 'test-key';
    const fetch = vi.fn(async (_url: string, init: RequestInit) => {
      expect(String(init.body)).toContain('illustrative_sample_not_official');
      expect(String(init.body)).toContain('no visit findings exist');
      return new Response(JSON.stringify({ choices: [{ message: { content: 'The fictional example has visit particulars and checklist areas.' } }] }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetch);
    const institution = await ctx.as('inst1@demo.local');
    const response = await institution.post('/api/reference/ask', { question: 'What information should an inspection report contain?' });
    expect(response.status).toBe(200);
    expect(response.body.answer).toContain('visit particulars');
    expect(response.body.sample_documents).toContainEqual(expect.objectContaining({
      doc_type: 'Inspection Report',
      link: '/documents?sample=Inspection%20Report',
    }));
  });
});
