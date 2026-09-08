import type { AssistantCard } from "../../shared/ai";
export function AssistantCardView({ card }: { card: AssistantCard }) {
  const link = (href?: string) =>
    href?.startsWith("/") && !href.startsWith("//") ? href : undefined;
  return (
    <article className="as-card">
      <h3>{card.title}</h3>
      {card.body && <p>{card.body}</p>}
      {card.items?.map((i) => (
        <div className="as-card-row" key={i.id}>
          {link(i.href) ? (
            <a href={link(i.href)}>{i.title}</a>
          ) : (
            <strong>{i.title}</strong>
          )}
          {i.detail && <p>{i.detail}</p>}
        </div>
      ))}
      {link(card.href) && <a href={link(card.href)}>Open workspace →</a>}
    </article>
  );
}
