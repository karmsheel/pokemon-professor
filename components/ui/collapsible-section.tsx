"use client";

import type { ReactNode } from "react";

export interface CollapsibleSectionProps {
  isExpanded: boolean;
  onToggle: () => void;
  label: string;
  children: ReactNode;
}

export function CollapsibleSection({
  isExpanded,
  onToggle,
  label,
  children,
}: CollapsibleSectionProps) {
  return <div className="collapsible-section">{children}</div>;
}

export interface CollapsibleHeaderProps {
  isExpanded: boolean;
  onToggle: () => void;
  label: string;
  children?: ReactNode;
}

export function CollapsibleSectionHeader({
  isExpanded,
  onToggle,
  label,
  children,
}: CollapsibleHeaderProps) {
  return (
    <div
      className="collapsible-header"
      role="button"
      tabIndex={0}
      aria-label={`${isExpanded ? "Collapse" : "Expand"} ${label}`}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle();
        }
      }}
    >
      <span className="collapsible-label">{label}</span>
      <span className="collapsible-chevron">
        {isExpanded ? "▼" : "▶"}
      </span>
      {children}
    </div>
  );
}

export interface CollapsibleContentProps {
  isExpanded: boolean;
  children: ReactNode;
}

export function CollapsibleSectionContent({
  isExpanded,
  children,
}: CollapsibleContentProps) {
  if (!isExpanded) return null;
  return <div className="collapsible-content">{children}</div>;
}
