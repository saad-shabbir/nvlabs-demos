# Demo website system

You are building and running a demo-website system. Saad contacts local businesses that don't have websites and sends them a link to a demo site built for them. Each demo lives at demo.nvlabs.co/<business-name>.

## Setup
- This is an Astro static site in the private GitHub repo nvlabs-demos. The repo is the only place the project lives: pull it at the start of every job and push when you finish, since the computer may reset between jobs.
- The GitHub token is stored only at /home/box/.config/nvlabs/github_token (mode 600). Never commit it, never print it, never put it in this file.
- Saad connects the repo to Cloudflare Pages himself so every push deploys automatically. Do not ask for his Cloudflare login.
- demo.nvlabs.co itself is a plain NV Labs page that does not list any of the businesses.
- Reread this file at the start of every job.

## Every demo site
- Before designing, look at a few really good websites of businesses like this one and follow what makes them work: layout, page structure, how they show their menu or services, where the buttons go. Borrow their UX freely, but don't copy their text, photos, logos, or code. Each demo should look like a real business's website, not a template or a generic AI site.
- Phone first, since most owners will open the link on their phone. Tap-to-call, directions, and order/booking buttons must all work.
- Only use information Saad gives you. Never make up prices, hours, reviews, or facts. Leave out any section you don't have info for.
- Slim banner at the top: "Demo site built for <Business Name> by Saad Shabbir. Want it live? Call or text (501) 413-3386." Make the number tap-to-call (tel:+15014133386).
- Keep demos out of Google with a noindex meta tag and an X-Robots-Tag: noindex header (public/_headers), but don't block crawlers in robots.txt.
- Add link-preview tags (Open Graph and Twitter) so the link shows the business name and photo when texted.
- If a business has an expiry date, after that date the page shows only: "This demo has expired. Contact Saad Shabbir at (501) 413-3386." Implement this with an inline script in the head so it works on a static host without a rebuild.
- Check the finished page at phone size before you push.

## New business command
When Saad says "New Business: [name]":
1. Ask him to paste everything he has on them. It will be messy and repetitive (copied from Instagram, Facebook, Google, and AI research), sometimes across several messages. Clean it up yourself. If details conflict, trust the business's own posts and tell him what conflicted.
2. Ask for photos. He will attach them or send a Google Drive link. Pick the logo and the best main photo yourself, and skip blurry shots and screenshots with app buttons on them.
3. Build it, push it, and send him the live link plus anything he should double-check.
He might give several businesses at once. Handle them all and send all the links together.

Slug rule: business-name in the URL is a lowercase hyphenated slug of the business name.
