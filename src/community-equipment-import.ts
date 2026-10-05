import { communityNameEffect } from './community-rules.mjs';
import type { NameEffect } from './community-rules.mjs';

export const NAME_EFFECT_FILE_MAX_BYTES = 64 * 1024;

function objectValue(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireKeys(value: Record<string, unknown>, expected: readonly string[]): void {
  const keys = Object.keys(value);
  if (keys.length !== expected.length || keys.some(key => !expected.includes(key))) {
    throw new Error('昵称特效文件的字段不符合格式，不能包含脚本、CSS 或其他配置。');
  }
}

/** Import data only; the existing item-save endpoint validates the resulting effect again. */
export async function readNameEffectFile(file: File): Promise<NameEffect> {
  if (!/\.json$/i.test(file.name)) throw new Error('请拖入昵称特效 JSON 文件。');
  if (file.size > NAME_EFFECT_FILE_MAX_BYTES) throw new Error('昵称特效文件不能超过 64 KB。');

  let bytes: ArrayBuffer;
  try {
    bytes = await file.arrayBuffer();
  } catch {
    throw new Error('读取昵称特效文件失败，请重新选择文件。');
  }
  if (bytes.byteLength > NAME_EFFECT_FILE_MAX_BYTES) throw new Error('昵称特效文件不能超过 64 KB。');

  let content: string;
  try {
    content = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
  } catch {
    throw new Error('昵称特效文件必须使用 UTF-8 编码。');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error('昵称特效文件不是有效的 JSON，不能导入脚本、CSS 或 HTML。');
  }
  if (!objectValue(parsed)) throw new Error('昵称特效文件格式不正确。');

  let configuration: unknown = parsed;
  if (['format', 'version', 'effect'].some(key => Object.hasOwn(parsed, key))) {
    requireKeys(parsed, ['format', 'version', 'effect']);
    if (parsed.format !== 'sansphase-name-effect') throw new Error('这个文件不是支持的昵称特效格式。');
    if (parsed.version !== 1) throw new Error('这个昵称特效文件的版本不受支持。');
    configuration = parsed.effect;
  }
  if (!objectValue(configuration)) throw new Error('昵称特效配置格式不正确。');
  requireKeys(configuration, ['style', 'colors']);
  const effect = communityNameEffect(configuration);
  if (!effect) throw new Error('昵称特效的样式或颜色不正确，仅支持单色、渐变和流光以及六位十六进制颜色。');
  return effect;
}
