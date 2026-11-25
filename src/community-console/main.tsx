import { communityConsoleDestination } from "./entry.ts";

// Old bookmarks are compatibility entries only. The community keeps its one
// existing management UI, account flow, permissions and content renderer.
window.location.replace(
  communityConsoleDestination(window.location.hash, window.location.search),
);
