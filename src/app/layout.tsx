import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";
import { appUrl } from "@/lib/hosts";
import { PRODUCT_DESCRIPTION, PRODUCT_NAME, PRODUCT_TAGLINE } from "@/lib/brand-name";

const sans = Inter({ variable: "--font-sans", subsets: ["latin"] });
const mono = JetBrains_Mono({ variable: "--font-mono", subsets: ["latin"] });

/**
 * Defaults for every screen the app itself renders.
 *
 * metadataBase is what makes the social card work: relative image paths in
 * openGraph are resolved against it, and without it Next emits a relative URL
 * that no scraper can fetch, so a shared link renders as a bare string. It has
 * to be the deployment's own origin, which is why it comes from appUrl()
 * rather than a constant.
 *
 * Published landing pages set their own title and description over these.
 */
export const metadata: Metadata = {
  metadataBase: new URL(appUrl()),
  title: { default: PRODUCT_NAME, template: `%s · ${PRODUCT_NAME}` },
  description: PRODUCT_DESCRIPTION,
  applicationName: PRODUCT_NAME,
  openGraph: {
    type: "website",
    siteName: PRODUCT_NAME,
    title: `${PRODUCT_NAME} — ${PRODUCT_TAGLINE}`,
    description: PRODUCT_DESCRIPTION,
    url: appUrl(),
    images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: PRODUCT_NAME }],
  },
  twitter: {
    card: "summary_large_image",
    title: `${PRODUCT_NAME} — ${PRODUCT_TAGLINE}`,
    description: PRODUCT_DESCRIPTION,
    images: ["/opengraph-image"],
  },
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
