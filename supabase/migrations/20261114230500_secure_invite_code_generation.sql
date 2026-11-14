-- Replace the non-cryptographic invite-code PRNG with pgcrypto randomness.
-- Preserve the public code format and serialize generation to avoid collisions.
begin;

create or replace function public.generate_arownd_referral_code()
returns text
language plpgsql
volatile
set search_path = ''
as $function$
declare
  random_bytes bytea;
  random_value bigint;
  code_index integer;
  pair_index integer;
  digit_index integer;
  rejection_limit bigint := (4294967296 / 6760000) * 6760000;
  generated_code text;
begin
  perform pg_catalog.pg_advisory_xact_lock(731904218);

  loop
    random_bytes := extensions.gen_random_bytes(4);
    random_value :=
        pg_catalog.get_byte(random_bytes, 0)::bigint * 16777216
      + pg_catalog.get_byte(random_bytes, 1)::bigint * 65536
      + pg_catalog.get_byte(random_bytes, 2)::bigint * 256
      + pg_catalog.get_byte(random_bytes, 3)::bigint;

    -- Rejection sampling avoids modulo bias over the 6,760,000 valid codes.
    exit when random_value < rejection_limit;
  end loop;

  code_index := (random_value % 6760000)::integer;
  pair_index := code_index / 10000;
  digit_index := code_index % 10000;

  generated_code :=
      'AR-INVITE-'
    || pg_catalog.chr(65 + pair_index / 26)
    || pg_catalog.chr(65 + pair_index % 26)
    || '-'
    || pg_catalog.lpad(digit_index::text, 4, '0');

  return generated_code;
end;
$function$;

revoke all on function public.generate_arownd_referral_code() from public, anon;
grant execute on function public.generate_arownd_referral_code() to authenticated;

comment on function public.generate_arownd_referral_code() is
'Generates unique Arownd Invite codes in the AR-INVITE-XX-0000 format using pgcrypto secure randomness and unbiased sampling.';

commit;
