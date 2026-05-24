#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BACKGROUND_PATH = path.join(PROJECT_ROOT, 'src', 'background.js');
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'eval-results');
const CACHE_DIR = path.join(PROJECT_ROOT, '.cache', 'phishguard-eval');
const GEMINI_MODEL = 'gemini-3.1-flash-lite';
const DATASET_FETCH_TIMEOUT_MS = 60_000;
const MODEL_FETCH_TIMEOUT_MS = 90_000;

export const DATASET_URLS = {
  texts: 'https://huggingface.co/datasets/ealvaradob/phishing-dataset/resolve/main/texts.json',
  urls: 'https://huggingface.co/datasets/ealvaradob/phishing-dataset/resolve/main/urls.json',
  webs: 'https://huggingface.co/datasets/ealvaradob/phishing-dataset/resolve/main/webs.json',
  combined_reduced: 'https://huggingface.co/datasets/ealvaradob/phishing-dataset/resolve/main/combined_reduced.json',
  combined_full: 'https://huggingface.co/datasets/ealvaradob/phishing-dataset/resolve/main/combined_full.json'
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

if (isCliEntry()) {
  main().catch(error => {
    console.error(`\n평가 실패: ${error.message}`);
    process.exitCode = 1;
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const repeat = Math.max(1, positiveInt(args.repeat, 1));
  const repeatPauseMs = positiveInt(args.repeatPause, 0);
  const reporter = createCliReporter();

  for (let i = 0; i < repeat; i += 1) {
    if (repeat > 1) {
      reporter.log(`\n반복 실행 ${i + 1}/${repeat}`);
    }

    await runEvaluation({
      ...args,
      seed: args.seed ? `${args.seed}-${i + 1}` : undefined
    }, reporter);

    if (i < repeat - 1 && repeatPauseMs > 0) {
      reporter.log(`반복 대기: ${Math.round(repeatPauseMs / 1000)}초`);
      await sleep(repeatPauseMs);
    }
  }
}

export async function runEvaluation(args = {}, reporter = {}) {
  const report = createReporter(reporter);
  const model = String(args.model || 'gemini').toLowerCase();
  const datasetName = String(args.dataset || 'texts');
  const limit = positiveInt(args.limit, 12);
  const offset = positiveInt(args.offset, 0);
  const delayMs = positiveInt(args.delay, 700);
  const chunkCount = positiveInt(args.chunkCount, 5);
  const chunkPauseMs = positiveInt(args.chunkPause, 0);
  const bodyLimit = positiveInt(args.bodyLimit, 3000);
  const mediumAs = String(args.mediumAs || 'phishing').toLowerCase();
  const dryRun = Boolean(args.dryRun);
  const balanced = args.balanced !== false;
  const randomize = args.random !== false;
  const seed = args.seed ? String(args.seed) : String(Date.now());

  throwIfAborted(report.signal);
  const promptTools = await loadCurrentPromptTools();
  const env = await loadEnv();
  const apiKey = dryRun ? '' : getApiKey(model, env);
  report.log(`데이터셋 준비 중: ${datasetName}`);
  const rows = await loadRows(args, datasetName, report.signal, report);
  report.log(`데이터셋 로드 완료: ${rows.length}개`);
  const samples = selectSamples(rows, { limit, offset, balanced, randomize, seed });
  report.log(`평가 샘플 선택 완료: ${samples.length}개`);
  report.log(`샘플링: ${randomize ? `랜덤 (seed=${seed})` : '순차'}`);
  const chunkSize = Math.max(1, Math.ceil(samples.length / Math.max(1, chunkCount)));

  if (samples.length === 0) {
    throw new Error('평가할 샘플을 찾지 못했습니다.');
  }

  const startedAt = new Date();
  const runId = startedAt.toISOString().replace(/[:.]/g, '-');
  const outputBase = path.join(OUTPUT_DIR, `phishing-prompt-${datasetName}-${model}-${runId}`);
  const jsonlPath = `${outputBase}.jsonl`;
  const summaryPath = `${outputBase}.summary.json`;

  if (!dryRun) {
    await fs.mkdir(OUTPUT_DIR, { recursive: true });
  }

  const summary = createSummary({
    model,
    datasetName,
      source: args.local || args.source || DATASET_URLS[datasetName],
    limit,
    offset,
    balanced,
    randomize,
    seed,
    chunkCount,
    chunkSize,
    chunkPauseMs,
    mediumAs,
    startedAt: startedAt.toISOString()
  });
  const records = [];
  const dryRunSamples = [];

  report.log(`현재 background.js 프롬프트로 ${samples.length}개 샘플을 평가합니다.`);
  report.log(`데이터셋: ${datasetName}, 모델: ${model}${dryRun ? ', dry-run' : ''}`);
  if (!dryRun && samples.length > chunkSize && chunkPauseMs > 0) {
    report.log(`요청 페이싱: ${chunkSize}개 처리 후 ${Math.round(chunkPauseMs / 1000)}초 대기`);
  }

  for (let i = 0; i < samples.length; i += 1) {
    throwIfAborted(report.signal);
    const sample = samples[i];
    const metadata = {
      subject: sample.subject || makeSyntheticSubject(sample.text),
      sender: sample.sender || 'Hugging Face phishing-dataset',
      senderEmail: sample.senderEmail || `sample-${sample.rowIndex}@dataset.local`,
      date: sample.date || ''
    };
    const body = sample.text.slice(0, bodyLimit);
    const systemPrompt = promptTools.buildSystem();
    const userPrompt = promptTools.buildPrompt(metadata, body);

    if (dryRun) {
      const dryRunSample = {
        index: i,
        total: samples.length,
        rowIndex: sample.rowIndex,
        label: sample.label,
        expectedLabel: normalizeExpected(sample.label),
        metadata,
        textPreview: sample.text.slice(0, 500),
        systemPrompt,
        userPrompt
      };
      dryRunSamples.push(dryRunSample);
      report.dryRunSample(dryRunSample);
      continue;
    }

    report.log(`[${i + 1}/${samples.length}] API 호출 중...`);
    const raw = await callModel({ model, apiKey, systemPrompt, userPrompt, signal: report.signal });
    const result = promptTools.normalizeModelResult(
      promptTools.parseModelJson(raw),
      'email'
    );
    const prediction = classifyPrediction(result.riskLevel, mediumAs);
    const expected = normalizeExpected(sample.label);
    const correct = expected == null ? null : prediction === expected;
    const record = makeRecord({
      sample,
      model,
      datasetName,
      result,
      expected,
      prediction,
      correct,
      raw,
      systemPrompt,
      userPrompt
    });

    records.push(record);
    updateSummary(summary, record);
    await fs.appendFile(jsonlPath, `${JSON.stringify(record)}\n`, 'utf8');
    report.record(record, i, samples.length);

    const hasMore = i < samples.length - 1;
    const isChunkBoundary = (i + 1) % chunkSize === 0;
    if (hasMore && isChunkBoundary && chunkPauseMs > 0) {
      report.log(`요청 묶음 대기: ${Math.round(chunkPauseMs / 1000)}초 (${i + 1}/${samples.length} 완료)`);
      await sleep(chunkPauseMs);
    } else if (hasMore && delayMs > 0) {
      await sleep(delayMs);
    }
  }

  summary.finishedAt = new Date().toISOString();
  summary.accuracy = summary.withLabel > 0
    ? Number((summary.correct / summary.withLabel).toFixed(4))
    : null;

  if (!dryRun) {
    await fs.writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
    report.log('저장 완료');
    report.log(`- 결과: ${relative(jsonlPath)}`);
    report.log(`- 요약: ${relative(summaryPath)}`);
  }

  const output = dryRun
    ? null
    : {
        jsonlPath: relative(jsonlPath),
        summaryPath: relative(summaryPath)
      };

  const payload = { summary, records, dryRunSamples, output };
  report.done(payload);
  return payload;
}

function isCliEntry() {
  return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
}

function createCliReporter() {
  return {
    log(message = '') {
      console.log(message);
    },
    record(record, index, total) {
      printRecord(index, total, record);
    },
    dryRunSample(sample) {
      printDryRunSample(sample.index, sample.total, {
        rowIndex: sample.rowIndex,
        label: sample.label
      }, sample.userPrompt);
    }
  };
}

function createReporter(reporter) {
  return {
    signal: reporter.signal,
    log: typeof reporter.log === 'function' ? reporter.log : () => {},
    record: typeof reporter.record === 'function' ? reporter.record : () => {},
    dryRunSample: typeof reporter.dryRunSample === 'function' ? reporter.dryRunSample : () => {},
    done: typeof reporter.done === 'function' ? reporter.done : () => {}
  };
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw new Error('사용자가 평가를 중단했습니다.');
  }
}

function parseArgs(argv) {
  const args = {};

  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith('--')) continue;

    const [rawKey, inlineValue] = item.slice(2).split('=');
    const key = rawKey.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    const next = argv[i + 1];
    const hasInlineValue = inlineValue !== undefined;
    const value = hasInlineValue
      ? inlineValue
      : next && !next.startsWith('--')
      ? argv[++i]
      : true;

    if (key.startsWith('no')) {
      const normalized = key.slice(2, 3).toLowerCase() + key.slice(3);
      args[normalized] = false;
    } else {
      args[key] = value;
    }
  }

  return args;
}

