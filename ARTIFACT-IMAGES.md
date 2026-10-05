# Images in Artifacts

**The question:** what would it take to support the store and render of images
from our side — core's `Artifacts` — so a consumer keeps generated images there
instead of a Durable Object of its own? First consumer: the Slack gatekeeper's
agent avatars.

**The answer, short:** one PR in core, and nothing in `g2a-protocol`. An entry
gains an optional `media` descriptor beside its text; the bytes go in a BLOB
table in the object that already holds the artifact; a third route under the
same `/a/<token>/` prefix serves them with the stored content type and a cache
that cannot outlive the artifact; the viewer renders a media entry as an `<img>`
whose `src` it derives from `location.pathname` the way it already derives the
stream URL. The token stays the only credential, retention stays as it is, and
every text artifact in the train is untouched.

The one thing core cannot answer is whether an avatar may be deleted after
thirty days. That is the first open question below, and it is the only one that
could change the shape of the work rather than a number in it.

---

## 1. What is there today

Verified by reading, not remembered. Every claim below cites the line.

`core/src/artifacts/` is **text-only, and nothing in it has a concept of a
content type.** `grep -rni "mime|content-type|image|blob|png|jpeg|binary"
core/src/artifacts --include=*.ts` finds no mime, image or blob concept at all,
and the only content types are the two the directory serves itself:
`text/event-stream` (`do.ts:319`) and `text/html` (`viewer.ts:219`).

| module | what it owns |
| ------ | ------------ |
| `store.ts` | the tables, the token, the queries, the retention sweep, the schema version |
| `do.ts` | `Artifacts` — the RPC ingest door, the SSE read door, the watcher seating |
| `route.ts` | `handleArtifactRoute`, the one delegation a Worker's `fetch` makes |
| `viewer.ts` | the page at `/a/<token>`, one inline string, no asset pipeline |
| `path.ts` | the URL grammar all three readers share, and the link helper |
| `events.ts` | the SSE event names, the frame spelling, `Last-Event-ID` parsing |
| `transcript.ts` | the `session-transcript` kind, and core's own emission into it |
| `label.ts` | how a sub-agent note is attributed |
| `binding.ts` | the required `ARTIFACTS` binding, the well-known object name, the named wiring fault |
| `approval.ts` | `fileApproval` — a person's answer, filed on the artifact it was about |
| `index.ts` | the `@dynamicagents/core/artifacts` subpath |

### The model

An artifact is a **kind**, a **token**, an append-only list of **labelled
notes**, and a **settle status** (`do.ts:22-29`). An entry is
`{ sequence, label, text, at }` (`store.ts:55-64`) stored as
`artifact_entries(token, sequence, entry_key, label, body TEXT NOT NULL,
created_at)` (`store.ts:137-145`). `append` takes
`{ label, text, key? }` (`store.ts:93-108`), dedupes on `entry_key` before it
checks the lock (`store.ts:420-432`), and numbers from `MAX(sequence) + 1`
(`store.ts:434-439`).

The **token is the id and the authorization both**: forty symbols over a
sixty-two-symbol alphabet, from `crypto.getRandomValues`, derived from nothing
(`store.ts:20-53`). Reads are the token and nothing else checks anything
(`do.ts:31-43`). Ingest is RPC through the binding — **there is no HTTP route
that writes** (`do.ts:33-38`).

`parseArtifactPath` matches two routes under `/a/` and declines everything else,
including a well-formed path carrying a token this package could not have minted
(`path.ts:26,40-50`). `handleArtifactRoute` is GET-only (`route.ts:43`), serves
the page from a string without consulting the object (`route.ts:53`), and
forwards anything else it matched to the stub (`route.ts:55`).

Retention is `ARTIFACT_RETENTION_MS = 30 days` (`store.ts:18`), swept lazily on
every `open` and `append` (`store.ts:375-383, 392, 416`), never on an alarm
(`do.ts:51-58`). The sweep is two DELETEs: the entries of every artifact past
the cutoff, then the artifacts.

The store carries a **schema version**, currently 2 (`store.ts:158`), with one
`if (from < n)` per version in `upgrade` (`store.ts:171-174`). The rule that
makes it work is stated at `store.ts:163-170`: **`DDL` stays frozen at version
1**, so a store that has never been opened arrives at 0 and runs every step — a
column written into both the `CREATE TABLE` and a step is added twice on a fresh
store, and the `ALTER TABLE` is what fails.

