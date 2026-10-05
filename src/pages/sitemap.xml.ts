import type { APIRoute } from "astro";

export const GET: APIRoute = () => {
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://demo.nvlabs.co/</loc>
  </url>
  <url>
    <loc>https://demo.nvlabs.co/bakery-website-design/</loc>
  </url>
  <url>
    <loc>https://demo.nvlabs.co/las-vegas-bakery-website/</loc>
  </url>
  <url>
    <loc>https://demo.nvlabs.co/panaderia-website/</loc>
  </url>
  <url>
    <loc>https://demo.nvlabs.co/mobile-mechanic-website/</loc>
  </url>
  <url>
    <loc>https://demo.nvlabs.co/houston-mobile-mechanic-website/</loc>
  </url>
  <url>
    <loc>https://demo.nvlabs.co/las-vegas-barbershop-website/</loc>
  </url>
  <url>
    <loc>https://demo.nvlabs.co/instagram-only-business-website/</loc>
  </url>
  <url>
    <loc>https://demo.nvlabs.co/free-website-demo/</loc>
  </url>
  <url>
    <loc>https://demo.nvlabs.co/las-vegas-landscaper-website/</loc>
  </url>
  <url>
    <loc>https://demo.nvlabs.co/ice-cream-shop-website/</loc>
  </url>
  <url>
    <loc>https://demo.nvlabs.co/dallas-bakery-website/</loc>
  </url>
  <url>
    <loc>https://demo.nvlabs.co/henderson-barbershop-website/</loc>
  </url>
  <url>
    <loc>https://demo.nvlabs.co/facebook-only-business-website/</loc>
  </url>
  <url>
    <loc>https://demo.nvlabs.co/las-vegas-food-truck-website/</loc>
  </url>
  <url>
    <loc>https://demo.nvlabs.co/las-vegas-nail-salon-website/</loc>
  </url>
  <url>
    <loc>https://demo.nvlabs.co/las-vegas-mobile-detailing-website/</loc>
  </url>
</urlset>
`;
  return new Response(body, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
    },
  });
};