function printHelp() {
  console.log(`사용법:
  node tools/evaluate-phishing-prompt.mjs --model gemini --limit 12
  node tools/evaluate-phishing-prompt.mjs --model groq --dataset texts --limit 8
  node tools/evaluate-phishing-prompt.mjs --dry-run --limit 2
  node tools/evaluate-phishing-prompt.mjs --local data/texts.json --limit 20

옵션:
  --model gemini|groq|gpt        호출할 모델입니다. 기본값은 gemini입니다.
  --dataset texts|urls|webs|combined_reduced|combined_full
                               Hugging Face에서 받을 파일입니다. 기본값은 texts입니다.
  --source URL                  직접 받을 JSON URL입니다.
  --local PATH                  이미 받은 JSON 파일을 사용합니다.
  --limit N                     평가할 샘플 수입니다. 기본값은 12입니다.
  --offset N                    샘플 시작 위치입니다. 기본값은 0입니다.
  --no-random                   샘플을 순차 선택합니다. 기본값은 랜덤입니다.
  --seed VALUE                  랜덤 샘플링 seed입니다. 같은 seed는 같은 샘플을 고릅니다.
  --no-balanced                 label 0/1 균형 샘플링을 끕니다.
  --delay MS                    API 호출 간 대기 시간입니다. 기본값은 700입니다.
  --chunk-count N               전체 요청을 N묶음으로 나눕니다. 기본값은 5입니다.
  --chunk-pause MS              요청 묶음 사이 대기 시간입니다. 기본값은 0입니다.
  --repeat N                    같은 설정으로 평가를 N번 반복합니다. 기본값은 1입니다.
  --repeat-pause MS             반복 실행 사이 대기 시간입니다. 기본값은 0입니다.
  --medium-as phishing|benign   MEDIUM 판정을 어떤 라벨로 볼지 정합니다. 기본값은 phishing입니다.
  --dry-run                     API 호출 없이 현재 프롬프트 입력만 확인합니다.`);
}

