import { unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { createReaderWorkflow } from './reader-workflow.ts';

export type CleanupPayload = { find?: (options: { collection: 'readers'; limit: 1; depth: 0; where: { avatar: { equals: string } } }) => Promise<unknown> };
type CleanupOptions = { workflow: ReturnType<typeof createReaderWorkflow>; payload: CleanupPayload; directory: string; ids?: string[] | null; limit?: number };
export async function cleanReaderFiles({ workflow, payload, directory, ids = null, limit = 100 }: CleanupOptions) {
  const selected = ids ? new Set(ids) : null;
  const entries = workflow.cleanupFiles(limit).filter(row => !selected || selected.has(row.id));
  const result = { cleaned: 0, failed: 0, protected: 0 };
  for (const row of entries) {
    const id = row.filename.match(/[0-9a-f-]{36}(?=\.webp$)/)?.[0];
    if (!id) { workflow.fileFailed(row.id, '文件名无效'); result.failed++; continue; }
    const active = row.filename.startsWith('reader-avatar-')
      ? ((await payload.find!({ collection: 'readers', limit: 1, depth: 0, where: { avatar: { equals: id } } })) as { totalDocs: number }).totalDocs > 0
      : Boolean(workflow.profileByAvatar(id));
    if (active) { workflow.fileFailed(row.id, '仍被当前资料引用'); result.protected++; continue; }
    try {
      await unlink(resolve(directory, 'uploads', row.filename));
      workflow.fileCleaned(row.id); result.cleaned++;
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') { workflow.fileCleaned(row.id); result.cleaned++; }
      else { workflow.fileFailed(row.id, error instanceof Error ? error.message : String(error)); result.failed++; }
    }
  }
  return result;
}
