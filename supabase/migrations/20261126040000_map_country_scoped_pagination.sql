drop function if exists public.fetch_map_stores_in_view(
  double precision, double precision, double precision, double precision,
  double precision, double precision, uuid, integer
);

create function public.fetch_map_stores_in_view(
  p_west double precision,
  p_south double precision,
  p_east double precision,
  p_north double precision,
  p_center_lat double precision,
  p_center_long double precision,
  p_include_store_id uuid default null,
  p_limit integer default 1000,
  p_country_code text default null,
  p_offset integer default 0
)
returns table (
  id uuid,
  name text,
  logo_url text,
  commune text,
  address_line text,
  latitude double precision,
  longitude double precision,
  is_verified boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    s.id, s.name, s.logo_url, s.commune, s.address_line,
    s.latitude, s.longitude, s.is_verified
  from public.stores as s
  where
    s.country_code = upper(btrim(p_country_code))
    and s.latitude is not null
    and s.longitude is not null
    and (
      (
        s.latitude between p_south and p_north
        and (
          (p_west <= p_east and s.longitude between p_west and p_east)
          or (p_west > p_east and (s.longitude >= p_west or s.longitude <= p_east))
        )
      )
      or (p_include_store_id is not null and s.id = p_include_store_id)
    )
    and p_country_code ~ '^[A-Za-z]{2}$'
    and p_west between -180 and 180
    and p_east between -180 and 180
    and p_south between -90 and 90
    and p_north between -90 and 90
    and p_south <= p_north
    and p_center_lat between -90 and 90
    and p_center_long between -180 and 180
    and p_offset >= 0
  order by
    case when s.id = p_include_store_id then 0 else 1 end,
    power(s.latitude - p_center_lat, 2)
      + power((s.longitude - p_center_long) * cos(radians(p_center_lat)), 2),
    s.id
  limit least(greatest(coalesce(p_limit, 1000), 1), 1000)
  offset p_offset;
$$;

revoke all on function public.fetch_map_stores_in_view(
  double precision, double precision, double precision, double precision,
  double precision, double precision, uuid, integer, text, integer
) from public, anon;

grant execute on function public.fetch_map_stores_in_view(
  double precision, double precision, double precision, double precision,
  double precision, double precision, uuid, integer, text, integer
) to authenticated;
