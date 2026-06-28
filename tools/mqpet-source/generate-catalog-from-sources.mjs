import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

const PROJECT_ROOT = new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const CONFIG_PATH = process.env.MQPET_CONFIG_INI ?? 'C:/Users/given/Downloads/Config.ini';
const UNITY_ZIP_PATH = process.env.MQPET_UNITY_ZIP ?? 'C:/Users/given/Downloads/QQpet2.zip';
const OUT = join(PROJECT_ROOT, 'src', 'shared', 'mqpet-catalog-generated.ts');

const MAIN = ['Feeding', 'Function', 'DressUp'];
const SUB = ['Food', 'Daily', 'Medicine', 'Other', 'Toy', 'Stats', 'Background', 'Props'];

function decodeGb18030(buffer) {
  return new TextDecoder('gb18030').decode(buffer);
}

function parseIniSection(text, section) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `[${section}]`);
  if (start < 0) return [];
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^\[[^\]]+\]$/.test(lines[index].trim())) {
      end = index;
      break;
    }
  }
  return lines.slice(start + 1, end).filter((line) => /^\d+=/.test(line));
}

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function parseStatTriple(raw) {
  const parts = raw.split('|').map(numberOrZero);
  return {
    stress: parts[0] ?? 0,
    intelligence: parts[1] ?? 0,
    charm: parts[2] ?? 0,
  };
}

function configIconSource(section, assetId) {
  if (!assetId) return undefined;
  if (section === 'Goods') return `img_res/food/${assetId}.gif`;
  return `img_res/clean/${assetId}.gif`;
}

function parseConfigEntry(section, line) {
  const [indexPart, payload] = line.split('=', 2);
  const fields = payload.split(',');
  const sourceIndex = Number(indexPart);
  const name = fields[0]?.trim() ?? '';
  const price = numberOrZero(fields[1]);
  const value = numberOrZero(fields[3]);
  const stats = parseStatTriple(fields[4] ?? '0');
  const iconAssetId = fields[6]?.trim() || undefined;
  const activeIconAssetId = fields[8]?.trim() || undefined;

  const isGoods = section === 'Goods';
  return {
    id: `${isGoods ? 'goods' : 'wash'}:${sourceIndex}`,
    name,
    main: 'Feeding',
    sub: isGoods ? 'Food' : 'Daily',
    price,
    addHunger: isGoods ? value : 0,
    addCleanliness: isGoods ? 0 : value,
    addHealth: 0,
    addMood: 0,
    addStressResistance: stats.stress,
    addIntelligence: stats.intelligence,
    addCharm: stats.charm,
    addGrowth: 0,
    buffDuration: 0,
    unlockLevel: 1,
    sourceIndex,
    originalSource: isGoods ? 'ConfigGoods' : 'ConfigWash',
    iconAssetId,
    iconSourcePath: configIconSource(section, iconAssetId),
    activeIconAssetId,
    activeIconSourcePath: configIconSource(section, activeIconAssetId),
    description: describeItem({
      addHunger: isGoods ? value : 0,
      addCleanliness: isGoods ? 0 : value,
      addHealth: 0,
      addMood: 0,
      addStressResistance: stats.stress,
      addIntelligence: stats.intelligence,
      addCharm: stats.charm,
      addGrowth: 0,
      buffDuration: 0,
    }),
  };
}

