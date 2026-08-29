import type { MetadataRoute } from "next";
import { appUrl } from "@/lib/hosts";

/**
 * The workspace is not for crawlers, and the endpoints are not content.
 *
 * Published landing pages are the only thing here that should ever appear in a
 * search result. Everything else is either behind sign-in, an API, or a
 * preview of somebody's draft, and a crawler that indexes /p/ drafts or the
 * sign-in page costs the customer ranking on the page they actually meant.
 */
export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/p/"],
        disallow: ["/api/", "/admin", "/pages/", "/sign-in", "/sign-up"],
      },
    ],
    sitemap: `${appUrl().replace(/\/+$/, "")}/sitemap.xml`,
  };
}
