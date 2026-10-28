import { ArrowUpRight, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";

export function EmptyState({
  eyebrow = "Nothing here yet",
  title,
  description,
  actionLabel,
  actionTo = "/audits/new",
}) {
  return (
    <section className="empty-state" aria-label={title}>
      <div className="empty-orbit" aria-hidden="true">
        <span className="orbit-line orbit-line-one" />
        <span className="orbit-line orbit-line-two" />
        <span className="orbit-core"><Sparkles size={22} strokeWidth={1.6} /></span>
        <span className="orbit-dot orbit-dot-one" />
        <span className="orbit-dot orbit-dot-two" />
      </div>
      <p className="eyebrow">{eyebrow}</p>
      <h2>{title}</h2>
      <p className="empty-copy">{description}</p>
      {actionLabel && (
        <Link className="button button-primary" to={actionTo}>
          {actionLabel}<ArrowUpRight size={16} />
        </Link>
      )}
    </section>
  );
}
