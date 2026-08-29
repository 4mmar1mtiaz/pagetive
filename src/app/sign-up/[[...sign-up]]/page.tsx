import { redirect } from "next/navigation";
import { SignUp } from "@clerk/nextjs";
import { AuthFrame, authAppearance } from "@/components/AuthFrame";

export default function Page() {
  // With no Clerk keys the app runs as a single local account and there is
  // nothing to sign into, so this route sends you straight to the workspace
  // rather than rendering a component that needs a provider it will not find.
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || !process.env.CLERK_SECRET_KEY) {
    redirect("/");
  }

  return (
    <AuthFrame heading={"Build your first page"} sub={"The free trial covers one complete landing page — built, restyled, variants written, traffic simulated, heatmap and all. Publishing and export need the unlimited plan."}>
      <SignUp appearance={authAppearance} signInUrl="/sign-in" />
    </AuthFrame>
  );
}
