do $migration$
declare fn text; old_text text; new_text text;
begin
 fn:=pg_get_functiondef('public.create_merchant_product_offer(uuid,text,integer,integer,text,text,text,jsonb,jsonb)'::regprocedure);
 old_text:=$old$or image_url is null or image_url not like 'https://%'$old$;
 new_text:=$new$or image_url is distinct from ('https://nagzoafkitfsqlcwsdau.supabase.co/storage/v1/object/public/product-media/' || image_path)$new$;
 if position(old_text in fn)=0 then raise exception 'create_product_image_url_guard_not_found'; end if;
 execute replace(fn,old_text,new_text);

 fn:=pg_get_functiondef('public.add_merchant_product_image(uuid,text,text)'::regprocedure);
 old_text:=$old$_image_url not like '%/storage/v1/object/public/product-media/' || _image_path$old$;
 new_text:=$new$_image_url is not distinct from ('https://nagzoafkitfsqlcwsdau.supabase.co/storage/v1/object/public/product-media/' || _image_path)$new$;
 if position(old_text in fn)=0 then raise exception 'add_product_image_url_guard_not_found'; end if;
 execute replace(fn,old_text,new_text);

 fn:=pg_get_functiondef('public.update_merchant_product_offer(uuid,uuid,integer,integer,jsonb,boolean)'::regprocedure);
 old_text:=$old$or coalesce(jsonb_array_length(case when jsonb_typeof(_options->'colors')='array' then _options->'colors' else '[]'::jsonb end),0)>20
 ) then raise exception 'invalid_merchant_product_options'; end if;$old$;
 new_text:=$new$or coalesce(jsonb_array_length(case when jsonb_typeof(_options->'colors')='array' then _options->'colors' else '[]'::jsonb end),0)>20
  or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(_options->'sizes')='array' then _options->'sizes' else '[]'::jsonb end) item
    where jsonb_typeof(item)<>'string' or char_length(btrim(item#>>'{}'))=0 or char_length(btrim(item#>>'{}'))>40)
  or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(_options->'colors')='array' then _options->'colors' else '[]'::jsonb end) item
    where jsonb_typeof(item)<>'string' or char_length(btrim(item#>>'{}'))=0 or char_length(btrim(item#>>'{}'))>40)
 ) then raise exception 'invalid_merchant_product_options'; end if;$new$;
 if position(old_text in fn)=0 then raise exception 'update_product_options_guard_not_found'; end if;
 execute replace(fn,old_text,new_text);
end
$migration$;