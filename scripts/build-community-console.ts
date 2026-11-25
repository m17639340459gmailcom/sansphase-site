import { buildManagementConsole } from './build-management-console.ts';

// Local first: this builder is deliberately not called by the live site build
// until the community console has completed its own acceptance and integration.
export function buildCommunityConsole(outputRoot: string, { preview = false }: { preview?: boolean } = {}) {
  return buildManagementConsole('community-console', outputRoot, preview);
}