async function loadCurrentPromptTools() {
  const source = await fs.readFile(BACKGROUND_PATH, 'utf8');
  const sandbox = {
    console,
    fetch,
    chrome: {
      runtime: { onMessage: { addListener() {} } },
      storage: {
        local: {
          get() {},
          set(_value, callback) {
            if (typeof callback === 'function') callback();
          }
        }
      }
    }
  };

  vm.createContext(sandbox);
  vm.runInContext(`${source}
globalThis.__phishguardEval = {
  buildSystem,
  buildPrompt,
  parseModelJson,
  normalizeModelResult
};`, sandbox, { filename: BACKGROUND_PATH });

  return sandbox.__phishguardEval;
}

async function loadEnv() {
  const env = { ...process.env };
  const envPath = path.join(PROJECT_ROOT, '.env');

  try {
    const text = await fs.readFile(envPath, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const index = trimmed.indexOf('=');
      if (index === -1) continue;

      const key = trimmed.slice(0, index).trim();
      const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, '');
      if (key && env[key] == null) env[key] = value;
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  return env;
}

function getApiKey(model, env) {
  const candidates = {
    gemini: ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY', 'gemini_key', 'gemini_api_key'],
    groq: ['GROQ_API_KEY', 'groq_key', 'groq_api_key'],
    gpt: ['OPENAI_API_KEY', 'openai_key', 'openai_api_key']
  }[model];

  if (!candidates) {
    throw new Error(`지원하지 않는 모델입니다: ${model}`);
  }

  for (const key of candidates) {
    if (env[key]) return env[key];
  }

  throw new Error(`${model} API 키가 없습니다. .env 또는 환경변수에 ${candidates.join(' / ')} 중 하나를 넣어주세요.`);
}

async function loadRows(args, datasetName, signal, reporter = {}) {
  let raw;
  let source;

  if (args.local) {
    source = path.resolve(PROJECT_ROOT, String(args.local));
    reporter.log?.(`로컬 데이터셋 사용: ${relative(source)}`);
    raw = await fs.readFile(source, 'utf8');
  } else {
    source = args.source || DATASET_URLS[datasetName];
    if (!source) {
      throw new Error(`알 수 없는 dataset 값입니다: ${datasetName}`);
    }

    const cachePath = datasetCachePath(datasetName, source);
    try {
      raw = await fs.readFile(cachePath, 'utf8');
      reporter.log?.(`캐시 데이터셋 사용: ${relative(cachePath)}`);
    } catch (_) {
      reporter.log?.(`원격 데이터셋 다운로드 중: ${source}`);
      const response = await fetchWithTimeout(source, {
        signal,
        timeoutMs: DATASET_FETCH_TIMEOUT_MS
      });
      if (!response.ok) {
        throw new Error(`데이터셋 다운로드 실패: HTTP ${response.status}`);
      }
      raw = await readResponseTextWithProgress(response, {
        signal,
        reporter,
        label: '데이터셋 다운로드'
      });
      await fs.mkdir(CACHE_DIR, { recursive: true });
      await fs.writeFile(cachePath, raw, 'utf8');
      reporter.log?.(`데이터셋 캐시 저장: ${relative(cachePath)}`);
    }
  }

  const parsed = parseJsonOrJsonl(raw);
  return extractRows(parsed)
    .map((row, rowIndex) => normalizeDatasetRow(row, rowIndex))
    .filter(row => row.text);
}

function datasetCachePath(datasetName, source) {
  const safeSource = String(source || '')
    .replace(/^https?:\/\//i, '')
    .replace(/[^a-z0-9._-]+/gi, '_')
    .slice(0, 120);
  return path.join(CACHE_DIR, `${datasetName}-${safeSource || 'dataset'}.json`);
}

async function fetchWithTimeout(url, { signal, timeoutMs, ...options } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`timeout ${timeoutMs}ms`)), timeoutMs);
  const abortFromParent = () => controller.abort(signal.reason);

  if (signal?.aborted) {
    clearTimeout(timer);
    throw signal.reason || new Error('aborted');
  }

  signal?.addEventListener?.('abort', abortFromParent, { once: true });
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted && !signal?.aborted) {
      throw new Error(`요청 시간이 초과되었습니다: ${Math.round(timeoutMs / 1000)}초`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.('abort', abortFromParent);
  }
}

