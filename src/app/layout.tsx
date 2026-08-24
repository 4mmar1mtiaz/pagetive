import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";

const sans = Inter({ variable: "--font-sans", subsets: ["latin"] });
const mono = JetBrains_Mono({ variable: "--font-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Adaptive LP",
  description: "Describe a landing page. It gets built, published, tracked, and it keeps testing itself.",
};

// Clerk is optional. With no keys the app runs as a single local account, so
// self-hosting and development never depend on an auth vendor being wired up.
const clerkOn = Boolean(
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY,
);

/**
 * Provider-level appearance covers the components that live inside the dark
 * app — currently just the UserButton. The sign-in and sign-up screens pass
 * their own light appearance instead; see components/AuthFrame.
 */
const appearance = {
  variables: {
    colorBackground: "#0f1319",
    colorPrimary: "#dfe6ef",
    colorText: "#e6ebf2",
    colorTextSecondary: "#98a2b0",
    colorInputBackground: "rgba(255,255,255,0.04)",
    colorInputText: "#ffffff",
    borderRadius: "12px",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>
        {clerkOn ? (
          <ClerkProvider appearance={appearance} dynamic>
            {children}
          </ClerkProvider>
        ) : (
          children
        )}
      </body>
    </html>
  );
}
