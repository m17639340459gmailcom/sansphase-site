import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { Suspense, type ReactNode } from "react";
import { CommandPalette } from "@/components/command/command-palette";
import { Cursor } from "@/components/fx/cursor";
import { FX_NOSCRIPT_CSS } from "@/components/fx/noscript";
import { Footer } from "@/components/layout/footer";
import { FooterVisibility } from "@/components/layout/footer-visibility";
import { Navbar } from "@/components/layout/navbar";
import { ScrollProgress } from "@/components/layout/scroll-progress";
import { SmoothScroll } from "@/components/providers/smooth-scroll";

// A publication, withdrawal, or session change must be visible on the next request.
export const dynamic = "force-dynamic";

export default async function SiteLayout({ children }: { children: ReactNode }) {
  const { Blog, Common, FX, Home, Library, Nav, Projects, Skills } = await getMessages();

  return (
    <NextIntlClientProvider messages={{ Blog, Common, FX, Home, Library: { catalog: Library.catalog }, Nav, Projects, Skills }}>
      <noscript>
        <style dangerouslySetInnerHTML={{ __html: FX_NOSCRIPT_CSS }} />
      </noscript>
      <div id="top" />
      <ScrollProgress />
      <SmoothScroll />
      <div className="grain-overlay" aria-hidden />
      <Cursor />
      <Navbar />
      <main className="flex-1">{children}</main>
      <FooterVisibility>
        <Footer />
      </FooterVisibility>
      <Suspense fallback={null}>
        <CommandPalette />
      </Suspense>
    </NextIntlClientProvider>
  );
}