### Every consumer of an artifact in this train

- **core, approvals.** `ask_user` takes an optional `artifact` id
  (`agent/tools.ts:41-45`); `mayAskApproval` admits any artifact of the
  deployment that is still open (`agent/agent.ts:782-785`); `#approval` builds
  the `HitlRequestData` with `artifact: { id, url }` and puts the viewer URL in
  the prompt too (`agent/agent.ts:747-770`); the answer is filed by
  `fileApproval`, which locks on approve (`artifacts/approval.ts:15-26`,
  `agent/agent.ts:517-528`).
- **core, transcripts.** `transcribeNote` opens the artifact keyed on the task
  id, appends the note, and posts the link until a post lands
  (`transcript.ts:91-127`); `settleTranscript` ends it in the task's state
  (`transcript.ts:143-164`).
- **starter, plans.** `PLAN_KIND`/`PLAN_LABEL`, `createPlan`, `lookUpPlan` and
  `latestPlan` in `starter/src/agents/anthropic-coding/plans.ts:22, 29, 307-330, 335-337`.
  These are the reads that constrain the design: `lookUpPlan` calls
  `readArtifact(id)` and hands back `artifact.entries` whole (`:327, 330`), and
  `latestPlan` reads `page[at]!.text` off the last entry carrying the plan label
  (`:337`). `children.ts:449-473, 678, 703` reads
  and appends the same way. `starter/src/index.ts:97` mounts
  `handleArtifactRoute` in front of the A2A router.
- **g2a-protocol, the wire.** `HitlArtifact` is `{ id, url }` and nothing more
  (`g2a-protocol/src/hitl.ts:70-78`), carried as `HitlRequestData.artifact`
  (`hitl.ts:98-103`). A gatekeeper has no use for the id and **links** the url
  rather than fetching it.
- **plugins.** No reference to artifacts at all.

Nothing in the train narrows `ArtifactRoute`, and no `AGENTS.md` in the
workspace or in any submodule mentions artifacts — so this change touches code
and its comments only.

---

## 2. What the first consumer actually needs

Read-only input from `slack-gatekeeper` (cloned to a scratch directory; **no
change to it is planned here**).

**What an avatar is.** Generated by Workers AI from
`@cf/black-forest-labs/flux-2-klein-9b` (`src/config.ts:48`) at 512×512 — the
size Slack recommends — returned as base64 in `{ image }` and decoded to bytes
with a declared content type of **`image/jpeg`** (`src/agents/admin/avatar.ts:66-100`).
The call deliberately bypasses the AI Gateway because the gateway cannot carry a
multipart binary body. `generateAndStoreIcon` asserts the type is `image/jpeg`
and nothing else (`src/agents/admin/tools.ts:692`).

**How it is stored.** `AvatarStore` (`src/agents/avatar-store.ts`) — the class
the admin agent used to be, renamed by a wrangler migration so its storage came
along (`wrangler.jsonc:49-53`). One instance per workspace, `admin:{wsId}`
(`avatar-store.ts:96`). Each image is a `{ contentType, data: Uint8Array }`
under `icon:{name}:{hash}` in the object's **key-value** storage
(`avatar-store.ts:3-7, 17-22, 57`), where `hash` is the first sixteen hex
characters of the bytes' SHA-256 (`avatar-store.ts:50-54`). An index per agent
keeps the last two and deletes the rest (`avatar-store.ts:10, 59-66`).

**How it is served.** `GET /icons/{wsId}/{name}/{key}.{ext}` at the Worker
(`src/server.ts:80-85`), forwarded to the instance, which answers the bytes with
the stored content type and `public, max-age=31536000, s-maxage=31536000,
immutable` (`avatar-store.ts:24-25, 85-90`). The URL is recorded in D1 as the
agent's `iconUrl` and Slack fetches it with no credential of any kind.

**What that tells the design.**

1. The binary shapes to handle are **small raster images**: a 512×512 JPEG, and
   PNG for anything that produces one. Not video, not documents.
2. The URL must be fetchable by a third party with **no header and no
   credential** — which is exactly what a token-in-URL artifact already is.
3. It must be **cacheable for a long time**, because Slack and every CDN between
   will cache it, and that is desirable rather than tolerated.
4. The URL must be **immutable per image**: a regenerated avatar gets a new URL,
   and the old one keeps resolving for a while so in-flight caches do not 404.
   `(token, sequence)` already has exactly this property, and keeps *every*
   older version rather than two.
