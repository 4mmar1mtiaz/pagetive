/**
 * Shared chrome for the two Clerk screens.
 *
 * The panel is deliberately light while the rest of the app is dark. Clerk's
 * components render their own surface, and on a dark translucent panel the
 * result was black-on-black — the form was effectively invisible. Rather than
 * fight it with overrides, the sign-in panel is the one light surface in the
 * product: near-white, slightly translucent so the background still reads
 * through it, with the app's dark ink on top.
 */
export function AuthFrame({
  heading,
  sub,
  children,
}: {
  heading: string;
  sub: string;
  children: React.ReactNode;
}) {
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
      <div style={{ width: "100%", maxWidth: 460 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 22 }}>
          <div className="mark" style={{ width: 30, height: 30, borderRadius: 9 }} />
          <div>
            <div className="chrome" style={{ fontWeight: 640, fontSize: 17, letterSpacing: "-0.01em" }}>
              Adaptive LP
            </div>
            <div
              style={{
                fontSize: 11,
                color: "var(--silver-faint)",
                letterSpacing: ".05em",
                textTransform: "uppercase",
              }}
            >
              one page, many versions
            </div>
          </div>
        </div>

        <div
          style={{
            background: "rgba(243, 245, 248, 0.93)",
            border: "1px solid rgba(255, 255, 255, 0.5)",
            borderRadius: "var(--radius)",
            backdropFilter: "blur(26px) saturate(140%)",
            WebkitBackdropFilter: "blur(26px) saturate(140%)",
            boxShadow: "0 30px 70px -34px rgba(0, 0, 0, 0.95), inset 0 1px 0 rgba(255, 255, 255, 0.8)",
            padding: "26px 24px",
            color: "#0d1117",
          }}
        >
          <h1
            style={{
              fontSize: 21,
              fontWeight: 620,
              letterSpacing: "-0.02em",
              margin: "0 0 6px",
              color: "#0d1117",
            }}
          >
            {heading}
          </h1>
          <p style={{ color: "#5b6470", fontSize: 13, margin: "0 0 18px" }}>{sub}</p>
          {children}
        </div>
      </div>
    </main>
  );
}

/**
 * Passed to SignIn and SignUp only, not to the provider.
 *
 * Scoping it here keeps the UserButton in the dark workspace on its own
 * defaults — a single global light theme would have dragged that popover into
 * the wrong palette to fix a problem that only exists on these two screens.
 */
/**
 * How the Clerk widget is styled.
 *
 * One object, shared by both screens, so sign-in and sign-up cannot drift
 * apart. `variables` are Clerk's own tokens and cover most of it; `elements`
 * are per-part class overrides for the handful of things the tokens cannot
 * reach, and `options` controls structure rather than colour.
 *
 * The card's own chrome is turned off on purpose. AuthFrame already draws a
 * panel, and leaving Clerk's border and shadow on produced a card inside a
 * card.
 */
export const authAppearance = {
  options: {
    // Clerk's own "Sign up" and "Sign in" links inside the widget follow the
    // signUpUrl / signInUrl props on the components, not this object — without
    // those props they point at the hosted portal on accounts.<domain>, which
    // is a different design on a different subdomain.
    socialButtonsVariant: "blockButton" as const,
    socialButtonsPlacement: "top" as const,
  },
  variables: {
    colorBackground: "transparent",
    colorPrimary: "#12161c",
    colorText: "#0d1117",
    colorTextSecondary: "#5b6470",
    colorInputBackground: "#ffffff",
    colorInputText: "#0d1117",
    colorNeutral: "#0d1117",
    borderRadius: "10px",
    fontSize: "14px",
  },
  elements: {
    rootBox: "w-full",
    cardBox: "w-full shadow-none border-0",
    card: "bg-transparent shadow-none border-0 p-0",
    header: "hidden",
    footer: "bg-transparent",
    footerAction: "bg-transparent",
    socialButtonsBlockButton: "border border-black/15 bg-white hover:bg-black/[0.03]",
    formFieldInput: "border border-black/15 bg-white",
    formButtonPrimary: "bg-[#12161c] text-white hover:bg-[#232a33] normal-case",
  },
};
