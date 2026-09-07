# injury.bot entry and command center

Adapted from `raygalvan/law-bot` main at `3eea173471311b4e9dc73ade8e78d6d847d0377c`:

- `apps/web/app/(chrome)/sign-in/page.tsx` and `apps/web/app/client/sign-in/page.tsx`: separate firm/client entry, framed two-column introduction and form, confirmation state, explicit one-time-link continuation and portal switching.
- `apps/web/app/client-portal.css`: shared entry layout, green/cream palette, serif headings and responsive card layout.
- `apps/web/app/globals.css`, `components/command-center/rail.tsx` and `components/mobile-nav.tsx`: cream command-center rail, branded top bar and five-position mobile navigation. Injury.bot places Human Atlas in the central mobile position.
- `apps/web/app/actions/auth.ts`: remembered email in an HttpOnly cookie, single-use email login and command-center landing. Injury.bot retains its own server sessions and token fragments.

The app is branded injury.bot in sign-in, the workspace header, browser title and access emails. Human Atlas remains the separate pinned anatomical tool.

Firm members enter the command center; clients enter their assigned evidence portal. Workspace navigation has URLs and browser back/forward support. The command center shows actual case counts and selected-case source review, with working links to cases, injury review and the atlas. No agent activity or reconstruction is invented.

The existing `owner` role is displayed as Super admin and retains its existing permissions. The server bootstrap command creates or promotes that role; it does not grant privileges based on a browser-provided email or bypass email verification. Firm isolation remains enforced. A platform-wide cross-firm administration console is not introduced by this adaptation.

Production registration must be run on EC2 against `/var/lib/injury-atlas/atlas.sqlite`, as documented in `deploy/README.md`. A release does not overwrite or seed the live user database. No invitation is automatically sent by deployment or bootstrap; the registered administrator requests the secure link from `/sign-in`.

Law.bot's general practice management, open client self-registration, telephony and agent execution are outside this injury evidence adaptation. The client portal remains invitation-only and evidence-focused.
