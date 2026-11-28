# Running the worker on Render during judging

The web app is a static site on Cloudflare Pages (`https://escape-the-crypt.pages.dev`, from the README). The worker (`apps/worker`) is the only part that runs on Render. It holds all of its state in memory. There is no database.

**How this was checked.** Every statement about our code was read against the source on 2026-11-27: `config.ts`, `start.ts`, `index.ts`, `lock-type-flags.ts`, `budget/interim-ledger.ts`, `jobs/job-store.ts`, `http/server.ts`, `http/routes-jobs.ts`, `http/rate-limit.ts`, `http/judge-access.ts`, `http/cors.ts` and `http/job-runner.ts`. Statements about Render come from Render's docs, linked where they appear. Nothing here was tested on a live Render service. Anything I could not confirm is marked **Unconfirmed** and collected in section 7.

## 1. Service settings

| Setting | Value | Why |
| --- | --- | --- |
| Service type | Web Service | The worker is an HTTP server. |
| Node version | Leave `NODE_VERSION` unset. | The root `package.json` has `"engines": { "node": ">=22 <23" }`. [Render reads `engines`](https://render.com/docs/node-version), and its default for new services is Node 24, so keep that line. |
| Build command | `corepack enable && pnpm install --frozen-lockfile && pnpm --filter @escape-the-crypt/worker build` | The worker script `build` bundles `src/index.ts` into `apps/worker/dist/index.js` with esbuild. `packageManager` pins pnpm. **Unconfirmed:** whether Render needs `corepack enable` to honour it. |
| Start command | `pnpm --filter @escape-the-crypt/worker start` | Runs `node dist/index.js`. |
| Health check path | `/health` | See section 5. |
| `PORT` | Do not set it. | [Render sets `PORT`](https://render.com/tutorials/web-service-vs-static-site/web-services) (default 10000). The worker reads it and falls back to 8787 only when it is unset. |
| Instance type | Check it. | [A free instance spins down after 15 minutes without inbound traffic](https://render.com/free) and takes about a minute to wake. Each spin-down is a restart (section 4). |
| Auto-Deploy | Consider turning it off during judging. | Every redeploy is a restart. |

The code calls `listen(port)` with no host, so Node binds all interfaces. [Render's docs ask for host `0.0.0.0`](https://render.com/docs/web-services). **Unconfirmed** on a live service. If a deploy reports no open port, that is the first thing to change.

## 2. Environment variables

Set these in the service's Environment tab. Never put values in the repo, in a chat, or in a URL. [Render offers three save options](https://render.com/docs/configure-environment-variables): "Save, rebuild, and deploy", "Save and deploy" (existing build, new values) and "Save only" (no deploy, the worker keeps the old values). After an edit, use **Save and deploy**.

| Name | Needed | What it does | Safe value or source |
| --- | --- | --- | --- |
| `PROVIDER` | no | `openai` or `gemini`. Unset means `openai`. Anything else stops the worker at startup. | `openai`. `gemini` only as the fallback (section 3). |
| `OPENAI_API_KEY` | when `PROVIDER` is `openai` or unset | The provider key. Missing stops the worker at startup. | A key from your OpenAI project. Set a monthly spending limit on that project: it is the only limit that survives a worker restart. |
| `OPENAI_MODEL` | same | Model ID sent on every call. Missing stops the worker at startup. | The model your last dev run measured. The dev runs in `eval/results/` used `gpt-5.4-mini`. |
| `PRICE_INPUT_USD_PER_MTOK`, `PRICE_OUTPUT_USD_PER_MTOK` | to accept jobs on OpenAI | Dollars per million tokens, used by the budget. Positive numbers. Missing or invalid: the worker starts, `/health` says `budget-not-configured`, and every job fails. | Copy from OpenAI's pricing page for exactly that model. Wrong prices make the budget wrong. |
| `GEMINI_API_KEY` | when `PROVIDER=gemini` | Key for the Gemini API. | A key from a billing-enabled Google project. The README privacy note explains why unpaid quota is not acceptable. |
| `GEMINI_MODEL` | when `PROVIDER=gemini` | A bare model ID. Missing, or anything with a slash or query, stops the worker at startup. | The ID from Google AI Studio. There is no default in code. |
| `GEMINI_PRICE_INPUT_USD_PER_MTOK`, `GEMINI_PRICE_OUTPUT_USD_PER_MTOK` | when `PROVIDER=gemini` | Same as the OpenAI prices. Both are required, and a gap stops the worker at startup. Thinking tokens are counted as output. | Google's pricing page for that model. |
| `WEB_ORIGIN` | yes | The one origin allowed by CORS. The comparison is exact. | `https://escape-the-crypt.pages.dev`, with no trailing slash and no path. A Cloudflare preview URL is a different origin and is refused. Confirm the live address first. |
| `DAILY_BUDGET_USD` | to accept jobs | Spending cap per UTC day, for this process only. Missing, non-numeric or 0 or less: `budget-not-configured`. | An amount you accept losing. Each provider call reserves `(20,000 x input price + 4,096 x output price) / 1,000,000` dollars before it runs, and reservations for calls in flight count against the cap. A cap below that refuses every call. |
| `JUDGE_ACCESS_TOKEN` | no | Turns on `POST /judge/jobs`. Only its SHA-256 is kept. Unset or shorter than 24 characters: that route answers 404. The worker still starts, and logs one line saying whether judge access is `enabled` or `disabled` (with `unset` or `shorter-than-24-characters`), never the code or its length. | At least 24 random characters. In PowerShell: `$b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [Convert]::ToBase64String($b)`. Rotating it means a new value and a deploy. |
| `DISABLED_LOCK_TYPES` | no | Section 3. | Unset, or one name such as `combination-dial`. |
| `TRUSTED_PROXY_HOPS` | no | Which `X-Forwarded-For` entry, counted from the end, the per-IP rate limit treats as the visitor. A whole number from 0 to 3; unset means 1. Anything else (`4`, `1.0`, `two`) stops the worker at startup with `TRUSTED_PROXY_HOPS must be a whole number from 0 to 3 (unset means 1)`. `0` ignores the header and uses the connection's address, which on Render is the proxy's, so every visitor would share one limit. | Leave it unset unless the section 7 test says otherwise. |
| `JOB_TTL_MINUTES` | no | How long a finished job, with the notes text and the result, stays in memory. A positive number. Default 30. After that only a content-free record remains, for 24 hours. | Leave it unset. The README promises 30 minutes. |
| `PORT` | no | See section 1. | Leave it to Render. |

Web build variable, on Cloudflare Pages and not Render: `VITE_WORKER_URL` is the worker's `https://` origin. Without it the "Generate from my notes" button is hidden. It is read at build time, so a change needs a new web build. The build adds that origin to `connect-src` in the web app's `_headers` file.

**Fixed in code.** These are not environment variables. Changing one needs a code change and a deploy.

- 20 live jobs in total, and 1 running job per session. Judge jobs skip both limits.
- 3 judge jobs at once, counted apart from the public limit.
- 6 `POST /jobs` per IP in any 15 minutes, with at most 10,000 IPs remembered. (Which address counts as the IP is `TRUSTED_PROXY_HOPS`, above.)
- A request body up to 256 KiB, and notes up to 6,000 words.
- A provider call times out after 60 seconds, with 1 retry, and answers up to 4,096 tokens.
- A job still queued or running after 10 minutes is failed by the sweep. The sweep runs every minute.

## 3. The two switches

### `PROVIDER=gemini`

1. Set `PROVIDER=gemini`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_PRICE_INPUT_USD_PER_MTOK` and `GEMINI_PRICE_OUTPUT_USD_PER_MTOK`.
2. Choose **Save and deploy**.
3. Check the startup log line: it shows `provider: "gemini"` and `budgetConfigured: true`.

To switch back, set `PROVIDER=openai` or delete it, then deploy. The OpenAI variables are not read while `PROVIDER=gemini`, so leave them in place.

- Switching is manual. The worker never fails over by itself.
- A missing or invalid Gemini value stops the worker at startup with a message that names the variable and never shows a value.
- The deploy is a restart, so the daily spend counter starts again at 0 (section 4). Spend on the other provider is not counted.
- There is no Gemini run in `eval/results/` yet (all three result files are OpenAI `gpt-5.4-mini`), so question quality on Gemini is unmeasured.

### `DISABLED_LOCK_TYPES`

A comma-separated list of lock types the worker will not ask the model for. Names are `rune-cipher`, `seance-board`, `bone-ordering`, `bound-threads`, `cursed-object` and `combination-dial`. Spaces and capitals are ignored, and an empty value disables nothing.

- It narrows generation for public and judge jobs. It does not touch the bundled sample crypts or the evaluation CLI.
- An unknown name stops the worker at startup (`DISABLED_LOCK_TYPES contains an unrecognised lock type`). Leaving fewer than two types stops it too (`...fewer than two lock types enabled`).
- The startup log line shows `enabledLockTypeCount` and `disabledLockTypes`.
- It is read once at startup, so a change needs **Save and deploy**.

## 4. What a restart loses

A restart happens on every deploy, when Render restarts an instance that fails its health checks, after a crash, and after each free-instance spin-down. On `SIGTERM` the worker stops listening and exits. It does not wait for running jobs.

| Held in memory | After a restart |
| --- | --- |
| All jobs: queued, running and finished, with the notes text and the result | Gone. `GET /jobs/:id` answers 404 "Nothing is here." A job that was running stops. Calls already sent to the provider may still be billed, and the ledger does not count them. |
| Idempotency keys | Forgotten. A retry of the same request starts a new job and a new spend. |
| The daily budget counter | Back to 0. `DAILY_BUDGET_USD` limits one process lifetime, not one calendar day, so repeated restarts can spend more than the cap in a day. The backstop is a spending limit on the provider account. For OpenAI that is a monthly limit on the project. **Unconfirmed:** which limit Google offers. |
| Per-IP rate-limit counts, judge jobs in flight | Back to empty. |

Not lost: the learner's notes and saved crypts (they live in the browser), the bundled sample crypts, and every environment variable.

## 5. Reading the health endpoint

```powershell
Invoke-RestMethod https://<worker-host>/health
```

The answer is HTTP 200 whenever the process is serving, with one of two bodies:

- `{"status":"ok"}`: a valid `DAILY_BUDGET_USD` and both prices are set.
- `{"status":"budget-not-configured"}`: the worker is up, but every job is accepted (HTTP 202) and then fails with the "used up its candles" message. The startup log line `budget not configured: jobs refused` lists the missing variable names in `missing`.

`/health` does not check the provider key, whether the provider is reachable, how much budget is left, or how many jobs are queued. A healthy answer with every job failing as `generation-failed` is a provider problem: read the logs. Render's health check passes in both states, so it will not flag a budget mistake. Read the body yourself.

Logs are one JSON line per event on stdout, with counts, timings and closed-set names, never notes, prompts, model output, keys or IPs:

| `event` | Useful fields |
| --- | --- |
| `startup` | `provider`, `budgetConfigured`, `trustedProxyHops`, `enabledLockTypeCount`, `disabledLockTypes`, `missing`; a separate line with `note: "judge access"` and `judgeAccess`, plus `judgeAccessReason` when disabled |
| `startup-failed` | `kind`, `message`: the worker exited and the deploy did not come up |
| `request` | `route`, `status`, `durationMs`, `errorKind` |
| `provider-call` | `provider`, `stage`, `outcome` (`ok`, `timeout`, `rate-limited`, `provider-error`, `invalid-response-shape`), token counts |
| `job` | `status`, `failure`, `errorKind`, `durationMs`, `calls` |
| `sweep` | `expired`, `swept`, every minute |

## 6. "Something is broken during judging": five steps

1. **Check the worker.** Run the health command above. No answer, or a slow one, means the instance is asleep or has crashed. On a free instance wait a minute. Then open the service's Logs and look for `startup-failed`: its `message` names the variable to fix. [Per Render's docs](https://render.com/articles/how-render-handles-deploy-failures), a deploy whose new instance never becomes healthy is cancelled and the old instance keeps running.
2. **Name the symptom from the logs.**

   | What you see | Likely cause | Action |
   | --- | --- | --- |
   | `provider-call` with `rate-limited`, `provider-error` or `timeout`, or jobs failing `generation-failed` | The provider is out of credit, down, or refusing the key | Step 3 |
   | Jobs failing `budget-exhausted`, or `/health` says `budget-not-configured` | The daily cap is spent, or a budget variable is missing | Set the missing variable, or raise `DAILY_BUDGET_USD`, and deploy. A deploy also resets the counter. |
   | Status 429 with `errorKind` `rate-limited` | One IP made 6 public starts in 15 minutes | Judges use `/judge/jobs`, which is not limited by IP. Others wait for `Retry-After`. |
   | 429 `capacity` | 20 live jobs. Finished jobs count until their 30 minutes are up. | Wait, or restart the worker to clear them. |
   | 429 `session-busy` | That browser already has a job running | Wait for it to finish, or cancel it. |
   | `/judge/jobs` answers 403 or 404 | 403: the code is wrong. 404: judge access is off; the `judge access` startup line says `disabled` and why | Fix the variable and deploy. |
   | The page shows a network error and the worker is healthy | `WEB_ORIGIN` is not exactly the page's origin, or `VITE_WORKER_URL` points elsewhere | Compare both, character for character. |
   | One lock type keeps producing bad or failing questions | A model problem with that type | Step 4 |

3. **If the provider is the problem, switch it.** Use the `PROVIDER=gemini` steps in section 3. Confirm the new startup line before telling anyone to retry.
4. **If one lock type is the problem, switch it off.** Set `DISABLED_LOCK_TYPES` to that name, **Save and deploy**, and read the startup line.
5. **If nothing works, send people to the sample crypt.** "Enter the crypt: The human heart" runs entirely in the browser and needs no worker. Then fix the worker calmly. Rolling back to the last good deploy from the Render dashboard is the usual exit; **Unconfirmed:** the exact menu path, so find it before judging starts.

**Smoke test after any fix.** This spends real money on one job. Put the judge code into this shell session only, from a hidden prompt, so it never appears in a command line, a history file or a chat:

```powershell
$k = Read-Host 'Judge code' -AsSecureString
$env:JUDGE_CODE = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($k)); Remove-Variable k
```

Then run the following, and afterwards `Remove-Item Env:JUDGE_CODE`.

```powershell
$worker = 'https://<worker-host>'
$session = 'a' * 32
$headers = @{ 'X-Judge-Token' = $env:JUDGE_CODE; 'X-Session-Token' = $session; 'Idempotency-Key' = [guid]::NewGuid().ToString('N') }
$body = @{ notesText = (Get-Content samples/human-heart.txt -Raw); runLength = 'short' } | ConvertTo-Json
$job = Invoke-RestMethod -Method Post -Uri "$worker/judge/jobs" -Headers $headers -ContentType 'application/json' -Body $body
Invoke-RestMethod "$worker/jobs/$($job.jobId)?progress=1" -Headers @{ 'X-Session-Token' = $session }
```

Repeat the last line until `status` is `completed` or `failed`.

## 7. Check these on the live service before judging

1. **The client address behind Render.** The per-IP limit takes the last entry of `X-Forwarded-For` (`TRUSTED_PROXY_HOPS`, default 1). Reports from Render's feedback board (2021) are mixed: one says Render only appends to the header and that Cloudflare is probably in front, another that the first entry is the client. If more than one proxy adds an address, every visitor would share one bucket and the public path would refuse most people after 6 starts in total. Test: from one network run `1..7 | ForEach-Object { curl.exe -s -o NUL -w '%{http_code}\n' -X POST https://<worker-host>/jobs }`. The requests have no headers, so they answer 400 and cost nothing, and the 7th should answer 429. Then send one from a second network, such as a phone hotspot. It must answer 400, not 429. If it answers 429, a second proxy is adding an address: set `TRUSTED_PROXY_HOPS=2` and choose **Save and deploy**. That needs no code change or rebuild, but it is a restart (section 4). Check that the `listening` line shows `trustedProxyHops: 2`, then run the test again. Judges are not affected, because `/judge/jobs` skips the IP limit.
2. The listen host (section 1) and the build command (section 1).
3. The instance type, and whether Auto-Deploy is on.
4. The exact path for a manual rollback.
5. Which spending limit the Google account offers.
6. That `WEB_ORIGIN` equals the live page's origin.
