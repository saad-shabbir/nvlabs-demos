# Route app data (Supabase + Mapbox)

The Las Vegas Compost page (`/las-vegas-compost/`) is still the sample-data demo. Add `?live`
to the address (`/las-vegas-compost/?live`) to use the real app: sign in by email code, and
everything saves to Supabase.

## Supabase

- Org **NV Labs**, project **las-vegas-compost** (`avcyluflyjvmklnqqjva`, West US, Pro plan).
- `migrations/20261118000000_route_app_multi_business.sql` is the schema. It is already applied.
- `seed_las_vegas_compost.sql` created the first business (Las Vegas Compost, its facility and
  Yusuf as the owner-driver). It is already applied.

Built for many businesses: every table has `business_id`, and row-level security only lets
signed-in members of a business read or change its rows.

| Role | Can do |
| --- | --- |
| owner, admin | everything in their business |
| driver | read their business; update the routes and stops assigned to them; add texts and finished-route records |
| signed out | nothing |

Stop photos go to the private `stop-photos` storage bucket, one folder per business.

### Adding people

Owners add logins in the app: **Drivers** page, **Logins**, **Add a login** (email, owner or
driver, and which driver they are). That writes a row to `business_invites`, which turns into a
membership the first time that email signs in.

Sign-in codes are emailed by Supabase Auth. Its built-in sender only delivers to members of the
NV Labs Supabase organization (and only a few emails an hour), so anyone else gets "Email address
not authorized" until a custom SMTP sender (for example Resend) is set under Authentication >
SMTP Settings.

Or add an invite in the SQL editor:

```sql
insert into public.business_invites (business_id, email, role, driver_id)
select id, 'someone@example.com', 'driver', 'd1' from public.businesses where slug = 'las-vegas-compost';
```

`driver_id` is optional and links the login to a driver on the Drivers page.

### A new business later

Insert a row in `businesses` (with a new `slug`), a `facilities` row and an owner invite, the
same way the seed file does. Open the app with `?live=<slug>`.

### Practice mode and walkthroughs

`?live&practice` opens the driver app on the sample customers with no sign-in: nothing is saved,
uploaded or texted. `tour.js` has two walkthroughs that highlight the real buttons and wait for a
tap: a new-driver one (runs in practice mode) and an owner one (makes a TEST route and drives it).
The menu opens by itself the first time the live app opens on a device, and from **Tutorial** in
the top bar after that.

## Keys (never in the repo)

`src/pages/las-vegas-compost/live-config.js.ts` writes `/las-vegas-compost/live-config.js` at
build time from these environment variables. Locally they go in `.env` (git-ignored, see
`.env.example`); in Cloudflare they are build variables.

| Variable | Value |
| --- | --- |
| `PUBLIC_SUPABASE_URL` | `https://avcyluflyjvmklnqqjva.supabase.co` |
| `PUBLIC_SUPABASE_PUBLISHABLE_KEY` | the `sb_publishable_…` key from Settings > API Keys |
| `PUBLIC_MAPBOX_TOKEN` | a Mapbox public token (`pk.…`), ideally limited to demo.nvlabs.co |
| `PUBLIC_MAPBOX_PERMANENT_GEOCODING` | `true` once Mapbox has a card on file (see below) |

Both keys are meant to be public in a browser. Never use the Supabase secret or service-role key here.

## Mapbox

Used only in live mode:

- **Address lookup** when a customer is added, edited or imported, and for a driver's home start.
- **Drive-time stop order** for routes that haven't started (Matrix API), on top of the page's
  own straight-line order.
- **Road miles** for the mileage log when a route is finished, and the route line on the map (Directions API).
- **Maps** on the route pages (Mapbox GL JS).

Mapbox's terms ask for "permanent" geocoding when coordinates are stored, which is what the app
does. Permanent geocoding needs a card on the Mapbox account; until then the app uses the
standard lookup. Set `PUBLIC_MAPBOX_PERMANENT_GEOCODING=true` after adding a card.
