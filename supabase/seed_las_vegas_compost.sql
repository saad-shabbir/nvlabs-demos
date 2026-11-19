-- First business: Las Vegas Compost. Run once after the migration.
-- Facility and owner details are the same ones the demo page shows.
with b as (
  insert into public.businesses (slug, name, settings) values (
    'las-vegas-compost', 'Las Vegas Compost',
    jsonb_build_object(
      'reminderOn', true, 'reminderTime', '19:00', 'onTheWay', 'next',
      'templates', jsonb_build_object(
        'reminder', 'Hi {first_name}, this is Las Vegas Compost. Tomorrow is your pickup day! Please have your bucket out by 7 AM. Thank you for composting with us.',
        'onway', 'Hi {first_name}, {driver_name} from Las Vegas Compost is on the way to you now. Please make sure your bucket is out.',
        'serviced', 'Your compost bucket has been picked up and swapped for a clean one. Photo: {photo_link}',
        'dropoff', 'Welcome to Las Vegas Compost, {first_name}! Your new bucket has been dropped off. Photo: {photo_link}',
        'final', 'We picked up your final bucket today. Thank you for composting with Las Vegas Compost, {first_name}! Photo: {photo_link}'
      )
    )
  )
  on conflict (slug) do update set name = excluded.name
  returning id
), f as (
  insert into public.facilities (business_id, id, name, short_name, address, city, lat, lng)
  select id, 'f1', 'Terra Firma Organics', 'Terra Firma', '5355 Beesley Dr', 'Las Vegas, NV 89115', 36.25775, -115.03873 from b
  on conflict do nothing
)
insert into public.drivers (business_id, id, name, phone, color, is_owner, start, sort_order)
select id, 'd0', 'Yusuf', '(949) 873-0720', '#2C6B3E', true, '{"kind":"facility"}'::jsonb, 0 from b
on conflict do nothing;
