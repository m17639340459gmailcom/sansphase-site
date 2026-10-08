import {
  Bot, Brain, Cpu, Workflow, Code, Lightbulb, BookOpen, FlaskConical,
  Database, Mic, Video, Palette, Network, Compass, WandSparkles, Wrench,
  CircleHelp, Image, Box, Feather, Megaphone, Coffee, type IconNode,
} from 'lucide';
import type { CommunityBoardIconId } from './community-board-icons.ts';

// The existing Lucide node renderer is reused by the main UI and separately
// bundled layout. There is no new SVG engine or external image request.
export const communityBoardDrawings = {
  help: CircleHelp, image: Image, box: Box, feather: Feather, megaphone: Megaphone, coffee: Coffee,
  bot: Bot, brain: Brain, cpu: Cpu, workflow: Workflow, code: Code, lightbulb: Lightbulb,
  'book-open': BookOpen, flask: FlaskConical, database: Database, mic: Mic, video: Video,
  palette: Palette, network: Network, compass: Compass, wand: WandSparkles, wrench: Wrench,
} satisfies Record<CommunityBoardIconId, IconNode>;
