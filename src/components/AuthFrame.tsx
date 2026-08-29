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
import { PRODUCT_NAME, PRODUCT_TAGLINE } from "@/lib/brand-name";
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
              {PRODUCT_NAME}
            </div>
            <div
              style={{
                fontSize: 11,
                color: "var(--silver-faint)",
                letterSpacing: ".05em",
                textTransform: "uppercase",
              }}
            >
              {PRODUCT_TAGLINE}
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
/**
 * The auth panel's palette.
 *
 * Named here because the same three values are used a dozen times below and a
 * near-black that drifts between elements is exactly what makes a form look
 * unfinished.
 */
const INK = "#12161c";
const MUTED = "#5b6470";
const LINE = "rgba(0, 0, 0, 0.14)";

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
    colorPrimary: INK,
    colorText: INK,
    colorTextSecondary: MUTED,
    colorInputBackground: "#ffffff",
    colorInputText: INK,
    colorNeutral: INK,
    colorDanger: "#b4232a",
    colorSuccess: "#1c7c4a",
    borderRadius: "10px",
    fontSize: "14px",
    fontFamily: "var(--font-sans), system-ui, sans-serif",
  },

  // Style objects, not class names.
  //
  // These were Tailwind utility strings, and every one of them was silently
  // losing. Tailwind v4 emits utilities inside a cascade layer, Clerk ships its
  // own unlayered stylesheet, and unlayered CSS beats layered CSS whatever the
  // specificity — so "text-white" on the primary button never applied and the
  // label inherited the panel's near-black ink onto a near-black button. Style
  // objects become inline styles, which nothing overrides.
  elements: {
    rootBox: { width: "100%" },
    cardBox: { width: "100%", boxShadow: "none", border: "none" },
    card: { background: "transparent", boxShadow: "none", border: "none", padding: 0 },
    header: { display: "none" },

    formButtonPrimary: {
      background: INK,
      color: "#ffffff",
      border: "none",
      boxShadow: "none",
      textTransform: "none" as const,
      fontSize: "14px",
      fontWeight: 560,
      letterSpacing: "0",
      height: "40px",
    },

    socialButtonsBlockButton: {
      background: "#ffffff",
      color: INK,
      border: `1px solid ${LINE}`,
      boxShadow: "none",
      height: "40px",
      fontWeight: 520,
      textTransform: "none" as const,
    },
    socialButtonsBlockButtonText: { color: INK, fontWeight: 520 },

    dividerLine: { background: LINE },
    dividerText: { color: MUTED },

    formFieldLabel: { color: INK, fontWeight: 520 },
    formFieldInput: {
      background: "#ffffff",
      color: INK,
      border: `1px solid ${LINE}`,
      boxShadow: "none",
      height: "40px",
    },
    formFieldInputShowPasswordButton: { color: MUTED },
    formFieldAction: { color: INK },
    formFieldHintText: { color: MUTED },
    formFieldErrorText: { color: "#b4232a" },
    identityPreviewText: { color: INK },
    identityPreviewEditButton: { color: INK },

    footer: { background: "transparent" },
    footerAction: { background: "transparent" },
    footerActionText: { color: MUTED },
    footerActionLink: { color: INK, fontWeight: 560, textDecoration: "underline" },

    otpCodeFieldInput: { background: "#ffffff", color: INK, border: `1px solid ${LINE}` },
    alertText: { color: INK },
    formResendCodeLink: { color: INK },
  },
};
