import Link from "next/link";
import { notFound } from "next/navigation";
import { adminEmails, currentSession } from "@/lib/account";
import { listAccounts } from "@/lib/admin";
import { AdminTable } from "@/components/AdminTable";

/**
 * The agency side.
 *
 * A non-admin gets a 404 rather than a "forbidden" — the existence of this page
 * is not something a customer needs confirmed.
 */
export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const session = await currentSession();
  if (!session.isAdmin) notFound();

  const { accounts, totals } = await listAccounts();

  return (
    <div style={{ maxWidth: 1240, margin: "0 auto", padding: "22px 20px 90px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 22 }}>
        <Link className="btn sm ghost" href="/">
          ← Workspace
        </Link>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 19, fontWeight: 600, letterSpacing: "-0.02em" }}>Accounts</div>
          <div className="sm">Everyone using this install, what they use, and what they cost.</div>
        </div>
      </div>

      <div className="kpis" style={{ marginBottom: 22 }}>
        <div className="kpi">
          <div className="v">{totals.accounts}</div>
          <div className="l">accounts</div>
        </div>
        <div className="kpi">
          <div className="v">{totals.pages}</div>
          <div className="l">pages</div>
        </div>
        <div className="kpi">
          <div className="v">{totals.leads.toLocaleString()}</div>
          <div className="l">leads captured</div>
        </div>
        <div className="kpi">
          <div className="v">${totals.spendUsd.toFixed(2)}</div>
          <div className="l">ai spend, all time</div>
        </div>
      </div>

      <AdminTable accounts={accounts} />

      <div className="note" style={{ marginTop: 16 }}>
        <strong>Page limit</strong> — blank uses the plan default (1 on trial, unlimited on paid). A number
        overrides it for that account only, so you can give somebody room without inventing a plan.
        <strong> Reset</strong> clears their lifetime page count, which hands a trial back.
        <strong> Suspend</strong> stops new work immediately and deletes nothing; their live pages keep
        serving and keep capturing leads.
      </div>

      <div className="note" style={{ marginTop: 10 }}>
        Admins are set by the <code className="mono">ADMIN_EMAILS</code> environment variable, not in here — so
        nobody can promote themselves through the app.{" "}
        {adminEmails().length > 0 ? `Currently: ${adminEmails().join(", ")}.` : "Currently: nobody."}
      </div>
    </div>
  );
}
