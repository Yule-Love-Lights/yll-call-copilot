// Shared shapes for "Seed the Brain" (Wave 1 PR B): the brain_insights
// table (see supabase/migrations/0015_brain_insights.sql), populated either
// by the operator typing a manual insight (POST /api/brain/insights) or by
// the guided interview (src/lib/brain/interview.ts + distillInterview.ts).
// A sibling PR's Brain view reads these rows by lens -- this file is the
// shared contract; that PR's own src/lib/brain/lenses.ts (display labels,
// icons, etc.) builds on top of the InsightLens union here rather than
// redefining it.

export type InsightSource = 'interview' | 'manual';
export type InsightLens = 'market' | 'leads' | 'coaching' | 'general';

export const INSIGHT_LENSES: InsightLens[] = ['market', 'leads', 'coaching', 'general'];

// Row shape for the `brain_insights` table -- only the columns the app
// reads and writes, same convention as playbook/types.ts's VerticalRow.
export type BrainInsightRow = {
  id: string;
  vertical_id: string | null;
  source: InsightSource;
  lens: InsightLens;
  title: string;
  content: string;
  created_by: string | null;
  created_at: string;
};

export function isInsightLens(value: unknown): value is InsightLens {
  return typeof value === 'string' && (INSIGHT_LENSES as string[]).includes(value);
}
