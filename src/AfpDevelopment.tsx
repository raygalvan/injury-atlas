import { useEffect, useState } from "react";
import { api } from "./api";
export function AfpDevelopment() {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState("");
  useEffect(() => {
    void api("/afp/development")
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);
  return (
    <details className="settings-card">
      <summary>Archived shared coding tasks</summary>
      <p>
        The shared repository executor is suspended. AFP customization uses
        private features, not shared deployments. Existing history is retained.
      </p>
      {error && <p role="alert">{error}</p>}
      {data?.jobs.map((job: any) => (
        <article key={job.id}>
          <strong>{job.state}</strong>
          <p>{job.request}</p>
          <p>{job.result}</p>
        </article>
      ))}
    </details>
  );
}
