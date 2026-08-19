do $verify$
begin
  if not (
    select commitment_extraction_attempts = 2
      and commitment_extraction_terminal_failures = 2
      and commitment_extraction_quarantined_at is null
      and commitments_extracted_at is null
    from public.transcripts
    where id = '24000000-0000-4000-8000-000000000302'
  ) then
    raise exception 'concurrent failures did not increment the locked state exactly twice';
  end if;
end
$verify$;
