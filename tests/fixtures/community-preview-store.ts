import { createCommunityStore } from '../../server/community-store.ts';

// Tests that exercise the local sample products opt in deliberately. Formal
// runtime tests use createCommunityStore directly and receive no sample sales.
export const createCommunityPreviewStore = (directory: string) => createCommunityStore(directory, { previewCatalog: true });
