// Plain deterministic message templates for the two sendable touch kinds
// (reveal_photo -> crew, cold_snap_checkin -> customer). No Claude call here
// on purpose (AGENTS spec point 5) -- these are simple, testable functions;
// POST /api/second-mile/[id]/draft just calls one of these and saves the
// result onto the touch's payload.

export function draftRevealPhotoCrewMessage(input: { address: string | null; customerName: string | null }): string {
  const where = input.address ? `at ${input.address}` : 'at tonight\'s install';
  const whose = input.customerName ? ` (${input.customerName})` : '';
  return `Reveal shot time: get the reveal shot tonight ${where}${whose} before you head out. Nice and lit, straight on if you can.`;
}

export function draftColdSnapCheckinMessage(input: { customerName: string | null }): string {
  const greeting = input.customerName ? `Hi ${input.customerName},` : 'Hi there,';
  return `${greeting} first real cold snap of the season is here. Just checking in, everything still looking good out front? Reply here anytime if a section needs a look, we've got you.`;
}
