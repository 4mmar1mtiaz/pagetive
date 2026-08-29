import { Spinner } from "@/components/Spinner";

/**
 * Shown while the report is being built on the server.
 *
 * The report runs a dozen aggregate queries against however many hundred
 * thousand events a page has collected, and it is a server render, so the
 * browser has nothing at all until it finishes. Without this route the tab
 * simply hangs on the previous screen and the click reads as ignored.
 */
export default function Loading() {
  return (
    <main className="wrap" style={{ padding: "48px 24px" }}>
      <Spinner block label="Building the report" />
    </main>
  );
}