async function readResponseTextWithProgress(response, { signal, reporter = {}, label = '다운로드' } = {}) {
  const total = Number(response.headers.get('content-length') || 0);
  const reader = response.body?.getReader?.();

  if (!reader) {
    reporter.log?.(`${label}: 크기를 알 수 없어 일반 방식으로 읽습니다.`);
    return response.text();
  }

  const chunks = [];
  let received = 0;
  let lastPercent = -1;
  const decoder = new TextDecoder();

  while (true) {
    throwIfAborted(signal);
    const { done, value } = await reader.read();
    if (done) break;

    chunks.push(value);
    received += value.byteLength;

    if (total > 0) {
      const percent = Math.min(100, Math.floor((received / total) * 100));
      if (percent === 100 || percent >= lastPercent + 5) {
        lastPercent = percent;
        reporter.log?.(`${label}: ${percent}% (${formatBytes(received)} / ${formatBytes(total)})`);
      }
    } else if (received >= (lastPercent + 1) * 1024 * 1024) {
      lastPercent += 1;
      reporter.log?.(`${label}: ${formatBytes(received)} 받음`);
    }
  }

  if (total > 0 && lastPercent < 100) {
    reporter.log?.(`${label}: 100% (${formatBytes(received)} / ${formatBytes(total)})`);
  }

  let text = '';
  for (const chunk of chunks) {
    text += decoder.decode(chunk, { stream: true });
  }
  text += decoder.decode();
  return text;
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)}MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)}KB`;
  return `${value}B`;
}

function parseJsonOrJsonl(raw) {
  const text = String(raw || '').trim();
  if (!text) return [];

  try {
    return JSON.parse(text);
  } catch (_) {
    return text
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => JSON.parse(line));
  }
}

function extractRows(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];

  for (const key of ['train', 'data', 'rows', 'items']) {
    if (Array.isArray(value[key])) return value[key];
  }

  return Object.values(value).find(Array.isArray) || [];
}

function normalizeDatasetRow(row, rowIndex) {
  const text = pickString(row, ['text', 'body', 'message', 'email', 'html', 'url', 'content']);
  const label = row?.label ?? row?.labels ?? row?.target ?? row?.is_phishing ?? row?.phishing;

  return {
    rowIndex,
    text: cleanTextBlock(text),
    label,
    subject: row?.subject ?? row?.title,
    sender: row?.sender ?? row?.senderName,
    senderEmail: row?.senderEmail ?? row?.sender_email ?? row?.email,
    date: row?.date
  };
}

function pickString(row, keys) {
  for (const key of keys) {
    if (row?.[key] != null && String(row[key]).trim()) {
      return String(row[key]);
    }
  }
  return '';
}

function cleanTextBlock(value) {
  return String(value || '')
    .replace(/\u0000/g, '')
    .replace(/\r\n/g, '\n')
    .trim();
}

function selectSamples(rows, { limit, offset, balanced, randomize = true, seed = '0' }) {
  const safeRows = rows.slice(offset);
  const rng = createSeededRandom(seed);

  if (!balanced) {
    const pool = randomize ? shuffleCopy(safeRows, rng) : safeRows;
    return pool.slice(0, limit);
  }

  const phishing = safeRows.filter(row => normalizeExpected(row.label) === 1);
  const benign = safeRows.filter(row => normalizeExpected(row.label) === 0);

  if (phishing.length === 0 || benign.length === 0) {
    const pool = randomize ? shuffleCopy(safeRows, rng) : safeRows;
    return pool.slice(0, limit);
  }

  const result = [];
  const perLabel = Math.ceil(limit / 2);
  const max = Math.max(perLabel, limit - perLabel);
  const benignPool = randomize ? shuffleCopy(benign, rng) : benign;
  const phishingPool = randomize ? shuffleCopy(phishing, rng) : phishing;

  for (let i = 0; i < max && result.length < limit; i += 1) {
    if (benignPool[i]) result.push(benignPool[i]);
    if (result.length < limit && phishingPool[i]) result.push(phishingPool[i]);
  }

  return randomize ? shuffleCopy(result.slice(0, limit), rng) : result.slice(0, limit);
}

function shuffleCopy(items, rng) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function createSeededRandom(seed) {
  let state = 2166136261;
  const text = String(seed);
  for (let i = 0; i < text.length; i += 1) {
    state ^= text.charCodeAt(i);
    state = Math.imul(state, 16777619);
  }

  return () => {
    state += 0x6D2B79F5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normalizeExpected(label) {
  if (label == null || label === '') return null;

  const value = String(label).trim().toLowerCase();
  if (value === '1' || value === 'true' || value.includes('phish') || value.includes('spam') || value.includes('smish')) {
    return 1;
  }
  if (value === '0' || value === 'false' || value.includes('benign') || value.includes('ham') || value.includes('legit')) {
    return 0;
  }

  return null;
}

function makeSyntheticSubject(text) {
  const firstLine = String(text || '').split(/\r?\n/).find(Boolean) || '(dataset sample)';
  return firstLine.replace(/\s+/g, ' ').slice(0, 120);
}

async function callModel({ model, apiKey, systemPrompt, userPrompt, signal }) {
  if (model === 'groq') {
    const response = await fetchWithTimeout('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      signal,
      timeoutMs: MODEL_FETCH_TIMEOUT_MS,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.1,
        response_format: { type: 'json_object' }
      })
    });

    if (!response.ok) {
      throw new Error(`Groq API 오류: HTTP ${response.status} ${await response.text()}`);
    }

    const data = await response.json();
    return data?.choices?.[0]?.message?.content || '';
  }

  if (model === 'gpt') {
    const response = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal,
      timeoutMs: MODEL_FETCH_TIMEOUT_MS,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.1,
        response_format: { type: 'json_object' }
      })
    });

    if (!response.ok) {
      throw new Error(`GPT API 오류: HTTP ${response.status} ${await response.text()}`);
    }

    const data = await response.json();
    return data?.choices?.[0]?.message?.content || '';
  }

  if (model === 'gemini') {
    const response = await fetchWithTimeout(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`, {
      method: 'POST',
      signal,
      timeoutMs: MODEL_FETCH_TIMEOUT_MS,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
        tools: [{ googleSearch: {} }]
      })
    });

    if (!response.ok) {
      throw new Error(`Gemini API 오류: HTTP ${response.status} ${await response.text()}`);
    }

    const data = await response.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }

  throw new Error(`지원하지 않는 모델입니다: ${model}`);
}

