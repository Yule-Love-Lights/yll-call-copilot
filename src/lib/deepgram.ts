// Deepgram prerecorded transcription for GHL call recordings (Workstream 1,
// see docs/SALES-EXCELLENCE-PLAN.md section 4). isDeepgramConfigured() lets
// the pipeline degrade gracefully -- same convention as
// isSupabaseConfigured() / isHighLevelConfigured() / isClaudeConfigured().
// transcribeRecording() flattens the diarized utterances into
// "Speaker 0:"/"Speaker 1:" turn lines -- the same "label: text" shape
// parse.ts / ringcentral.ts already produce for the existing extraction
// pipeline (src/lib/transcripts/extract.ts) to consume, so extraction needs
// no changes to read a transcript that came from a live call instead of an
// uploaded file.
//
// DEEPGRAM_API_KEY already exists in .env.example (previously used only by
// the standalone live-coaching bridge, scripts/live-bridge.mjs); this module
// is the first place the Next.js app itself reads it.

import { DeepgramClient } from '@deepgram/sdk';

export function isDeepgramConfigured(): boolean {
  return !!process.env.DEEPGRAM_API_KEY;
}

export class DeepgramTranscriptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeepgramTranscriptionError';
  }
}

export type DeepgramUtterance = {
  speaker: number;
  start: number;
  end: number;
  text: string;
};

export type TranscribeResult = {
  rawText: string;
  utterances: DeepgramUtterance[];
  durationSeconds: number;
};

// Pure + exported for tests: turns diarized utterances into the "Label:
// text" line shape ringcentral.ts's raw_text already uses, one line per
// utterance, labeled "Speaker 0" / "Speaker 1" by Deepgram's channel index.
// Never guesses at "Rep:"/"Customer:" labels -- there is no reliable signal
// in a diarization for which numbered speaker is which (the same limitation
// ringcentral.ts documents for its own per-file speaker labels); rep
// identity for a GHL call instead comes from the call's ghl_user_id (ground
// truth), handled separately in src/lib/recordings/pipeline.ts.
export function flattenUtterances(utterances: DeepgramUtterance[]): string {
  return utterances
    .filter(u => u.text.trim().length > 0)
    .map(u => `Speaker ${u.speaker}: ${u.text.trim()}`)
    .join('\n\n');
}

export async function transcribeRecording(audio: Buffer, mimetype: string): Promise<TranscribeResult> {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    throw new DeepgramTranscriptionError('Deepgram not configured. Set DEEPGRAM_API_KEY.');
  }

  const client = new DeepgramClient({ apiKey });

  let response;
  try {
    response = await client.listen.v1.media.transcribeFile(
      { data: audio, contentType: mimetype },
      {
        model: 'nova-3',
        diarize: true,
        utterances: true,
        smart_format: true,
        punctuate: true,
      },
    );
  } catch (err) {
    throw new DeepgramTranscriptionError(`Deepgram transcription request failed: ${(err as Error).message ?? err}`);
  }

  if (!('results' in response)) {
    // The async (callback) response shape -- never expected here since we
    // never pass a `callback` option, but guarded rather than assumed away.
    throw new DeepgramTranscriptionError('Deepgram returned an async-accepted response instead of a transcript.');
  }

  const utterances: DeepgramUtterance[] = (response.results.utterances ?? []).map(u => ({
    speaker: u.speaker ?? 0,
    start: u.start ?? 0,
    end: u.end ?? 0,
    text: (u.transcript ?? '').trim(),
  }));

  return {
    rawText: flattenUtterances(utterances),
    utterances,
    // Deepgram reports fractional seconds (e.g. 96.23994); the
    // transcripts.duration_seconds column is an integer, so round here at
    // the source rather than in every consumer.
    durationSeconds: Math.round(response.metadata.duration ?? 0),
  };
}
