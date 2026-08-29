import { redirect } from "next/navigation";
import { SignIn } from "@clerk/nextjs";
import { AuthFrame, authAppearance } from "@/components/AuthFrame";

export default function Page() {
  // With no Clerk keys the app runs as a single local account and there is
  // nothing to sign into, so this route sends you straight to the workspace
  // rather than rendering a component that needs a provider it will not find.
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || !process.env.CLERK_SECRET_KEY) {
    redirect("/");
  }

  return (
    <AuthFrame heading={"Welcome back"} sub={"Your pages, variants and leads are where you left them."}>
      <SignIn appearance={authAppearance} signUpUrl="/sign-up" />
    </AuthFrame>
  );
}