5. The avatar today lives under the **128 KiB** production ceiling on a
   key-value value, because that is the API it uses. Anything we offer at or
   above that is not a regression.
6. **`handleArtifactRoute` appears nowhere in `slack-gatekeeper/src`.** It binds
   `ARTIFACTS` and re-exports core's `Artifacts` class (`wrangler.jsonc:32`,
   `src/server.ts:33`) because every task host refuses to start without it, but
   it serves no `/a/<token>` link. Mounting the routes there is a gatekeeper-side
   prerequisite — noted under follow-ups, not planned here.

---

## 3. Measured, not assumed

Run in this container's workerd through a throwaway spec driving the real
`Artifacts` object's `ctx.storage.sql` (deleted again; nothing committed):

- A `BLOB` round-trips **byte-identical** and reads back as `ArrayBuffer`, which
  is what `SqlStorageValue` promises (`core/worker-configuration.d.ts:3281`).
- It succeeds at 64 KiB, 128 KiB, 1 MiB, 2 MiB + 1 and **3,500,000** bytes, and
  throws `string or blob too big: SQLITE_TOOBIG` at **4,194,303**. Cloudflare
  documents 2 MB as the per-row limit, so the usable ceiling is the documented
  one and the measured one is headroom above it.
- Durable Object RPC carried a **2 MiB `Uint8Array`** inbound inside an
  `addEntry` argument without complaint. A 4 MiB *string* also crossed RPC and
  failed at SQLite rather than at the boundary — so for these sizes RPC is not
  the binding constraint.
- `storage.put` of 1 MiB succeeded **locally**. Production enforces 128 KiB on a
  key-value value, so this is a local-only leniency and the design does not lean
  on it. It is the reason to prefer a SQL blob over the key-value API.

---

## 4. The five decisions

### 4.1 Where the binary lives: a BLOB table in the artifact object

Not a new binding. Three reasons, in order of weight:

- **Retention.** An artifact is deleted by one cheap DELETE over `created_at`
  (`store.ts:375-383`). Bytes in R2 or a KV namespace would have a lifetime of
  their own, and keeping two stores in step across a sweep is a job nobody is
  doing — the failure mode is an orphaned object paid for monthly and reachable
  by nobody.
- **Wiring.** `binding.ts:1-13` argues that a required binding is the right
  shape precisely because the alternative is not "a second behaviour worth
  having". A second required binding doubles that cost for every consumer and
  for `create-dynamicagents`. A second *optional* one splits the directory into
  a path with images and a path without.
- **Fit.** The measured ceiling is ~2 MB of documented headroom per row against
  a 512×512 JPEG, and a blob in the same object is written inside the same
  synchronous, non-interleavable window as the entry row it belongs to
  (`store.ts:8-10`).

The blob goes in a **table of its own**, `artifact_entry_media(token, sequence,
bytes BLOB)`, with the *descriptor* — `media_type TEXT`, `media_bytes INTEGER` —
as two narrow columns on `artifact_entries`. That split is the point: `entries()`
(`store.ts:497-507`) and therefore `readArtifact` and every SSE frame keep
scanning narrow rows and never touch a blob, while the blob table is read only by
the bytes route and deleted only by the sweep.

**The limit is explicit: `MAX_ARTIFACT_MEDIA_BYTES = 512 * 1024`.** Four times
what an avatar lives under today, an order of magnitude above a 512×512 JPEG, and
a quarter of the documented row limit so the row keeps headroom. **Above it the
append throws** rather than returning a value: `addEntry` already answers `null`
for "swept, or locked" (`store.ts:274-286`), and `transcribeNote` branches on
that `null` to post the note verbatim instead (`transcript.ts:114-117`) — so
folding a caller's oversized payload into the same answer would make a bug
indistinguishable from a month-old artifact. Nothing partial is written: the
validation runs before either insert.

A thrown error loses its class crossing DO RPC, so the design does not ask a
caller to `instanceof` it: the predicate and the limit are **exported**, a caller
that wants to branch checks before the call, and the throw is the backstop whose
message names the rule. The store's own spec asserts the class (it calls
`makeArtifactStore` in-isolate); the object's spec asserts the message.

### 4.2 The content model: media per entry, not per artifact

An entry gains an optional descriptor; an artifact gains nothing.

