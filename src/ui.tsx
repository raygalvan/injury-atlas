import React from "react";
import { FolderOpen } from "lucide-react";
export function Field({
  name,
  label,
  type = "text",
  placeholder = "",
  defaultValue,
}: {
  name: string;
  label: string;
  type?: string;
  placeholder?: string;
  defaultValue?: string;
}) {
  return (
    <label>
      {label}
      <input
        name={name}
        type={type}
        placeholder={placeholder}
        defaultValue={defaultValue}
        required
        maxLength={240}
      />
    </label>
  );
}
export function Empty({
  title,
  text,
  action,
  label,
}: {
  title: string;
  text: string;
  action?: () => void;
  label?: string;
}) {
  return (
    <section className="empty">
      <FolderOpen size={30} />
      <h2>{title}</h2>
      <p>{text}</p>
      {action && (
        <button className="primary" onClick={action}>
          {label}
        </button>
      )}
    </section>
  );
}
