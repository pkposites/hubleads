import { ImageResponse } from "next/og";

/** The app icon: "LH" on a dark square, with room for maskable cropping. */
export function appIcon(size: number) {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#18181b",
          color: "#ffffff",
          fontSize: size * 0.36,
          fontWeight: 700,
          letterSpacing: -size * 0.01,
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline" }}>
          LH<span style={{ color: "#10b981" }}>.</span>
        </div>
      </div>
    ),
    { width: size, height: size },
  );
}