```ts
/** What an entry carries besides its text. Images only — see ARTIFACT_MEDIA_TYPES. */
export interface ArtifactMedia {
  type: string;
  byteLength: number;
}

export interface ArtifactEntry {
  sequence: number;
  label: string;
  /** On a media entry, the image's alt text. */
  text: string;
  at: number;
  media?: ArtifactMedia;
}

export interface ArtifactEntryInput {
  label: string;
  text: string;
  key?: string;
  media?: { type: string; data: ArrayBuffer | Uint8Array };
}
```

**Per entry rather than per artifact**, because the artifact is the unit a person
is handed a link to and acts on. A plan and the `approval` note that decided it
are one page (`approval.ts:7-14`); a screenshot belongs on the page it is about,
beside the sentence explaining it, not on a page of its own with no context and
its own link. A typed artifact could never hold both.

**The entry carries the descriptor, never the bytes.** The alternative loses
three things at once: `lookUpPlan` would drag every image on a page through RPC
to read one plan's text (`plans.ts:307-330`); the SSE `entry` frame is JSON
and a base64 payload in it would blow through `MAX_QUEUED_BYTES`
(`do.ts:394-395`); and the viewer wants an `<img src>` a browser can cache, not a
data URI it cannot.

**`text` stays required, and on a media entry it is the alt text.** That keeps
`page[at]!.text` in starter compiling and meaningful, keeps a text-only reader of
any kind served, and means accessibility is not an optional field.

**No chunked append.** An entry is immutable once written — that is what makes
`(token, sequence)` a URL a cache may keep. A chunked media entry would be a
mutable entry, and the first consequence is a cache holding half an image
forever. The limit is one `addEntry` call's worth, and a payload that does not
fit is one the caller re-encodes.

**Who may write: exactly who writes today.** `Artifacts.addEntry`, over the
binding, inside the Worker. No new door, and "there is no HTTP route that writes"
(`do.ts:33-38`) stays literally true. Core ships no tool and no prompt copy for
this: a model-callable "save this image" belongs in `starter` or `plugins`, which
is the line `core/AGENTS.md` draws under "The line core does not cross".
`transcribeNote` and `fileApproval` stay text-only — a sub-agent note is a
sentence and an approval is a verdict.

**The media type is validated against the bytes.** A new module `media.ts` holds
a table of accepted types and their signatures; the caller supplies a type and
the store refuses it when the bytes do not start with that type's signature. So
the `Content-Type` the route serves is provably the shape of the bytes behind it,
and a caller cannot smuggle a document behind `image/png`.

**PNG and JPEG to start**, by signature:

| type | signature |
| ---- | --------- |
| `image/png` | `89 50 4E 47 0D 0A 1A 0A` |
| `image/jpeg` | `FF D8 FF` |

**SVG is refused outright, and that is not an open question.** An SVG served from
this origin and *opened directly* — which a bytes URL invites — runs script on
the origin that also serves the agent's A2A endpoint and its card JWKS. (Inside
an `<img>` it would be inert; direct navigation is the hole.) The alternative is
shipping an XML sanitizer into a package whose own rules are about not importing
things, and owning it forever. The refusal is a named error with that sentence in
it.

**A `Uint8Array` view is normalized before it is stored.** `subarray` into a
larger buffer is the ordinary way a producer slices bytes, and binding the view
must not store the backing buffer. The store copies when
`byteOffset !== 0 || byteLength !== buffer.byteLength`, and a spec pins it.

### 4.3 Serving, and rendering

**A third route under the same prefix:** `/a/<token>/<sequence>`, with an
optional trailing extension that is parsed and ignored.

```ts
export type ArtifactRoute =
  | { token: string; route: "page" }
  | { token: string; route: "events" }
  | { token: string; route: "bytes"; sequence: number };
```

The sequence grammar is `/^\d{1,9}$/` — bounded so no path segment becomes a
`Number` worth worrying about — and it cannot collide with `/events`, which is
not digits. `/a/<token>/raw` stays declined, as `path.spec.ts` already asserts.
The ignored extension exists because the first consumer's current URLs end in
`.jpg` (`slack-gatekeeper/src/agents/admin/tools.ts:694`) and a URL that looks
like an image costs nothing; `nosniff` plus a signature-checked type means the
`Content-Type` is the only authority either way.

**`route.ts` needs no functional change.** It special-cases `page` and forwards
everything else it matched to the stub (`route.ts:53-55`), so a matched `bytes`
route already arrives at the object. Its doc comment, which says "the two
artifact routes", does need one.