function classifyPrediction(riskLevel, mediumAs) {
  const risk = String(riskLevel || '').toUpperCase();
  if (risk === 'HIGH') return 1;
  if (risk === 'MEDIUM') return mediumAs === 'benign' ? 0 : 1;
  return 0;
}

function makeRecord({ sample, model, datasetName, result, expected, prediction, correct, raw, systemPrompt, userPrompt }) {
  return {
    rowIndex: sample.rowIndex,
    dataset: datasetName,
    model,
    expectedLabel: expected,
    expectedName: expected === 1 ? 'phishing' : expected === 0 ? 'benign' : 'unknown',
    predictedLabel: prediction,
    predictedName: prediction === 1 ? 'phishing' : 'benign',
    correct,
    riskLevel: result.riskLevel,
    confidence: result.confidence,
    summary: result.summary,
    flaggedChecklist: (result.checklist || []).filter(item => item.flagged),
    indicators: result.indicators || [],
    textPreview: sample.text.slice(0, 500),
    rawResult: result,
    rawResponsePreview: String(raw || '').slice(0, 2000),
    systemPrompt,
    userPrompt
  };
}

function createSummary(base) {
  return {
    ...base,
    total: 0,
    withLabel: 0,
    correct: 0,
    accuracy: null,
    byExpected: { benign: 0, phishing: 0, unknown: 0 },
    byRisk: { LOW: 0, MEDIUM: 0, HIGH: 0 },
    confusion: {
      benignToBenign: 0,
      benignToPhishing: 0,
      phishingToBenign: 0,
      phishingToPhishing: 0
    }
  };
}

