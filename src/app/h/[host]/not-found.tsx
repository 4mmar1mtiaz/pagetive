export default function NotFound() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        background: "#0a0c10",
        color: "#98a2b0",
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
      }}
    >
      <div style={{ textAlign: "center" }}>
        <p style={{ fontSize: 15 }}>This page is not published.</p>
      </div>
    </main>
  );
}