**`Artifacts.fetch`** grows a branch beside the events one (`do.ts:267-273`) and
answers:

| header | value | why |
| ------ | ----- | --- |
| `content-type` | the stored type | checked against the bytes at ingest |
| `cache-control` | `public, max-age=<capped>, immutable` | Slack and every CDN between will cache it, and that is the point |
| `x-content-type-options` | `nosniff` | the declared type is the only one a browser may act on |
| `content-disposition` | `inline` | it is a page element, not a download |
| `x-robots-tag` | `noindex, nofollow` | what the page already says (`viewer.ts:223`) |

`max-age` is **capped at the artifact's remaining retention** —
`min(ARTIFACT_CACHE_MAX_AGE, createdAt + ARTIFACT_RETENTION_MS - now)`. That is
what makes `immutable` honest: a cache populated today expires no later than the
artifact it copied, so there is no window in which the store has forgotten an
image and the internet has not. Entry bytes never change, so `immutable` is true
of the rest.

404 for a token that names nothing, a sequence that names no entry, and an entry
with no media — one answer, because distinguishing them tells a holder of a
guessed URL which half they guessed. GET only; `handleArtifactRoute` declines
every other method (`route.ts:43`) and that stays. No range requests: an `<img>`
and a Slack fetch want the whole thing, and a 206 path is surface for nobody.

**The viewer** (`viewer.ts:97-115`) renders a media entry as an `<img>`:
`className`, `loading="lazy"`, `decoding="async"`, `alt = entry.text`, and
`src` built from the same `location.pathname` the stream URL is built from
(`viewer.ts:117`, hoisted to a shared `base`) plus `String(Number(entry.sequence))`.
`onerror` replaces it with the muted note the page already has a class for —
which is what a reader sees for an image whose artifact was swept while the page
was open.

Two properties to preserve, both already written down at `viewer.ts:13-25`: the
page stays **the same bytes for every artifact** (it derives the image URL from
its own location, so no token is interpolated into it), and **nothing
caller-supplied reaches markup** (`src` is a DOM property assignment of a
number this page computed, `alt` is `textContent`-equivalent).

The text is rendered as `alt` and **not also as a caption** — the same string in
both makes a screen reader read it twice. The `.meta` row still carries the label
and the time, as it does for a text entry.

The styling is one rule: `max-width: 100%; max-height: 32rem; height: auto`, so a
tall image does not push the log off the page.

### 4.4 Auth: no new surface, and nothing to decide

The bytes route is under `/a/`, matched by the same `parseArtifactPath` and so by
the same narrow token grammar (`path.ts:26`), reached through the same
`handleArtifactRoute` delegation, forwarded to the same object, and guarded by
the same token and nothing else (`do.ts:39-43`). No header, no query parameter,
no signed URL, no expiry, no second credential.

One thing genuinely changes and is deliberate: the page and the stream are
`no-store` (`do.ts:320`, `viewer.ts:222`) and the bytes are `public`. That is
cacheability, not authorization — a cache hit still requires the URL, and the URL
is the token. It is what the first consumer needs and what its own store already
does (`slack-gatekeeper/src/agents/avatar-store.ts:24-25`). `public` versus
`private` is listed below as a question, with a recommendation.

The specs pin the boundary: a bytes URL with a well-formed unknown token is a
404, one with a token outside the grammar is declined as `null`, and a non-GET is
declined as `null`.

### 4.5 What does not change

- **Retention.** `ARTIFACT_RETENTION_MS` keeps its value and its meaning, and
  the sweep gains one DELETE for the blob table so an image cannot outlive the
  artifact. (Whether an avatar may be swept at all is question 1.)
- **The token model.** Same length, same alphabet, same minter, same grammar,
  same "id and authorization in one".
- **Every existing text artifact.** `ArtifactEntry.media` is optional and absent
  on every row ever written; `readArtifact`, `entries`, `artifactState`, the SSE
  frames and starter's `latestPlan` all read exactly what they read now.
- **The approval flow.** `ask_user`, `mayAskApproval`, `#approval`,
  `fileApproval` and the lock-on-approve ordering are untouched.
- **`transcribeNote` and `settleTranscript`.** Untouched.
- **The watcher bound.** A media entry's frame carries a descriptor, so
  `MAX_QUEUED_FRAMES`/`MAX_QUEUED_BYTES` describe the same thing they do now.
- **The binding.** One required `ARTIFACTS`, one object per deployment, one
  well-known name.