function parseUnityString(raw) {
  if (!raw) return '';
  const trimmed = raw.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

function scalar(text, key, fallback = '') {
  const match = text.match(new RegExp(`^\\s*${key}:\\s*(.*)$`, 'm'));
  return match ? match[1].trim() : fallback;
}

function parseUnityAsset(path) {
  const text = readFileSync(path, 'utf8');
  if (!text.includes('itemName:')) return null;
  const name = parseUnityString(scalar(text, 'itemName'));
  if (!name) return null;
  const main = MAIN[numberOrZero(scalar(text, 'mainCategory'))] ?? 'Feeding';
  const sub = SUB[numberOrZero(scalar(text, 'subCategory'))] ?? 'Other';
  const addHunger = numberOrZero(scalar(text, 'addHunger'));
  const addCleanliness = numberOrZero(scalar(text, 'addCleanliness'));
  const addHealth = numberOrZero(scalar(text, 'addHealth'));
  const addMood = numberOrZero(scalar(text, 'addMood'));
  const addGrowth = numberOrZero(scalar(text, 'addGrowth'));
  const addCharm = numberOrZero(scalar(text, 'addCharm'));
  const buffDuration = numberOrZero(scalar(text, 'buffDuration'));
  const unlockLevel = Math.max(1, numberOrZero(scalar(text, 'unlockLevel', '1')));
  const price = numberOrZero(scalar(text, 'price')) || priceFor({
    addHunger,
    addCleanliness,
    addHealth,
    addMood,
    addStressResistance: 0,
    addIntelligence: 0,
    addCharm,
    addGrowth,
  });
  const description = parseUnityString(scalar(text, 'description')) || describeItem({
    addHunger,
    addCleanliness,
    addHealth,
    addMood,
    addStressResistance: 0,
    addIntelligence: 0,
    addCharm,
    addGrowth,
    buffDuration,
  });

  return {
    id: `unity:${name}`,
    name,
    main,
    sub,
    price,
    addHunger,
    addCleanliness,
    addHealth,
    addMood,
    addStressResistance: 0,
    addIntelligence: 0,
    addCharm,
    addGrowth,
    buffDuration,
    unlockLevel,
    originalSource: 'UnityItemData',
    description,
  };
}

function priceFor(item) {
  const magnitude =
    item.addHunger +
    item.addCleanliness * 2 +
    item.addHealth * 5 +
    item.addMood +
    item.addStressResistance * 50 +
    item.addIntelligence * 50 +
    item.addCharm * 8 +
    item.addGrowth * 10;
  if (item.addHealth >= 40 || item.addCharm >= 60 || item.addGrowth >= 80) return 500;
  if (magnitude >= 3000) return 300;
  if (magnitude >= 800) return 150;
  if (magnitude >= 200) return 80;
  return 50;
}

function describeItem(item) {
  const parts = [];
  if (item.addHunger) parts.push(`饥饿 +${item.addHunger}`);
  if (item.addCleanliness) parts.push(`清洁 +${item.addCleanliness}`);
  if (item.addHealth) parts.push(`健康 +${item.addHealth}`);
  if (item.addMood) parts.push(`心情 +${item.addMood}`);
  if (item.addStressResistance) parts.push(`抗压 +${item.addStressResistance}`);
  if (item.addIntelligence) parts.push(`智力 +${item.addIntelligence}`);
  if (item.addCharm) parts.push(`魅力 +${item.addCharm}`);
  if (item.addGrowth) parts.push(`成长 +${item.addGrowth}`);
  if (item.buffDuration) parts.push(`持续 ${Math.round(item.buffDuration / 3600)} 小时`);
  return parts.join('，');
}

function readUnityItemsFromZip(zipPath) {
  if (!existsSync(zipPath)) return [];
  const temp = mkdtempSync(join(tmpdir(), 'qwicks-qqpet-unity-items-'));
  try {
    execFileSync('tar', ['-xf', zipPath, '-C', temp, 'QQpet2/Assets/Model/Item'], { stdio: 'ignore' });
    const itemDir = join(temp, 'QQpet2', 'Assets', 'Model', 'Item');
    return readdirSync(itemDir)
      .filter((name) => name.endsWith('.asset'))
      .sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
      .map((name) => parseUnityAsset(join(itemDir, name)))
      .filter(Boolean);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

function tsString(value) {
  return JSON.stringify(value);
}

function itemToTs(item) {
  const entries = Object.entries(item)
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([key, value]) => `${key}: ${typeof value === 'string' ? tsString(value) : value}`);
  return `  { ${entries.join(', ')} },`;
}

function main() {
  if (!existsSync(CONFIG_PATH)) {
    throw new Error(`Config.ini not found: ${CONFIG_PATH}`);
  }
  const configText = decodeGb18030(readFileSync(CONFIG_PATH));
  const configItems = [
    ...parseIniSection(configText, 'Goods').map((line) => parseConfigEntry('Goods', line)),
    ...parseIniSection(configText, 'Wash').map((line) => parseConfigEntry('Wash', line)),
  ];
  const unityItems = readUnityItemsFromZip(UNITY_ZIP_PATH);
  const items = [...configItems, ...unityItems];

  const lines = [
    '// AUTO-GENERATED by tools/mqpet-source/generate-catalog-from-sources.mjs - do not edit by hand.',
    `// Sources: ${CONFIG_PATH} and ${UNITY_ZIP_PATH}`,
    '',
    "import type { MqItem } from './mqpet-catalog';",
    '',
    'export const MQ_ITEMS: MqItem[] = [',
    ...items.map(itemToTs),
    '];',
    '',
  ];
  writeFileSync(OUT, `${lines.join('\n')}`, 'utf8');
  console.log(`Wrote ${items.length} MQPet items to ${OUT}`);
  console.log(`Config items: ${configItems.length}; Unity ItemData assets: ${unityItems.length}`);
}

main();