function updateSummary(summary, record) {
  summary.total += 1;
  summary.byRisk[record.riskLevel] = (summary.byRisk[record.riskLevel] || 0) + 1;
  summary.byExpected[record.expectedName] = (summary.byExpected[record.expectedName] || 0) + 1;

  if (record.expectedLabel == null) return;

  summary.withLabel += 1;
  if (record.correct) summary.correct += 1;

  if (record.expectedLabel === 0 && record.predictedLabel === 0) summary.confusion.benignToBenign += 1;
  if (record.expectedLabel === 0 && record.predictedLabel === 1) summary.confusion.benignToPhishing += 1;
  if (record.expectedLabel === 1 && record.predictedLabel === 0) summary.confusion.phishingToBenign += 1;
  if (record.expectedLabel === 1 && record.predictedLabel === 1) summary.confusion.phishingToPhishing += 1;
}

function printRecord(index, total, record) {
  const mark = record.correct == null ? '?' : record.correct ? 'OK' : 'MISS';
  const flagged = record.flaggedChecklist
    .map(item => item.text)
    .join(' / ') || '의심 체크리스트 없음';
  const indicators = record.indicators.join(' / ') || '지표 없음';

  console.log(`[${index + 1}/${total}] ${mark} row=${record.rowIndex} expected=${record.expectedName} predicted=${record.riskLevel} confidence=${record.confidence}`);
  console.log(`  요약: ${record.summary || '(없음)'}`);
  console.log(`  의심 항목: ${flagged}`);
  console.log(`  지표: ${indicators}\n`);
}

function printDryRunSample(index, total, sample, userPrompt) {
  console.log(`[${index + 1}/${total}] row=${sample.rowIndex} label=${sample.label}`);
  console.log(userPrompt.slice(0, 1600));
  console.log('\n---\n');
}

function positiveInt(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return fallback;
  return Math.floor(number);
}

function relative(filePath) {
  return path.relative(PROJECT_ROOT, filePath).replace(/\\/g, '/');
}
