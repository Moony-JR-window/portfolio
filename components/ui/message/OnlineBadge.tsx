"use client";

interface Props {
  count: number;
}

export default function OnlineBadge({ count }: Props) {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        fontSize: 12,
        color: "#e4e6eb",
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: "#31a24c",
          display: "inline-block",
        }}
      />
      {count} online
    </div>
  );
}