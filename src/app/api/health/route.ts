// GET /api/health — connection status for the dashboard's health panel.
// Only ever reports whether each integration is configured, never the env
// values themselves.

import { NextResponse } from 'next/server';
import { isHighLevelConfigured } from '@/lib/ghl/client';
import { isSupabaseConfigured } from '@/lib/supabase';
import { isClaudeConfigured } from '@/lib/claude';
import packageJson from '../../../../package.json';

export async function GET() {
  return NextResponse.json({
    ghl: isHighLevelConfigured(),
    supabase: isSupabaseConfigured(),
    claude: isClaudeConfigured(),
    version: packageJson.version,
  });
}
