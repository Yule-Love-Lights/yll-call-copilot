do $verify$
begin
  if (
    select count(*)
    from public.call_commitments
    where transcript_id = '24000000-0000-4000-8000-000000000301'
  ) <> 1 then
    raise exception 'concurrent extraction changed the finalized commitment set';
  end if;

  if (
    select commitment_extracted_count
    from public.transcripts
    where id = '24000000-0000-4000-8000-000000000301'
  ) <> 1 then
    raise exception 'concurrent extraction changed the finalized marker count';
  end if;

  if (
    select commitment_extractor_version
    from public.transcripts
    where id = '24000000-0000-4000-8000-000000000301'
  ) <> 'concurrency-session-1' then
    raise exception 'concurrent extraction replaced the winning extractor version';
  end if;

  if (
    select commitment_extraction_attempts
    from public.transcripts
    where id = '24000000-0000-4000-8000-000000000301'
  ) <> 0 then
    raise exception 'a failure racing after finalization mutated attempt state';
  end if;
end
$verify$;
