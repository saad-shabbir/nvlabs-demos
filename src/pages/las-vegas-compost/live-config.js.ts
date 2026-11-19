import type { APIRoute } from "astro";

// Writes /las-vegas-compost/live-config.js at build time from environment variables,
// so no keys live in the repo. Both values are public browser keys (Supabase publishable
// key, Mapbox public token); row-level security and Mapbox URL limits protect them.
// With nothing set, live mode shows a "not set up" note and the demo is unaffected.
const env = (name: string): string =>
  ((import.meta.env as Record<string, string | undefined>)[name] ?? process.env[name] ?? "").trim();

export const GET: APIRoute = () => {
  const config = {
    supabaseUrl: env("PUBLIC_SUPABASE_URL"),
    supabaseKey: env("PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
    mapboxToken: env("PUBLIC_MAPBOX_TOKEN"),
    permanentGeocoding: env("PUBLIC_MAPBOX_PERMANENT_GEOCODING") === "true",
  };
  return new Response(`window.LVC_CONFIG = ${JSON.stringify(config)};\n`, {
    headers: { "Content-Type": "text/javascript; charset=utf-8" },
  });
};