- **`g2a-protocol`.** See below.

---

## 5. Why `g2a-protocol` needs no PR

`HitlArtifact` is `{ id, url }` (`hitl.ts:70-78`) and a gatekeeper's job with it
is to **link** it beside the prompt (`hitl.ts:98-103`). An image artifact's `url`
is its viewer page, the page renders the image, and a gatekeeper that knew
nothing of this change shows the person the right thing. Nothing on the wire
learns a new word.

The first consumer does not touch the wire at all: an avatar is a URL in D1 that
Slack fetches, not a question put to anybody.

**What *would* need a protocol PR**, so the next person can tell: a gatekeeper
rendering the bytes *inline* — a Slack image block instead of a link — because
that needs the direct bytes URL and its media type on the question, which is a
new field on `HitlArtifact` (and, by `g2a-protocol/AGENTS.md`, a patch for an
added value, shipped to both consumers). Nothing in the avatar case or the plan
case asks for it, so it is not in this plan. If it is ever wanted, the train
order is `g2a-protocol` → `core` and that PR goes first.

---

## 6. The PR

One PR, in `core`, against `main`. Title: *Store and serve images in Artifacts*.

### Files

**`src/artifacts/media.ts`** — new. `ARTIFACT_MEDIA_TYPES` (the type → signature
table), `MAX_ARTIFACT_MEDIA_BYTES = 512 * 1024`, `ARTIFACT_CACHE_MAX_AGE`,
`artifactMediaType(bytes): string | null` (the signature match),
`artifactMediaExtension(type)`, `ArtifactMediaTooLargeError`,
`ArtifactMediaTypeError`, and `normalizeMediaBytes`. The module is where the SVG
refusal and the signature-over-declaration rule are explained once; everything
else points here.

**`src/artifacts/media.spec.ts`** — new. Signature detection per type, a
rejection for a plausible-but-wrong payload, SVG and HTML rejected by signature,
the extension table, and the view-normalization rule.

**`src/artifacts/store.ts`**

- `ArtifactMedia`, `ArtifactEntry.media?`, `ArtifactEntryInput.media?`.
- `EntryRow` gains `media_type: string | null`, `media_bytes: number | null` —
  it is already a type alias for the index-signature reason at `store.ts:241-243`,
  and `ArrayBuffer` is a `SqlStorageValue`.
- `CURRENT_SCHEMA_VERSION = 3` and one step in `upgrade`: two `ALTER TABLE
  artifact_entries ADD COLUMN`, and `CREATE TABLE IF NOT EXISTS
  artifact_entry_media (token, sequence, bytes BLOB NOT NULL, PRIMARY KEY (token,
  sequence))`. **Nothing goes in `DDL`** — the rule at `store.ts:163-170`, and
  the trap it names, is the whole reason v2's `locked_at` lives only in a step.
- `rowToEntry` builds `media` when `media_type` is non-null.
- `append` validates (type, then signature, then size) before either insert,
  after the `entry.key` replay return at `store.ts:429-431` so a replay rewrites
  no bytes, and inserts the entry row and the blob row with no await between them
  — which is what makes them atomic (`store.ts:8-10`).
- `entries()` selects the two new columns; the blob table is not joined.
- `media(token, sequence)` — new: one joined read answering
  `{ type, data: ArrayBuffer, artifactCreatedAt }`, or `null`. It does **not**
  sweep, for the reason `entries` does not: a read of a hot image URL must not do
  writes.
- `sweep()` gains a third DELETE, children before parents.
- The `ArtifactStore` interface and its doc comments.

**`src/artifacts/store.spec.ts`** — a v2 → v3 upgrade case in the shape of the
existing v1 → v2 one (`store.spec.ts:167-188`): a store written at target 2 with
a text entry in it comes up to 3, keeps the entry, reads it with no `media`, and
takes a media append afterwards. Plus the refusals asserted as classes, which
only an in-isolate store can do.

**`src/artifacts/do.ts`**

- `addEntry` passes `entry` through as it already does; the doc comment gains
  what a refusal does, since it is now the one path here that throws.
- `fetch` branches on `route === "bytes"` and calls a new private
  `serveMedia(token, sequence)` with the headers from 4.3.
- The "Two doors" comment (`do.ts:31-43`) gains the bytes door on the read side,
  and the `no-alarms` note (`do.ts:51-58`) is unchanged.

**`src/artifacts/do.spec.ts`**

