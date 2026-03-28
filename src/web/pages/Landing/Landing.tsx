import { useDocumentTitle } from "@/web/hooks/use-document-title";
import { useForceDefaultTheme } from "@/web/hooks/use-force-default-theme";

import { CtaSection } from "./components/CtaSection";
import { FeaturesSection } from "./components/FeaturesSection";
import { HeroSection } from "./components/HeroSection";
import { LandingFooter } from "./components/LandingFooter";
import { LandingNav } from "./components/LandingNav";
import { ProductShowcase } from "./components/ProductShowcase";
import { ThemesSection } from "./components/ThemesSection";

export function Landing() {
  useDocumentTitle("Cadence — Find your rhythm");
  useForceDefaultTheme();

  return (
    <div className="landing">
      <LandingNav />
      <HeroSection />
      <FeaturesSection />
      <ProductShowcase />
      <ThemesSection />
      <CtaSection />
      <LandingFooter />
    </div>
  );
}

export default Landing;
