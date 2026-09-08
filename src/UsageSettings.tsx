import React, { useEffect, useState } from "react";

const money = (v: number) => "$" + Number(v || 0).toFixed(4);
export function UsageSettings({
  data,
  editable,
  busy,
  onSave,
  onRefresh,
}: {
  data: any;
  editable: boolean;
  busy: boolean;
  onSave: (v: any) => void;
  onRefresh: () => void;
}) {
  const [policy, setPolicy] = useState(data.policy),
    [selected, setSelected] = useState("");
  useEffect(() => setPolicy(data.policy), [data.policy]);
  const job = data.jobs.find((j: any) => j.id === selected);
  const completePrice = job && !job.unpricedCalls && job.costUsd !== null;
  const cost = job
    ? Number(job.costUsd || 0) +
      (Number(job.minutes || 0) / 60) * policy.processingHourlyUsd +
      policy.overheadPerJobUsd
    : 0;
  const suggested = cost / (1 - policy.targetMargin / 100);
  const field = (label: string, key: string, max = 100000) => (
    <label>
      {label}
      <input
        type="number"
        min="0"
        max={max}
        step="any"
        value={policy[key]}
        onChange={(e) => setPolicy({ ...policy, [key]: Number(e.target.value) })}
      />
    </label>
  );
  return (
    <section className="settings-card" id="usage">
      <div className="usage-heading">
        <div>
          <h2>Usage and pricing</h2>
          <p>
            Last 30 days. Provider-reported tokens include retries and failed responses. Tracking
            starts with this release.
          </p>
        </div>
        <button type="button" onClick={onRefresh}>
          Refresh usage
        </button>
      </div>
      <div className="usage-metrics">
        <article>
          <strong>
            {Number(data.totals.inputTokens) +
              Number(data.totals.cachedTokens) +
              Number(data.totals.cacheWriteTokens)}
          </strong>
          <span>Input tokens, including cache</span>
        </article>
        <article>
          <strong>{data.totals.outputTokens}</strong>
          <span>Output tokens, including reported reasoning</span>
        </article>
        <article>
          <strong>{money(data.totals.knownCostUsd)}</strong>
          <span>Estimated AI subtotal</span>
        </article>
        <article>
          <strong>{data.totals.unpricedCalls}</strong>
          <span>Calls without a cost estimate</span>
        </article>
      </div>
      <p>
        {data.totals.unreportedCalls} calls have no provider usage report. Missing usage is unknown,
        not free. Live voice token usage is not yet collected. This is not a complete provider or
        AWS invoice.
      </p>
      <div className="usage-models">
        {data.models.map((r: any, i: number) => (
          <article key={i}>
            <strong>{r.agent}</strong>
            <p>
              {r.provider} · {r.model}
            </p>
            <p>
              {r.calls} calls · {r.tokens} tokens ·{" "}
              {r.costUsd === null ? "Unpriced" : money(r.costUsd)}
              {r.unpricedCalls > 0 ? " + unpriced calls" : ""}
            </p>
          </article>
        ))}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave(policy);
        }}
      >
        <fieldset disabled={!editable || busy}>
          <legend>Testing and price policy</legend>
          <label className="usage-check">
            <input
              type="checkbox"
              checked={policy.testingEnabled}
              onChange={(e) => setPolicy({ ...policy, testingEnabled: e.target.checked })}
            />
            Super-admin testing mode
          </label>
          <p>
            Removes the daily AI run cap for active super admins and expands library research to 12
            provider calls per stage. Other users keep their normal policy. Provider limits and
            timeouts for stuck jobs still apply.
          </p>
          <label>
            Testing output ceiling per response
            <input
              type="number"
              min="16384"
              max="131072"
              step="1024"
              value={policy.testingMaxTokens}
              onChange={(e) => setPolicy({ ...policy, testingMaxTokens: Number(e.target.value) })}
            />
          </label>
          <p>
            Set this within the selected model’s supported output limit. Research starts with a
            smaller budget and expands automatically when output is truncated.
          </p>
          <h3>Provider rates</h3>
          <p>
            USD per million tokens and per thousand searches. Initial Claude Opus 5 and GPT-6 Astra
            rates are standard short-context reference rates checked September 8, 2026. Confirm your
            account rates. Calls above 200,000 input/cache tokens remain unpriced. Enter rates from
            your provider account for each exact model. Zero means free. Unconfigured models remain
            unpriced. Saved estimates retain the rates used when calculated.
          </p>
          <p>
            <a
              href="https://platform.claude.com/docs/en/about-claude/pricing"
              target="_blank"
              rel="noreferrer"
            >
              Claude pricing
            </a>{" "}
            ·{" "}
            <a
              href="https://developers.openai.com/api/docs/pricing"
              target="_blank"
              rel="noreferrer"
            >
              OpenAI pricing
            </a>
          </p>
          {policy.rates.map((r: any, i: number) => (
            <div className="usage-rate" key={i}>
              <label>
                Provider
                <select
                  value={r.provider}
                  onChange={(e) =>
                    setPolicy({
                      ...policy,
                      rates: policy.rates.map((x: any, j: number) =>
                        j === i ? { ...x, provider: e.target.value } : x,
                      ),
                    })
                  }
                >
                  {["openai", "anthropic", "xai"].map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </select>
              </label>
              <label>
                Exact model ID
                <input
                  required
                  value={r.model}
                  onChange={(e) =>
                    setPolicy({
                      ...policy,
                      rates: policy.rates.map((x: any, j: number) =>
                        j === i ? { ...x, model: e.target.value } : x,
                      ),
                    })
                  }
                />
              </label>
              {(["input", "output", "cachedInput", "cacheWrite", "searchPerThousand"] as const).map(
                (key) => (
                  <label key={key}>
                    {
                      {
                        input: "Input / 1M",
                        output: "Output / 1M",
                        cachedInput: "Cached input / 1M",
                        cacheWrite: "Cache writes / 1M",
                        searchPerThousand: "Searches / 1K",
                      }[key]
                    }
                    <input
                      type="number"
                      required
                      min="0"
                      max="100000"
                      step="any"
                      value={r[key]}
                      onChange={(e) =>
                        setPolicy({
                          ...policy,
                          rates: policy.rates.map((x: any, j: number) =>
                            j === i ? { ...x, [key]: Number(e.target.value) } : x,
                          ),
                        })
                      }
                    />
                  </label>
                ),
              )}
              <button
                type="button"
                onClick={() =>
                  setPolicy({
                    ...policy,
                    rates: policy.rates.filter((_: any, j: number) => j !== i),
                  })
                }
              >
                Remove rate
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              setPolicy({
                ...policy,
                rates: [
                  ...policy.rates,
                  {
                    provider: "openai",
                    model: "",
                    input: 0,
                    output: 0,
                    cachedInput: 0,
                    cacheWrite: 0,
                    searchPerThousand: 0,
                  },
                ],
              })
            }
          >
            Add model rate
          </button>
          <h3>Rendering price calculator</h3>
          <div className="usage-fields">
            {field("Allocated processing cost per hour, USD", "processingHourlyUsd")}
            {field("Storage, review and support allowance per job, USD", "overheadPerJobUsd")}
            {field("Target gross margin, %", "targetMargin", 99)}
            {field("Your customer price, USD", "customerPriceUsd")}
          </div>
          <button type="submit">Save usage and pricing</button>
        </fieldset>
      </form>
      {!editable && (
        <p>The super admin manages pricing and testing controls in Platform settings.</p>
      )}
      <label>
        Inspect a job
        <select value={selected} onChange={(e) => setSelected(e.target.value)}>
          <option value="">Choose a recorded job</option>
          {data.jobs.map((j: any) => (
            <option key={j.id} value={j.id}>
              {j.name} · {j.state}
            </option>
          ))}
        </select>
      </label>
      {job && (
        <div className="usage-quote">
          <p>
            {job.tokens} tokens · {Number(job.minutes).toFixed(2)} processing minutes across
            attempts. Processing time includes waiting for AI and files; the hourly rate is an
            allocation estimate.
          </p>
          <p>
            AI cost {job.costUsd === null ? "unknown" : money(job.costUsd)}
            {job.unpricedCalls ? " plus unpriced calls" : ""}.
          </p>
          {completePrice ? (
            <>
              <p>
                Estimated delivery cost <strong>{money(cost)}</strong>. Price at{" "}
                {policy.targetMargin}% gross margin <strong>{money(suggested)}</strong>.
              </p>
              <p>
                At your price of {money(policy.customerPriceUsd)}, estimated gross profit is{" "}
                <strong>{money(policy.customerPriceUsd - cost)}</strong>.
              </p>
            </>
          ) : (
            <p>Set the missing provider rates before relying on a recommended price.</p>
          )}
          <p>
            Library research alone is not a completed 3D rendering. Use a completed rendering job
            for a rendering quote. No customer is charged by this calculator.
          </p>
        </div>
      )}
      <p>
        For a 70% gross margin, divide delivery cost by 0.30. Include revisions and attorney review
        time in your allowance before choosing a selling price.
      </p>
    </section>
  );
}