- A media append round-trips **byte-identical** through the object and the route.
- The response's `content-type` is the stored type, and `cache-control` carries
  `immutable` and a `max-age` no greater than the artifact's remaining retention.
- `nosniff` and `content-disposition: inline` are set.
- 404 for an unknown token, for a sequence past the end, and for a text entry's
  sequence.
- A media entry's `entry` SSE frame carries `media` and **not** the bytes.
- `readArtifact` answers the descriptor and no payload.
- A replayed `entry.key` returns the first sequence and leaves the bytes as they
  were.
- A `Uint8Array` view into a larger buffer stores only the view.
- Above the limit the append **throws** and writes nothing — no entry row, no
  blob row, and `entries()` unchanged; the message names the limit.
- A declared type the bytes contradict throws; `image/svg+xml` throws.
- Retention takes the blob: `COUNT(*) FROM artifact_entry_media` is 0 after the
  sweep, in the shape of `do.spec.ts:423-426`.
- `do.spec.ts:590` ("serves nothing but the events route") is renamed and gains a
  case: the page is still a 404 at the object, `/a/<token>/raw` still is, and the
  bytes route is not.

**`src/artifacts/path.ts`** — the `ArtifactRoute` union, the bytes branch with
the bounded sequence grammar and the ignored extension, and
`artifactEntryUrl(origin, token, sequence, mediaType?)`.

**`src/artifacts/path.spec.ts`** — bytes with and without an extension, the
sequence bound, `/events` not read as a sequence, `/a/<token>/0` and
`/a/<token>/raw` and `/a/<token>/1/extra` declined, and `artifactEntryUrl`
round-tripping back through the parser (the coupling the existing
`artifactViewerUrl` case pins the same way).

**`src/artifacts/route.ts`** — doc comment only: three routes, and which two the
object answers.

**`src/artifacts/route.spec.ts`** — a bytes URL is served end to end with the
right `content-type`; a bytes URL on an unknown token is a 404; a non-GET bytes
URL is still `null`; `/a/<token>/raw` is still `null` (the existing `it.each`
table gains rows).

**`src/artifacts/viewer.ts`** — the `.image` style rule, the `base` hoist, the
`media` branch in `render`, the `onerror` fallback, and the comment on why the
text is `alt` and not also a caption.

**`src/artifacts/index.ts`** — `ArtifactMedia`, `ARTIFACT_MEDIA_TYPES`,
`MAX_ARTIFACT_MEDIA_BYTES`, `artifactMediaType`, `artifactMediaExtension`,
`ArtifactMediaTooLargeError`, `ArtifactMediaTypeError`, `artifactEntryUrl`.

### Not in it

- No version bump and no release: `core/AGENTS.md` makes a bump the deliberate
  act that ships, and nothing here is urgent.
- No `wrangler.jsonc` change, so no `npm run types` and no regenerated
  `worker-configuration.d.ts`. `ARTIFACTS` is already bound in the test worker
  (`core/wrangler.jsonc:31, 56`).
- No change to `plugins`, `starter`, `create-dynamicagents` or the submodule
  pointers.
- No per-artifact or per-kind media budget. The bound on what a deployment holds
  is the per-entry limit times the write rate, swept every thirty days, and the
  object reports `databaseSize` if that ever needs watching. Adding a budget
  before anyone has met the bound would be a number core invented.
- No intrinsic dimensions on the descriptor (see question 4).

### Verification

In `core`, on the committed tree:

```bash
npm run check    # peer ranges + types:check + prettier + eslint + tsc x2 + build
npm test         # vitest, inside real workerd
```

Both, not one: `core/AGENTS.md` is explicit that vitest transpiles specs without
typechecking them, so a type error passes a green suite, and that prettier and
the type-aware `no-deprecated` rule only run under `check`.

Nothing else in the train is touched, so nothing else is run. The change is
additive at the type level — `media?` is optional and `ArtifactRoute` becomes a
union whose existing members still satisfy every `route === "page"` narrowing in
core and in starter — and `PLUGIN_CONTRACT_VERSION` does not cover this surface,
so it does not move.

### The PR body

Says what moved and why, lists the schema step, and states the three things a
reviewer should check deliberately: that the blob never travels on a read path,
that `max-age` cannot outlive retention, and that SVG is refused rather than
sanitized. Copilot reviews it, and every thread it opens ends resolved per the
workspace rule.

---

## 7. Open questions — for the maintainer, not decided here

