import { Spinner } from "@/components/Spinner";

/**
 * Shown while the workspace is rendered on the server.
 *
 * The first paint waits on the sign-in check against the database, and without
 * this the browser sits on a blank tab with no sign that anything is coming.
 */
export default function Loading() {
  return (
    <main className="app-loading">
      <div className="mark" />
      <Spinner block label="Loading your workspace" />
    </main>
  );
}
