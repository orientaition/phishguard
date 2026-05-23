#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BACKGROUND_PATH = path.join(PROJECT_ROOT, 'src', 'background.js');
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'eval-results');
const GEMINI_MODEL = 'gemini-3.1-flash-lite-preview';

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

  await runEvaluation(args, createCliReporter());
}

export async function runEvaluation(args = {}, reporter = {}) {
  const report = createReporter(reporter);
  const model = String(args.model || 'gemini').toLowerCase();
  const datasetName = String(args.dataset || 'texts');
  const limit = positiveInt(args.limit, 12);
  const offset = positiveInt(args.offset, 0);
  const delayMs = positiveInt(args.delay, 700);
  const bodyLimit = positiveInt(args.bodyLimit, 3000);
  const mediumAs = String(args.mediumAs || 'phishing').toLowerCase();
  const dryRun = Boolean(args.dryRun);
  const balanced = args.balanced !== false;

  throwIfAborted(report.signal);
  const promptTools = await loadCurrentPromptTools();
  const env = await loadEnv();
  const apiKey = dryRun ? '' : getApiKey(model, env);
  const rows = await loadRows(args, datasetName, report.signal);
  const samples = selectSamples(rows, { limit, offset, balanced });

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
    mediumAs,
    startedAt: startedAt.toISOString()
  });
  const records = [];
  const dryRunSamples = [];

  report.log(`현재 background.js 프롬프트로 ${samples.length}개 샘플을 평가합니다.`);
  report.log(`데이터셋: ${datasetName}, 모델: ${model}${dryRun ? ', dry-run' : ''}`);

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

    if (i < samples.length - 1 && delayMs > 0) {
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
  --no-balanced                 label 0/1 균형 샘플링을 끕니다.
  --delay MS                    API 호출 간 대기 시간입니다. 기본값은 700입니다.
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

async function loadRows(args, datasetName, signal) {
  let raw;
  let source;

  if (args.local) {
    source = path.resolve(PROJECT_ROOT, String(args.local));
    raw = await fs.readFile(source, 'utf8');
  } else {
    source = args.source || DATASET_URLS[datasetName];
    if (!source) {
      throw new Error(`알 수 없는 dataset 값입니다: ${datasetName}`);
    }
    const response = await fetch(source, { signal });
    if (!response.ok) {
      throw new Error(`데이터셋 다운로드 실패: HTTP ${response.status}`);
    }
    raw = await response.text();
  }

  const parsed = parseJsonOrJsonl(raw);
  return extractRows(parsed)
    .map((row, rowIndex) => normalizeDatasetRow(row, rowIndex))
    .filter(row => row.text);
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

function selectSamples(rows, { limit, offset, balanced }) {
  const safeRows = rows.slice(offset);

  if (!balanced) {
    return safeRows.slice(0, limit);
  }

  const phishing = safeRows.filter(row => normalizeExpected(row.label) === 1);
  const benign = safeRows.filter(row => normalizeExpected(row.label) === 0);

  if (phishing.length === 0 || benign.length === 0) {
    return safeRows.slice(0, limit);
  }

  const result = [];
  const perLabel = Math.ceil(limit / 2);
  const max = Math.max(perLabel, limit - perLabel);

  for (let i = 0; i < max && result.length < limit; i += 1) {
    if (benign[i]) result.push(benign[i]);
    if (result.length < limit && phishing[i]) result.push(phishing[i]);
  }

  return result.slice(0, limit);
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
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      signal,
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
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal,
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
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`, {
      method: 'POST',
      signal,
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