**1. May an avatar be deleted after thirty days?** This is the one that could
change the work. An artifact lives `ARTIFACT_RETENTION_MS` from when it was
opened (`store.ts:18, 375-383`); an avatar in `AvatarStore` lives until it is
replaced (`avatar-store.ts:10, 59-66`). So a gatekeeper that moved avatars into
Artifacts unchanged would, thirty days on, hold an `iconUrl` in D1 that 404s —
and Slack would show the agent with no avatar until somebody regenerated it.

Three answers, and the plan above assumes **(a)** because it is the only one that
touches no core behaviour:

- **(a) The gatekeeper refreshes.** Artifacts stays as it is; the gatekeeper
  re-opens or re-appends inside the window, or regenerates on a miss. Nothing
  here changes, and the whole cost lands on the consumer — including a cron or a
  lazy-regenerate path it does not have today.
- **(b) An artifact may be pinned.** `createArtifact(kind, sourceKey, { pinned:
  true })`, one `pinned_at` column, one predicate in the sweep, one more schema
  step. Additive, changes nothing for any existing artifact, and is *the* right
  shape if "an image that outlives a conversation" is a thing Artifacts should
  support at all. About a day, as its own PR after this one.
- **(c) Retention per kind.** Rejected on sight: it puts a number per domain into
  a package that ships no numbers, and `core/AGENTS.md` draws exactly that line.

If the answer is (b), say so and it becomes a second PR in the same sequence —
the first PR does not change.

**2. Is `MAX_ARTIFACT_MEDIA_BYTES = 512 KiB` the number?** The reasoning is in
4.1 and the measured ceiling is in §3. 128 KiB would match what avatars live
under today exactly; 1 MiB would leave room for a screenshot of a page, which is
the next thing anybody will want to put on a plan.

**3. PNG and JPEG only, or GIF and WebP too?** JPEG is what the avatar model
returns; PNG is the other thing a generator emits. GIF (`47 49 46 38`) and WebP
(`RIFF` at 0, `WEBP` at 8) are one row each in `ARTIFACT_MEDIA_TYPES` and one
signature each, and both are inert in an `<img>` and under direct navigation. Say
the word and they go in the same PR. SVG does not, for the reason in 4.2.

**4. `public` caching, and for how long?** The recommendation is `public,
max-age=<capped at remaining retention>, immutable` — a cache hit still needs the
token, and the first consumer's whole requirement is that Slack and the CDNs
cache it. `private` would be the conservative choice and would cost the consumer
most of the benefit. Separately: is a cap of a year the right ceiling under the
retention cap, or something shorter?

**5. Does the viewer need intrinsic dimensions?** Without them the page reflows
as each image decodes. With them, the descriptor grows `width`/`height` and core
grows a header parser per format — trivial for PNG and GIF, a scan for JPEG, a
branch per chunk kind for WebP. The CSS in 4.3 handles layout either way. The
plan says no; it is a real call.

**6. The viewer's rendering cannot be asserted against a DOM.** There is no
`viewer.spec.ts` and no jsdom harness in core — the page is asserted today only
as a string containing `EventSource` (`route.spec.ts:55-56`). The plan pins what
this repo can pin: the SSE `entry` frame carries the `media` descriptor the page
branches on, and the page string carries the `<img>` construction. Standing up a
DOM harness in the node vitest project would be a separate piece of work; flagged
rather than smuggled in.

---

## 8. Follow-ups that are not this plan's

Gatekeeper-side, after core publishes — **noted, not planned here:**

- **Mount the routes.** `handleArtifactRoute` is absent from
  `slack-gatekeeper/src`; without the one-line delegation that
  `starter/src/index.ts:97` makes, no `/a/<token>` URL resolves there and no
  artifact-hosted image has a URL at all. This is the prerequisite.
- **Migrate or regenerate.** Existing avatars are bytes under `icon:*` keys in
  `AvatarStore`, behind `iconUrl`s already recorded in D1
  (`wrangler.jsonc:49-53` keeps them resolving). Moving them means reading each
  one, appending it to an artifact, and rewriting the `iconUrl` — or simply
  regenerating on the next request and leaving `AvatarStore` serving the old URLs
  until they age out. Which, and whether `AvatarStore` is then deleted, is the
  gatekeeper's call and its repo's PR.
- **The inline-image question.** If the gatekeeper ever wants to render an
  artifact image in a Slack block rather than link its page, that is the
  `g2a-protocol` field in §5, and it goes first in the train.
